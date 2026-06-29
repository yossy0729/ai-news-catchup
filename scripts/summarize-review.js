const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reviewPath = path.join(root, "data", "review.json");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const write = args.has("--write");
const force = args.has("--force");
const limit = Number(getArg("--limit=", "10"));
const model = getArg("--model=", process.env.OPENAI_MODEL || "gpt-4o-mini");
const apiKey = process.env.OPENAI_API_KEY;

function getArg(prefix, fallback) {
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[、。,. ]+$/u, "")}...`;
}

function responseText(responseJson) {
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text;
  }

  const parts = [];
  for (const output of responseJson.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
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

function promptFor(item) {
  return [
    "次のAI関連一次情報を、日本語で公開ダッシュボード向けのカード文面に書き換えてください。",
    "条件:",
    "- 誇張しない。原文にない断定をしない",
    "- titleJaは20〜40字程度の独自見出しにする。日本語タイトルでも元タイトルをそのまま写さず、意味を保って言い換える",
    "- summaryJaは90〜150字程度・2文以内にする。短すぎる一言要約にしない",
    "- summaryJaは『何が起きたか』『何についての記事か』『AI動向としての意味』を具体的に書く",
    "- 元記事の見出しや本文の表現を長く引用・直訳しない。事実関係を自分の言葉で要約する",
    "- 汎用的な文言は禁止: 『確認する価値があります』『示唆があります』『見る材料になります』のような一般論を書かない",
    "- AIコンサルタントが一覧で世界の動きを把握できる文章にする",
    "- 固有名詞・モデル名・製品名は必要に応じて英語のまま残す",
    "- summaryJaとimpactJaは必ず日本語で書く。英語の原文をそのまま残さない",
    "- impactJaは『なぜ見るべきか』を短く書く",
    "- JSONのみを返す",
    "",
    "JSON schema:",
    "{\"titleJa\":\"...\",\"summaryJa\":\"...\",\"impactJa\":\"...\"}",
    "",
    `source: ${item.sourceName}`,
    `sourceType: ${item.sourceType}`,
    `category: ${item.suggestedCategory}`,
    `title: ${item.title}`,
    `description: ${item.description || ""}`,
    `excerpt: ${compactText(item.excerpt, 1800)}`
  ].join("\n");
}
async function summarizeItem(item) {
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
          content: "You rewrite AI news into original, faithful Japanese dashboard copy. Avoid close paraphrases of source wording, never invent facts, and return only valid JSON."
        },
        {
          role: "user",
          content: promptFor(item)
        }
      ],
      max_output_tokens: 600
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${detail.slice(0, 500)}`);
  }

  const json = await response.json();
  const parsed = parseJsonText(responseText(json));

  return {
    llmTitle: compactText(parsed.titleJa || item.title, 120),
    llmSummary: compactText(parsed.summaryJa || "", 260),
    llmImpact: compactText(parsed.impactJa || "", 120),
    llmModel: model,
    llmSummarizedAt: new Date().toISOString()
  };
}

async function main() {
  if (!apiKey) {
    console.log("LLM summary skipped: OPENAI_API_KEY is not set.");
    return;
  }

  const review = readJson(reviewPath);
  const targets = review.items
    .filter((item) => item.status === "accepted" || item.status === "needs_review")
    .filter((item) => force || !item.llmSummary)
    .slice(0, limit);

  let summarized = 0;
  let failed = 0;

  for (const item of targets) {
    try {
      const summary = await summarizeItem(item);
      Object.assign(item, summary);
      summarized += 1;
      console.log(`OK ${item.sourceName}: ${summary.llmTitle}`);
    } catch (error) {
      failed += 1;
      item.llmSummaryError = error.message;
      item.llmSummaryErrorAt = new Date().toISOString();
      console.log(`NG ${item.sourceName}: ${item.title} (${error.message})`);
    }
  }

  review.updatedDate = todayInTokyo();
  console.log(`LLM summary ${write ? "write" : "dry-run"}: summarized ${summarized}, failed ${failed}, total targets ${targets.length}`);

  if (write) {
    writeJson(reviewPath, review);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
