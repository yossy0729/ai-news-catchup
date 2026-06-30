const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const writeReview = args.has("--write-review") || args.has("--write");
const applyVerified = args.has("--apply-verified");
const pricingPath = path.join(root, "data", "pricing.json");
const reviewPath = path.join(root, "data", "pricing-review.json");

function getArg(prefix, fallback) {
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const timeoutMs = Number(getArg("--timeout-ms=", "15000"));

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(value) {
  return decodeEntities(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function normalizeForSearch(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, "").replace(/[^a-z0-9.]/g, "");
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function samePrice(a, b) {
  const left = numeric(a);
  const right = numeric(b);
  if (left === null || right === null) return false;
  return Math.abs(left - right) < 0.0001;
}

function uniqueAmounts(amounts) {
  const seen = new Set();
  const result = [];
  for (const amount of amounts) {
    const value = Number(amount.value);
    if (!Number.isFinite(value)) continue;
    const key = value.toFixed(6);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ value, excerpt: amount.excerpt });
  }
  return result;
}

function extractMoneyAmounts(text) {
  const amounts = [];
  const regex = /(?:\$|USD\s*)\s*([0-9]+(?:\.[0-9]+)?)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(text.length, match.index + 140);
    amounts.push({
      value: Number(match[1]),
      excerpt: normalizeSpaces(text.slice(start, end))
    });
  }
  return uniqueAmounts(amounts).slice(0, 20);
}

function findLabeledPrice(text, labelRegexes) {
  const amounts = extractMoneyAmounts(text);
  for (const labelRegex of labelRegexes) {
    const labelMatch = labelRegex.exec(text);
    if (!labelMatch) continue;
    const after = text.slice(labelMatch.index, labelMatch.index + 500);
    const money = /(?:\$|USD\s*)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(after);
    if (money) return Number(money[1]);
  }

  for (const amount of amounts) {
    const excerpt = amount.excerpt.toLowerCase();
    if (labelRegexes.some((regex) => regex.test(excerpt))) return amount.value;
  }
  return null;
}

function findModelWindow(pageText, modelName) {
  const normalizedPage = normalizeForSearch(pageText);
  const normalizedModel = normalizeForSearch(modelName);
  if (!normalizedModel) return null;

  let rawIndex = pageText.toLowerCase().indexOf(String(modelName || "").toLowerCase());
  if (rawIndex < 0 && normalizedPage.includes(normalizedModel)) {
    const terms = String(modelName || "").split(/[\s_-]+/).filter((term) => term.length >= 2);
    const firstTerm = terms[0];
    rawIndex = firstTerm ? pageText.toLowerCase().indexOf(firstTerm.toLowerCase()) : -1;
  }
  if (rawIndex < 0) return null;

  const start = Math.max(0, rawIndex - 1600);
  const end = Math.min(pageText.length, rawIndex + 3200);
  return pageText.slice(start, end);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "AI-News-Catchup/0.1 pricing-review"
      }
    });
    const body = await response.text();
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.httpStatus = response.status;
      error.bodySample = body.slice(0, 240);
      throw error;
    }
    return { html: body, httpStatus: response.status };
  } finally {
    clearTimeout(timer);
  }
}

function buildDetected(windowText) {
  return {
    inputPer1M: findLabeledPrice(windowText, [/\binput\b/i, /\bprompt\b/i]),
    cachedInputPer1M: findLabeledPrice(windowText, [/cache(?:d)?\s+input/i, /cache\s+read/i, /cached/i]),
    outputPer1M: findLabeledPrice(windowText, [/\boutput\b/i, /\bcompletion\b/i])
  };
}

function compareModel(model, pageResult) {
  const current = {
    inputPer1M: numeric(model.inputPer1M),
    cachedInputPer1M: numeric(model.cachedInputPer1M),
    outputPer1M: numeric(model.outputPer1M),
    context: model.context || null
  };

  if (!pageResult.ok) {
    return {
      vendor: model.vendor,
      model: model.model,
      sourceUrl: model.sourceUrl,
      current,
      detected: {},
      status: "fetch_failed",
      confidence: "none",
      reasons: [pageResult.error],
      fetchedAt: pageResult.fetchedAt
    };
  }

  const windowText = findModelWindow(pageResult.text, model.model);
  if (!windowText) {
    return {
      vendor: model.vendor,
      model: model.model,
      sourceUrl: model.sourceUrl,
      current,
      detected: {},
      status: "model_not_found",
      confidence: "none",
      reasons: ["Model name was not found on the official pricing page."],
      fetchedAt: pageResult.fetchedAt
    };
  }

  const detected = buildDetected(windowText);
  const amounts = extractMoneyAmounts(windowText);
  const reasons = [];
  const hasInput = detected.inputPer1M !== null;
  const hasOutput = detected.outputPer1M !== null;

  const currentValuesFound = [current.inputPer1M, current.cachedInputPer1M, current.outputPer1M]
    .filter((value) => value !== null)
    .every((value) => amounts.some((amount) => samePrice(amount.value, value)));

  if (!amounts.length) {
    reasons.push("Model name was found, but no USD prices were found nearby.");
    return {
      vendor: model.vendor,
      model: model.model,
      sourceUrl: model.sourceUrl,
      current,
      detected,
      extractedAmounts: amounts,
      status: "no_prices",
      confidence: "none",
      reasons,
      fetchedAt: pageResult.fetchedAt
    };
  }

  if (currentValuesFound) {
    return {
      vendor: model.vendor,
      model: model.model,
      sourceUrl: model.sourceUrl,
      current,
      detected,
      extractedAmounts: amounts,
      status: "matched_unlabeled",
      confidence: "medium",
      reasons: ["Current prices appear near the model name, but labels were not reliable enough for auto-apply."],
      fetchedAt: pageResult.fetchedAt
    };
  }

  if (hasInput && hasOutput) {
    const inputChanged = !samePrice(detected.inputPer1M, current.inputPer1M);
    const outputChanged = !samePrice(detected.outputPer1M, current.outputPer1M);
    if (!inputChanged && !outputChanged) {
      return {
        vendor: model.vendor,
        model: model.model,
        sourceUrl: model.sourceUrl,
        current,
        detected,
        extractedAmounts: amounts,
        status: "matched",
        confidence: "high",
        reasons,
        fetchedAt: pageResult.fetchedAt
      };
    }

    if (inputChanged) reasons.push(`Potential input difference: current=${current.inputPer1M}, detected=${detected.inputPer1M}`);
    if (outputChanged) reasons.push(`Potential output difference: current=${current.outputPer1M}, detected=${detected.outputPer1M}`);
    reasons.push("Generic page parsing found different labeled prices, but the mapping is not safe enough for auto-apply.");
    return {
      vendor: model.vendor,
      model: model.model,
      sourceUrl: model.sourceUrl,
      current,
      detected,
      extractedAmounts: amounts,
      status: "review_required",
      confidence: "low",
      reasons,
      fetchedAt: pageResult.fetchedAt
    };
  }

  return {
    vendor: model.vendor,
    model: model.model,
    sourceUrl: model.sourceUrl,
    current,
    detected,
    extractedAmounts: amounts,
    status: "review_required",
    confidence: "low",
    reasons: ["Prices were found near the model name, but input/output labels could not be mapped safely."],
    fetchedAt: pageResult.fetchedAt
  };
}

