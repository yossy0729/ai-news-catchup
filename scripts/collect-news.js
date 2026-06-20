const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcesPath = path.join(root, "data", "sources.json");
const candidatesPath = path.join(root, "data", "candidates.json");
const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

const limit = getNumberArg("--limit=", null);
const perSource = getNumberArg("--per-source=", 5);
const maxCandidates = getNumberArg("--max-candidates=", 60);
const maxAgeDays = getNumberArg("--max-age-days=", 30);
const minScore = getNumberArg("--min-score=", 28);
const write = args.has("--write");
const check = args.has("--check");
const collect = args.has("--collect") || write;

const enabledSources = sources.sources
  .filter((source) => source.enabled)
  .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
const selectedSources = Number.isFinite(limit) ? enabledSources.slice(0, limit) : enabledSources;

const skippedMethods = new Set(["api", "github", "manual_review"]);
const contentHints = [
  "ai",
  "artificial intelligence",
  "agent",
  "agents",
  "llm",
  "model",
  "models",
  "rag",
  "reasoning",
  "multimodal",
  "benchmark",
  "safety",
  "security",
  "governance",
  "regulation",
  "policy",
  "research",
  "paper",
  "open source",
  "generative",
  "inference",
  "training",
  "robotics",
  "claude",
  "gemini",
  "llama",
  "gpt",
  "生成AI",
  "AIエージェント",
  "基盤モデル",
  "機械学習",
  "深層学習",
  "自然言語処理",
  "画像認識",
  "自動化",
  "業務効率化",
  "ロボット",
  "生成ai",
  "人工知能",
  "大規模言語モデル",
  "基盤モデル",
  "機械学習",
  "研究",
  "規制",
  "安全性",
  "ガイドライン"
];

const genericTitles = new Set([
  "home",
  "news",
  "blog",
  "research",
  "about",
  "contact",
  "careers",
  "events",
  "learn more",
  "read more",
  "view all",
  "see all",
  "previous",
  "next",
  "press",
  "privacy",
  "terms",
  "login",
  "sign up",
  "subscribe",
  "続きを読む",
  "詳細",
  "ニュース",
  "お問い合わせ"
]);

