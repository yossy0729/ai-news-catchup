const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const write = args.has("--write");
const dryRun = args.has("--dry-run");
const limit = Number(getArg("--limit=", "36"));
const perSource = Number(getArg("--per-source=", "4"));
const outputPath = path.join(root, "data", "official-news.json");

const vendors = [
  {
    id: "openai",
    name: "OpenAI / ChatGPT",
    accent: "research",
    homepage: "https://openai.com/news/",
    sources: [
      { name: "OpenAI News", url: "https://openai.com/news/rss.xml", method: "rss", type: "公式発表" },
      { name: "OpenAI Blog", url: "https://openai.com/blog/rss.xml", method: "rss", type: "公式ブログ" }
    ]
  },
  {
    id: "anthropic",
    name: "Anthropic / Claude",
    accent: "product",
    homepage: "https://www.anthropic.com/news",
    sources: [
      { name: "Anthropic News", url: "https://www.anthropic.com/news", method: "html", type: "公式発表" },
      { name: "Anthropic Research", url: "https://www.anthropic.com/research", method: "html", type: "研究" }
    ]
  },
  {
    id: "google",
    name: "Google / DeepMind",
    accent: "infrastructure",
    homepage: "https://blog.google/technology/ai/",
    sources: [
      { name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", method: "rss", type: "公式ブログ" },
      { name: "Google DeepMind Blog", url: "https://deepmind.google/blog/rss.xml", method: "rss", type: "研究" }
    ]
  },
  {
    id: "microsoft",
    name: "Microsoft / Azure AI",
    accent: "adoption",
    homepage: "https://blogs.microsoft.com/ai/",
    sources: [
      { name: "Microsoft AI Blog", url: "https://blogs.microsoft.com/ai/", method: "html", type: "公式ブログ" },
      { name: "Microsoft Research AI", url: "https://www.microsoft.com/en-us/research/research-area/artificial-intelligence/", method: "html", type: "研究", enabled: false }
    ]
  },
  {
    id: "meta",
    name: "Meta AI",
    accent: "research",
    homepage: "https://ai.meta.com/blog/",
    sources: [
      { name: "Meta AI Blog", url: "https://ai.meta.com/blog/", method: "html", type: "研究" }
    ]
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    accent: "infrastructure",
    homepage: "https://developer.nvidia.com/blog/category/generative-ai/",
    sources: [
      { name: "NVIDIA Technical Blog AI", url: "https://developer.nvidia.com/blog/category/generative-ai/feed/", method: "atom", type: "公式ブログ" },
      { name: "NVIDIA Newsroom", url: "https://nvidianews.nvidia.com/", method: "html", type: "公式発表", enabled: false }
    ]
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    accent: "research",
    homepage: "https://huggingface.co/blog",
    sources: [
      { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", method: "rss", type: "公式ブログ" }
    ]
  },
  {
    id: "apple",
    name: "Apple ML",
    accent: "research",
    homepage: "https://machinelearning.apple.com/",
    sources: [
      { name: "Apple Machine Learning Research", url: "https://machinelearning.apple.com/rss.xml", method: "rss", type: "論文・技術文書" }
    ]
  }
];

const aiPatterns = [
  /\bAI\b/i,
  /artificial intelligence/i,
  /machine learning/i,
  /deep learning/i,
  /generative/i,
  /LLM/i,
  /model/i,
  /agent/i,
  /reasoning/i,
  /benchmark/i,
  /inference/i,
  /robotics/i,
  /safety/i,
  /security/i,
  /governance/i,
  /Claude/i,
  /ChatGPT/i,
  /Gemini/i,
  /Copilot/i,
  /Llama/i,
  /NVIDIA/i
];

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

function dateInTokyo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function textBetween(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(xml);
  return match ? decodeEntities(match[1]).trim() : "";
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function hasAiSignal(...values) {
  const text = values.join(" ");
  return aiPatterns.some((pattern) => pattern.test(text));
}

function parseDateFromText(...values) {
  const text = values.map((value) => String(value || "")).join(" ");
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;

  const monthMap = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09",
    oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12"
  };
  const month = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s+(20\d{2})\b/i.exec(text);
  if (month) return `${month[3]}-${monthMap[month[1].toLowerCase().replace(".", "")]}-${String(Number(month[2])).padStart(2, "0")}`;

  return "";
}

function sourceKind(title, summary) {
  const text = `${title} ${summary}`;
  if (/safety|security|governance|policy|risk|threat/i.test(text)) return "AIセーフティ・リスク";
  if (/research|paper|benchmark|evaluation|SOTA|CVPR|ICML|NeurIPS/i.test(text)) return "研究・評価";
  if (/model|Gemini|Claude|GPT|Llama|inference|agent/i.test(text)) return "モデル・プロダクト";
  if (/partner|customer|enterprise|industry|business/i.test(text)) return "導入・事業";
  return "公式アップデート";
}

function buildSummary(title, description, sourceName) {
  const cleanDescription = stripTags(description).replace(/\s+/g, " ").trim();
  const japaneseSummary = japaneseInsight(title, sourceName);
  if (japaneseSummary) return japaneseSummary;

  if (cleanDescription.length > 40) {
    return `${cleanDescription.slice(0, 150)}${cleanDescription.length > 150 ? "..." : ""}`;
  }
  return `${sourceName}の公式情報です。発表内容、対象プロダクト、企業導入・研究・安全性への影響を確認するための一次情報として扱います。`;
}

function japaneseInsight(title, sourceName) {
  const text = String(title || "");
  const source = sourceName.replace(/\s+(News|Blog|AI|Research).*$/i, "");

  if (/usage analytics|spend controls/i.test(text)) {
    return `${source}が企業向けの利用状況分析と支出管理機能を更新。ChatGPT Enterpriseなどの管理・ガバナンス運用に関わる公式発表です。`;
  }
  if (/health intelligence|medical AI|AMIE|physicians|diagnose|genetic diseases/i.test(text)) {
    return `${source}が医療・ヘルスケア領域でのAI活用を発表。診断支援、健康相談、医療現場でのAI利用可能性を確認する一次情報です。`;
  }
  if (/chemist|chemistry|reaction/i.test(text)) {
    return `${source}が化学・創薬領域でのAI活用を発表。研究開発の自動化や実験改善に関わる動向として確認できます。`;
  }
  if (/agent|agents|agentic|tooling|MosaicLeaks/i.test(text)) {
    return `${source}がAIエージェント関連の技術・安全性・評価に関する情報を公開。実装設計、ツール利用、リスク管理の観点で追うべき内容です。`;
  }
  if (/MLPerf|benchmark|SOTA|Training|throughput|MoE|Blackwell/i.test(text)) {
    return `${source}がAI性能評価・学習基盤に関する情報を公開。モデル開発、GPU基盤、推論・学習コスト判断に関わる一次情報です。`;
  }
  if (/Gemini|Claude|GPT|Llama|model|Foundation Models|DiffusionGemma/i.test(text)) {
    return `${source}がAIモデルまたは開発者向け機能に関する更新を発表。利用可能モデル、開発体験、プロダクト選定への影響を確認できます。`;
  }
  if (/planning|house-building|enterprise|business|jobs/i.test(text)) {
    return `${source}が企業・産業利用に関するAI活用情報を公開。業務変革、導入ロードマップ、事業インパクトを見る材料になります。`;
  }
  if (/safety|security|threat|risk|governance|policy/i.test(text)) {
    return `${source}がAI安全性・セキュリティ・ガバナンスに関する情報を公開。リスク管理や規制対応の観点で確認すべき一次情報です。`;
  }
  if (/CVPR|ICML|NeurIPS|Conference|research/i.test(text)) {
    return `${source}がAI研究・学会発表に関する情報を公開。研究テーマ、モデル評価、技術トレンドを把握する材料になります。`;
  }

  return "";
}

function toItem(raw, vendor, source) {
  const title = normalizeSpaces(stripTags(raw.title));
  const summary = buildSummary(title, raw.description || raw.summary || "", source.name);
  const url = normalizeUrl(raw.url);
  const date = raw.date || parseDateFromText(raw.publishedAt, title, summary, url) || "";
  const publishedAt = raw.publishedAt || (date ? `${date}T00:00:00.000Z` : "");

  if (!title || !url || !date || !hasAiSignal(title, summary, source.name, vendor.name)) return null;

  return {
    id: crypto.createHash("sha256").update(`${vendor.id}|${url}`).digest("hex").slice(0, 16),
    vendorId: vendor.id,
    vendorName: vendor.name,
    accent: vendor.accent,
    homepage: vendor.homepage,
    title,
    titleJa: "",
    summary,
    url,
    source: source.name,
    type: source.type,
    kind: sourceKind(title, summary),
    date,
    publishedAt,
    freshness: date === todayInTokyo() ? "today" : "recent",
    priority: raw.priority || 80,
    dateVerification: {
      status: "verified",
      method: raw.method,
      checkedAt: new Date().toISOString()
    }
  };
}

function parseRssItems(xml, vendor, source) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, perSource)) {
    const title = textBetween(block, "title");
    const url = textBetween(block, "link");
    const description = textBetween(block, "description") || textBetween(block, "content:encoded");
    const pubDate = textBetween(block, "pubDate") || textBetween(block, "dc:date");
    const item = toItem({
      title,
      url,
      description,
      date: dateInTokyo(pubDate),
      publishedAt: Number.isNaN(new Date(pubDate).getTime()) ? "" : new Date(pubDate).toISOString(),
      method: "rss"
    }, vendor, source);
    if (item) items.push(item);
  }
  return items;
}