function summarize(items) {
  const summary = {
    total: items.length,
    matched: 0,
    matchedUnlabeled: 0,
    changed: 0,
    reviewRequired: 0,
    modelNotFound: 0,
    noPrices: 0,
    fetchFailed: 0
  };
  for (const item of items) {
    if (item.status === "matched") summary.matched += 1;
    else if (item.status === "matched_unlabeled") summary.matchedUnlabeled += 1;
    else if (item.status === "changed") summary.changed += 1;
    else if (item.status === "review_required") summary.reviewRequired += 1;
    else if (item.status === "model_not_found") summary.modelNotFound += 1;
    else if (item.status === "no_prices") summary.noPrices += 1;
    else if (item.status === "fetch_failed") summary.fetchFailed += 1;
  }
  return summary;
}

async function collect() {
  const pricing = readJson(pricingPath, { models: [] });
  const models = Array.isArray(pricing.models) ? pricing.models : [];
  const fetchedAt = new Date().toISOString();
  const pages = new Map();

  for (const url of new Set(models.map((model) => model.sourceUrl).filter(Boolean))) {
    try {
      const response = await fetchText(url);
      pages.set(url, {
        ok: true,
        text: stripTags(response.html),
        httpStatus: response.httpStatus,
        fetchedAt
      });
    } catch (error) {
      pages.set(url, {
        ok: false,
        error: `${error.httpStatus ? `HTTP ${error.httpStatus}` : error.message}`,
        fetchedAt
      });
    }
  }

  const items = models.map((model) => compareModel(model, pages.get(model.sourceUrl) || {
    ok: false,
    error: "Missing sourceUrl",
    fetchedAt
  }));

  return {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    generatedDate: todayInTokyo(),
    pricingAsOf: pricing.asOf || null,
    sourcePolicy: "Official pricing pages are fetched into review data first. pricing.json is not overwritten unless a future verified apply step is explicitly enabled.",
    summary: summarize(items),
    items
  };
}

function applyVerifiedChanges(pricing, review) {
  const byKey = new Map(review.items.map((item) => [`${item.vendor}\u0000${item.model}`, item]));
  let changed = 0;
  for (const model of pricing.models || []) {
    const reviewItem = byKey.get(`${model.vendor}\u0000${model.model}`);
    if (!reviewItem || reviewItem.status !== "changed" || reviewItem.confidence !== "high") continue;
    model.inputPer1M = reviewItem.detected.inputPer1M;
    model.outputPer1M = reviewItem.detected.outputPer1M;
    if (reviewItem.detected.cachedInputPer1M !== null && reviewItem.detected.cachedInputPer1M !== undefined) {
      model.cachedInputPer1M = reviewItem.detected.cachedInputPer1M;
    }
    model.asOf = review.generatedDate;
    model.verified = true;
    changed += 1;
  }
  if (changed) {
    pricing.asOf = review.generatedDate;
    writeJson(pricingPath, pricing);
  }
  return changed;
}

async function main() {
  const review = await collect();
  if (writeReview) writeJson(reviewPath, review);

  let applied = 0;
  if (applyVerified) {
    const pricing = readJson(pricingPath, { models: [] });
    applied = applyVerifiedChanges(pricing, review);
  }

  console.log(`Pricing review ${writeReview ? "write" : "dry-run"}: total=${review.summary.total}, matched=${review.summary.matched}, matched_unlabeled=${review.summary.matchedUnlabeled}, changed=${review.summary.changed}, review_required=${review.summary.reviewRequired}, model_not_found=${review.summary.modelNotFound}, no_prices=${review.summary.noPrices}, fetch_failed=${review.summary.fetchFailed}, applied=${applied}`);

  const notable = review.items.filter((item) => !["matched", "matched_unlabeled"].includes(item.status));
  for (const item of notable.slice(0, 12)) {
    console.log(`- ${item.status} ${item.vendor} ${item.model}: ${item.reasons.join(" / ")}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