function getNumberArg(prefix, fallback) {
  const value = rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function sourceBasePath(source) {
  return new URL(source.url).pathname.replace(/\/$/, "");
}

function isBadHref(url) {
  const text = `${url.pathname} ${url.search}`.toLowerCase();
  return /(?:login|signin|signup|subscribe|newsletter|privacy|terms|cookie|careers|jobs|contact|about|author|tag|search|account|download|webinar|event|rss|feed|mailto|javascript)/i.test(text);
}

function isLikelyContentUrl(url, source) {
  const sourceUrl = new URL(source.url);
  const sourcePath = sourceBasePath(source);
  const pathName = url.pathname.replace(/\/$/, "");

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (normalizeUrl(url.href) === normalizeUrl(source.url)) return false;
  if (isBadHref(url)) return false;
  if (url.hostname !== sourceUrl.hostname && !url.hostname.endsWith(`.${sourceUrl.hostname}`)) return false;
  if (pathName === sourcePath) return false;

  const sourceLooksLikeListing = /(?:news|press|release|releases|blog|research)/i.test(sourcePath);
  if (sourceLooksLikeListing && sourcePath && !pathName.startsWith(`${sourcePath}/`)) {
    return false;
  }

  if (/(?:\/category\/|\/tag\/|\/tags\/|\/topics\/|\/sustainability\/|\/policy\/|\/about\/|\/service\/|\/services\/|\/solution\/|\/solutions\/|\/product\/|\/products\/)/i.test(pathName)) {
    return false;
  }

  const depth = pathName.split("/").filter(Boolean).length;
  const hasContentPath = /(?:blog|news|research|article|articles|posts|press|release|releases|technology|ai|paper|papers|resources|publication|publications)/i.test(pathName);
  return depth >= 2 || hasContentPath;
}

function hasContentHint(value) {
  const text = String(value || "").toLowerCase();
  return contentHints.some((hint) => {
    const normalizedHint = hint.toLowerCase();

    if (/^[a-z0-9-]+$/i.test(normalizedHint) && normalizedHint.length <= 4) {
      const escaped = normalizedHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
    }

    return text.includes(normalizedHint);
  });
}

function isAiFocusedSource(source) {
  const text = `${source.id} ${source.name} ${source.url}`.toLowerCase();
  return /(?:openai|anthropic|deepmind|google-ai|meta-ai|huggingface|nvidia|sakana|artificial-intelligence|machinelearning|riken-aip|nist-ai|eu-ai-act)/i.test(text);
}

function parseDateFromText(...values) {
  const text = values.map((value) => String(value || "")).join(" ");
  const iso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;

  const jp = /\b(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日\b/.exec(text);
  if (jp) return `${jp[1]}-${String(Number(jp[2])).padStart(2, "0")}-${String(Number(jp[3])).padStart(2, "0")}`;

  const monthMap = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12"
  };
  const month = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s+(20\d{2})\b/i.exec(text);
  if (!month) return "";
  return `${month[3]}-${monthMap[month[1].toLowerCase().replace(".", "")]}-${String(Number(month[2])).padStart(2, "0")}`;
}

function ageInDays(dateValue, todayValue) {
  if (!dateValue) return null;
  const itemDate = new Date(`${dateValue}T00:00:00+09:00`);
  const todayDate = new Date(`${todayValue}T00:00:00+09:00`);
  return Math.floor((todayDate - itemDate) / 86400000);
}

function scoreCandidate(candidate, source, today) {
  const text = `${candidate.title} ${candidate.url}`.toLowerCase();
  const publishedDate = parseDateFromText(candidate.title, candidate.url);
  const age = ageInDays(publishedDate, today);
  let score = 0;

  if (!isAiFocusedSource(source) && !hasContentHint(text)) {
    return 0;
  }

  score += Math.max(0, 16 - source.priority * 2);
  if (source.trustLevel === "primary") score += 10;
  if (source.trustLevel === "canonical_index") score += 7;
  if (hasContentHint(text)) score += 18;
  if (/(?:blog|news|research|article|posts|press|release|papers|technology|ai)/i.test(new URL(candidate.url).pathname)) score += 8;
  if (publishedDate && age != null && age >= 0 && age <= maxAgeDays) score += 28;
  if (publishedDate && age != null && age >= 0 && age <= 7) score += 8;
  if (!publishedDate) score += 4;
  if (candidate.title.length > 28) score += 4;
  if (candidate.title.length > 120) score -= 10;
  if (genericTitles.has(candidate.title.toLowerCase())) score -= 30;
  if (/(?:pricing|storage|cookie|privacy|terms|login|subscribe)/i.test(text)) score -= 25;

  return Math.max(0, score);
}

function extractCandidatesFromHtml(html, source, today) {
  const candidates = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = decodeEntities(match[1]);
    const title = normalizeSpaces(stripTags(match[2]));

    if (!href || !title || title.length < 8) continue;
    if (genericTitles.has(title.toLowerCase())) continue;
    if (title.toLowerCase() === source.name.toLowerCase()) continue;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, source.url);
    } catch {
      continue;
    }

    if (!isLikelyContentUrl(absoluteUrl, source)) continue;

    const candidate = {
      title,
      url: normalizeUrl(absoluteUrl.href),
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.sourceType,
      categories: source.categories,
      trustLevel: source.trustLevel
    };
    const score = scoreCandidate(candidate, source, today);

    if (score >= minScore) {
      candidates.push({
        ...candidate,
        query: "daily-auto",
        score,
        publishedDate: parseDateFromText(candidate.title, candidate.url) || undefined
      });
    }
  }

  return candidates;
}

