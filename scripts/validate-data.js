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

const allowedSourceTypes = new Set(sources.sourceTypes);
const allowedFetchMethods = new Set(sources.fetchMethods);
const allowedCandidateStatuses = new Set(["candidate", "accepted", "rejected", "expired"]);
const allowedReviewStatuses = new Set(["needs_review", "fetch_failed", "accepted", "rejected"]);

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

  if (signalIds.has(item.id)) {
    duplicateSignalIds.add(item.id);
  }
  signalIds.add(item.id);
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

if (process.exitCode) {
  process.exit();
}

console.log(`Data validation passed: ${news.categories.length} categories, ${sources.sources.length} sources, ${candidates.items.length} candidates, ${review.items.length} review items, ${(mediaNews.items || []).length} media items, ${(officialNews.items || []).length} official items, ${(aiSignals.items || []).length} AI signals`);
