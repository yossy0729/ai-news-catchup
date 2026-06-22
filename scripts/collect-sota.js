// SOTA収集スクリプト（paperswithcode.co 公式JSON API 経由）
//
// 公式サイトはJS描画でWebスクレイピング不可だが、裏のREST API (/api/v1/) は
// ブラウザUAを付ければJSONで取得できる。これを使って全研究分野(タスク)の
// 現SOTA（best_rank==1 のモデル/スコア）を機械的に収集する。
//
// 使い方:
//   node scripts/collect-sota.js            … 取得→プレビュー表示のみ（書き込まない）
//   node scripts/collect-sota.js --write    … data/sota.json を生成/更新（1位交代は前回値へ退避）
//   node scripts/collect-sota.js --refresh  … APIキャッシュを無視して再取得
//
// 設計メモ:
// - APIが best_rank を算出済みなので、指標の向き(higherIsBetter)を自前判定する必要がない。
// - evaluations は全件(約7000)をページングで取得し data/cache に保存（毎回叩かずAPIに優しく）。
// - 1位が交代したときだけ現在値を prev* に退避し、新値を記入（履歴が自然に蓄積）。

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const cacheDir = path.join(dataDir, "cache");
const sotaPath = path.join(dataDir, "sota.json");
const labelsPath = path.join(dataDir, "sota-labels.json");
const officialPath = path.join(dataDir, "sota-official.json");
const evalCachePath = path.join(cacheDir, "pwc-evaluations.json");

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const refresh = args.has("--refresh");

const API = "https://paperswithcode.co/api/v1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12時間以内のキャッシュは再利用

async function apiGet(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// next_page を辿って全件取得（PwCは50件/ページ）。
async function fetchAllPages(endpoint, label) {
  const out = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await apiGet(`${API}/${endpoint}?page=${page}`);
    if (!data || !Array.isArray(data.results)) break;
    out.push(...data.results);
    process.stdout.write(`\r  ${label}: ${out.length}/${data.count}    `);
    if (!data.next_page) break;
    page = data.next_page;
    await sleep(40); // サーバ負荷軽減
  }
  process.stdout.write("\n");
  return out;
}

async function loadEvaluations() {
  if (!refresh && fs.existsSync(evalCachePath)) {
    const stat = fs.statSync(evalCachePath);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      const cached = JSON.parse(fs.readFileSync(evalCachePath, "utf8"));
      console.log(`  evaluations: キャッシュ利用 (${cached.length}件)`);
      return cached;
    }
  }
  const evals = await fetchAllPages("evaluations/", "evaluations");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(evalCachePath, JSON.stringify(evals));
  return evals;
}

