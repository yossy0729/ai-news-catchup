const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reviewPath = path.join(root, "data", "review.json");
const candidatesPath = path.join(root, "data", "candidates.json");
const rawArgs = process.argv.slice(2);
const write = rawArgs.includes("--write");
const sourceId = getArg("--source=");
const ids = rawArgs
  .filter((arg) => arg.startsWith("--id="))
  .map((arg) => arg.slice("--id=".length))
  .filter(Boolean);

function getArg(prefix) {
  return rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function matches(item) {
  if (sourceId && item.sourceId === sourceId) return true;
  if (ids.includes(item.candidateId || item.id)) return true;
  return false;
}

if (!sourceId && ids.length === 0) {
  console.error("Specify --source=<sourceId> or --id=<candidateId>.");
  process.exit(1);
}

const review = readJson(reviewPath);
const candidates = readJson(candidatesPath);
const rejectedIds = new Set();
const now = new Date().toISOString();

for (const item of review.items) {
  if (!matches(item)) continue;
  item.status = "rejected";
  item.rejectedAt = now;
  rejectedIds.add(item.candidateId);
}

for (const item of candidates.items) {
  if (rejectedIds.has(item.id) || matches(item)) {
    item.status = "rejected";
    item.rejectedAt = now;
    rejectedIds.add(item.id);
  }
}

review.updatedDate = todayInTokyo();
candidates.updatedDate = todayInTokyo();

console.log(`${write ? "Reject write" : "Reject dry-run"}: rejected ${rejectedIds.size} candidates`);

if (write) {
  writeJson(reviewPath, review);
  writeJson(candidatesPath, candidates);
}
