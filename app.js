let today = "";
let categories = [];
let mediaItems = [];
let mediaCategories = [];
let officialItems = [];
let officialDataVendors = [];
let officialShownUrls = new Set();
let aiSignals = [];
let pricingData = { models: [] };
let sotaData = { entries: [] };
let sotaPresets = [];

const dataPath = "data/news.json";
const mediaPath = "data/media-news.json";
const officialPath = "data/official-news.json";
const signalPath = "data/ai-signals.json";
const pricingPath = "data/pricing.json";
const sotaPath = "data/sota.json";
const sotaPresetsPath = "data/sota-presets.json";
const categoryGrid = document.querySelector("#categoryGrid");
const categoryTemplate = document.querySelector("#categoryTemplate");
const newsTemplate = document.querySelector("#newsTemplate");
const mediaTemplate = document.querySelector("#mediaTemplate");
const mediaGrid = document.querySelector("#mediaGrid");
const priorityList = document.querySelector("#officialGrid");
const officialFreshness = document.querySelector("#officialFreshness");
const tabs = Array.from(document.querySelectorAll(".tab"));
const todayLabel = document.querySelector("#todayLabel");
const freshnessLabel = document.querySelector(".freshness");
const keywordSearch = document.querySelector("#keywordSearch");
const clearSearch = document.querySelector("#clearSearch");
const sourceSearch = document.querySelector("#sourceSearch");
const saveCandidates = document.querySelector("#saveCandidates");
const sourceSearchResults = document.querySelector("#sourceSearchResults");
const searchStatus = document.querySelector("#searchStatus");
const runUpdate = document.querySelector("#runUpdate");
const mediaFreshness = document.querySelector("#mediaFreshness");
const pricingTable = document.querySelector("#pricingTable");
const pricingNote = document.querySelector("#pricingNote");
const pricingFreshness = document.querySelector("#pricingFreshness");
const sotaTable = document.querySelector("#sotaTable");
const sotaNote = document.querySelector("#sotaNote");
const sotaFreshness = document.querySelector("#sotaFreshness");
const sotaTabs = document.querySelector("#sotaTabs");
const sotaSearch = document.querySelector("#sotaSearch");
const sotaSearchClear = document.querySelector("#sotaSearchClear");
const tickerTrack = document.querySelector("#tickerTrack");
const tickerToggle = document.querySelector("#tickerToggle");
const tickerLaneButtons = Array.from(document.querySelectorAll(".ticker-lane"));
const pageTabs = Array.from(document.querySelectorAll(".page-tab"));
const pageSections = Array.from(document.querySelectorAll(".page"));
const metricsTickerTrack = document.querySelector("#metricsTickerTrack");
const officialTickerTrack = document.querySelector("#officialTickerTrack");

let activeTab = "all";
let activeQuery = "";
let latestSourceSearch = null;
let activeTickerLane = "core";
let activeSotaDomain = "preset"; // 既定は前線プリセット表示
let activeSotaQuery = "";

// SOTAドメイン（PwCのarea）の表示順とラベル。sota.json の domain キーと対応。
const sotaDomainLabels = {
  General: "基盤・エージェント",
  Language: "言語",
  Vision: "画像",
  Video: "動画",
  Audio: "音声",
  Other: "その他"
};

