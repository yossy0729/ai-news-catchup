const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const news = readJson("data/news.json");
const sources = readJson("data/sources.json");
const candidates = readJson("data/candidates.json");
const review = readJson("data/review.json");
const mediaNews = fs.existsSync(path.join(root, "data/media-news.json"))
  ? readJson("data/media-news.json")
  : { items: [] };
const officialNews = fs.existsSync(path.join(root, "data/official-news.json"))
  ? readJson("data/official-news.json")
  : { items: [] };
const aiSignals = fs.existsSync(path.join(root, "data/ai-signals.json"))
  ? readJson("data/ai-signals.json")
  : { items: [] };
const health = fs.existsSync(path.join(root, "data/health.json"))
  ? readJson("data/health.json")
  : null;
const sourceHealth = fs.existsSync(path.join(root, "data/source-health.json"))
  ? readJson("data/source-health.json")
  : null;

const categoryIds = new Set(news.categories.map((category) => category.id));
const sourceIds = new Set();
const duplicateSourceIds = new Set();
const invalidSourceCategories = [];
const invalidSourceTypes = [];
const invalidFetchMethods = [];
const invalidCandidateCategories = [];
const invalidCandidateStatuses = [];
const invalidReviewStatuses = [];
const duplicateCandidateUrls = new Set();
const duplicateReviewUrls = new Set();
const invalidMediaItems = [];
const duplicateMediaUrls = new Set();
const invalidOfficialItems = [];
const duplicateOfficialUrls = new Set();
const invalidSignals = [];
const duplicateSignalIds = new Set();
const invalidImportanceItems = [];
const invalidHealth = [];
const invalidSourceHealth = [];
const duplicateSourceHealthIds = new Set();

const allowedSourceTypes = new Set(sources.sourceTypes);
const allowedFetchMethods = new Set(sources.fetchMethods);
const allowedCandidateStatuses = new Set(["candidate", "accepted", "rejected", "expired"]);
const allowedReviewStatuses = new Set(["needs_review", "fetch_failed", "accepted", "rejected"]);
const allowedHealthStatuses = new Set(["ok", "warning", "failed"]);
const allowedSourceHealthStatuses = new Set(["ok", "no_items", "failed", "skipped", "unknown"]);
const allowedImportanceAxes = new Set(["technical", "business", "regulatory", "implementation", "market"]);

function priceSignalRule(item) {
  const source = `${item.source || ""} ${item.title || ""}`;
  const rules = [
    { name: "OpenAI", source: /OpenAI/i, required: /OpenAI/i, forbidden: /Anthropic|Claude|Gemini|Google/i },
    { name: "Anthropic", source: /Anthropic/i, required: /Anthropic|Claude/i, forbidden: /OpenAI|Gemini|Google/i },
    { name: "Google Gemini", source: /Google|Gemini/i, required: /Google|Gemini/i, forbidden: /OpenAI|Anthropic|Claude/i }
  ];
  return rules.find((rule) => rule.source.test(source));
}

function validatePriceSignal(item) {
  if (item.tag !== "Price") return null;
  const rule = priceSignalRule(item);
  if (!rule) return `${item.id || item.url}: unknown price signal source ${item.source || item.title}`;

  const titleJa = String(item.titleJa || "");
  if (!titleJa) return `${item.id || item.url}: missing titleJa for ${rule.name} price signal`;
  if (!rule.required.test(titleJa)) {
    return `${item.id || item.url}: titleJa does not mention ${rule.name}: ${titleJa}`;
  }
  if (rule.forbidden.test(titleJa)) {
    return `${item.id || item.url}: titleJa mentions another provider: ${titleJa}`;
  }
  return null;
}

for (const source of sources.sources) {
  if (sourceIds.has(source.id)) {
    duplicateSourceIds.add(source.id);
  }
  sourceIds.add(source.id);

  if (!allowedSourceTypes.has(source.sourceType)) {
    invalidSourceTypes.push(`${source.id}:${source.sourceType}`);
  }

  if (!allowedFetchMethods.has(source.fetchMethod)) {
    invalidFetchMethods.push(`${source.id}:${source.fetchMethod}`);
  }

  for (const category of source.categories) {
    if (!categoryIds.has(category)) {
      invalidSourceCategories.push(`${source.id}:${category}`);
    }
  }
}

