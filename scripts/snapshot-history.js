const fs = require("node:fs");
const path = require("node:path");

// 指標履歴の日次スナップショット。
// 対象は「出典側に履歴が残らないソース」だけに絞る:
// - SOTA: data/sota-official.json の overrides に載る公式ボード由来の分野
//   （LMArena系・Open ASR等。現在値のみの上書き配信で、過去の首位・スコアは出典側に残らない）
// - 価格: data/pricing.json の全モデル（公式価格ページは改定されると旧価格が消える）
// PwC由来の遅い分野は対象外（PwC側に日付付きの履歴が残るため）。
// 出力は data/history/YYYY-MM.json の月次ファイル。同日分は上書きするため1日2回実行でも冪等。

const root = path.resolve(__dirname, "..");
const historyDir = path.join(root, "data", "history");
const args = new Set(process.argv.slice(2));
const write = args.has("--write");

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
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function main() {
  const sota = readJson(path.join(root, "data", "sota.json"), { entries: [] });
  const official = readJson(path.join(root, "data", "sota-official.json"), { overrides: [] });
  const pricing = readJson(path.join(root, "data", "pricing.json"), { models: [] });

  const targetSlugs = new Set((official.overrides || []).map((item) => item.slug));
  const sotaRows = (sota.entries || [])
    .filter((entry) => targetSlugs.has(entry.slug) && entry.hasData)
    .map((entry) => ({
      slug: entry.slug,
      task: entry.task,
      benchmark: entry.benchmark,
      metric: entry.metric,
      topModel: entry.topModel,
      score: entry.score,
      asOf: entry.asOf
    }));

  const pricingRows = (pricing.models || []).map((model) => ({
    vendor: model.vendor,
    model: model.model,
    inputPer1M: model.inputPer1M ?? null,
    cachedInputPer1M: model.cachedInputPer1M ?? null,
    outputPer1M: model.outputPer1M ?? null,
    verified: model.verified === true
  }));

  const date = todayInTokyo();
  const month = date.slice(0, 7);
  const filePath = path.join(historyDir, `${month}.json`);
  const monthly = readJson(filePath, { schemaVersion: 1, month, days: [] });
  const days = (monthly.days || []).filter((day) => day.date !== date);
  days.push({ date, sota: sotaRows, pricing: pricingRows });
  days.sort((a, b) => a.date.localeCompare(b.date));
  monthly.days = days;

  console.log(
    `History snapshot ${write ? "write" : "dry-run"}: date=${date}, sota=${sotaRows.length}, pricing=${pricingRows.length}, days=${days.length} -> data/history/${month}.json`
  );

  if (write) {
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(monthly, null, 2)}\n`, "utf8");
  }
}

main();