const officialVendors = [
  {
    id: "anthropic",
    name: "Anthropic / Claude",
    accent: "product",
    homepage: "https://www.anthropic.com/news",
    pattern: /Anthropic|Claude/i
  },
  {
    id: "openai",
    name: "OpenAI / ChatGPT",
    accent: "research",
    homepage: "https://openai.com/news/",
    pattern: /OpenAI|ChatGPT|Codex/i
  },
  {
    id: "google",
    name: "Google / DeepMind",
    accent: "infrastructure",
    homepage: "https://blog.google/technology/ai/",
    pattern: /Google|DeepMind|Gemini/i
  },
  {
    id: "microsoft",
    name: "Microsoft / Azure AI",
    accent: "adoption",
    homepage: "https://blogs.microsoft.com/ai/",
    pattern: /Microsoft|Azure|Copilot/i
  },
  {
    id: "meta",
    name: "Meta AI",
    accent: "research",
    homepage: "https://ai.meta.com/blog/",
    pattern: /Meta AI|Meta\b|Llama/i
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    accent: "infrastructure",
    homepage: "https://developer.nvidia.com/blog/category/generative-ai/",
    pattern: /NVIDIA/i
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    accent: "research",
    homepage: "https://huggingface.co/blog",
    pattern: /Hugging Face|HuggingFace/i
  },
  {
    id: "apple",
    name: "Apple ML",
    accent: "research",
    homepage: "https://machinelearning.apple.com/",
    pattern: /Apple Machine Learning|Apple/i
  },
  {
    id: "japan-ai",
    name: "Japan AI Labs",
    accent: "business",
    homepage: "https://www.nttdata.com/global/ja/news/",
    pattern: /NTT DATA|理化学研究所|Sakana|Preferred Networks|PFN/i
  }
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function hoursSince(publishedAt) {
  if (!publishedAt) return Infinity;
  const time = new Date(publishedAt).getTime();
  if (Number.isNaN(time)) return Infinity;
  return (Date.now() - time) / 3_600_000;
}

// 公開からの経過を「◯時間前 / ◯日前」で表示。publishedAt が無ければ空（呼び出し側で日付にフォールバック）。
function relativeTime(publishedAt) {
  const hours = hoursSince(publishedAt);
  if (!Number.isFinite(hours)) return "";
  if (hours < 1) return "たった今";
  if (hours < 24) return `${Math.round(hours)}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

function isFreshItem(item) {
  return hoursSince(item.publishedAt) < 24;
}

function formatFullDate(value) {
  if (!value) return "----";
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(date)
    .replaceAll("/", ".");
}

function collectItems() {
  return categories.flatMap((category) =>
    category.items.map((item) => ({
      ...item,
      categoryTitle: category.title,
      categoryGroup: category.group,
      categoryAccent: category.accent
    }))
  );
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function tokenMatches(text, token) {
  if (!token) return false;

  if (/^[a-z0-9-]+$/i.test(token) && token.length <= 4) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  }

  return text.includes(token);
}

function itemMatchesQuery(item, query) {
  if (!query) return true;

  const haystack = [
    item.title,
    item.titleJa,
    item.summary,
    item.impact,
    item.source,
    item.type,
    item.category,
    item.date
  ]
    .map(normalizeText)
    .join(" ");

  return normalizeText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => tokenMatches(haystack, token));
}

function appendTitle(titleElement, item) {
  titleElement.replaceChildren();

  const original = document.createElement("span");
  original.className = "title-original";
  original.textContent = item.title;
  titleElement.append(original);

  if (item.titleJa && normalizeText(item.titleJa) !== normalizeText(item.title)) {
    const translated = document.createElement("span");
    translated.className = "title-ja";
    translated.textContent = item.titleJa;
    titleElement.append(translated);
  }
}

function renderSourceResults(data) {
  sourceSearchResults.replaceChildren();
  latestSourceSearch = data;
  saveCandidates.disabled = data.results.length === 0;

  if (!data.results.length) {
    const empty = document.createElement("div");
    empty.className = "source-result-empty";
    empty.textContent = "公式ソース内に一致候補は見つかりませんでした。別の語句で検索してください。";
    sourceSearchResults.append(empty);
    return;
  }

  const heading = document.createElement("div");
  heading.className = "source-result-heading";
  heading.textContent = `公式ソース検索: ${data.results.length}件`;
  sourceSearchResults.append(heading);

  data.results.forEach((result) => {
    const link = document.createElement("a");
    link.className = "source-result";
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noreferrer";

    const title = document.createElement("strong");
    title.textContent = result.title;

    const meta = document.createElement("span");
    meta.textContent = `${result.sourceName} / ${result.sourceType}`;

    link.append(title, meta);
    sourceSearchResults.append(link);
  });
}

function renderMetrics() {
  const items = collectItems();
  document.querySelector("#mediaCount").textContent = mediaItems.length;
  document.querySelector("#newCount").textContent = items.filter((item) => item.new).length;
  document.querySelector("#primaryCount").textContent = items.length;
}

function mediaSort(a, b) {
  return (
    Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0) ||
    Number(b.priority || 0) - Number(a.priority || 0) ||
    String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date))
  );
}

function chooseVisibleMediaItems(items) {
  const sorted = [...items].sort(mediaSort);
  // 24時間以内の新着を最優先。無いカテゴリは直近(24〜72h)で補完してスカスカを避ける。
  const fresh = sorted.filter(isFreshItem);
  const pool = fresh.length ? fresh : sorted;
  const important = pool.filter((item) => Number(item.relevanceScore || 0) >= 2);
  const count = Math.min(Math.max(3, important.length), 4, pool.length);
  return pool.slice(0, count);
}

function tickerLaneMatches(item, lane) {
  const text = `${item.title} ${item.summary} ${item.category} ${item.source}`;
  if (lane === "fde") {
    return (
      item.categoryId === "fde" ||
      /\bFDE\b|Forward Deployed|AIエージェント|RAG|作業代行|自動化|導入|本番導入|基幹システム|Google Cloud|AWS|クラウド|業務AI/i.test(text)
    );
  }
  if (lane === "research") return item.categoryId === "models" || /SOTA|ベンチ|benchmark|論文|研究|モデル|LLM|AI for Science|Midjourney/i.test(text);
  if (lane === "consult") return item.categoryId === "regulation" || item.categoryId === "industry" || /規制|著作権|導入|事例|PoC|本番|業務|生産性|ガバナンス/i.test(text);
  return /AI|生成AI|ChatGPT|Claude|Gemini|OpenAI|Anthropic|Copilot|LLM|RAG|FDE|エージェント|モデル/i.test(text);
}

// ティッカーのタグ（日本語）。色の意味と一致させる:
//   モデル/研究=青, インフラ・業務(FDE/エージェント)=橙, 規制=赤, 一般=緑。
// SOTA/ベンチは「指標・ベンチ」タブの担当なので、ニュース速報では「モデル」に寄せる。
function tickerTag(item) {
  const text = `${item.title} ${item.summary}`;
  if (/\bFDE\b|Forward Deployed/i.test(text)) return "FDE";
  if (/規制|著作権|ガバナンス|プライバシー|CISO|セキュリティ|脆弱性/i.test(text)) return "規制";
  if (/エージェント|Copilot|RAG|作業代行|自動化/i.test(text)) return "エージェント";
  if (/GPU|クラウド|Cloud|AWS|半導体|スパコン|データセンター|基盤/i.test(text)) return "インフラ";
  if (/モデル|LLM|ベンチ|SOTA|benchmark|Midjourney|動画|画像AI|AI for Science|論文|研究/i.test(text)) return "モデル";
  return "AI";
}

// タグ → 色トーン。色とタグの意味を一致させ「色を見れば中身が分かる」状態にする。
const TICKER_TAG_TONE = {
  "モデル": "blue",
  "インフラ": "amber",
  "エージェント": "amber",
  "FDE": "amber",
  "規制": "red",
  "AI": "green"
};

function tickerTone(item) {
  if (item.tag) return "blue"; // aiSignals(論文/ベンチ/研究/価格)は研究・指標系=青
  return TICKER_TAG_TONE[tickerTag(item)] || "green";
}

// aiSignals の英語タグを日本語に。media/official はタグを持たないので tickerTag で導出。
const SIGNAL_TAG_JA = { Paper: "論文", SOTA: "ベンチ", Research: "研究", Price: "価格" };
function tickerTagLabel(item) {
  if (item.tag) return SIGNAL_TAG_JA[item.tag] || item.tag;
  return tickerTag(item);
}

function buildTickerMessage(item) {
  if (item.text) return item.text;
  const cleanTitle = String(item.title || "").replace(/\s+/g, " ").trim();
  const meta = `${formatDate(item.date)} / ${item.source}`;
  return `${cleanTitle} / ${meta}`;
}

// ティッカーの見た目スクロール速度を一定(px/秒)に揃える。
// トラックは同じ内容を2回並べ translateX(-50%) で流すため、1周距離=幅の半分。
// 中身の長短で速度が変わらないよう、距離に比例して animation-duration を設定する。
const TICKER_SPEED_PX_PER_SEC = 55;
function applyTickerSpeed(track) {
  if (!track) return;
  const distance = track.scrollWidth / 2;
  if (!distance) return;
  const duration = Math.max(24, Math.round(distance / TICKER_SPEED_PX_PER_SEC));
  track.style.animationDuration = `${duration}s`;
}

function renderTicker() {
  if (!tickerTrack) return;

  const signalCandidates = aiSignals
    .filter((item) => item.url && (activeTickerLane === "core" || item.lane === activeTickerLane))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(b.date).localeCompare(String(a.date)));
  const officialCandidates = officialItems
    .filter((item) => item.url && (activeTickerLane === "core" || tickerLaneMatches(item, activeTickerLane)))
    .sort(officialSort);
  const mediaCandidates = mediaItems
    .filter((item) => item.url && tickerLaneMatches(item, activeTickerLane))
    .sort(mediaSort);

  const candidates = (activeTickerLane === "research"
    ? [...signalCandidates, ...officialCandidates, ...mediaCandidates]
    : activeTickerLane === "core"
      ? [...mediaCandidates.slice(0, 7), ...officialCandidates.slice(0, 5)]
      : [...mediaCandidates, ...officialCandidates, ...signalCandidates]
  ).slice(0, 12);

  if (!candidates.length) {
    tickerTrack.textContent = "AI速報はまだ取得されていません。今すぐ取得で更新してください。";
    return;
  }

  const buildSegment = () => {
    const fragment = document.createDocumentFragment();
    candidates.forEach((entry, index) => {
      const link = document.createElement("a");
      link.className = `ticker-item ticker-${tickerTone(entry)}`;
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.title = `${entry.source} / ${entry.date}`;

      const tag = document.createElement("em");
      tag.textContent = tickerTagLabel(entry);
      const headline = document.createElement("strong");
      headline.textContent = buildTickerMessage(entry);

      link.append(tag, headline);
      fragment.append(link);

      if (index < candidates.length - 1) {
        const separator = document.createElement("span");
        separator.className = "ticker-separator";
        separator.textContent = "/";
        fragment.append(separator);
      }
    });
    return fragment;
  };

  tickerTrack.replaceChildren(buildSegment(), buildSegment());
  applyTickerSpeed(tickerTrack);
}

function renderMediaRadar() {
  const filtered = mediaItems
    .filter((item) => itemMatchesQuery(item, activeQuery))
    .sort(mediaSort);

  if (mediaFreshness) {
    const freshCount = mediaItems.filter(isFreshItem).length;
    const totalCount = mediaItems.length;
    mediaFreshness.textContent = freshCount
      ? `24時間以内 ${freshCount}件 / 直近72時間 ${totalCount}件`
      : totalCount
        ? `直近72時間 ${totalCount}件（24時間以内の新着なし）`
        : "速報なし";
    mediaFreshness.classList.toggle("stale", totalCount === 0);
    mediaFreshness.classList.toggle("good", totalCount > 0);
  }

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state load-error";
    empty.textContent = activeQuery
      ? "速報記事に一致するものはありません。検索語を変えてください。"
      : "メディア速報はまだ取得されていません。「今すぐ取得」で更新してください。";
    mediaGrid.replaceChildren(empty);
    return;
  }

  const byCategory = new Map();
  for (const category of mediaCategories) {
    if (category.id === "fde") {
      byCategory.set(category.id, {
        title: category.label,
        accent: category.accent || "business",
        items: []
      });
    }
  }

  for (const item of filtered) {
    const key = item.categoryId || item.category || "other";
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        title: item.category || "その他",
        accent: item.accent || "product",
        items: []
      });
    }
    byCategory.get(key).items.push(item);
  }

  const sections = Array.from(byCategory.values())
    .filter((group) => group.items.length > 0 || group.title === "FDE")
    .map((group) => {
    const section = document.createElement("section");
    section.className = "media-group";
    section.dataset.accent = group.accent;

    const head = document.createElement("div");
    head.className = "media-group-head";

    const title = document.createElement("h3");
    title.textContent = group.title;

    const count = document.createElement("span");
    count.className = "status-chip good";
    const visibleItems = chooseVisibleMediaItems(group.items);
    count.textContent = `${visibleItems.length}件`;

    head.append(title, count);

    const list = document.createElement("div");
    list.className = "media-group-list";
    if (visibleItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "media-empty-note";
      empty.textContent = "24時間以内の新着ニュースは未検出です。検出され次第ここに表示します。";
      list.append(empty);
    } else {
      // 新着(24h)が無く直近(24〜72h)で補完したカテゴリは、その旨を小さく明示する。
      if (!visibleItems.some(isFreshItem)) {
        const note = document.createElement("div");
        note.className = "media-stale-note";
        note.textContent = "24時間以内の新着なし・直近72時間の注目を表示";
        list.append(note);
      }
      visibleItems.forEach((item) => list.append(renderMediaCard(item)));
    }

    section.append(head, list);
    return section;
  });

  mediaGrid.replaceChildren(...sections);
}

function renderMediaCard(item) {
  const fragment = mediaTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".media-card");
  card.href = item.url;
  card.dataset.accent = item.accent || "product";
  card.dataset.region = item.region || "";

  fragment.querySelector(".media-category").textContent = item.category;
  const relative = relativeTime(item.publishedAt);
  fragment.querySelector(".media-source").textContent = relative
    ? `${item.source} ・ ${relative}`
    : `${item.source} / ${formatDate(item.date)}`;
  if (relative) {
    fragment.querySelector(".media-source").title = `${item.source} / ${formatFullDate(item.date)}`;
  }
  fragment.querySelector("h3").textContent = item.title;
  fragment.querySelector("p").textContent = item.summary;

  if (isFreshItem(item)) {
    card.classList.add("is-fresh");
    const chip = document.createElement("span");
    chip.className = "media-fresh";
    chip.textContent = "NEW";
    fragment.querySelector(".media-meta").prepend(chip);
  }

  return card;
}

function vendorMatches(item, vendor) {
  return vendor.pattern.test(`${item.source} ${item.title} ${item.titleJa || ""} ${item.summary}`);
}

function officialSort(a, b) {
  return (
    Number(b.new) - Number(a.new) ||
    String(b.date || "").localeCompare(String(a.date || "")) ||
    Number(b.priority || 0) - Number(a.priority || 0)
  );
}

function renderOfficialCard(item, vendor) {
  const link = document.createElement("a");
  link.className = "official-item";
  link.dataset.accent = vendor.accent;
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noreferrer";

  const meta = document.createElement("div");
  meta.className = "official-meta";
  const date = document.createElement("span");
  date.textContent = formatDate(item.date);
  const type = document.createElement("span");
  type.textContent = item.type || "公式";
  meta.append(date, type);

  const title = document.createElement("h3");
  appendTitle(title, item);

  const summary = document.createElement("p");
  summary.textContent = item.summary;

  const source = document.createElement("div");
  source.className = "official-source";
  source.textContent = item.source;

  link.append(meta, title, summary, source);
  return link;
}

function renderOfficialRadar() {
  if (!priorityList) return;

  const hasOfficialFeed = officialItems.length > 0;
  const primaryItems = hasOfficialFeed
    ? officialItems.filter((item) => itemMatchesQuery(item, activeQuery)).sort(officialSort)
    : collectItems().filter((item) => itemMatchesQuery(item, activeQuery)).sort(officialSort);
  const fallbackPrimaryItems = collectItems()
    .filter((item) => itemMatchesQuery(item, activeQuery))
    .sort(officialSort);

  const vendorList = hasOfficialFeed && officialDataVendors.length ? officialDataVendors : officialVendors;
  const groups = vendorList
    .map((vendor) => {
      const normalizedVendor = {
        ...vendor,
        pattern: vendor.pattern || officialVendors.find((item) => item.id === vendor.id)?.pattern || /$a/
      };
      return {
        vendor: normalizedVendor,
        items: hasOfficialFeed
          ? (
              primaryItems.filter((item) => item.vendorId === vendor.id).length
                ? primaryItems.filter((item) => item.vendorId === vendor.id)
                : fallbackPrimaryItems.filter((item) => vendorMatches(item, normalizedVendor))
            ).slice(0, 3)
          : primaryItems.filter((item) => vendorMatches(item, normalizedVendor)).slice(0, 3)
      };
    })
    .filter((group) => group.items.length > 0);

  officialShownUrls = new Set(groups.flatMap((group) => group.items.map((item) => item.url)));

  if (officialFreshness) {
    const count = groups.reduce((total, group) => total + group.items.length, 0);
    officialFreshness.textContent = count ? `公式 ${count}件` : "公式未検出";
    officialFreshness.classList.toggle("good", count > 0);
    officialFreshness.classList.toggle("stale", count === 0);
  }

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state load-error";
    empty.textContent = activeQuery
      ? "公式ベンダー動向に一致する一次情報はありません。検索語を変えるか、公式ソース検索を使ってください。"
      : "公式ベンダー動向は未検出です。今すぐ取得で一次情報を更新してください。";
    priorityList.replaceChildren(empty);
    return;
  }

  priorityList.replaceChildren(
    ...groups.map(({ vendor, items }) => {
      const section = document.createElement("section");
      section.className = "official-vendor";
      section.dataset.accent = vendor.accent;

      const head = document.createElement("div");
      head.className = "official-vendor-head";

      const title = document.createElement("div");
      title.className = "official-vendor-title";
      const name = document.createElement("h3");
      name.textContent = vendor.name;
      const url = document.createElement("a");
      url.href = vendor.homepage;
      url.target = "_blank";
      url.rel = "noreferrer";
      url.textContent = "公式ページ";
      title.append(name, url);

      const count = document.createElement("span");
      count.className = "status-chip good";
      count.textContent = `${items.length}件`;

      head.append(title, count);

      const list = document.createElement("div");
      list.className = "official-list";
      items.forEach((item) => list.append(renderOfficialCard(item, vendor)));

      section.append(head, list);
      return section;
    })
  );
}

function renderPriority() {
  renderOfficialRadar();
}

function renderNewsCard(item, accent) {
  const fragment = newsTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".news-card");
  card.href = item.url;
  card.dataset.accent = accent;
  card.classList.toggle("is-new", item.new);
  // 地域バッジ（国内/海外）。横断カテゴリは付けない。
  if (item._region === "国内" || item._region === "海外") {
    const meta = fragment.querySelector(".news-meta");
    const region = document.createElement("span");
    region.className = item._region === "国内" ? "region-badge region-jp" : "region-badge region-global";
    region.textContent = item._region;
    meta.insertBefore(region, meta.firstChild);
  }
  fragment.querySelector(".source-type").textContent = item.type;
  fragment.querySelector(".published").textContent = formatDate(item.date);
  appendTitle(fragment.querySelector("h4"), item);
  fragment.querySelector("p").textContent = item.summary;
  fragment.querySelector(".impact-label").textContent = item.impact;
  fragment.querySelector(".source-name").textContent = item.source;
  return fragment;
}

function diversifyBySource(items, maxPerSource = 2) {
  const counts = new Map();
  const selected = [];

  for (const item of items) {
    const key = item.source || "unknown";
    const count = counts.get(key) || 0;
    if (count < maxPerSource) {
      selected.push(item);
      counts.set(key, count + 1);
    }
  }

  return selected;
}

// 分野別動向タブのグルーピング（テーマ軸）。国内/海外を分けず分野でまとめ、
// 地域はカードの地域バッジで示す。各分野は複数の収集カテゴリ(cats)を束ねる。
const FIELD_GROUPS = [
  { id: "research", title: "モデル・研究", accent: "research", cats: ["jp-research", "global-research", "product-release"] },
  { id: "adoption", title: "産業導入・活用事例", accent: "adoption", cats: ["jp-cases", "global-cases", "business"] },
  { id: "governance", title: "規制・ガバナンス", accent: "governance", cats: ["jp-governance", "global-governance"] },
  { id: "security", title: "セキュリティ", accent: "security", cats: ["security"] },
  { id: "infrastructure", title: "インフラ・基盤", accent: "infrastructure", cats: ["infrastructure"] }
];

function renderCategories(nextTab = "all") {
  let matchedItemCount = 0;
  const byId = new Map(categories.map((c) => [c.id, c]));

  const fields = FIELD_GROUPS
    .filter((fg) => nextTab === "all" || nextTab === fg.id)
    .map((fg) => {
      // 束ねる収集カテゴリのitemsを統合し、各itemに地域(国内/海外/横断)を注入。
      let items = [];
      for (const cid of fg.cats) {
        const c = byId.get(cid);
        if (!c) continue;
        for (const it of c.items) items.push({ ...it, _region: c.group });
      }
      items = diversifyBySource(
        items.filter((item) => itemMatchesQuery(item, activeQuery) && !officialShownUrls.has(item.url))
      );
      items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      matchedItemCount += items.length;
      return { ...fg, items };
    })
    .filter((fg) => !activeQuery || fg.items.length > 0);

  categoryGrid.replaceChildren(
    ...fields.map((fg) => {
      const fragment = categoryTemplate.content.cloneNode(true);
      const column = fragment.querySelector(".category-column");
      column.dataset.accent = fg.accent;
      const hasToday = fg.items.some((item) => item.date === today);
      const isEmpty = fg.items.length === 0;
      const status = fragment.querySelector(".status-chip");

      // 0件分野は折りたたみ表示（網羅性は残しつつ視覚的に小さく）。
      column.classList.toggle("is-collapsed", isEmpty);

      fragment.querySelector(".category-group").textContent = "分野";
      fragment.querySelector("h3").textContent = fg.title;
      status.textContent = hasToday ? "本日更新" : fg.items.length ? "最近の動向" : "未取得";
      status.classList.add(hasToday ? "good" : "stale");

      const list = fragment.querySelector(".news-list");
      if (isEmpty) {
        const note = document.createElement("div");
        note.className = "empty-note";
        note.textContent = "最近の新着はありません";
        list.append(note);
      } else {
        fg.items.slice(0, 4).forEach((item) => list.append(renderNewsCard(item, fg.accent)));
      }

      return column;
    })
  );

  if (fields.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state load-error";
    empty.textContent = "該当する一次情報はありません。今日の動向（速報）や公式ソース検索もご確認ください。";
    categoryGrid.append(empty);
  }

  updateSearchStatus(matchedItemCount);
}

function updateSearchStatus(primaryMatches = collectItems().filter((item) => itemMatchesQuery(item, activeQuery)).length) {
  if (!activeQuery) {
    searchStatus.textContent = "";
    searchStatus.hidden = true;
    return;
  }

  const mediaMatches = mediaItems.filter((item) => itemMatchesQuery(item, activeQuery)).length;
  searchStatus.textContent = `速報 ${mediaMatches}件 / 一次情報 ${primaryMatches}件`;
  searchStatus.hidden = false;
}

function setActiveTab(nextTab) {
  activeTab = nextTab;
  tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === nextTab));
  renderCategories(nextTab);
}

function formatPrice(value) {
  if (value === null || value === undefined || value === "") return "要確認";
  const num = Number(value);
  if (!Number.isFinite(num)) return "要確認";
  // 0.075 のような小額（キャッシュ入力）は3桁まで表示し丸め誤差を避ける。
  return `$${num < 0.1 ? num.toFixed(3) : num.toFixed(2)}`;
}

function renderPricing() {
  if (!pricingTable) return;

  const models = Array.isArray(pricingData.models) ? pricingData.models : [];
  const unit = pricingData.unit || "per 1M tokens";

  if (pricingNote) {
    const asOf = pricingData.asOf ? `（基準: ${pricingData.asOf}時点 / 単位: ${unit}）` : "";
    pricingNote.textContent = `${pricingData.note || "公式pricingで要確認"}${asOf}`;
  }
  if (pricingFreshness) {
    const verifiedCount = models.filter((m) => m.verified).length;
    pricingFreshness.textContent = verifiedCount ? `確認済 ${verifiedCount}/${models.length}` : "参考";
    pricingFreshness.classList.toggle("good", verifiedCount === models.length && models.length > 0);
    pricingFreshness.classList.toggle("stale", verifiedCount < models.length);
  }

  if (!models.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "価格データがありません。data/pricing.json を確認してください。";
    pricingTable.replaceChildren(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "pricing-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["ベンダー", "モデル", `入力 (${unit})`, "キャッシュ入力", `出力 (${unit})`, "出力倍率", "コンテキスト", "出典"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  models.forEach((m, i) => {
    const row = document.createElement("tr");
    if (!m.verified) row.classList.add("is-unverified");

    // ベンダー列: 同一ベンダーの連続行は先頭だけ表示し rowSpan で結合する。
    if (i === 0 || models[i - 1].vendor !== m.vendor) {
      let span = 1;
      while (i + span < models.length && models[i + span].vendor === m.vendor) span++;
      const vendorTd = document.createElement("td");
      vendorTd.textContent = m.vendor || "";
      vendorTd.className = "pricing-vendor";
      if (span > 1) vendorTd.rowSpan = span;
      row.append(vendorTd);
    }

    const modelTd = document.createElement("td");
    modelTd.textContent = m.model || "";
    row.append(modelTd);

    const inputTd = document.createElement("td");
    inputTd.className = "pricing-num";
    inputTd.textContent = formatPrice(m.inputPer1M);
    if (inputTd.textContent === "要確認") inputTd.classList.add("needs-check");
    row.append(inputTd);

    // キャッシュ入力（任意。提供が無いモデルは「—」）
    const cachedTd = document.createElement("td");
    cachedTd.className = "pricing-num";
    const cachedVal = m.cachedInputPer1M;
    if (cachedVal === null || cachedVal === undefined || cachedVal === "") {
      cachedTd.textContent = "—";
      cachedTd.classList.add("sota-linkonly");
    } else {
      cachedTd.textContent = formatPrice(cachedVal);
    }
    row.append(cachedTd);

    const outputTd = document.createElement("td");
    outputTd.className = "pricing-num";
    outputTd.textContent = formatPrice(m.outputPer1M);
    if (outputTd.textContent === "要確認") outputTd.classList.add("needs-check");
    row.append(outputTd);

    // 出力倍率: 出力単価が入力単価の何倍か（データから正確に算出）。
    const ratioTd = document.createElement("td");
    ratioTd.className = "pricing-num";
    if (typeof m.inputPer1M === "number" && m.inputPer1M > 0 && typeof m.outputPer1M === "number") {
      ratioTd.textContent = `${(m.outputPer1M / m.inputPer1M).toFixed(1)}倍`;
    } else {
      ratioTd.textContent = "—";
      ratioTd.classList.add("sota-linkonly");
    }
    row.append(ratioTd);

    const ctx = document.createElement("td");
    ctx.textContent = m.context || "—";
    row.append(ctx);

    const src = document.createElement("td");
    if (m.sourceUrl) {
      const link = document.createElement("a");
      link.href = m.sourceUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "公式";
      src.append(link);
    } else {
      src.textContent = "—";
    }
    row.append(src);

    tbody.append(row);
  });

  table.append(thead, tbody);
  pricingTable.replaceChildren(table);
}

function parseSotaDate(value) {
  if (!value) return null;
  const str = String(value);
  if (/^\d{4}$/.test(str)) return new Date(`${str}-01-01T00:00:00`);
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSotaPeriod(fromStr, toStr) {
  const from = parseSotaDate(fromStr);
  const to = parseSotaDate(toStr);
  if (!from || !to) return "";
  const months = Math.round((to - from) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 1) return "";
  if (months < 12) return `約${months}ヶ月`;
  const years = months / 12;
  return `約${years < 10 ? years.toFixed(1) : Math.round(years)}年`;
}

// 今回と前回の改善幅テキストを返す。同一ベンチ・同一指標(prevComparable)のときだけ
// 数値差分を出し、基準変更時は比較せず注記のみ（誤った引き算を避ける）。
function sotaImprovementText(e) {
  if (!e.prevTopModel) return "";
  if (e.prevComparable === false) return "基準変更のため単純比較不可";
  if (typeof e.score !== "number" || typeof e.prevScore !== "number") return "";

  const raw = e.score - e.prevScore;
  const improvement = e.higherIsBetter === false ? -raw : raw;
  const period = formatSotaPeriod(e.prevAsOf, e.asOf);
  // SOTA更新は改善前提なので「改善」の語は付けない。万一の後退時のみ ▼ を付す。
  const prefix = improvement < 0 ? "▼" : "";
  return `${prefix}${Math.abs(improvement).toFixed(2)}pt${period ? ` / ${period}ぶりに更新` : ""}`;
}

// 検索の正規化。揺らぎ吸収はこの程度に留める（小文字化のみ）。
function normalizeSotaText(value) {
  return String(value || "").toLowerCase();
}

// 端的なキーワード検索。複数語はAND。研究名(日英)・ベンチ名・キーワードを対象。
function sotaMatches(entry, query) {
  const q = normalizeSotaText(query).trim();
  if (!q) return true;
  const hay = normalizeSotaText(
    [entry.task, entry.taskEn, entry.benchmark, ...(entry.keywords || [])].join(" ")
  );
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

// 表示順: データあり→なし、各群で時点の新しい順。
function sortSotaEntries(list) {
  return [...list].sort((a, b) => {
    if (!!b.hasData !== !!a.hasData) return a.hasData ? -1 : 1;
    const da = parseSotaDate(a.asOf)?.getTime() || 0;
    const db = parseSotaDate(b.asOf)?.getTime() || 0;
    if (db !== da) return db - da;
    return String(a.task).localeCompare(String(b.task));
  });
}

// プリセットslugの順序を保って存在するentryだけ返す。
function getSotaPresetEntries(allEntries) {
  const bySlug = new Map(allEntries.map((e) => [e.slug, e]));
  return sotaPresets.map((slug) => bySlug.get(slug)).filter(Boolean);
}

function renderSotaTabs(allEntries) {
  if (!sotaTabs) return;

  const present = Object.keys(sotaDomainLabels).filter((key) =>
    allEntries.some((e) => e.domain === key)
  );
  const presetCount = getSotaPresetEntries(allEntries).length;
  const tabKeys = [...(presetCount ? ["preset"] : []), ...present, "all"];

  // 選択中のタブが消えた場合の復帰。
  if (
    activeSotaDomain !== "all" &&
    activeSotaDomain !== "preset" &&
    !present.includes(activeSotaDomain)
  ) {
    activeSotaDomain = presetCount ? "preset" : "all";
  }

  const labelFor = (key) =>
    key === "preset" ? "注目" : key === "all" ? "すべて" : sotaDomainLabels[key];
  const countFor = (key) =>
    key === "preset"
      ? presetCount
      : key === "all"
        ? allEntries.length
        : allEntries.filter((e) => e.domain === key).length;

  sotaTabs.replaceChildren(
    ...tabKeys.map((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sota-tab";
      button.classList.toggle("active", key === activeSotaDomain && !activeSotaQuery.trim());
      button.textContent = `${labelFor(key)} (${countFor(key)})`;
      button.addEventListener("click", () => {
        activeSotaDomain = key;
        // タブと検索は排他。タブ選択で検索を解除。
        if (sotaSearch) sotaSearch.value = "";
        activeSotaQuery = "";
        renderSota();
      });
      return button;
    })
  );
}

function renderSota() {
  if (!sotaTable) return;

  const allEntries = Array.isArray(sotaData.entries) ? sotaData.entries : [];
  renderSotaTabs(allEntries);

  // 検索中はタブを無視して全分野から横断検索（あなたの①の方針）。
  let entries;
  let scopeLabel;
  const query = activeSotaQuery.trim();
  if (query) {
    entries = sortSotaEntries(allEntries.filter((e) => sotaMatches(e, query)));
    scopeLabel = `「${query}」の検索結果`;
  } else if (activeSotaDomain === "preset") {
    entries = getSotaPresetEntries(allEntries); // プリセットは重要度順を維持
    scopeLabel = "前線プリセット（時代の注目分野）";
  } else if (activeSotaDomain === "all") {
    entries = sortSotaEntries(allEntries);
    scopeLabel = "全分野";
  } else {
    entries = sortSotaEntries(allEntries.filter((e) => e.domain === activeSotaDomain));
    scopeLabel = sotaDomainLabels[activeSotaDomain] || "分野別";
  }

  if (sotaNote) {
    const asOf = sotaData.asOf ? `（基準: ${sotaData.asOf}時点）` : "";
    sotaNote.textContent = `${scopeLabel}・出典: paperswithcode.co ほか公式リーダーボード${asOf}`;
  }
  if (sotaFreshness) {
    const withData = entries.filter((e) => e.hasData).length;
    sotaFreshness.textContent = `数値あり ${withData} / ${entries.length}`;
    sotaFreshness.classList.toggle("good", withData > 0);
    sotaFreshness.classList.toggle("stale", withData === 0);
  }

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = query
      ? `「${query}」に一致する研究分野は見つかりませんでした。別のキーワードでお試しください。`
      : "SOTAデータがありません。data/sota.json を確認してください。";
    sotaTable.replaceChildren(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "pricing-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["研究分野", "ベンチマーク", "指標", "トップモデル", "スコア", "時点", "出典"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  entries.forEach((e) => {
    const hasScore = typeof e.score === "number";
    const hasPrev = !!e.prevTopModel;

    // 今回(上段)の行。前回がある場合、共有列(分野/ベンチ/指標/出典)は2行ぶち抜き。
    const row = document.createElement("tr");
    if (hasPrev) row.classList.add("sota-cur");
    if (e.hasData) row.classList.add("sota-now");
    if (!e.hasData) row.classList.add("sota-nodata");

    [e.task, e.benchmark || "—"].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (hasPrev) td.rowSpan = 2;
      row.append(td);
    });

    // 指標列: 向き(↑高いほど良い / ↓低いほど良い)を併記。
    const metricTd = document.createElement("td");
    metricTd.textContent = e.metric || "—";
    if (e.hasData && e.metric) {
      const dir = document.createElement("span");
      dir.className = e.higherIsBetter === false ? "sota-dir sota-dir-down" : "sota-dir sota-dir-up";
      dir.textContent = e.higherIsBetter === false ? "▼" : "▲";
      dir.title = e.higherIsBetter === false ? "数値が低いほど良い" : "数値が高いほど良い";
      metricTd.append(dir);
    }
    if (hasPrev) metricTd.rowSpan = 2;
    row.append(metricTd);

    // モデル列: データありはモデル名、無ければ「データ未登録」。
    const model = document.createElement("td");
    if (e.topModel) {
      model.textContent = e.topModel;
      model.classList.add("sota-emph");
    } else {
      model.textContent = "データ未登録";
      model.classList.add("sota-linkonly");
    }
    row.append(model);

    // スコア列: 実値 + 改善幅の注記。
    const score = document.createElement("td");
    score.className = "pricing-num";
    score.textContent = hasScore ? String(e.score) : "—";
    if (hasScore) score.classList.add("sota-emph");
    if (!hasScore) score.classList.add("sota-linkonly");
    if (hasPrev) {
      const delta = sotaImprovementText(e);
      if (delta) {
        const note = document.createElement("div");
        note.className = "sota-delta";
        note.textContent = delta;
        score.append(note);
      }
    }
    row.append(score);

    // 時点列: 2025年より前は鮮度低として控えめ表示。
    const asOf = document.createElement("td");
    if (e.asOf) {
      asOf.textContent = e.asOf;
      asOf.classList.add("sota-emph");
      const year = Number(String(e.asOf).slice(0, 4));
      if (year && year < 2025) asOf.classList.add("sota-old");
    } else {
      asOf.textContent = "—";
      asOf.classList.add("sota-linkonly");
    }
    row.append(asOf);

    // 出典列(2行ぶち抜き): Paper / Code / PwC(掲載元)。
    // リンクが無いものはダッシュを付けず、飛べないグレー文字で示す。
    const src = document.createElement("td");
    if (hasPrev) src.rowSpan = 2;
    const makeSrcNode = (url, label, hint) => {
      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = label;
        if (hint) link.title = hint;
        return link;
      }
      const span = document.createElement("span");
      span.className = "sota-nolink";
      span.textContent = label;
      return span;
    };
    const boardName = e.boardName || "PwC";
    [
      makeSrcNode(e.paperUrl, "Paper"),
      makeSrcNode(e.codeUrl, "Code"),
      makeSrcNode(e.boardUrl, boardName, `${boardName}（SOTAの掲載元）`)
    ].forEach((node, i) => {
      if (i > 0) src.append(document.createTextNode(" / "));
      src.append(node);
    });
    row.append(src);

    tbody.append(row);

    // 前回(下段)の行。同じ列を兼用してモデル/スコア/時点だけ並べる。
    if (hasPrev) {
      const prevRow = document.createElement("tr");
      prevRow.className = "sota-prev";

      const pModel = document.createElement("td");
      pModel.textContent = `前回: ${e.prevTopModel}`;
      prevRow.append(pModel);

      const pScore = document.createElement("td");
      pScore.className = "pricing-num";
      pScore.textContent = typeof e.prevScore === "number" ? String(e.prevScore) : "—";
      prevRow.append(pScore);

      const pAsOf = document.createElement("td");
      pAsOf.textContent = e.prevAsOf || "—";
      prevRow.append(pAsOf);

      tbody.append(prevRow);
    }
  });

  table.append(thead, tbody);
  sotaTable.replaceChildren(table);
}

// 指標タブのティッカー: 実値のあるSOTAのハイライトを流す。
// （価格改定やSOTA順位交代の検知は将来機能。今は現値のハイライト表示。）
function renderMetricsTicker() {
  if (!metricsTickerTrack) return;

  const verified = (sotaData.entries || []).filter((e) => typeof e.score === "number" && e.topModel);
  if (!verified.length) {
    metricsTickerTrack.textContent = "価格・SOTAの最新値は各表で確認できます。";
    return;
  }

  const buildSegment = () => {
    const fragment = document.createDocumentFragment();
    verified.forEach((e, index) => {
      const item = document.createElement("span");
      item.className = "ticker-item ticker-blue";
      const headline = document.createElement("strong");
      headline.append(document.createTextNode(`${e.task}: ${e.topModel} `));
      const score = document.createElement("b");
      score.className = "ticker-num";
      score.textContent = e.score;
      headline.append(score);
      item.append(headline);
      fragment.append(item);

      if (index < verified.length - 1) {
        const separator = document.createElement("span");
        separator.className = "ticker-separator";
        separator.textContent = "/";
        fragment.append(separator);
      }
    });
    return fragment;
  };

  metricsTickerTrack.replaceChildren(buildSegment(), buildSegment());
  applyTickerSpeed(metricsTickerTrack);
}

// 公式ベンダーのaccent → 色トーン。共通の色定義に合わせる:
//   研究・モデル=青, プロダクト=緑, インフラ/業務導入=橙, リスク・規制=赤。
const OFFICIAL_TICKER_TONE = {
  research: "blue",
  product: "green",
  infrastructure: "amber",
  adoption: "amber",
  security: "red",
  governance: "red"
};

// 公式動向タブのティッカー: ベンダー公式の最新更新をベンダー色で流す。
function renderOfficialTicker() {
  if (!officialTickerTrack) return;

  const items = [...officialItems].filter((item) => item.url).sort(officialSort).slice(0, 10);
  if (!items.length) {
    officialTickerTrack.textContent = "公式動向はまだ取得されていません。今すぐ取得で更新してください。";
    return;
  }

  const buildSegment = () => {
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const vendor = officialDataVendors.find((v) => v.id === item.vendorId);
      const tone = OFFICIAL_TICKER_TONE[vendor?.accent] || "green";
      const link = document.createElement("a");
      link.className = `ticker-item ticker-${tone}`;
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.title = `${item.vendorName || item.source} / ${item.date}`;

      const tag = document.createElement("em");
      tag.textContent = item.vendorName || item.source || "公式";
      const headline = document.createElement("strong");
      headline.textContent = String(item.title || "").replace(/\s+/g, " ").trim();

      link.append(tag, headline);
      fragment.append(link);

      if (index < items.length - 1) {
        const separator = document.createElement("span");
        separator.className = "ticker-separator";
        separator.textContent = "/";
        fragment.append(separator);
      }
    });
    return fragment;
  };

  officialTickerTrack.replaceChildren(buildSegment(), buildSegment());
  applyTickerSpeed(officialTickerTrack);
}

const PAGE_ID_BY_NAME = {
  today: "pageToday",
  category: "pageCategory",
  official: "pageOfficial",
  metrics: "pageMetrics"
};

function setActivePage(name) {
  const targetId = PAGE_ID_BY_NAME[name] || "pageToday";
  pageTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.page === name));
  pageSections.forEach((section) => section.classList.toggle("active", section.id === targetId));
  if (name === "metrics") renderMetricsTicker();
  if (name === "official") renderOfficialTicker();
}

function renderApp(newsData, mediaData, officialData, signalData, pricing, sota, presets) {
  today = newsData.generatedDate || mediaData.generatedDate || officialData.generatedDate || signalData.generatedDate;
  categories = newsData.categories || [];
  mediaItems = mediaData.items || [];
  mediaCategories = mediaData.categories || [];
  officialItems = officialData.items || [];
  officialDataVendors = officialData.vendors || [];
  aiSignals = signalData.items || [];
  pricingData = pricing || { models: [] };
  sotaData = sota || { entries: [] };
  sotaPresets = (presets && Array.isArray(presets.slugs)) ? presets.slugs : [];
  todayLabel.textContent = formatFullDate(today);
  freshnessLabel.textContent = "自動収集中";
  freshnessLabel.classList.remove("error");
  renderMetrics();
  renderTicker();
  renderMediaRadar();
  renderPriority();
  renderPricing();
  renderSota();
  renderMetricsTicker();
  setActiveTab(document.querySelector(".tab.active")?.dataset.tab || "all");
}

function renderLoadError(error) {
  console.error(error);
  freshnessLabel.textContent = "読み込み失敗";
  freshnessLabel.classList.add("error");
  priorityList.replaceChildren();
  mediaGrid.replaceChildren();
  categoryGrid.replaceChildren();

  const empty = document.createElement("div");
  empty.className = "empty-state load-error";
  empty.textContent = "ニュースデータを読み込めませんでした。ローカルサーバ経由で開いているか確認してください。";
  categoryGrid.append(empty);
}

async function loadJson(path, fallback) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    if (fallback) return fallback;
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

async function loadAllData() {
  freshnessLabel.textContent = "読み込み中";
  const [newsData, mediaData, officialData, signalData, pricing, sota, presets] = await Promise.all([
    loadJson(dataPath),
    loadJson(mediaPath, { generatedDate: "", items: [] }),
    loadJson(officialPath, { generatedDate: "", vendors: [], items: [] }),
    loadJson(signalPath, { generatedDate: "", items: [] }),
    loadJson(pricingPath, { models: [] }),
    loadJson(sotaPath, { entries: [] }),
    loadJson(sotaPresetsPath, { slugs: [] })
  ]);
  return [newsData, mediaData, officialData, signalData, pricing, sota, presets];
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

pageTabs.forEach((tab) => {
  tab.addEventListener("click", () => setActivePage(tab.dataset.page));
});

keywordSearch.addEventListener("input", () => {
  activeQuery = keywordSearch.value;
  renderMediaRadar();
  renderPriority();
  renderCategories(activeTab);
});

if (sotaSearch) {
  sotaSearch.addEventListener("input", () => {
    activeSotaQuery = sotaSearch.value;
    renderSota();
  });
}
if (sotaSearchClear) {
  sotaSearchClear.addEventListener("click", () => {
    if (sotaSearch) sotaSearch.value = "";
    activeSotaQuery = "";
    renderSota();
  });
}

clearSearch.addEventListener("click", () => {
  keywordSearch.value = "";
  activeQuery = "";
  latestSourceSearch = null;
  saveCandidates.disabled = true;
  keywordSearch.focus();
  sourceSearchResults.replaceChildren();
  searchStatus.hidden = true;
  searchStatus.textContent = "";
  renderMediaRadar();
  renderPriority();
  renderCategories(activeTab);
});

tickerToggle?.addEventListener("click", () => {
  const paused = document.body.classList.toggle("ticker-paused");
  tickerToggle.setAttribute("aria-pressed", String(paused));
  tickerToggle.textContent = paused ? "AI FLASH PAUSED" : "AI FLASH";
});

tickerLaneButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeTickerLane = button.dataset.tickerLane || "core";
    tickerLaneButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderTicker();
  });
});

sourceSearch.addEventListener("click", async () => {
  const query = keywordSearch.value.trim();
  if (query.length < 2) {
    searchStatus.textContent = "2文字以上のキーワードを入力してください";
    searchStatus.hidden = false;
    keywordSearch.focus();
    return;
  }

  sourceSearch.disabled = true;
  sourceSearch.textContent = "検索中";
  searchStatus.textContent = "許可済み公式ソースを検索しています";
  searchStatus.hidden = false;
  sourceSearchResults.replaceChildren();

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=12`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    const data = await response.json();
    renderSourceResults(data);
    searchStatus.textContent = `保存済みニュース + 公式ソース${data.searchedSources}件を確認`;
    sourceSearchResults.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (error) {
    console.error(error);
    const empty = document.createElement("div");
    empty.className = "source-result-empty";
    empty.textContent = "公式ソース検索に失敗しました。ローカルサーバとネットワーク接続を確認してください。";
    sourceSearchResults.replaceChildren(empty);
    searchStatus.textContent = "公式ソース検索に失敗しました";
  } finally {
    sourceSearch.disabled = false;
    sourceSearch.textContent = "公式ソース検索";
  }
});

