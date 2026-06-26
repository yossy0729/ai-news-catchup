const fs = require("node:fs");
const path = require("node:path");

// ティッカー/カードに出る英語見出しを日本語化する。
// - 対象: official-news / media-news / ai-signals の items[]（ティッカーはこれらを流す）。
// - OPENAI_API_KEY があるときだけ実行。無ければ何もしない（=英語のままフォールバック）。
// - 失敗(料金超過429など)はバッチ単位で握りつぶし、その分は英語のまま据え置く。
// - コスト節約のため複数見出しを1回のAPIでまとめて翻訳する。

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
  const list = batch.map((entry, i) => ({ i, title: entry.item.title }));
  return [
    "次のAI関連ニュースの英語見出しを、日本語の短い見出しに翻訳してください。",
    "条件:",
    "- ニュースティッカー用なので簡潔に（各40字以内目安）",
    "- 製品名・モデル名・企業名・論文名などの固有名詞は、自然な場合は英語のまま残す",
    "- 原文にない情報を足さない。誇張しない",
    "- 入力と同じ i を付けてJSON配列のみで返す",
    "",
    "JSON schema: [{\"i\":0,\"ja\":\"...\"}]",
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
            "You translate English AI-news headlines into concise Japanese headlines for a ticker. Keep proper nouns in English when natural. Return only a valid JSON array."
        },
        { role: "user", content: buildPrompt(batch) }
      ],
      max_output_tokens: Math.max(400, batch.length * 90)
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${detail.slice(0, 300)}`);
  }

  const json = await response.json();
  const parsed = parseJsonText(responseText(json));
  if (!Array.isArray(parsed)) throw new Error("translation response is not an array");

  for (const row of parsed) {
    const target = batch[row.i];
    const ja = compactText(row.ja, 120);
    if (target && ja) target.item.titleJa = ja;
  }
}

async function main() {
  if (!apiKey) {
    console.log("Translate titles skipped: OPENAI_API_KEY is not set.");
    return;
  }

  // 全ファイルから「英語見出し かつ 未翻訳」の items を集める。
  const files = targetFiles
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({ filePath, data: readJson(filePath) }));

  const pending = [];
  for (const file of files) {
    for (const item of file.data.items || []) {
      if (!item.title || hasJapanese(item.title)) continue;
      if (!force && item.titleJa) continue;
      pending.push({ item });
    }
  }

  if (!pending.length) {
    console.log("Translate titles: no English headlines to translate.");
    return;
  }

  let done = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    try {
      await translateBatch(batch);
      done += batch.filter((entry) => entry.item.titleJa).length;
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
