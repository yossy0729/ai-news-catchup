const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const write = args.has("--write");
const dryRun = args.has("--dry-run");
const limit = Number(getArg("--limit=", "50"));
const perSource = Number(getArg("--per-source=", "12"));
// 速報の鮮度上限（時間）。これを超える記事は「速報プール」に載せない。
// 24h以内=fresh / 24〜72h=recent。空カテゴリは recent で補完する設計（app.js側）。
const maxAgeHours = Number(getArg("--max-age-hours=", "72"));
const outputPath = path.join(root, "data", "media-news.json");

const categories = [
  { id: "fde", label: "FDE", accent: "business" },
  { id: "agents", label: "AIエージェント・業務AI", accent: "product" },
  { id: "models", label: "モデル・研究・プロダクト", accent: "research" },
  { id: "regulation", label: "規制・倫理・著作権", accent: "governance" },
  { id: "industry", label: "産業活用・導入事例", accent: "adoption" },
  { id: "infrastructure", label: "半導体・クラウド・基盤", accent: "infrastructure" },
  { id: "security", label: "AIセキュリティ・リスク", accent: "security" }
];

const directFeeds = [
  {
    name: "ITmedia AI+",
    url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml",
    priority: 92,
    region: "日本"
  },
  {
    name: "ITmedia NEWS",
    url: "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml",
    priority: 86,
    region: "日本"
  },
  {
    name: "EnterpriseZine",
    url: "https://enterprisezine.jp/rss/new/20/index.xml",
    priority: 84,
    region: "日本"
  },
  {
    name: "CNET Japan",
    url: "https://japan.cnet.com/rss/index.rdf",
    priority: 78,
    region: "日本"
  },
  {
    name: "ASCII.jp",
    url: "https://ascii.jp/rss.xml",
    priority: 80,
    region: "日本"
  },
  {
    name: "Impress Watch",
    url: "https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf",
    priority: 74,
    region: "日本"
  },
  {
    name: "TechCrunch (AI)",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    priority: 82,
    region: "海外"
  }
];

const aiRelevancePatterns = [
  /\bAI\b/i,
  /人工知能/i,
  /生成AI/i,
  /ChatGPT/i,
  /OpenAI/i,
  /Anthropic/i,
  /Claude/i,
  /Gemini/i,
  /Copilot/i,
  /\bLLM\b/i,
  /大規模言語モデル/i,
  /機械学習/i,
  /ディープラーニング/i,
  /深層学習/i,
  /AIエージェント/i,
  /agentic/i,
  /generative AI/i,
  /artificial intelligence/i,
  /machine learning/i,
  /deep learning/i,
  /foundation model/i,
  /\bRAG\b/i,
  /\bFDE\b/i,
  /Forward[-\s]+Deployed/i,
  /Midjourney/i
];

const categoryClassifiers = {
  fde: [/\bFDE\b/i, /Forward[-\s]+Deployed(?:[-\s]+Engineer(?:s)?)?/i, /フォワード[・\s-]*デプロイ/i],
  agents: [
    /エージェント/i,
    /agent/i,
    /\bRAG\b/i,
    /Copilot/i,
    /業務AI/i,
    /自動化/i,
    /問い合わせ/i,
    /作業代行/i,
    /Record & Replay/i
  ],
  models: [
    /モデル/i,
    /model/i,
    /Midjourney/i,
    /画像AI/i,
    /動画/i,
    /音声/i,
    /論文/i,
    /研究/i,
    /LLM/i,
    /大規模言語モデル/i,
    /AI for Science/i,
    /スパコン/i
  ],
  regulation: [
    /規制/i,
    /法規制/i,
    /法律/i,
    /著作権/i,
    /個人情報/i,
    /プライバシー/i,
    /倫理/i,
    /ガバナンス/i,
    /CISO/i,
    /regulation/i,
    /copyright/i,
    /privacy/i
  ],
  industry: [
    /導入/i,
    /活用/i,
    /企業/i,
    /業務/i,
    /事例/i,
    /PoC/i,
    /人材/i,
    /製造/i,
    /金融/i,
    /医療/i,
    /建設/i,
    /マーケティング/i,
    /予算管理/i,
    /協業/i
  ],
  infrastructure: [
    /GPU/i,
    /NVIDIA/i,
    /半導体/i,
    /データセンター/i,
    /クラウド/i,
    /Cloud/i,
    /AWS/i,
    /Google Cloud/i,
    /IBM/i,
    /基盤/i,
    /スパコン/i
  ],
  security: [
    /セキュリティ/i,
    /サイバー/i,
    /攻撃/i,
    /防御/i,
    /脆弱/i,
    /悪用/i,
    /リスク/i,
    /deepfake/i,
    /cyber/i,
    /security/i
  ]
};

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
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function textBetween(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(xml);
  return match ? decodeEntities(match[1]).trim() : "";
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 120)
    .trim();
}