saveCandidates.addEventListener("click", async () => {
  if (!latestSourceSearch?.results?.length) return;

  saveCandidates.disabled = true;
  saveCandidates.textContent = "保存中";

  try {
    const response = await fetch("/api/candidates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: latestSourceSearch.query,
        results: latestSourceSearch.results
      })
    });

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }

    const data = await response.json();
    searchStatus.textContent = `記事候補を保存しました: 追加${data.added}件 / 更新${data.updated}件`;
    searchStatus.hidden = false;
  } catch (error) {
    console.error(error);
    searchStatus.textContent = "記事候補の保存に失敗しました";
    searchStatus.hidden = false;
  } finally {
    saveCandidates.disabled = false;
    saveCandidates.textContent = "候補を保存";
  }
});

runUpdate.addEventListener("click", async () => {
  const label = runUpdate.querySelector("span");
  const originalText = label.textContent;
  runUpdate.disabled = true;
  label.textContent = "取得中";
  freshnessLabel.textContent = "取得中";
  freshnessLabel.classList.remove("error");

  try {
    const response = await fetch("/api/update", {
      method: "POST",
      cache: "no-store"
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Update failed: ${response.status}`);
    }

    const promoted = result.summary?.promoted?.promoted ?? 0;
    freshnessLabel.textContent = `更新完了 ${promoted}件`;
    const [newsData, mediaData, officialData, signalData, pricing, sota, presets] = await loadAllData();
    renderApp(newsData, mediaData, officialData, signalData, pricing, sota, presets);
  } catch (error) {
    console.error(error);
    freshnessLabel.textContent = "取得失敗";
    freshnessLabel.classList.add("error");
  } finally {
    label.textContent = originalText;
    runUpdate.disabled = false;
  }
});

loadAllData()
  .then(([newsData, mediaData, officialData, signalData, pricing, sota, presets]) => renderApp(newsData, mediaData, officialData, signalData, pricing, sota, presets))
  .catch(renderLoadError);
