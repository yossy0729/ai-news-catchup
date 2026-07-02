const fs = require("node:fs");
const path = require("node:path");

// news.json（表示確定後）の記事を、カード向けの独自見出し・独自要約で後追い整形する。
// - 蓄積モードで残る古い記事（APIキー設定前に昇格した分）は誰も再要約しないため、ここで埋める。
// - 材料はタイトル/翻訳済みtitleJa/出典。review.json に同一URLの excerpt があれば補強。
// - OPENAI_API_KEY があるときだけ実行。失敗(料金超過など)は1件ずつ握りつぶし、英語/未生成のまま据え置く。

const root = path.resolve(__dirname, "..");
const newsPath = path.join(root, "data", "news.json");
const reviewPath = path.join(root, "data", "review.json");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const write = args.has("--write");
const force = args.has("--force");
const limit = Number(getArg("--limit=", "40"));
const model = getArg("--model=", process.env.OPENAI_MODEL || "gpt-4o-mini");
const apiKey = process.env.OPENAI_API_KEY;

function getArg(prefix, fallback) {
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hasJapanese(text) {
  return /[ぁ-んァ-ヶ一-龠]/.test(String(text || ""));
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[、。,. ]+$/u, "")}...`;
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

// カード文面の整形が必要な記事か（独自見出し不足、プレースホルダー、短すぎる/日本語でない要約）。
function needsDashboardCopy(item) {
  if (!item.titleJa) return true;
  if (item.summaryStatus === "missing-ja-summary") return true;
  if (!hasJapanese(item.summary)) return true;
  return String(item.summary || "").trim().length < 70;
}

function promptFor(item, enrich) {
  // 見出しの作り方は記事の言語で分ける（日本語記事=独自見出し / 外国語記事=忠実な翻訳）。
  const titleRule = hasJapanese(item.title)
    ? "- titleJaは、元タイトルを丸写しせず、企業名・製品名・何が起きたかを押さえた30〜50字程度の独自見出しにする"
    : "- titleJaは、元タイトルの意味を変えない忠実な日本語訳にする。日本語として自然になる範囲でのみ整え、情報の追加・省略・誇張をしない";
  return [
    "次のAI関連ニュースを、日本語で公開ダッシュボード向けのカード文面に書き換えてください。",
    "条件:",
    titleRule,
    "- summaryJaは90〜150字程度・2文以内にする。短すぎる一言要約にしない",
    "- summaryJaは、何が起きたか、誰・何に関係するか、なぜAI動向として見る価値があるかを具体的に書く",
    "- 元記事の見出しや本文の表現を長く引用・直訳しない。事実関係を自分の言葉で要約する",
    "- 原文・見出しにない事実を作らない。情報が少ない場合は、分かる範囲を明示して簡潔に書く",
    "- 『確認する価値があります』『示唆があります』のような中身のない一般論は禁止",
    "- 固有名詞・モデル名・製品名は必要に応じて英語のまま残す",
    "- JSONのみを返す",
    "",
    'JSON schema: {"titleJa":"...","summaryJa":"..."}',
    "",
    `source: ${item.source || ""}`,
    `title: ${item.title || ""}`,
    `currentTitleJa: ${item.titleJa || ""}`,
    `currentSummary: ${item.summary || ""}`,
    `excerpt: ${compactText(enrich?.excerpt || enrich?.description || "", 1400)}`
  ].join("\n");
}
async function summarizeItem(item, enrich) {
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
            "You rewrite AI-news headlines and summaries into original, faithful Japanese dashboard copy. Avoid close paraphrases of source wording, do not invent facts, and return only valid JSON."
        },
        { role: "user", content: promptFor(item, enrich) }
      ],
      max_output_tokens: 600
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${detail.slice(0, 300)}`);
  }

  const json = await response.json();
  const parsed = parseJsonText(responseText(json));
  return {
    titleJa: compactText(parsed.titleJa || item.titleJa || "", 120),
    summaryJa: compactText(parsed.summaryJa || "", 260)
  };
}

async function main() {
  if (!apiKey) {
    console.log("Summarize news skipped: OPENAI_API_KEY is not set.");
    return;
  }

  const news = readJson(newsPath, null);
  if (!news || !Array.isArray(news.categories)) {
    console.log("Summarize news skipped: news.json not found.");
    return;
  }

  // review.json から URL→本文(excerpt) を引けるようにして要約材料を補強。
  const review = readJson(reviewPath, { items: [] });
  const enrichByUrl = new Map((review.items || []).map((it) => [it.url, it]));

  const targets = [];
  for (const category of news.categories) {
    for (const item of category.items || []) {
      if (force || needsDashboardCopy(item)) targets.push(item);
    }
  }
  const slice = targets.slice(0, limit);

  let done = 0;
  let failed = 0;
  for (const item of slice) {
    try {
      const result = await summarizeItem(item, enrichByUrl.get(item.url));
      if (result.summaryJa) {
        item.summary = result.summaryJa;
        item.summaryStatus = "llm-ja";
        if (result.titleJa) item.titleJa = result.titleJa;
        done += 1;
      }
    } catch (error) {
      failed += 1;
      console.log(`NG ${item.source || ""}: ${item.title} (${error.message})`);
    }
  }

  console.log(
    `Summarize news ${write ? "write" : "dry-run"}: summarized ${done}, failed ${failed}, targets ${targets.length}`
  );

  if (write) writeJson(newsPath, news);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
