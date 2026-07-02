const fs = require("node:fs");
const path = require("node:path");

// ティッカー/カードに出る見出しと要約を、元表現のコピーではない日本語の独自見出し・独自要約へ整える。
// - 対象: official-news / media-news / ai-signals の items[]（ティッカーはこれらを流す）。
// - OPENAI_API_KEY があるときだけ実行。無ければ何もしない（=英語のままフォールバック）。
// - 失敗(料金超過429など)はバッチ単位で握りつぶし、その分は英語のまま据え置く。
// - コスト節約のため複数項目を1回のAPIでまとめて翻訳する。

const root = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const write = args.has("--write");
const force = args.has("--force");
const batchSize = Number(getArg("--batch=", "15"));
const model = getArg("--model=", process.env.OPENAI_MODEL || "gpt-4o-mini");
const apiKey = process.env.OPENAI_API_KEY;

const targetFiles = ["official-news.json", "media-news.json", "ai-signals.json"].map((name) =>
  path.join(root, "data", name)
);

function getArg(prefix, fallback) {
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// 日本語(かな/カナ/漢字)を含むタイトルは翻訳不要とみなす。
function hasJapanese(text) {
  return /[ぁ-んァ-ヶ一-龠]/.test(String(text || ""));
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[、。,. ]+$/u, "")}...`;
}

function signalTranslationLooksConsistent(item, titleJa) {
  if (item.tag !== "Price") return true;
  const title = String(titleJa || "");
  const source = String(item.source || item.title || "");
  const rules = [
    { source: /OpenAI/i, required: /OpenAI/i, forbidden: /Anthropic|Claude|Gemini|Google/i },
    { source: /Anthropic/i, required: /Anthropic|Claude/i, forbidden: /OpenAI|Gemini|Google/i },
    { source: /Google|Gemini/i, required: /Google|Gemini/i, forbidden: /OpenAI|Anthropic|Claude/i }
  ];
  const rule = rules.find((entry) => entry.source.test(source));
  if (!rule || !title) return true;
  return rule.required.test(title) && !rule.forbidden.test(title);
}

function responseText(responseJson) {
  if (typeof responseJson.output_text === "string") return responseJson.output_text;
  const parts = [];
  for (const output of responseJson.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseJsonText(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function buildPrompt(batch) {
  const list = batch.map((entry) => {
    const row = {
      key: entry.key,
      source: entry.item.source || entry.item.vendorName || "",
      title: entry.item.title,
      // 見出しの作り方を言語で分岐させるためのフラグ（ja=独自見出し / foreign=忠実な翻訳）。
      titleLang: hasJapanese(entry.item.title) ? "ja" : "foreign"
    };
    if (entry.needSummary) row.summary = compactText(entry.item.summary, 900);
    return row;
  });
  return [
    "次のAI関連ニュースを、公開ダッシュボード向けの日本語カード文面に書き換えてください。",
    "条件:",
    "- titleJaの作り方は各項目の titleLang で分ける:",
    "  - ja（日本語記事）: 元タイトルを丸写しせず、30〜50字の独自見出しに言い換える。30字未満にしない",
    "    - 企業名・製品名・人名・数字などの固有情報は要約で省略せず見出しに残す",
    "    - 『〜の実験結果』『〜の最前線』のような抽象的な言い切りで終わらせず、何がどうなったかまで書く",
    "    - 例: 元「AIに『電気ショックを与えろ』と命じ続けたら押すのか？ 11のLLMで“ミルグラム実験”」",
    "      良い例「11のLLMでミルグラム実験を再現、AIが権威の命令に従うかを検証」（32字・固有情報が残る）",
    "      悪い例「AIの権威への従属の実験結果」（短すぎる・実験名と規模が消えている）",
    "  - foreign（外国語記事）: 意味を変えずに忠実に日本語へ翻訳する。日本語として自然になる範囲でのみ整え、情報の追加・省略・誇張をしない",
    "- summaryがある項目は、summaryJaを90〜150字程度・2文以内で作る。短すぎる一言要約にしない",
    "- summaryJaは、何が起きたか、誰・何に関係するか、なぜAI動向として見る価値があるかを具体的に書く",
    "- 元記事の見出しや本文の表現を長く引用・直訳しない。事実関係を自分の言葉で要約する",
    "- 製品名・モデル名・企業名・論文名などの固有名詞は、自然な場合は英語のまま残す",
    "- 原文にない情報を足さない。推測や評価を断定しない",
    "- 入力と同じ key を付けてJSON配列のみで返す",
    "",
    'JSON schema: [{"key":"...","titleJa":"...","summaryJa":"..."}]（summaryが無い項目はsummaryJa省略可）',
    "",
    `input: ${JSON.stringify(list)}`
  ].join("\n");
}
async function translateBatch(batch) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content:
            "You rewrite AI-news headlines and summaries into original, faithful Japanese dashboard copy. Avoid close paraphrases of source wording, do not invent facts, and return only a valid JSON array."
        },
        { role: "user", content: buildPrompt(batch) }
      ],
      // 応答の途中切れはバッチ全体のJSON解析失敗（=全件英語のまま）につながるため、余裕を持たせる。
      max_output_tokens: Math.max(900, batch.length * 320)
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${detail.slice(0, 300)}`);
  }

  const json = await response.json();
  const parsed = parseJsonText(responseText(json));
  if (!Array.isArray(parsed)) throw new Error("translation response is not an array");

  const byKey = new Map(batch.map((entry) => [entry.key, entry]));
  for (const row of parsed) {
    const target = byKey.get(String(row.key || ""));
    if (!target) continue;
    const titleJa = compactText(row.titleJa, 120);
    if (target.needTitle && titleJa && signalTranslationLooksConsistent(target.item, titleJa)) {
      target.item.titleJa = titleJa;
    }
    const summaryJa = compactText(row.summaryJa, 260);
    if (target.needSummary && summaryJa) target.item.summaryJa = summaryJa;
  }
}

