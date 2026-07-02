const fs = require("node:fs");
const path = require("node:path");

// 指標履歴の日次スナップショット（2層構造）。
// [1] 日次の定点観測（days[]）: 出典側に履歴が残らないソースだけを毎日丸ごと記録する。
//     - SOTA: data/sota-official.json の overrides に載る公式ボード由来の分野
//       （LMArena系・Open ASR等。現在値のみの上書き配信で、過去の首位・スコアは出典側に残らない）
//     - 価格: data/pricing.json の全モデル（公式価格ページは改定されると旧価格が消える）
// [2] 変化ログ（changes[]）: 全分野を対象に、首位モデル/スコア/ベンチが変わった日だけ1行追記する。
//     前回値は data/history/sota-state.json に保持。PwC閉鎖リスクへの保険を兼ねる。
//     動かない分野は何も追記しないため、全分野カバーでもサイズはほぼ増えない。
// 出力は data/history/YYYY-MM.json の月次ファイル。同日分は上書きするため1日2回実行でも冪等。

const root = path.resolve(__dirname, "..");
const historyDir = path.join(root, "data", "history");
const statePath = path.join(historyDir, "sota-state.json");
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
  const monthly = readJson(filePath, { schemaVersion: 1, month, days: [], changes: [] });
  const days = (monthly.days || []).filter((day) => day.date !== date);
  days.push({ date, sota: sotaRows, pricing: pricingRows });
  days.sort((a, b) => a.date.localeCompare(b.date));
  monthly.days = days;

  // [2] 全分野の変化ログ。前回状態(sota-state.json)と比較し、変わった分野だけ追記する。
  // 初回はログを吐かず現在値の記憶のみ行う（86分野分を「変化」として洪水させない）。
  const state = readJson(statePath, null);
  const nextState = { schemaVersion: 1, updatedDate: date, slugs: {} };
  const isFirstRun = !state;
  const changes = (monthly.changes || []).filter((change) => change.date !== date);

  for (const entry of sota.entries || []) {
    if (!entry.hasData) continue;
    const current = {
      task: entry.task,
      benchmark: entry.benchmark,
      metric: entry.metric,
      topModel: entry.topModel,
      score: entry.score,
      asOf: entry.asOf
    };
    nextState.slugs[entry.slug] = current;
    if (isFirstRun) continue;

    const previous = state.slugs?.[entry.slug];
    if (!previous) {
      changes.push({ date, slug: entry.slug, kind: "new_field", ...current, prev: null });
      continue;
    }
    const benchmarkChanged = previous.benchmark !== current.benchmark || previous.metric !== current.metric;
    const valueChanged = previous.topModel !== current.topModel || previous.score !== current.score;
    if (benchmarkChanged || valueChanged) {
      changes.push({
        date,
        slug: entry.slug,
        // benchmark_changed は代表ベンチ差し替え（スコアの単純比較不可）を示す。
        kind: benchmarkChanged ? "benchmark_changed" : "sota_changed",
        ...current,
        prev: previous
      });
    }
  }

  monthly.changes = changes;

  console.log(
    `History snapshot ${write ? "write" : "dry-run"}: date=${date}, sota=${sotaRows.length}, pricing=${pricingRows.length}, days=${days.length}, changes=${isFirstRun ? "seeded" : changes.filter((c) => c.date === date).length} -> data/history/${month}.json`
  );

  if (write) {
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(monthly, null, 2)}\n`, "utf8");
    fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  }
}

main();