const candidateUrls = new Set();
for (const candidate of candidates.items) {
  if (candidateUrls.has(candidate.url)) {
    duplicateCandidateUrls.add(candidate.url);
  }
  candidateUrls.add(candidate.url);

  if (!allowedCandidateStatuses.has(candidate.status)) {
    invalidCandidateStatuses.push(`${candidate.url}:${candidate.status}`);
  }

  for (const category of candidate.categories || []) {
    if (!categoryIds.has(category)) {
      invalidCandidateCategories.push(`${candidate.url}:${category}`);
    }
  }
}

const reviewUrls = new Set();
for (const item of review.items) {
  if (reviewUrls.has(item.url)) {
    duplicateReviewUrls.add(item.url);
  }
  reviewUrls.add(item.url);

  if (!allowedReviewStatuses.has(item.status)) {
    invalidReviewStatuses.push(`${item.url}:${item.status}`);
  }

  for (const category of item.categories || []) {
    if (!categoryIds.has(category)) {
      invalidCandidateCategories.push(`${item.url}:${category}`);
    }
  }
}

const mediaUrls = new Set();
for (const item of mediaNews.items || []) {
  if (!item.title || !item.url || !item.source || !item.category || !item.date) {
    invalidMediaItems.push(item.title || item.url || JSON.stringify(item).slice(0, 80));
  }

  if (item.url.includes("news.google.com/rss/articles/")) {
    invalidMediaItems.push(`${item.title || item.url}: Google News RSS links are discovery links, not verified article links`);
  }

  if (item.dateVerification?.status !== "verified") {
    invalidMediaItems.push(`${item.title || item.url}: missing verified publication date`);
  }

  if (mediaUrls.has(item.url)) {
    duplicateMediaUrls.add(item.url);
  }
  mediaUrls.add(item.url);
}

const officialUrls = new Set();
for (const item of officialNews.items || []) {
  if (!item.title || !item.url || !item.source || !item.vendorId || !item.vendorName || !item.date) {
    invalidOfficialItems.push(item.title || item.url || JSON.stringify(item).slice(0, 80));
  }

  if (item.url.includes("news.google.com/rss/articles/")) {
    invalidOfficialItems.push(`${item.title || item.url}: Google News RSS links are not allowed for official items`);
  }

  if (item.dateVerification?.status !== "verified") {
    invalidOfficialItems.push(`${item.title || item.url}: missing verified publication date`);
  }

  if (officialUrls.has(item.url)) {
    duplicateOfficialUrls.add(item.url);
  }
  officialUrls.add(item.url);
}

const signalIds = new Set();
for (const item of aiSignals.items || []) {
  if (!item.id || !item.lane || !item.tag || !item.text || !item.url || !item.source || !item.date) {
    invalidSignals.push(item.text || item.title || item.url || JSON.stringify(item).slice(0, 80));
  }

  const priceSignalError = validatePriceSignal(item);
  if (priceSignalError) {
    invalidSignals.push(priceSignalError);
  }

  if (signalIds.has(item.id)) {
    duplicateSignalIds.add(item.id);
  }
  signalIds.add(item.id);
}

for (const category of news.categories || []) {
  for (const item of category.items || []) {
    if (!item.importance) continue;
    if (
      typeof item.importance.total !== "number" ||
      !allowedImportanceAxes.has(item.importance.primaryAxis) ||
      !Array.isArray(item.importance.labels) ||
      !item.importance.primaryReason
    ) {
      invalidImportanceItems.push(item.title || item.url || JSON.stringify(item).slice(0, 80));
    }
  }
}

if (health) {
  if (!allowedHealthStatuses.has(health.status)) {
    invalidHealth.push(`invalid status: ${health.status}`);
  }
  if (!health.generatedAt || !health.generatedDate || !health.summary) {
    invalidHealth.push("missing generatedAt/generatedDate/summary");
  }
}

