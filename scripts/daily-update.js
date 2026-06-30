const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

const dryRun = args.has("--dry-run");
const noLog = args.has("--no-log");
const reviewLimit = getArg("--review-limit=", "20");
const mediaLimit = getArg("--media-limit=", "45");
const officialLimit = getArg("--official-limit=", "36");
const signalLimit = getArg("--signal-limit=", "32");
const perSource = getArg("--per-source=", "3");
const maxCandidates = getArg("--max-candidates=", "50");
const minPriority = getArg("--min-priority=", "60");
const maxAgeDays = getArg("--max-age-days=", "30");
const maxItems = getArg("--max-items=", "12");
const sourceLimit = getArg("--source-limit=", "");
// 既定は蓄積（履歴を残す）。明示的に作り直したいときだけ --replace-categories。
const replaceCategories = args.has("--replace-categories");
const noAccept = args.has("--no-accept");
const llmSummary = args.has("--llm-summary") || process.env.AI_NEWS_LLM_SUMMARY === "1";
const llmLimit = getArg("--llm-limit=", reviewLimit);
const newsSummaryLimit = getArg("--news-summary-limit=", "40");

if (args.has("--help")) {
  printHelp();
  process.exit(0);
}

const startedAt = new Date();
const logPath = path.join(root, "logs", `daily-update-${todayInTokyo()}.log`);
const healthPath = path.join(root, "data", "health.json");
const sourceHealthPath = path.join(root, "data", "source-health.json");
const results = [];

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

function printHelp() {
  console.log(`AI News Catchup daily update

Usage:
  node scripts/daily-update.js
  node scripts/daily-update.js --dry-run

Options:
  --dry-run              Run collection/review/promotion without writing data.
  --review-limit=N       Number of candidate URLs to prepare for review. Default: 20.
  --media-limit=N        Number of media radar items to keep. Default: 45.
  --official-limit=N     Number of official vendor items to keep. Default: 36.
  --signal-limit=N       Number of ticker signal items to keep. Default: 32.
  --per-source=N         Max collected candidates per source. Default: 3.
  --max-candidates=N     Max daily candidates saved from collection. Default: 50.
  --min-priority=N       Promotion threshold. Default: 60.
  --max-age-days=N       Exclude older items from promotion. Default: 30.
  --max-items=N          Max kept items per category (history depth). Default: 12.
  --source-limit=N       Limit source count for smoke tests.
  --replace-categories   Rebuild categories from scratch instead of accumulating history.
  --no-accept            Do not mark promoted review items as accepted.
  --llm-summary          Run optional OpenAI-powered Japanese summaries when OPENAI_API_KEY is set.
  --llm-limit=N          Number of review items to summarize with LLM. Default: review-limit.
  --news-summary-limit=N Max news.json items to back-fill with LLM summaries. Default: 40.
  --no-log               Print only; do not write logs/daily-update-YYYY-MM-DD.log.
`);
}

function appendLog(message = "") {
  if (noLog) return;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${message}\n`, "utf8");
}

function buildCommandLine(script, scriptArgs) {
  return `node ${[script, ...scriptArgs].join(" ")}`;
}

function runStep(name, script, scriptArgs) {
  const commandLine = buildCommandLine(script, scriptArgs);
  const started = Date.now();

  console.log(`\n[${name}] ${commandLine}`);
  appendLog("");
  appendLog(`[${new Date().toISOString()}] ${name}`);
  appendLog(`$ ${commandLine}`);

  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  const durationMs = Date.now() - started;
  const stdout = (result.stdout || "").trimEnd();
  const stderr = (result.stderr || "").trimEnd();

  if (stdout) {
    console.log(stdout);
    appendLog(stdout);
  }

  if (stderr) {
    console.error(stderr);
    appendLog(stderr);
  }

  const exitCode = result.status ?? (result.error ? 1 : 0);
  results.push({ name, commandLine, exitCode, durationMs, stdout, stderr });
  appendLog(`[exit=${exitCode}] duration=${durationMs}ms`);

  if (result.error) {
    throw result.error;
  }

  if (exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${exitCode}`);
  }
}