async function main() {
  if (!apiKey) {
    console.log("Translate titles skipped: OPENAI_API_KEY is not set.");
    return;
  }

  // 全ファイルから、カード表示用の独自見出し・独自要約が未生成の items を集める。
  const files = targetFiles
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({ filePath, data: readJson(filePath) }));

  // media/official は公開カードに直接出るため、日本語記事も独自見出し・独自要約の対象にする。
  // ai-signals は従来どおり、英語が残っている項目だけを日本語化する。
  const pending = [];
  for (const file of files) {
    const isPublicNewsFile = /(?:media|official)-news\.json$/i.test(file.filePath);
    const fileName = path.basename(file.filePath);
    for (const [index, item] of (file.data.items || []).entries()) {
      const isStructuredPriceSignal = fileName === "ai-signals.json" && item.tag === "Price";
      const needTitle = !isStructuredPriceSignal && Boolean(item.title) && (isPublicNewsFile
        ? (force || !item.titleJa)
        : (!hasJapanese(item.title) && (force || !item.titleJa)));
      const needSummary = !isStructuredPriceSignal && Boolean(item.summary) && (isPublicNewsFile
        ? (force || !item.summaryJa)
        : (!hasJapanese(item.summary) && (force || !item.summaryJa)));
      if (needTitle || needSummary) {
        const key = `${fileName}:${item.id || item.url || index}`;
        pending.push({ item, needTitle, needSummary, key });
      }
    }
  }

  if (!pending.length) {
    console.log("Translate titles: nothing to translate.");
    return;
  }

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    try {
      await translateBatch(batch);
    } catch (error) {
      console.log(`NG batch ${i / batchSize}: ${error.message}`);
    }
  }

  // LLMが応答から項目を欠落させる（keyが返ってこない）ことがあるため、
  // 未反映の項目だけを集めて1回だけ再試行する。ここで直らなければ英語のまま表示にフォールバック。
  const isStillPending = (entry) =>
    (entry.needTitle && !entry.item.titleJa) || (entry.needSummary && !entry.item.summaryJa);
  const remaining = pending.filter(isStillPending);
  if (remaining.length) {
    console.log(`Retry untranslated: ${remaining.length} items`);
    for (let i = 0; i < remaining.length; i += batchSize) {
      const batch = remaining.slice(i, i + batchSize);
      try {
        await translateBatch(batch);
      } catch (error) {
        console.log(`NG retry batch ${i / batchSize}: ${error.message}`);
      }
    }
  }

  const done = pending.filter((entry) => !isStillPending(entry)).length;
  console.log(
    `Translate titles ${write ? "write" : "dry-run"}: translated ${done}, leftover ${pending.length - done}, targets ${pending.length}`
  );

  if (write) {
    for (const file of files) writeJson(file.filePath, file.data);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
