const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pricingPath = path.join(root, "data", "pricing.json");
const reviewPath = path.join(root, "data", "pricing-review.json");
const allowedReviewStatuses = new Set([
  "matched",
  "matched_unlabeled",
  "secondary_consensus",
  "changed",
  "review_required",
  "model_not_found",
  "no_prices",
  "fetch_failed"
]);
const allowedConfidence = new Set(["high", "medium", "low", "none"]);
const errors = [];

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isDateLike(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isPrice(value, allowBlank = false) {
  if (allowBlank && (value === null || value === undefined || value === "")) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function add(message) {
  errors.push(message);
}

function validatePricing(pricing) {
  if (!pricing || typeof pricing !== "object") {
    add("pricing.json is missing or invalid JSON object");
    return;
  }
  if (pricing.schemaVersion !== 1) add("pricing.json schemaVersion must be 1");
  if (pricing.asOf && !isDateLike(pricing.asOf)) add(`pricing.json asOf must be YYYY-MM-DD: ${pricing.asOf}`);
  if (pricing.currency !== "USD") add(`pricing.json currency should be USD: ${pricing.currency}`);
  if (!Array.isArray(pricing.models)) {
    add("pricing.json models must be an array");
    return;
  }

  const keys = new Set();
  for (const model of pricing.models) {
    const key = `${model.vendor || ""}/${model.model || ""}`;
    if (!model.vendor || !model.model) add(`pricing model missing vendor/model: ${JSON.stringify(model).slice(0, 120)}`);
    if (keys.has(key)) add(`duplicate pricing model: ${key}`);
    keys.add(key);

    if (!isPrice(model.inputPer1M)) add(`${key}: inputPer1M must be a non-negative number`);
    if (!isPrice(model.cachedInputPer1M, true)) add(`${key}: cachedInputPer1M must be a non-negative number or blank`);
    if (!isPrice(model.outputPer1M)) add(`${key}: outputPer1M must be a non-negative number`);
    if (!model.context) add(`${key}: context is missing`);
    if (!isHttpUrl(model.sourceUrl)) add(`${key}: sourceUrl must be http(s)`);
    if (model.asOf && !isDateLike(model.asOf)) add(`${key}: asOf must be YYYY-MM-DD`);
    if (typeof model.verified !== "boolean") add(`${key}: verified must be boolean`);
  }
}

function validateReview(review) {
  if (!review) return;
  if (review.schemaVersion !== 1) add("pricing-review.json schemaVersion must be 1");
  if (!review.generatedAt) add("pricing-review.json generatedAt is missing");
  if (!isDateLike(review.generatedDate)) add(`pricing-review.json generatedDate must be YYYY-MM-DD: ${review.generatedDate}`);
  if (!review.summary || typeof review.summary.total !== "number") add("pricing-review.json summary.total is missing");
  if (!Array.isArray(review.items)) {
    add("pricing-review.json items must be an array");
    return;
  }

  for (const item of review.items) {
    const key = `${item.vendor || ""}/${item.model || ""}`;
    if (!item.vendor || !item.model || !item.sourceUrl) add(`review item missing vendor/model/sourceUrl: ${JSON.stringify(item).slice(0, 120)}`);
    if (!allowedReviewStatuses.has(item.status)) add(`${key}: invalid review status ${item.status}`);
    if (!allowedConfidence.has(item.confidence)) add(`${key}: invalid confidence ${item.confidence}`);
    if (!item.current || typeof item.current !== "object") add(`${key}: current snapshot is missing`);
    if (!Array.isArray(item.reasons)) add(`${key}: reasons must be an array`);
    if (item.sourceUrl && !isHttpUrl(item.sourceUrl)) add(`${key}: review sourceUrl must be http(s)`);
    if (item.secondaryConsensus) {
      if (!Array.isArray(item.secondaryConsensus.sources)) add(`${key}: secondaryConsensus.sources must be an array`);
      if (!["matches_current", "differs_from_current", "insufficient_sources"].includes(item.secondaryConsensus.status)) {
        add(`${key}: invalid secondaryConsensus status ${item.secondaryConsensus.status}`);
      }
    }
  }
}

const pricing = readJson(pricingPath);
const review = readJson(reviewPath, null);
validatePricing(pricing);
validateReview(review);

if (errors.length) {
  console.error(`Pricing validation failed:\n${errors.join("\n")}`);
  process.exit(1);
}

const reviewSuffix = review ? `, ${review.items.length} review items` : ", no pricing-review.json yet";
console.log(`Pricing validation passed: ${(pricing.models || []).length} models${reviewSuffix}`);
