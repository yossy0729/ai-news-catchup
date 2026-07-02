const fs = require("node:fs");
const path = require("node:path");

// 記事の月次アーカイブ（テーマ別アーカイブの土台）。
// news.json は30日/カテゴリ12件、media-news.json は72時間、official-news.json は36件で
// 回転して消えるため、表示中のアイテムを毎日 data/archive/YYYY-MM.json へ退避して「捨てない」ようにする。
// - URLで重複排除。アイテム寿命(最大30日)は月をまたいでも2ファイルまでなので、前月ファイルも確認する。
// - 閲覧ページは後続フェーズ。このスクリプトはデータを失わないことだけを担保する。

const root = path.resolve(__dirname, "..");
const archiveDir = path.join(root, "data", "archive");
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

function previousMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNum - 2, 1));
  return date.toISOString().slice(0, 7);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function collectPrimaryItems(news) {
  const items = [];
  for (const category of news.categories || []) {
    for (const item of category.items || []) {
      if (!item.url) continue;
      items.push({
        origin: "primary",
        url: item.url,
        title: item.title || "",
        titleJa: item.titleJa || "",
        summary: item.summary || "",
        source: item.source || "",
        type: item.type || "",
        date: item.date || "",
        region: category.group || "",
        categoryId: category.id || "",
        category: category.title || "",
        importanceLabel: item.importanceLabel || ""
      });
    }
  }
  return items;
}

function collectOfficialItems(official) {
  return (official.items || [])
    .filter((item) => item.url)
    .map((item) => ({
      origin: "official",
      url: item.url,
      title: item.title || "",
      titleJa: item.titleJa || "",
      summary: item.summaryJa || item.summary || "",
      source: item.source || "",
      type: item.type || "公式",
      date: item.date || "",
      region: "",
      categoryId: `official:${item.vendorId || ""}`,
      category: item.vendorName || "",
      importanceLabel: ""
    }));
}

function collectMediaItems(media) {
  return (media.items || [])
    .filter((item) => item.url)
    .map((item) => ({
      origin: "media",
      url: item.url,
      title: item.title || "",
      titleJa: item.titleJa || "",
      summary: item.summaryJa || item.summary || "",
      source: item.source || "",
      type: "メディア",
      date: item.date || "",
      region: item.region || "",
      categoryId: item.categoryId || "",
      category: item.category || "",
      importanceLabel: ""
    }));
}

function main() {
  const news = readJson(path.join(root, "data", "news.json"), { categories: [] });
  const media = readJson(path.join(root, "data", "media-news.json"), { items: [] });
  const official = readJson(path.join(root, "data", "official-news.json"), { items: [] });

  const today = todayInTokyo();
  const month = today.slice(0, 7);
  const filePath = path.join(archiveDir, `${month}.json`);
  const monthly = readJson(filePath, { schemaVersion: 1, month, items: [] });
  const previous = readJson(path.join(archiveDir, `${previousMonth(month)}.json`), { items: [] });

  const knownUrls = new Set([
    ...(monthly.items || []).map((item) => item.url),
    ...(previous.items || []).map((item) => item.url)
  ]);

  let added = 0;
  for (const item of [...collectPrimaryItems(news), ...collectMediaItems(media), ...collectOfficialItems(official)]) {
    if (knownUrls.has(item.url)) continue;
    knownUrls.add(item.url);
    monthly.items.push({ ...item, archivedDate: today });
    added += 1;
  }

  console.log(
    `Archive news ${write ? "write" : "dry-run"}: added=${added}, monthTotal=${monthly.items.length} -> data/archive/${month}.json`
  );

  if (write) {
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(monthly, null, 2)}\n`, "utf8");
  }
}

main();