// "84.26" / "65.8%" / "31.66 dB" → 数値。取れなければ null。
function parseScore(value) {
  if (value == null) return null;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// 「低いほど良い」指標名の手がかり（向きをデータから判定できない時のフォールバック）。
const LOWER_IS_BETTER_HINTS = [
  "wer", "cer", "mae", "mse", "rmse", "mad", "lpips", "sad",
  "fid", "perplexity", "ppl", "eer", "der", "nll", "loss", "error", "latency"
];

// 指標の向き(↑/↓)を判定。1位と2位のスコアの大小で判定し、無理なら指標名で推定。
function inferHigherIsBetter(repRows, metric, topScore) {
  const same = repRows.filter((r) => r.best_metric === metric);
  const rank2 = same.find((r) => r.best_rank === 2);
  const s2 = rank2 ? parseScore(rank2.metrics ? rank2.metrics[metric] : null) : null;
  if (topScore != null && s2 != null && topScore !== s2) return topScore > s2;
  const m = String(metric || "").toLowerCase();
  return !LOWER_IS_BETTER_HINTS.some((k) => m.includes(k));
}

// 公式ソースのfetcher。PwCに無い/代表ベンチが弱い分野を、最新の公式値で補完する。
// data/sota-official.json の overrides[].fetcher がこのキーを指す。新ソースはここに追加。
const officialFetchers = {
  // SWE-bench Verified（コーディングエージェントの花形ベンチ。PwCには未登録）。
  "swe-bench-verified": async () => {
    const data = await apiGet(
      "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json"
    );
    const board = (data.leaderboards || []).find((b) => b.name === "Verified");
    const results = board && Array.isArray(board.results) ? board.results : [];
    const top = results
      .filter((r) => typeof r.resolved === "number")
      .sort((a, b) => b.resolved - a.resolved)[0];
    if (!top) return null;
    return {
      benchmark: "SWE-bench Verified",
      metric: "解決率 (%)",
      higherIsBetter: true,
      topModel: top.name,
      score: top.resolved,
      asOf: top.date || null,
      paperUrl: "https://arxiv.org/abs/2310.06770",
      codeUrl: top.site || null,
      boardName: "SWE-bench",
      boardUrl: "https://www.swebench.com/",
    };
  },
};

function pickMode(items) {
  const counts = new Map();
  let best = null;
  let bestCount = 0;
  for (const item of items) {
    const c = (counts.get(item) || 0) + 1;
    counts.set(item, c);
    if (c > bestCount) {
      bestCount = c;
      best = item;
    }
  }
  return best;
}

async function main() {
  console.log("paperswithcode.co からSOTAを収集します…");

  const [areas, tasks, evals] = await Promise.all([
    fetchAllPages("areas/", "areas"),
    fetchAllPages("tasks/", "tasks"),
    loadEvaluations(),
  ]);

  const areaById = new Map(areas.map((a) => [String(a.id), a.name]));
  const taskBySlug = new Map(tasks.map((t) => [t.slug, t]));

  // 日本語ラベル辞書（任意）。slug -> { ja, keywords }
  const labels = fs.existsSync(labelsPath)
    ? JSON.parse(fs.readFileSync(labelsPath, "utf8"))
    : {};

  // タスクslug -> evaluations
  const byTask = new Map();
  for (const ev of evals) {
    if (!ev.task_slug) continue;
    if (!byTask.has(ev.task_slug)) byTask.set(ev.task_slug, []);
    byTask.get(ev.task_slug).push(ev);
  }

  const entries = [];
  const noData = []; // PwCに評価データが無い分野（リンクのみ掲載）

  // 全タスク共通のentry骨格を作る（評価あり/なしで上書きするフィールドを fields で渡す）。
  const makeEntry = (task, fields) => {
    const label = labels[task.slug] || {};
    return {
      slug: task.slug,
      domain: areaById.get(String(task.area_id)) || "Other",
      task: label.ja || task.name,
      taskEn: task.name,
      keywords: [
        ...(label.keywords || []),
        task.name,
        ...(task.keywords ? String(task.keywords).split(/,\s*/) : []),
      ],
      hasData: false,
      benchmark: null,
      metric: "",
      higherIsBetter: true,
      topModel: null,
      score: null,
      asOf: null,
      sourceName: "paperswithcode.co",
      boardName: "PwC",
      boardUrl: `https://paperswithcode.co/tasks/${task.slug}`,
      paperUrl: null,
      codeUrl: null,
      paperTitle: null,
      verified: false,
      // 退避用フィールド（snapshot時に埋める）
      prevTopModel: null,
      prevScore: null,
      prevAsOf: null,
      prevComparable: true,
      ...fields,
    };
  };

  // 研究分野として意味をなさないノイズタスクは除外。
  const excludeSlugs = new Set(["test-task", "general", "other"]);

  for (const task of tasks) {
    if (excludeSlugs.has(task.slug)) continue;
    const rows = byTask.get(task.slug) || [];
    if (!rows.length) {
      // 評価データなし → リンクのみで網羅（あなたの②の方針）。
      entries.push(makeEntry(task, {}));
      noData.push(task.slug);
      continue;
    }

    // 代表データセット = 評価件数が最多のもの（＝事実上の主要ベンチ）。
    const datasetCounts = new Map();
    for (const r of rows) {
      const key = r.dataset_slug || r.dataset_name || "";
      datasetCounts.set(key, (datasetCounts.get(key) || 0) + 1);
    }
    const repDataset = [...datasetCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const repRows = rows.filter(
      (r) => (r.dataset_slug || r.dataset_name || "") === repDataset
    );

    // 代表指標 = その代表データセットで最も使われている best_metric。
    const repMetric = pickMode(repRows.map((r) => r.best_metric).filter(Boolean));

    // SOTA行を多段フォールバックで決定（スキップを最小化）:
    //   (1) 代表データセット×代表指標で best_rank==1
    //   (2) 代表データセットで best_rank==1 の任意の行（最頻指標優先で並べた先頭）
    //   (3) best_rank が最小の行（rank==1 が無い枯れた分野の救済）
    const rank1 = repRows.filter((r) => r.best_rank === 1);
    let sotaRow =
      rank1.find((r) => r.best_metric === repMetric) || rank1[0] || null;
    if (!sotaRow) {
      const ranked = repRows
        .filter((r) => Number.isFinite(r.best_rank))
        .sort((a, b) => a.best_rank - b.best_rank);
      sotaRow = ranked[0] || null;
    }
    if (!sotaRow) {
      entries.push(makeEntry(task, {}));
      noData.push(task.slug);
      continue;
    }
    // 採用行の指標を正とする（代表指標と異なる場合がある）。
    const metric = sotaRow.best_metric || repMetric || "";
    const score = parseScore(sotaRow.metrics ? sotaRow.metrics[metric] : null);
    const paperUrl = sotaRow.result_url || sotaRow.source_url || null;

    entries.push(
      makeEntry(task, {
        hasData: true,
        benchmark: sotaRow.dataset_name || repDataset,
        metric,
        higherIsBetter: inferHigherIsBetter(repRows, metric, score),
        topModel: sotaRow.model_name || null,
        score,
        asOf: sotaRow.evaluated_on || sotaRow.paper_published_date || null,
        paperUrl,
        codeUrl: sotaRow.code_url || null,
        paperTitle: sotaRow.paper_title || null,
        verified: score != null,
      })
    );
  }

  // 公式ソースで上書き（PwCに無い/代表ベンチが弱い分野の補完）。
  if (fs.existsSync(officialPath)) {
    const official = JSON.parse(fs.readFileSync(officialPath, "utf8"));
    for (const ov of official.overrides || []) {
      const fetcher = officialFetchers[ov.fetcher];
      if (!fetcher) {
        console.warn(`  公式上書き: 未知のfetcher "${ov.fetcher}"`);
        continue;
      }
      try {
        const data = await fetcher();
        if (!data) {
          console.warn(`  公式上書き: ${ov.slug} の値が取得できず（PwC値を維持）`);
          continue;
        }
        const idx = entries.findIndex((e) => e.slug === ov.slug);
        if (idx >= 0) {
          entries[idx] = {
            ...entries[idx],
            ...data,
            hasData: true,
            verified: data.score != null,
          };
        }
        console.log(`  公式上書き: ${ov.slug} ← ${ov.fetcher} (${data.topModel} ${data.score})`);
      } catch (err) {
        console.warn(`  公式上書き失敗 ${ov.slug}: ${err.message}（PwC値を維持）`);
      }
    }
  }

  entries.sort((a, b) => a.domain.localeCompare(b.domain) || a.task.localeCompare(b.task));

  // プレビュー出力
  const withData = entries.filter((e) => e.hasData).length;
  console.log(
    `\n取得結果: 全${entries.length}分野（数値あり ${withData} / データなし(リンクのみ) ${noData.length}）\n`
  );
  const byDomain = new Map();
  for (const e of entries) {
    if (!byDomain.has(e.domain)) byDomain.set(e.domain, []);
    byDomain.get(e.domain).push(e);
  }
  for (const [domain, list] of byDomain) {
    console.log(`■ ${domain} (${list.length})`);
    for (const e of list) {
      const sc = e.score != null ? e.score : "—";
      console.log(
        `   ${e.task}  |  ${e.benchmark}  |  ${e.metric}=${sc}  |  ${e.topModel || "?"}  |  ${e.asOf || "?"}`
      );
    }
  }
  if (noData.length) {
    console.log(`\nデータなし分野（リンクのみ）: ${noData.join(", ")}`);
  }

  if (!write) {
    console.log("\n（プレビューのみ。書き込むには --write を付けてください）");
    return;
  }

  // --- 書き込み: 既存sota.jsonと照合し、1位交代時のみ前回値へ退避 ---
  const prev = fs.existsSync(sotaPath)
    ? JSON.parse(fs.readFileSync(sotaPath, "utf8"))
    : { entries: [] };
  const prevBySlug = new Map((prev.entries || []).map((e) => [e.slug, e]));

  let changed = 0;
  for (const e of entries) {
    const old = prevBySlug.get(e.slug);
    if (!old) continue;
    // ベンチ/指標が変わったら過去値は比較不能。履歴を持たない（prevはnullのまま）。
    const sameBench = old.benchmark === e.benchmark && old.metric === e.metric;
    if (!sameBench) continue;
    if (old.topModel && old.topModel !== e.topModel) {
      // 同一ベンチでの1位交代 → 旧値を退避
      e.prevTopModel = old.topModel;
      e.prevScore = old.score;
      e.prevAsOf = old.asOf;
      e.prevComparable = true;
      changed += 1;
    } else {
      // 同一1位 → 既存の退避履歴を引き継ぐ
      e.prevTopModel = old.prevTopModel ?? null;
      e.prevScore = old.prevScore ?? null;
      e.prevAsOf = old.prevAsOf ?? null;
      e.prevComparable = old.prevComparable ?? true;
    }
  }

  const out = {
    schemaVersion: 5,
    asOf: new Date().toISOString().slice(0, 10),
    source: "paperswithcode.co API (/api/v1)",
    note: "全研究分野の現SOTAを自動収集。各分野は評価件数最多のデータセットを代表ベンチとして表示。",
    entries,
  };
  fs.writeFileSync(sotaPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\ndata/sota.json を更新しました（${entries.length}分野 / 1位交代 ${changed}件）`);
}

main().catch((err) => {
  console.error("\n収集に失敗:", err.message);
  process.exit(1);
});
