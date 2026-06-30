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
    const row = { key: entry.key, source: entry.item.source || entry.item.vendorName || "", title: entry.item.title };
    if (entry.needSummary) row.summary = compactText(entry.item.summary, 900);
    return row;
  });
  return [
    "次のAI関連ニュースを、公開ダッシュボード向けの日本語カード文面に書き換えてください。",
    "条件:",
    "- titleJaは20〜40字程度の独自見出しにする。日本語タイトルでも元タイトルをそのまま写さず、意味を保って言い換える",
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
      max_output_tokens: Math.max(700, batch.length * 240)
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

  let done = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    try {
      await translateBatch(batch);
      done += batch.filter((entry) => entry.item.titleJa || entry.item.summaryJa).length;
    } catch (error) {
      failed += batch.length;
      console.log(`NG batch ${i / batchSize}: ${error.message}`);
    }
  }

  console.log(
    `Translate titles ${write ? "write" : "dry-run"}: translated ${done}, failed ${failed}, targets ${pending.length}`
  );

  if (write) {
    for (const file of files) writeJson(file.filePath, file.data);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
