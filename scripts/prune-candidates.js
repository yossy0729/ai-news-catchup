const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const candidatesPath = path.join(root, "data", "candidates.json");
const args = new Set(process.argv.slice(2));
const expireDaysArg = process.argv.find((arg) => arg.startsWith("--expire-days="));
const removeExpiredDaysArg = process.argv.find((arg) => arg.startsWith("--remove-expired-days="));
const expireDays = Number(expireDaysArg?.split("=")[1] || 14);
const removeExpiredDays = Number(removeExpiredDaysArg?.split("=")[1] || 30);
const write = args.has("--write");

function daysBetween(now, value) {
  const date = new Date(value);
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

// candidates.json はローカル生成物（Git管理外）。未生成の環境では処理対象なしとして正常終了する。
if (!fs.existsSync(candidatesPath)) {
  console.log("Candidate prune skipped: data/candidates.json not found.");
  process.exit(0);
}

const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));
const now = new Date();
let expired = 0;
let removed = 0;

const nextItems = [];

for (const item of candidates.items) {
  const age = daysBetween(now, item.lastSeenAt || item.firstSeenAt);

  if (item.status === "candidate" && age >= expireDays) {
    expired += 1;
    nextItems.push({
      ...item,
      status: "expired",
      expiredAt: now.toISOString()
    });
    continue;
  }

  if (item.status === "expired" && age >= removeExpiredDays) {
    removed += 1;
    continue;
  }

  nextItems.push(item);
}

console.log(`Candidate prune ${write ? "write" : "dry-run"}: expire ${expired}, remove ${removed}, keep ${nextItems.length}`);

if (write) {
  candidates.updatedDate = now.toISOString().slice(0, 10);
  candidates.items = nextItems;
  fs.writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`, "utf8");
}