async function fetchSource(source) {
  if (skippedMethods.has(source.fetchMethod)) {
    return {
      id: source.id,
      status: "SKIP",
      ok: true,
      url: source.url,
      skipped: true,
      candidates: []
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(source.url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "AI-News-Catchup/0.1"
      }
    });

    if (!response.ok) {
      return {
        id: source.id,
        status: response.status,
        ok: false,
        url: response.url,
        candidates: []
      };
    }

    return {
      id: source.id,
      status: response.status,
      ok: true,
      url: response.url,
      html: await response.text(),
      candidates: []
    };
  } catch (error) {
    return {
      id: source.id,
      status: "ERROR",
      ok: false,
      error: error.message,
      candidates: []
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printPlan() {
  const byMethod = enabledSources.reduce((result, source) => {
    result[source.fetchMethod] = (result[source.fetchMethod] || 0) + 1;
    return result;
  }, {});

  const byRegion = enabledSources.reduce((result, source) => {
    result[source.region] = (result[source.region] || 0) + 1;
    return result;
  }, {});

  console.log(`Enabled sources: ${enabledSources.length}`);
  console.log(`By fetch method: ${JSON.stringify(byMethod)}`);
  console.log(`By region: ${JSON.stringify(byRegion)}`);
  console.log("");
  console.log("Collection order:");

  for (const source of enabledSources) {
    console.log(`- [P${source.priority}] ${source.id} (${source.fetchMethod}) -> ${source.categories.join(", ")}`);
  }
}

async function checkSources() {
  for (const source of selectedSources) {
    const result = await fetchSource(source);
    const detail = result.ok ? result.url : result.error;
    const label = result.skipped ? "SKIP" : result.ok ? "OK" : "NG";
    console.log(`${label} ${result.id} ${result.status} ${detail || ""}`);
  }
}

function saveCandidates(results) {
  const candidates = fs.existsSync(candidatesPath)
    ? JSON.parse(fs.readFileSync(candidatesPath, "utf8"))
    : { schemaVersion: 1, updatedDate: todayInTokyo(), items: [] };
  const byUrl = new Map(candidates.items.map((item) => [item.url, item]));
  let added = 0;
  let updated = 0;

  for (const result of results) {
    const now = new Date().toISOString();
    const existing = byUrl.get(result.url);
    const item = {
      id: crypto.createHash("sha256").update(result.url).digest("hex").slice(0, 24),
      query: result.query || existing?.query || "daily-auto",
      title: result.title,
      url: result.url,
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      sourceType: result.sourceType,
      categories: result.categories || [],
      trustLevel: result.trustLevel,
      score: Math.max(result.score || 0, existing?.score || 0),
      publishedDate: result.publishedDate || existing?.publishedDate,
      status: existing?.status && existing.status !== "expired" ? existing.status : "candidate",
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now
    };

    if (existing) {
      updated += 1;
    } else {
      added += 1;
    }

    byUrl.set(result.url, item);
  }

  candidates.updatedDate = todayInTokyo();
  candidates.items = Array.from(byUrl.values()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  fs.writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`, "utf8");
  return { added, updated, total: candidates.items.length };
}

async function collectCandidates() {
  const today = todayInTokyo();
  const deduped = new Map();
  const stats = {
    ok: 0,
    failed: 0,
    skipped: 0
  };

  for (const source of selectedSources) {
    const result = await fetchSource(source);

    if (result.skipped) {
      stats.skipped += 1;
      continue;
    }

    if (!result.ok) {
      stats.failed += 1;
      console.log(`NG ${source.id} ${result.status} ${result.error || result.url || ""}`);
      continue;
    }

    stats.ok += 1;
    const extracted = extractCandidatesFromHtml(result.html, source, today)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, perSource);

    console.log(`OK ${source.id} ${result.status} candidates=${extracted.length}`);

    for (const candidate of extracted) {
      const existing = deduped.get(candidate.url);
      if (!existing || candidate.score > existing.score) {
        deduped.set(candidate.url, candidate);
      }
    }
  }

  const results = Array.from(deduped.values())
    .sort((a, b) => b.score - a.score || a.sourceName.localeCompare(b.sourceName))
    .slice(0, maxCandidates);

  console.log(`Collect ${write ? "write" : "dry-run"}: sources ok=${stats.ok}, failed=${stats.failed}, skipped=${stats.skipped}, candidates=${results.length}`);

  for (const result of results.slice(0, 20)) {
    const date = result.publishedDate ? ` ${result.publishedDate}` : "";
    console.log(`- [${result.score}]${date} ${result.sourceName}: ${result.title}`);
  }

  if (write) {
    const saved = saveCandidates(results);
    console.log(`Saved candidates: added=${saved.added}, updated=${saved.updated}, total=${saved.total}`);
  }
}

if (check) {
  checkSources();
} else if (collect) {
  collectCandidates().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  printPlan();
  console.log("");
  console.log("Use `node scripts/collect-news.js --check` to test source reachability.");
  console.log("Use `node scripts/collect-news.js --collect` for a dry-run collection.");
  console.log("Use `node scripts/collect-news.js --write` to save daily candidates.");
}
