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
  results.push({ name, commandLine, exitCode, durationMs });
  appendLog(`[exit=${exitCode}] duration=${durationMs}ms`);

  if (result.error) {
    throw result.error;
  }

  if (exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${exitCode}`);
  }
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
  runStep("collect-media-news", "scripts/collect-media-news.js", mediaArgs);
  runStep("collect", "scripts/collect-news.js", collectArgs);
  // ティッカー/速報の英語見出しを日本語化（APIキーがあるときだけ。失敗時は英語のまま）。
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

  runStep("validate-data", "scripts/validate-data.js", []);

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
  process.exit(1);
}