function readJson(relativePath, fallback = null) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch {
    return fallback;
  }
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items || []) {
    const value = item[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function parseCollectNewsHealth(stepResult) {
  const sources = readJson("data/sources.json", { sources: [] }).sources || [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const bySource = countBy(readJson("data/candidates.json", { items: [] }).items || [], "sourceId");
  const seen = new Set();
  const health = [];
  const checkedAt = new Date().toISOString();

  for (const line of String(stepResult?.stdout || "").split(/\r?\n/)) {
    let match = /^OK\s+(\S+)\s+(\S+)\s+candidates=(\d+)/.exec(line);
    if (match) {
      const [, id, httpStatus, count] = match;
      const source = sourceById.get(id);
      seen.add(id);
      health.push({
        id,
        name: source?.name || id,
        group: "primary",
        type: source?.fetchMethod || "html",
        url: source?.url || "",
        status: Number(count) > 0 ? "ok" : "no_items",
        httpStatus,
        itemsFound: Number(count),
        totalCandidates: bySource.get(id) || 0,
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
        lastFailureAt: null,
        lastError: null
      });
      continue;
    }

    match = /^NG\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (match) {
      const [, id, httpStatus, error] = match;
      const source = sourceById.get(id);
      seen.add(id);
      health.push({
        id,
        name: source?.name || id,
        group: "primary",
        type: source?.fetchMethod || "html",
        url: source?.url || "",
        status: "failed",
        httpStatus,
        itemsFound: 0,
        totalCandidates: bySource.get(id) || 0,
        lastCheckedAt: checkedAt,
        lastSuccessAt: null,
        lastFailureAt: checkedAt,
        lastError: error || `HTTP ${httpStatus}`
      });
    }
  }

  for (const source of sources) {
    if (!source.enabled || seen.has(source.id)) continue;
    if (["api", "github", "manual_review"].includes(source.fetchMethod)) {
      health.push({
        id: source.id,
        name: source.name,
        group: "primary",
        type: source.fetchMethod,
        url: source.url,
        status: "skipped",
        itemsFound: 0,
        totalCandidates: bySource.get(source.id) || 0,
        lastCheckedAt: checkedAt,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: "日次HTML収集の対象外"
      });
    }
  }

  return health;
}

function normalizeSourceHealth(item, groupFallback) {
  return {
    id: item.id || item.name || item.source || item.url,
    name: item.name || item.source || item.id || item.url,
    group: item.group || groupFallback,
    type: item.type || item.method || "",
    vendorId: item.vendorId,
    vendorName: item.vendorName,
    url: item.url || "",
    status: item.status || "unknown",
    httpStatus: item.httpStatus,
    itemsFound: Number(item.itemsFound || 0),
    totalCandidates: item.totalCandidates,
    lastCheckedAt: item.lastCheckedAt || new Date().toISOString(),
    lastSuccessAt: item.lastSuccessAt || null,
    lastFailureAt: item.lastFailureAt || null,
    lastError: item.lastError || null
  };
}

function buildSourceHealth() {
  const collectStep = results.find((item) => item.name === "collect");
  const sourceItems = [
    ...parseCollectNewsHealth(collectStep),
    ...(readJson("data/media-news.json", { sourceHealth: [] }).sourceHealth || []).map((item) => normalizeSourceHealth(item, "media")),
    ...(readJson("data/official-news.json", { sourceHealth: [] }).sourceHealth || []).map((item) => normalizeSourceHealth(item, "official")),
    ...(readJson("data/ai-signals.json", { sourceHealth: [] }).sourceHealth || []).map((item) => normalizeSourceHealth(item, "ai-signals"))
  ].sort((a, b) => String(a.group).localeCompare(String(b.group)) || String(a.name).localeCompare(String(b.name)));

  const summary = sourceItems.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "failed") acc.failed += 1;
      if (item.status === "no_items") acc.noItems += 1;
      if (item.status === "skipped") acc.skipped += 1;
      if (item.status === "ok") acc.ok += 1;
      return acc;
    },
    { total: 0, ok: 0, failed: 0, noItems: 0, skipped: 0 }
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedDate: todayInTokyo(),
    summary,
    sources: sourceItems
  };
}

