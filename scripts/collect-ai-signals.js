const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const write = args.has("--write");
const dryRun = args.has("--dry-run");
const limit = Number(getArg("--limit=", "32"));
const outputPath = path.join(root, "data", "ai-signals.json");
const officialPath = path.join(root, "data", "official-news.json");

function getArg(prefix, fallback) {
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function sentenceTrim(value, max = 130) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max).replace(/[ .,;:]+$/g, "")}...`;
}

function makeId(...parts) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xml,*/*",
        "User-Agent": "AI-News-Catchup/0.1"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function collectHfPapers() {
  const url = "https://huggingface.co/papers";
  const html = decodeEntities(await fetchText(url));
  const anchors = [...html.matchAll(/<a[^>]+href="(\/papers\/[0-9.]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const byId = new Map();

  for (const match of anchors) {
    const paperUrl = `https://huggingface.co${match[1]}`;
    const text = stripTags(match[2]);
    if (!text || text.length < 18 || /^\d+$/.test(text) || /authors?$/i.test(text)) continue;
    const id = match[1].split("/").pop();
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        title: text,
        url: paperUrl
      });
    }
  }

  return Array.from(byId.values()).slice(0, 5).map((paper, index) => ({
    id: makeId("hf-paper", paper.id),
    lane: "research",
    tag: "Paper",
    tone: "blue",
    date: todayInTokyo(),
    source: "Hugging Face Papers",
    title: `HF Papers #${index + 1}: ${paper.title}`,
    summary: "Hugging Face Papersの日次上位論文です。研究テーマ、実装可能性、評価タスクの変化を確認する候補として扱います。",
    text: `HF Papers #${index + 1}: ${paper.title}`,
    url: paper.url,
    priority: 95 - index
  }));
}

function collectOfficialSotaSignals() {
  if (!fs.existsSync(officialPath)) return [];
  const official = JSON.parse(fs.readFileSync(officialPath, "utf8"));
  return (official.items || [])
    .filter((item) => /MLPerf|benchmark|SOTA|leaderboard|Training|throughput|performance|CVPR|ICML|NeurIPS/i.test(`${item.title} ${item.summary}`))
    .slice(0, 8)
    .map((item) => ({
      id: makeId("official-sota", item.url),
      lane: "research",
      tag: /MLPerf|benchmark|SOTA|leaderboard/i.test(item.title) ? "SOTA" : "Research",
      tone: /MLPerf|benchmark|SOTA|leaderboard/i.test(item.title) ? "green" : "blue",
      date: item.date,
      source: item.source,
      title: item.title,
      summary: item.summary,
      text: `${/MLPerf|benchmark|SOTA|leaderboard/i.test(item.title) ? "SOTA" : "Research"}: ${item.title} / ${item.source}`,
      url: item.url,
      priority: 88
    }));
}

async function collectPriceSignals() {
  const priceSources = [
    {
      provider: "OpenAI",
      url: "https://openai.com/api/pricing/",
      note: "公式価格ページ。Node直取得は403になる場合があるため、現MVPではリンク確認シグナルとして扱います。"
    },
    {
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/about-claude/pricing",
      note: "Claudeの入力/出力MTok単価を確認する公式価格表です。"
    },
    {
      provider: "Google Gemini",
      url: "https://ai.google.dev/gemini-api/docs/pricing",
      note: "Gemini APIの入力/出力トークン単価を確認する公式価格表です。"
    }
  ];

  const signals = [];
  for (const source of priceSources) {
    let detected = source.note;
    try {
      if (!source.provider.includes("OpenAI")) {
        const html = await fetchText(source.url);
        const prices = (html.match(/\$\s?[0-9.]+(?:\s?\/\s?(?:M|1,000,000)?Tok|[^<]{0,24}tokens)?/gi) || [])
          .slice(0, 4)
          .map((value) => value.replace(/\s+/g, " ").trim());
        if (prices.length) {
          detected = `${source.note} 検出例: ${prices.join(" / ")}`;
        }
      }
    } catch {
      // Keep source link signal even if extraction fails.
    }

    signals.push({
      id: makeId("price", source.provider),
      lane: "research",
      tag: "Price",
      tone: "amber",
      date: todayInTokyo(),
      source: `${source.provider} Pricing`,
      title: `${source.provider} token pricing`,
      summary: detected,
      text: `Price: ${source.provider} 入力/出力トークン価格表を確認`,
      url: source.url,
      priority: 76
    });
  }
  return signals;
}

async function collect() {
  const errors = [];
  const batches = [];
  const sourceHealth = [];

  for (const task of [
    ["hf-papers", collectHfPapers],
    ["official-sota", async () => collectOfficialSotaSignals()],
    ["model-price", collectPriceSignals]
  ]) {
    try {
      const collected = await task[1]();
      batches.push(...collected);
      sourceHealth.push({
        id: task[0],
        name: task[0],
        group: "ai-signals",
        type: "mixed",
        url: "",
        status: collected.length ? "ok" : "no_items",
        itemsFound: collected.length,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastFailureAt: null,
        lastError: null
      });
    } catch (error) {
      errors.push({ source: task[0], error: error.message });
      sourceHealth.push({
        id: task[0],
        name: task[0],
        group: "ai-signals",
        type: "mixed",
        url: "",
        status: "failed",
        itemsFound: 0,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: null,
        lastFailureAt: new Date().toISOString(),
        lastError: error.message
      });
    }
  }

  const items = batches
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(b.date).localeCompare(String(a.date)))
    .slice(0, limit);

  return {
    schemaVersion: 1,
    generatedDate: todayInTokyo(),
    sourcePolicy: "HF Papers、公式ベンダー発表、公式価格ページからAIシグナルを構造化。価格数値は取得できる公式ページのみ検出例として保存し、取得不能なページは公式リンク確認に留める。",
    items,
    errors,
    sourceHealth
  };
}

async function main() {
  const data = await collect();
  if (write && !dryRun) {
    fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`AI signals write: ${data.items.length} items, ${data.errors.length} errors`);
  } else {
    console.log(JSON.stringify({
      generatedDate: data.generatedDate,
      items: data.items.length,
      errors: data.errors,
      sample: data.items.slice(0, 10).map((item) => ({
        lane: item.lane,
        tag: item.tag,
        text: item.text,
        source: item.source
      }))
    }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
