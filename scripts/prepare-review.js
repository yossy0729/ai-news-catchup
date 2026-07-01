const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reviewPath = path.join(root, "data", "review.json");
const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Number(limitArg?.split("=")[1] || 10);
const write = args.has("--write");

function readJson(relativePath, fallback) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return fallback;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
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
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractMeta(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  return decodeEntities(pattern.exec(html)?.[1] || "");
}

function extractTitle(html) {
  return stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
}

function extractBodyExcerpt(html) {
  const article = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  const source = article || html;
  return stripTags(source).slice(0, 1200);
}

function inferImpact(categories) {
  if (categories.includes("global-governance") || categories.includes("jp-governance")) return "規制インパクト";
  if (categories.includes("global-research") || categories.includes("jp-research")) return "研究価値";
  if (categories.includes("security")) return "規制インパクト";
  if (categories.includes("infrastructure") || categories.includes("product-release")) return "技術重要度";
  return "社会影響";
}

function initialPriority(candidate, extracted) {
  let score = 50 + Math.min(candidate.score || 0, 20);
  const text = `${candidate.title} ${extracted.description} ${extracted.excerpt}`.toLowerCase();

  if (candidate.trustLevel === "primary") score += 10;
  if (candidate.sourceType === "research_lab" || candidate.sourceType === "paper_index") score += 8;
  if (candidate.categories.includes("global-governance") || candidate.categories.includes("jp-governance")) score += 7;
  if (candidate.categories.includes("product-release")) score += 5;
  if (text.includes("release") || text.includes("launch") || text.includes("research") || text.includes("model")) score += 5;
  if (text.includes("pricing") || text.includes("storage") || text.includes("login")) score -= 12;

  return Math.max(1, Math.min(100, score));
}

async function fetchCandidate(candidate) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(candidate.url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "AI-News-Catchup/0.1"
      }
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`
      };
    }

    const html = await response.text();
    const extracted = {
      title: extractMeta(html, "og:title") || extractTitle(html) || candidate.title,
      description: extractMeta(html, "description") || extractMeta(html, "og:description"),
      excerpt: extractBodyExcerpt(html)
    };

    return {
      ok: true,
      status: response.status,
      extracted
    };
  } catch (error) {
    return {
      ok: false,
      status: "ERROR",
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  // candidates.json はローカル生成物。dry-run等でまだ生成されていない環境でも落とさない。
  const candidates = readJson("data/candidates.json", {
    schemaVersion: 1,
    updatedDate: new Date().toISOString().slice(0, 10),
    items: []
  });
  const existingReview = readJson("data/review.json", {
    schemaVersion: 1,
    updatedDate: new Date().toISOString().slice(0, 10),
    items: []
  });
  const reviewByUrl = new Map(existingReview.items.map((item) => [item.url, item]));
  const candidatesToReview = candidates.items
    .filter((item) => item.status === "candidate")
    .slice(0, limit);

  let prepared = 0;
  let failed = 0;

  for (const candidate of candidatesToReview) {
    const result = await fetchCandidate(candidate);
    const now = new Date().toISOString();

    if (!result.ok) {
      failed += 1;
      reviewByUrl.set(candidate.url, {
        ...reviewByUrl.get(candidate.url),
        candidateId: candidate.id,
        url: candidate.url,
        title: candidate.title,
        sourceName: candidate.sourceName,
        status: "fetch_failed",
        fetchStatus: result.status,
        fetchError: result.error,
        preparedAt: now
      });
      continue;
    }

    const item = {
      candidateId: candidate.id,
      query: candidate.query,
      title: result.extracted.title || candidate.title,
      url: candidate.url,
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      sourceType: candidate.sourceType,
      categories: candidate.categories,
      suggestedCategory: candidate.categories[0],
      suggestedImpact: inferImpact(candidate.categories),
      initialPriority: initialPriority(candidate, result.extracted),
      trustLevel: candidate.trustLevel,
      description: result.extracted.description,
      excerpt: result.extracted.excerpt,
      status: "needs_review",
      preparedAt: now
    };

    reviewByUrl.set(candidate.url, item);
    prepared += 1;
  }

  const nextReview = {
    schemaVersion: 1,
    updatedDate: new Date().toISOString().slice(0, 10),
    items: Array.from(reviewByUrl.values()).sort((a, b) => (b.preparedAt || "").localeCompare(a.preparedAt || ""))
  };

  console.log(`Prepare review ${write ? "write" : "dry-run"}: prepared ${prepared}, failed ${failed}, total ${nextReview.items.length}`);

  if (write) {
    fs.writeFileSync(reviewPath, `${JSON.stringify(nextReview, null, 2)}\n`, "utf8");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
