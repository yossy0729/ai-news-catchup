// 過去記事アーカイブページ（調べる時の動線）。
// data/archive/YYYY-MM.json を新しい月から順に読み込み、テーマ絞り込み＋月別グルーピングで表示する。
// 日次4タブ(app.js)からは独立したスクリプトとし、本体への影響をゼロに保つ。

const ARCHIVE_START_MONTH = "2026-07"; // アーカイブ蓄積の開始月。これより前のファイルは存在しない。
const MAX_MONTHS = 24;

// テーマ定義。一次情報のカテゴリID(news.json)とメディア速報のカテゴリID(media-news.json)を
// カテゴリ別タブの5分野と同じ軸に束ねる（[[ui-consistency]] タブ間で分類軸を揃える）。
const THEMES = [
  { id: "all", label: "すべて", cats: null },
  { id: "research", label: "モデル・研究", cats: ["jp-research", "global-research", "product-release", "models"] },
  { id: "adoption", label: "産業導入・業務AI", cats: ["jp-cases", "global-cases", "business", "industry", "agents", "fde"] },
  { id: "governance", label: "規制・ガバナンス", cats: ["jp-governance", "global-governance", "regulation"] },
  { id: "security", label: "セキュリティ", cats: ["security"] },
  { id: "infrastructure", label: "インフラ・基盤", cats: ["infrastructure"] },
  // 公式動向はベンダー軸（カテゴリ軸に属さない）のため、originで束ねる専用テーマにする。
  { id: "official", label: "公式動向", origin: "official" }
];

const themeChips = document.querySelector("#themeChips");
const searchInput = document.querySelector("#archiveSearch");
const statusEl = document.querySelector("#archiveStatus");
const listEl = document.querySelector("#archiveList");

let allItems = [];
let activeTheme = "all";
let activeQuery = "";

function monthList() {
  const months = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  for (let i = 0; i < MAX_MONTHS; i += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key < ARCHIVE_START_MONTH) break;
    months.push(key);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

async function loadMonth(month) {
  try {
    const response = await fetch(`data/archive/${month}.json`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function itemMatchesQuery(item, query) {
  if (!query) return true;
  const haystack = [item.title, item.titleJa, item.summary, item.source, item.category, item.date]
    .map(normalizeText)
    .join(" ");
  return normalizeText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function itemMatchesTheme(item, themeId) {
  if (themeId === "all") return true;
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) return false;
  if (theme.origin) return item.origin === theme.origin;
  return Boolean(theme.cats?.includes(item.categoryId));
}

function itemDate(item) {
  return String(item.date || item.archivedDate || "").slice(0, 10);
}

function formatDateHeading(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "日付不明";
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function renderThemeChips() {
  themeChips.replaceChildren(
    ...THEMES.map((theme) => {
      const count = allItems.filter((item) => itemMatchesTheme(item, theme.id)).length;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "theme-chip";
      chip.classList.toggle("active", theme.id === activeTheme);
      chip.textContent = `${theme.label} ${count}`;
      chip.addEventListener("click", () => {
        activeTheme = theme.id;
        render();
      });
      return chip;
    })
  );
}

function renderRow(item) {
  const row = document.createElement("div");
  row.className = "archive-row";

  const date = document.createElement("span");
  date.className = "archive-date";
  date.textContent = String(item.date || item.archivedDate || "").slice(5).replace("-", "/");

  const body = document.createElement("div");
  body.className = "archive-body";

  const link = document.createElement("a");
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = item.titleJa || item.title;
  if (item.titleJa && item.title !== item.titleJa) link.title = item.title;

  const meta = document.createElement("span");
  meta.className = "archive-meta";
  const originLabels = { primary: "一次情報", media: "メディア", official: "公式" };
  const origin = originLabels[item.origin] || "";
  meta.textContent = [item.source, item.region, origin, item.category].filter(Boolean).join(" ・ ");

  body.append(link, meta);
  row.append(date, body);
  return row;
}

function render() {
  renderThemeChips();

  const filtered = allItems
    .filter((item) => itemMatchesTheme(item, activeTheme))
    .filter((item) => itemMatchesQuery(item, activeQuery))
    .sort((a, b) => String(b.date || b.archivedDate).localeCompare(String(a.date || a.archivedDate)));

  statusEl.textContent = `${filtered.length}件を表示（全${allItems.length}件）`;

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "archive-empty";
    empty.textContent = "該当する記事はありません。テーマやキーワードを変えてください。";
    listEl.replaceChildren(empty);
    return;
  }

  // 日付単位でグルーピング（一覧として読みやすい塊にする）。新しい日付が上。
  const byDate = new Map();
  for (const item of filtered) {
    const date = itemDate(item) || "日付不明";
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(item);
  }

  listEl.replaceChildren(
    ...Array.from(byDate.entries()).map(([date, items]) => {
      const section = document.createElement("section");
      section.className = "archive-month";
      const heading = document.createElement("h2");
      heading.textContent = `${formatDateHeading(date)}（${items.length}件）`;
      const rows = document.createElement("div");
      items.forEach((item) => rows.append(renderRow(item)));
      section.append(heading, rows);
      return section;
    })
  );
}

async function main() {
  const files = await Promise.all(monthList().map(loadMonth));
  allItems = files.filter(Boolean).flatMap((file) => file.items || []);

  if (!allItems.length) {
    statusEl.textContent = "アーカイブはまだありません。日次更新の実行後に蓄積が始まります。";
    return;
  }
  render();
}

searchInput.addEventListener("input", () => {
  activeQuery = searchInput.value;
  render();
});

main();