if (sourceHealth) {
  if (!sourceHealth.generatedAt || !sourceHealth.generatedDate || !sourceHealth.summary || !Array.isArray(sourceHealth.sources)) {
    invalidSourceHealth.push("missing generatedAt/generatedDate/summary/sources");
  }

  const sourceHealthIds = new Set();
  for (const item of sourceHealth.sources || []) {
    if (!item.id || !item.name || !item.group || !allowedSourceHealthStatuses.has(item.status)) {
      invalidSourceHealth.push(item.id || item.name || JSON.stringify(item).slice(0, 80));
    }

    const id = `${item.group}:${item.id}`;
    if (sourceHealthIds.has(id)) {
      duplicateSourceHealthIds.add(id);
    }
    sourceHealthIds.add(id);
  }
}

if (duplicateSourceIds.size > 0) {
  fail(`Duplicate source ids:\n${Array.from(duplicateSourceIds).join("\n")}`);
}

if (invalidSourceCategories.length > 0) {
  fail(`Invalid source categories:\n${invalidSourceCategories.join("\n")}`);
}

if (invalidSourceTypes.length > 0) {
  fail(`Invalid source types:\n${invalidSourceTypes.join("\n")}`);
}

if (invalidFetchMethods.length > 0) {
  fail(`Invalid fetch methods:\n${invalidFetchMethods.join("\n")}`);
}

if (duplicateCandidateUrls.size > 0) {
  fail(`Duplicate candidate urls:\n${Array.from(duplicateCandidateUrls).join("\n")}`);
}

if (invalidCandidateCategories.length > 0) {
  fail(`Invalid candidate categories:\n${invalidCandidateCategories.join("\n")}`);
}

if (invalidCandidateStatuses.length > 0) {
  fail(`Invalid candidate statuses:\n${invalidCandidateStatuses.join("\n")}`);
}

if (duplicateReviewUrls.size > 0) {
  fail(`Duplicate review urls:\n${Array.from(duplicateReviewUrls).join("\n")}`);
}

if (invalidReviewStatuses.length > 0) {
  fail(`Invalid review statuses:\n${invalidReviewStatuses.join("\n")}`);
}

if (invalidMediaItems.length > 0) {
  fail(`Invalid media news items:\n${invalidMediaItems.join("\n")}`);
}

if (duplicateMediaUrls.size > 0) {
  fail(`Duplicate media news urls:\n${Array.from(duplicateMediaUrls).join("\n")}`);
}

if (invalidOfficialItems.length > 0) {
  fail(`Invalid official news items:\n${invalidOfficialItems.join("\n")}`);
}

if (duplicateOfficialUrls.size > 0) {
  fail(`Duplicate official news urls:\n${Array.from(duplicateOfficialUrls).join("\n")}`);
}

if (invalidSignals.length > 0) {
  fail(`Invalid AI signals:\n${invalidSignals.join("\n")}`);
}

if (duplicateSignalIds.size > 0) {
  fail(`Duplicate AI signal ids:\n${Array.from(duplicateSignalIds).join("\n")}`);
}

if (invalidImportanceItems.length > 0) {
  fail(`Invalid importance data:\n${invalidImportanceItems.join("\n")}`);
}

if (invalidHealth.length > 0) {
  fail(`Invalid health data:\n${invalidHealth.join("\n")}`);
}

if (invalidSourceHealth.length > 0) {
  fail(`Invalid source health data:\n${invalidSourceHealth.join("\n")}`);
}

if (duplicateSourceHealthIds.size > 0) {
  fail(`Duplicate source health ids:\n${Array.from(duplicateSourceHealthIds).join("\n")}`);
}

if (process.exitCode) {
  process.exit();
}

console.log(`Data validation passed: ${news.categories.length} categories, ${sources.sources.length} sources, ${candidates.items.length} candidates, ${review.items.length} review items, ${(mediaNews.items || []).length} media items, ${(officialNews.items || []).length} official items, ${(aiSignals.items || []).length} AI signals${sourceHealth ? `, ${sourceHealth.sources.length} source health items` : ""}`);
