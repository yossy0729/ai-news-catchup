const fs = require("node:fs");
const path = require("node:path");

// news.json（表示確定後）の「日本語要約が未生成」の記事を後追いで日本語要約する。
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

// 要約が必要な記事か（プレースホルダー or 日本語でない要約）。
function needsSummary(item) {
  if (item.summaryStatus === "missing-ja-summary") return true;
  return !hasJapanese(item.summary);
}

function promptFor(item, enrich) {
  return [
    "次のAI関連ニュースを、日本語でダッシュボード向けに1文要約してください。",
    "条件:",
    "- 60〜110字程度",
    "- 見出し(title/titleJa)が伝える主題を、誇張せず日本語で具体的に書く",
    "- 原文・見出しにない事実を作らない（情報が見出しだけなら、その主題を日本語で言い換える）",
    "- 『確認する価値があります』『示唆があります』のような中身のない一般論は禁止",
    "- 固有名詞・モデル名・製品名は必要に応じて英語のまま残す",
    "- titleJaが空なら日本語の見出しも作る",
    "- JSONのみを返す",
    "",
    'JSON schema: {"titleJa":"...","summaryJa":"..."}',
    "",
    `source: ${item.source || ""}`,
    `title: ${item.title || ""}`,
    `titleJa: ${item.titleJa || ""}`,
    `excerpt: ${compactText(enrich?.excerpt || enrich?.description || "", 1200)}`
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
            "You rewrite AI news headlines into concise, faithful Japanese one-line dashboard summaries. Never invent facts. Return only valid JSON."
        },
        { role: "user", content: promptFor(item, enrich) }
      ],
      max_output_tokens: 400
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
    summaryJa: compactText(parsed.summaryJa || "", 170)
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
      if (force || needsSummary(item)) targets.push(item);
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
        if (result.titleJa && !item.titleJa) item.titleJa = result.titleJa;
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