function findSimilarKey(map, key) {
  const probe = key.slice(0, 80);
  if (probe.length < 40) return map.has(key) ? key : "";

  for (const existingKey of map.keys()) {
    const existingProbe = existingKey.slice(0, 80);
    if (existingProbe.includes(probe) || probe.includes(existingProbe)) return existingKey;
  }

  return map.has(key) ? key : "";
}

function relevanceScore(title, description, categoryId) {
  const text = `${title} ${description}`;
  const explicitAiScore = aiRelevancePatterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
  if (explicitAiScore === 0) return 0;

  let score = explicitAiScore;
  score += (categoryClassifiers[categoryId] || []).reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
  return score;
}

function classifyCategory(title, description) {
  const text = `${title} ${description}`;
  const ranked = categories
    .map((category) => ({
      category,
      score: (categoryClassifiers[category.id] || []).reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0) return ranked[0].category;
  return categories.find((category) => category.id === "industry");
}

function buildSummary(title, description, categoryLabel, source) {
  const cleanedDescription = stripTags(description)
    .replace(/\s+-\s+[^-]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanedDescription.length >= 36 && !cleanedDescription.includes(title.slice(0, 24))) {
    return `${cleanedDescription.slice(0, 130)}${cleanedDescription.length > 130 ? "..." : ""}`;
  }

  if (categoryLabel === "FDE") {
    return `${source}が報じたFDE関連ニュースです。現場実装、AI導入支援、エンタープライズ展開への影響を確認する価値があります。`;
  }
  if (categoryLabel.includes("エージェント")) {
    return `${source}が報じた業務AI・AIエージェント関連ニュースです。業務プロセスの自動化、導入設計、運用変化を見る材料になります。`;
  }
  if (categoryLabel.includes("モデル")) {
    return `${source}が報じたAIモデル・研究・プロダクト関連ニュースです。性能、利用領域、開発ロードマップの変化を把握できます。`;
  }
  if (categoryLabel.includes("規制")) {
    return `${source}が報じたAI規制・倫理・ガバナンス関連ニュースです。法務、セキュリティ、リスク管理への影響を確認する材料です。`;
  }
  if (categoryLabel.includes("半導体")) {
    return `${source}が報じたAI基盤関連ニュースです。クラウド、計算資源、データ基盤、投資判断への影響を追う材料になります。`;
  }
  if (categoryLabel.includes("セキュリティ")) {
    return `${source}が報じたAIセキュリティ関連ニュースです。AI悪用、脅威対策、信頼性設計の観点で確認すべき内容です。`;
  }

  return `${source}が報じたAI活用・導入事例のニュースです。市場動向、業務適用、PoCから本番展開への流れを把握できます。`;
}

function parseItems(xml) {
  return xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
}

function parseRss(xml, feed) {
  const parsed = [];
  for (const itemXml of parseItems(xml).slice(0, perSource)) {
    const title = stripTags(textBetween(itemXml, "title"));
    const url = stripTags(textBetween(itemXml, "link"));
    const description = stripTags(textBetween(itemXml, "description"));
    const pubDate = textBetween(itemXml, "pubDate") || textBetween(itemXml, "dc:date");
    const publishedAtDate = new Date(pubDate);
    const publishedAt = Number.isNaN(publishedAtDate.getTime()) ? "" : publishedAtDate.toISOString();
    const date = dateInTokyo(pubDate);
    const category = classifyCategory(title, description);
    const relevance = relevanceScore(title, description, category.id);

    if (!title || !url || !publishedAt || relevance === 0) continue;

    // 鮮度の厳密化: 公開からの経過時間で判定し、上限を超えた古い記事は速報から除外する。
    const ageHours = (Date.now() - publishedAtDate.getTime()) / 3_600_000;
    if (ageHours < 0 || ageHours > maxAgeHours) continue;
    const freshness = ageHours < 24 ? "fresh" : "recent";

    parsed.push({
      id: crypto.createHash("sha256").update(`${title}|${url}`).digest("hex").slice(0, 16),
      title,
      summary: buildSummary(title, description, category.label, feed.name),
      url,
      source: feed.name,
      sourceType: "メディア",
      category: category.label,
      categoryId: category.id,
      accent: category.accent,
      region: feed.region,
      date,
      publishedAt,
      freshness,
      ageHours: Math.round(ageHours * 10) / 10,
      relevanceScore: relevance,
      priority: feed.priority + Math.min(relevance * 3, 12),
      dateVerification: {
        status: "verified",
        method: "direct_rss_pubDate",
        checkedAt: new Date().toISOString()
      }
    });
  }
  return parsed;
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": "AI-News-Catchup/0.1"
      }
    });

    if (!response.ok) throw new Error(`Feed fetch failed ${response.status}: ${feed.url}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function mediaSort(a, b) {
  return (
    Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0) ||
    Number(b.priority || 0) - Number(a.priority || 0) ||
    String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date))
  );
}
function mediaItemKey(item) {
  return item.url || item.id || normalizeKey(item.title);
}

function isFdeMediaItem(item) {
  const text = [item.title, item.titleJa, item.summary, item.summaryJa, item.category, item.categoryId]
    .filter(Boolean)
    .join(" ");
  return item.categoryId === "fde" || /\bFDE\b|Forward[-\s]+Deployed(?:[-\s]+Engineer(?:s)?)?/i.test(text);
}

function refreshRetainedItem(item, nowMs = Date.now()) {
  const publishedAtDate = new Date(item.publishedAt);
  if (Number.isNaN(publishedAtDate.getTime())) return null;

  const ageHours = (nowMs - publishedAtDate.getTime()) / 3_600_000;
  if (ageHours < 0 || ageHours > maxAgeHours) return null;

  return {
    ...item,
    freshness: ageHours < 24 ? "fresh" : "recent",
    ageHours: Math.round(ageHours * 10) / 10,
    retained: true,
    retentionReason: "priority_category_within_72h"
  };
}

function readPreviousMediaItems() {
  try {
    if (!fs.existsSync(outputPath)) return [];
    const previous = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    return Array.isArray(previous.items) ? previous.items : [];
  } catch {
    return [];
  }
}

function mergeRetainedPriorityItems(byKey) {
  for (const item of readPreviousMediaItems()) {
    if (!isFdeMediaItem(item)) continue;
    const retained = refreshRetainedItem(item);
    if (!retained) continue;

    const key = normalizeKey(retained.title);
    const targetKey = findSimilarKey(byKey, key) || key;
    if (!byKey.has(targetKey)) byKey.set(targetKey, retained);
  }
}

function selectMediaItems(byKey) {
  mergeRetainedPriorityItems(byKey);

  const sorted = Array.from(byKey.values()).sort(mediaSort);
  const protectedItems = sorted.filter(isFdeMediaItem).slice(0, 4);
  const protectedKeys = new Set(protectedItems.map(mediaItemKey));
  const selected = new Map();

  for (const item of sorted.slice(0, limit)) selected.set(mediaItemKey(item), item);
  for (const item of protectedItems) selected.set(mediaItemKey(item), item);

  const result = Array.from(selected.values()).sort(mediaSort);
  while (result.length > limit) {
    const removeIndex = result.map(mediaItemKey).findLastIndex((key) => !protectedKeys.has(key));
    if (removeIndex < 0) break;
    result.splice(removeIndex, 1);
  }

  return result.sort(mediaSort);
}


async function collect() {
  const collected = [];
  const errors = [];
  const sourceHealth = [];

  for (const feed of directFeeds) {
    try {
      const xml = await fetchFeed(feed);
      const parsed = parseRss(xml, feed);
      collected.push(...parsed);
      sourceHealth.push({
        id: crypto.createHash("sha256").update(feed.url).digest("hex").slice(0, 16),
        name: feed.name,
        group: "media",
        type: "rss",
        url: feed.url,
        status: parsed.length ? "ok" : "no_items",
        itemsFound: parsed.length,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastFailureAt: null,
        lastError: null
      });
    } catch (error) {
      errors.push({ source: feed.name, url: feed.url, error: error.message });
      sourceHealth.push({
        id: crypto.createHash("sha256").update(feed.url).digest("hex").slice(0, 16),
        name: feed.name,
        group: "media",
        type: "rss",
        url: feed.url,
        status: "failed",
        itemsFound: 0,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: null,
        lastFailureAt: new Date().toISOString(),
        lastError: error.message
      });
    }
  }

  const byKey = new Map();
  for (const item of collected) {
    const key = normalizeKey(item.title);
    const similarKey = findSimilarKey(byKey, key);
    const targetKey = similarKey || key;
    const existing = byKey.get(targetKey);
    if (!existing || mediaSort(item, existing) < 0) byKey.set(targetKey, item);
  }

  const items = selectMediaItems(byKey);

  return {
    schemaVersion: 2,
    generatedDate: todayInTokyo(),
    sourcePolicy:
      `直接RSSで元記事URLと公開日時を確認できる固定・厳選プールの2次情報媒体のみを速報対象にする。公開から${maxAgeHours}時間以内に限定し、24時間以内をfresh・24〜72時間をrecentとして区別する（空カテゴリはrecentで補完）。Google News RSSの検出時刻は元記事公開日と一致しないため、日付検証なしでは掲載しない。`,
    freshnessPolicy: { maxAgeHours, freshWithinHours: 24 },
    categories: categories.map(({ id, label, accent }) => ({ id, label, accent })),
    items,
    errors,
    sourceHealth
  };
}

async function main() {
  const data = await collect();

  if (write && !dryRun) {
    fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`Media news write: ${data.items.length} items, ${data.errors.length} errors`);
  } else {
    console.log(
      JSON.stringify(
        {
          generatedDate: data.generatedDate,
          items: data.items.length,
          errors: data.errors.length,
          sample: data.items.slice(0, 8).map((item) => ({
            title: item.title,
            source: item.source,
            category: item.category,
            date: item.date,
            url: item.url
          }))
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