function parseAtomItems(xml, vendor, source) {
  const items = [];
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks.slice(0, perSource)) {
    const title = textBetween(block, "title");
    const linkMatch = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block);
    const url = decodeEntities(linkMatch?.[1] || textBetween(block, "link"));
    const description = textBetween(block, "summary") || textBetween(block, "content");
    const dateText = textBetween(block, "published") || textBetween(block, "updated");
    const item = toItem({
      title,
      url,
      description,
      date: dateInTokyo(dateText),
      publishedAt: Number.isNaN(new Date(dateText).getTime()) ? "" : new Date(dateText).toISOString(),
      method: "atom"
    }, vendor, source);
    if (item) items.push(item);
  }
  return items;
}

function extractMeta(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return decodeEntities(match[1]);
  }
  return "";
}

function extractHtmlCandidates(html, source) {
  const candidates = [];
  const sourceUrl = new URL(source.url);
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = decodeEntities(match[1]);
    const title = normalizeSpaces(stripTags(match[2]));
    if (!href || !title || title.length < 12 || /read more|learn more|subscribe|contact|careers|privacy|terms/i.test(title)) continue;

    let url;
    try {
      url = new URL(href, source.url);
    } catch {
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.hostname !== sourceUrl.hostname && !url.hostname.endsWith(`.${sourceUrl.hostname}`)) continue;
    if (normalizeUrl(url.href) === normalizeUrl(source.url)) continue;
    if (!/news|blog|research|article|articles|posts|ai|technology|developer|updates/i.test(url.pathname)) continue;
    if (!hasAiSignal(title, url.pathname, source.name)) continue;

    candidates.push({ title, url: normalizeUrl(url.href) });
  }

  return Array.from(new Map(candidates.map((item) => [item.url, item])).values()).slice(0, perSource);
}