function buildHealth(status, error = null) {
  const news = readJson("data/news.json", { categories: [] });
  const media = readJson("data/media-news.json", { items: [], errors: [] });
  const official = readJson("data/official-news.json", { items: [], errors: [] });
  const signals = readJson("data/ai-signals.json", { items: [], errors: [] });
  const sota = readJson("data/sota.json", { entries: [] });
  const candidates = readJson("data/candidates.json", { items: [] });
  const review = readJson("data/review.json", { items: [] });
  const sourceHealth = buildSourceHealth();
  const failedSteps = results.filter((item) => item.exitCode !== 0);
  const warningCount = sourceHealth.summary.failed + sourceHealth.summary.noItems;
  const effectiveStatus = status === "ok" && warningCount > 0 ? "warning" : status;

  return {
    schemaVersion: 1,
    status: effectiveStatus,
    generatedAt: new Date().toISOString(),
    generatedDate: todayInTokyo(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    error: error ? String(error.message || error) : null,
    summary: {
      mediaItems: (media.items || []).length,
      primaryCategories: (news.categories || []).length,
      primaryItems: (news.categories || []).reduce((total, category) => total + ((category.items || []).length), 0),
      officialItems: (official.items || []).length,
      aiSignals: (signals.items || []).length,
      sotaEntries: (sota.entries || []).length,
      candidates: (candidates.items || []).length,
      reviewItems: (review.items || []).length,
      sourceTotal: sourceHealth.summary.total,
      sourceOk: sourceHealth.summary.ok,
      sourceFailed: sourceHealth.summary.failed,
      sourceNoItems: sourceHealth.summary.noItems,
      failedSteps: failedSteps.length
    },
    steps: results.map(({ stdout, stderr, ...item }) => item)
  };
}

function writeHealthFiles(status, error = null) {
  if (dryRun) return;
  const sourceHealth = buildSourceHealth();
  fs.writeFileSync(sourceHealthPath, `${JSON.stringify(sourceHealth, null, 2)}\n`, "utf8");
  fs.writeFileSync(healthPath, `${JSON.stringify(buildHealth(status, error), null, 2)}\n`, "utf8");
}

function main() {
  appendLog(`AI News Catchup daily update started ${startedAt.toISOString()}`);
  appendLog(`mode=${dryRun ? "dry-run" : "write"}`);

  const collectArgs = [
    dryRun ? "--collect" : "--write",
    `--per-source=${perSource}`,
    `--max-candidates=${maxCandidates}`
  ];
  if (sourceLimit) collectArgs.push(`--limit=${sourceLimit}`);

  const reviewArgs = [`--limit=${reviewLimit}`];
  if (!dryRun) reviewArgs.push("--write");

  const mediaArgs = [`--limit=${mediaLimit}`];
  mediaArgs.push(dryRun ? "--dry-run" : "--write");

  const officialArgs = [`--limit=${officialLimit}`];
  officialArgs.push(dryRun ? "--dry-run" : "--write");

  const signalArgs = [`--limit=${signalLimit}`];
  signalArgs.push(dryRun ? "--dry-run" : "--write");

  const pricingArgs = [];
  if (!dryRun) pricingArgs.push("--write-review");

  const promoteArgs = [
    `--min-priority=${minPriority}`,
    `--max-age-days=${maxAgeDays}`,
    `--max-items=${maxItems}`
  ];
  if (!dryRun) {
    promoteArgs.push("--write");
    if (replaceCategories) promoteArgs.push("--replace");
    if (!noAccept) promoteArgs.push("--accept");
  }

  runStep("collect-official-news", "scripts/collect-official-news.js", officialArgs);
  runStep("collect-ai-signals", "scripts/collect-ai-signals.js", signalArgs);
  // Pricing is collected into a review file first; pricing.json is not auto-overwritten.
  runStep("collect-pricing", "scripts/collect-pricing.js", pricingArgs);
  runStep("collect-media-news", "scripts/collect-media-news.js", mediaArgs);
  runStep("collect", "scripts/collect-news.js", collectArgs);
  // ティッカー/速報のカード文面を独自見出し・独自要約へ整形（APIキーがあるときだけ。失敗時は既存文面のまま）。
  if (llmSummary) {
    const translateArgs = [dryRun ? "--dry-run" : "--write"];
    runStep("translate-titles", "scripts/translate-titles.js", translateArgs);
  }
  runStep("prepare-review", "scripts/prepare-review.js", reviewArgs);
  if (llmSummary) {
    const summarizeArgs = [`--limit=${llmLimit}`];
    if (!dryRun) summarizeArgs.push("--write");
    runStep("summarize-review", "scripts/summarize-review.js", summarizeArgs);
  }
  runStep("promote-review", "scripts/promote-review.js", promoteArgs);
  // 表示確定後の news.json で、要約が未生成のまま残る記事（蓄積された過去分など）を埋める。
  if (llmSummary) {
    const summarizeNewsArgs = [`--limit=${newsSummaryLimit}`];
    if (!dryRun) summarizeNewsArgs.push("--write");
    runStep("summarize-news", "scripts/summarize-news.js", summarizeNewsArgs);
  }

  // SOTA収集は外部API(paperswithcode.co)依存のため、失敗してもニュース更新は止めない。
  // 1位交代時のみ前回値へ退避するので毎日実行で履歴が自然に蓄積する。
  try {
    runStep("collect-sota", "scripts/collect-sota.js", dryRun ? [] : ["--write"]);
  } catch (error) {
    const skip = `collect-sota skipped: ${error.message}`;
    console.error(skip);
    appendLog(skip);
  }

  runStep("validate-pricing", "scripts/validate-pricing.js", []);
  runStep("validate-data", "scripts/validate-data.js", []);
  writeHealthFiles("ok");

  const durationMs = Date.now() - startedAt.getTime();
  const summary = `Daily update ${dryRun ? "dry-run" : "write"} completed in ${Math.round(durationMs / 1000)}s`;
  console.log(`\n${summary}`);
  appendLog("");
  appendLog(summary);
  appendLog(JSON.stringify(results, null, 2));

  if (!noLog) {
    console.log(`Log: ${logPath}`);
  }
}

try {
  main();
} catch (error) {
  const message = `Daily update failed: ${error.message}`;
  console.error(`\n${message}`);
  appendLog("");
  appendLog(message);
  writeHealthFiles("failed", error);
  process.exit(1);
}