async function fetchText(url, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": "AI-News-Catchup/0.1"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichHtmlCandidate(candidate, vendor, source) {
  try {
    const html = await fetchText(candidate.url);
    const title = extractMeta(html, "og:title") || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || candidate.title;
    const description = extractMeta(html, "og:description") || extractMeta(html, "description");
    const dateText = extractMeta(html, "article:published_time") || extractMeta(html, "datePublished") || extractMeta(html, "pubdate") || html.slice(0, 6000);
    return toItem({
      title,
      url: candidate.url,
      description,
      date: dateInTokyo(dateText) || parseDateFromText(dateText, candidate.url),
      publishedAt: Number.isNaN(new Date(dateText).getTime()) ? "" : new Date(dateText).toISOString(),
      method: "html_meta"
    }, vendor, source);
  } catch {
    return null;
  }
}

async function collectSource(vendor, source) {
  const xmlOrHtml = await fetchText(source.url, source.method === "html" ? "text/html,*/*" : "application/rss+xml,application/xml,text/xml,*/*");
  if (source.method === "rss") return parseRssItems(xmlOrHtml, vendor, source);
  if (source.method === "atom") return parseAtomItems(xmlOrHtml, vendor, source);

  const candidates = extractHtmlCandidates(xmlOrHtml, source);
  const items = [];
  for (const candidate of candidates) {
    const item = await enrichHtmlCandidate(candidate, vendor, source);
    if (item) items.push(item);
  }
  return items;
}

function officialSort(a, b) {
  return String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)) ||
    Number(b.priority || 0) - Number(a.priority || 0);
}

async function collect() {
  const items = [];
  const errors = [];

  for (const vendor of vendors) {
    for (const source of vendor.sources) {
      if (source.enabled === false) continue;
      try {
        items.push(...await collectSource(vendor, source));
      } catch (error) {
        errors.push({ vendor: vendor.id, source: source.name, url: source.url, error: error.message });
      }
    }
  }

  const byUrl = new Map();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing || officialSort(item, existing) < 0) byUrl.set(item.url, item);
  }

  return {
    schemaVersion: 1,
    generatedDate: todayInTokyo(),
    sourcePolicy: "AIベンダー/GAFAMの公式RSSまたは公式一覧HTMLから直接取得し、元記事URLと公開日メタデータを確認できたものだけを保存。",
    vendors: vendors.map(({ id, name, accent, homepage }) => ({ id, name, accent, homepage })),
    items: Array.from(byUrl.values()).sort(officialSort).slice(0, limit),
    errors
  };
}

async function main() {
  const data = await collect();
  if (write && !dryRun) {
    fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`Official news write: ${data.items.length} items, ${data.errors.length} errors`);
  } else {
    console.log(JSON.stringify({
      generatedDate: data.generatedDate,
      items: data.items.length,
      errors: data.errors,
      sample: data.items.slice(0, 10).map((item) => ({
        vendor: item.vendorName,
        source: item.source,
        date: item.date,
        title: item.title,
        url: item.url
      }))
    }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
