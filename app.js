let today = "";
let categories = [];
let mediaItems = [];
let mediaCategories = [];
let officialItems = [];
let officialDataVendors = [];
let officialShownUrls = new Set();
let aiSignals = [];

const dataPath = "data/news.json";
const mediaPath = "data/media-news.json";
const officialPath = "data/official-news.json";
const signalPath = "data/ai-signals.json";
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
const tickerTrack = document.querySelector("#tickerTrack");
const tickerToggle = document.querySelector("#tickerToggle");
const tickerLaneButtons = Array.from(document.querySelectorAll(".ticker-lane"));

let activeTab = "all";
let activeQuery = "";
let latestSourceSearch = null;
let activeTickerLane = "core";

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
  const important = sorted.filter((item) => Number(item.relevanceScore || 0) >= 2);
  const count = Math.min(Math.max(3, important.length), 4, sorted.length);
  return sorted.slice(0, count);
}

const tickerSignalDefs = {
  core: [
    {
      label: "新モデル/weights",
      query: "モデル OR weights OR OpenAI OR Claude OR Gemini",
      pattern: /新モデル|weights|重み|モデル|OpenAI|Claude|Gemini|Midjourney|画像生成|動画生成|音声/i,
      tone: "green",
      importance: "H"
    },
    {
      label: "API/価格/ライセンス",
      query: "API 価格 ライセンス",
      pattern: /API|価格|料金|有料プラン|ライセンス|商用|規約|pricing|license/i,
      tone: "amber",
      importance: "H"
    },
    {
      label: "SOTA/ベンチ",
      query: "SOTA ベンチ 性能 評価",
      pattern: /SOTA|ベンチ|benchmark|性能|評価|ランキング|score|leaderboard/i,
      tone: "blue",
      importance: "H"
    },
    {
      label: "OSS/GitHub",
      query: "OSS GitHub オープンソース",
      pattern: /OSS|GitHub|オープンソース|公開|リポジトリ|repository|open source/i,
      tone: "green",
      importance: "H"
    },
    {
      label: "Agent標準/MCP",
      query: "AIエージェント MCP RAG Context",
      pattern: /エージェント|agent|MCP|RAG|Context|Copilot|ワークフロー|自動化/i,
      tone: "blue",
      importance: "H"
    }
  ],
  fde: [
    {
      label: "FDE",
      query: "FDE",
      pattern: /\bFDE\b/i,
      tone: "amber",
      importance: "H"
    },
    {
      label: "Agent実装/RAG",
      query: "AIエージェント RAG Context IT運用",
      pattern: /エージェント|agent|RAG|Context|IT運用|障害対応|ワークフロー|自動化/i,
      tone: "blue",
      importance: "H"
    },
    {
      label: "推論速度/TTFT",
      query: "TTFT レイテンシ 推論速度",
      pattern: /TTFT|レイテンシ|推論速度|latency|inference|速度/i,
      tone: "green",
      importance: "M"
    },
    {
      label: "API/価格",
      query: "API 価格 有料プラン",
      pattern: /API|価格|料金|有料プラン|pricing/i,
      tone: "amber",
      importance: "H"
    }
  ],
  research: [
    {
      label: "論文/研究",
      query: "論文 研究 arXiv",
      pattern: /論文|研究|arXiv|paper|学会|CVPR|ICML|NeurIPS/i,
      tone: "blue",
      importance: "H"
    },
    {
      label: "ベンチ更新",
      query: "ベンチ SOTA 性能 評価",
      pattern: /ベンチ|SOTA|benchmark|性能|評価|leaderboard/i,
      tone: "green",
      importance: "H"
    },
    {
      label: "モデル公開",
      query: "モデル weights オープンソース",
      pattern: /モデル|weights|重み|オープンソース|公開|foundation model/i,
      tone: "amber",
      importance: "H"
    }
  ],
  consult: [
    {
      label: "規制/法判断",
      query: "AI 規制 著作権 法律 ガバナンス",
      pattern: /規制|法規制|法律|著作権|プライバシ|個人情報|ガバナンス|regulation|copyright|privacy/i,
      tone: "amber",
      importance: "H"
    },
    {
      label: "PoC→本番/導入",
      query: "AI 導入 事例 PoC 本番",
      pattern: /導入|事例|PoC|本番|企業|業務|活用|実装/i,
      tone: "green",
      importance: "H"
    },
    {
      label: "生産性/業務時間",
      query: "生成AI 業務時間 生産性",
      pattern: /業務時間|生産性|効率|削減|人材|競争力/i,
      tone: "blue",
      importance: "M"
    }
  ]
};

function signalMatches(item, definition) {
  return definition.pattern.test(`${item.title} ${item.summary} ${item.category} ${item.source}`);
}

function buildTickerSignals(items, lane) {
  const definitions = tickerSignalDefs[lane] || tickerSignalDefs.core;
  return definitions.map((definition) => {
    const matches = items.filter((item) => signalMatches(item, definition));
    return {
      ...definition,
      count: matches.length,
      topSource: matches[0]?.source || "",
      delta: matches.length > 0 ? `24h +${matches.length}` : "変化なし"
    };
  });
}

function renderTicker() {
  if (!tickerTrack) return;

  const todayItems = mediaItems.filter((item) => item.date === today);
  if (!todayItems.length) {
    tickerTrack.textContent = "本日のAI速報はまだ取得されていません。今すぐ取得で更新してください。";
    return;
  }

  const signals = buildTickerSignals(todayItems, activeTickerLane);

  const buildSegment = () => {
    const fragment = document.createDocumentFragment();
    signals.forEach((signal, index) => {
      const item = document.createElement("button");
      item.className = `ticker-item ticker-${signal.tone}`;
      item.type = "button";
      item.disabled = signal.count === 0;
      item.title = signal.count
        ? `${signal.label}: ${signal.delta}${signal.topSource ? ` / ${signal.topSource}` : ""}`
        : `${signal.label}: 本日は未検出`;
      item.addEventListener("click", () => applyTickerQuery(signal.query));

      const key = document.createElement("strong");
      key.textContent = signal.label;
      const value = document.createElement("span");
      value.textContent = signal.delta;
      const importance = document.createElement("em");
      importance.textContent = signal.importance;

      item.append(importance, key, value);
      fragment.append(item);

      if (index < signals.length - 1) {
        const separator = document.createElement("span");
        separator.className = "ticker-separator";
        separator.textContent = "/";
        fragment.append(separator);
      }
    });
    return fragment;
  };

  tickerTrack.replaceChildren(buildSegment(), buildSegment());
}

function applyTickerQuery(query) {
  if (!query) return;
  keywordSearch.value = query;
  activeQuery = query;
  renderMediaRadar();
  renderPriority();
  renderCategories(activeTab);
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

function tickerTag(item) {
  const text = `${item.title} ${item.summary}`;
  if (/\bFDE\b|Forward Deployed/i.test(text)) return "FDE";
  if (/SOTA|ベンチ|benchmark/i.test(text)) return "SOTA";
  if (/規制|著作権|ガバナンス|プライバシー|CISO/i.test(text)) return "Risk";
  if (/エージェント|Copilot|RAG|作業代行|自動化/i.test(text)) return "Agent";
  if (/GPU|クラウド|Cloud|AWS|半導体|スパコン/i.test(text)) return "Infra";
  if (/モデル|LLM|Midjourney|動画|画像AI|AI for Science/i.test(text)) return "Model";
  return "AI";
}

function tickerTone(item) {
  const accent = item.accent || item.categoryId;
  if (accent === "security" || item.categoryId === "regulation") return "red";
  if (accent === "research" || item.categoryId === "models") return "blue";
  if (accent === "business" || item.categoryId === "fde") return "amber";
  return "green";
}

function buildTickerMessage(item) {
  if (item.text) return item.text;
  const cleanTitle = String(item.title || "").replace(/\s+/g, " ").trim();
  const meta = `${formatDate(item.date)} / ${item.source}`;
  return `${cleanTitle} / ${meta}`;
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
      ? [...signalCandidates.slice(0, 6), ...officialCandidates.slice(0, 5), ...mediaCandidates.slice(0, 5)]
      : [...mediaCandidates, ...officialCandidates, ...signalCandidates]
  ).slice(0, 12);

  if (!candidates.length) {
    tickerTrack.textContent = "検証済みのAI速報はまだ取得されていません。今すぐ取得で更新してください。";
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
      tag.textContent = entry.tag || tickerTag(entry);
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
}

function renderMediaRadar() {
  const filtered = mediaItems
    .filter((item) => itemMatchesQuery(item, activeQuery))
    .sort(mediaSort);

  if (mediaFreshness) {
    const todayCount = mediaItems.filter((item) => item.date === today).length;
    const recentCount = mediaItems.length;
    mediaFreshness.textContent = todayCount
      ? `本日公開 ${todayCount}件 / 検証済み ${recentCount}件`
      : `検証済み ${recentCount}件`;
    mediaFreshness.classList.toggle("stale", recentCount === 0);
    mediaFreshness.classList.toggle("good", recentCount > 0);
  }

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state load-error";
    empty.textContent = activeQuery
      ? "速報記事に一致するものはありません。検索語を変えてください。"
      : "検証済みのメディア速報はまだ取得されていません。「今すぐ取得」で更新してください。";
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
      empty.textContent = "本日のFDE関連ニュースは未検出です。検出され次第ここに表示します。";
      list.append(empty);
    } else {
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
  fragment.querySelector(".media-source").textContent = `${item.source} / ${formatDate(item.date)}`;
  fragment.querySelector("h3").textContent = item.title;
  fragment.querySelector("p").textContent = item.summary;

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
  return;

  const topItems = collectItems()
    .filter((item) => itemMatchesQuery(item, activeQuery))
    .sort((a, b) => Number(b.new) - Number(a.new) || b.date.localeCompare(a.date) || b.priority - a.priority)
    .slice(0, 6);

  if (topItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state load-error";
    empty.textContent = "該当する一次情報はありません。上段の速報で今日の動きを確認し、必要に応じて公式ソース検索を使ってください。";
    priorityList.replaceChildren(empty);
    return;
  }

  priorityList.replaceChildren(
    ...topItems.map((item) => {
      const link = document.createElement("a");
      link.className = "priority-card";
      link.dataset.accent = item.categoryAccent;
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noreferrer";

      const score = document.createElement("div");
      score.className = "priority-score";
      const category = document.createElement("span");
      category.textContent = `${item.new ? "本日" : "直近"} ${formatDate(item.date)} / ${item.impact}`;
      const pill = document.createElement("span");
      pill.className = "score-pill";
      pill.textContent = item.new ? "New" : "直近";
      score.append(category, pill);

      const body = document.createElement("div");
      const title = document.createElement("h3");
      appendTitle(title, item);
      const summary = document.createElement("p");
      summary.textContent = item.summary;
      body.append(title, summary);

      const impact = document.createElement("div");
      impact.className = "impact-row";
      const type = document.createElement("span");
      type.className = "impact-label";
      type.textContent = item.type;
      const source = document.createElement("span");
      source.className = "source-name";
      source.textContent = item.source;
      impact.append(type, source);

      link.append(score, body, impact);
      return link;
    })
  );
}

function renderNewsCard(item, accent) {
  const fragment = newsTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".news-card");
  card.href = item.url;
  card.dataset.accent = accent;
  card.classList.toggle("is-new", item.new);
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

function renderCategories(nextTab = "all") {
  let matchedItemCount = 0;
  const visible = categories
    .filter((category) => category.tab.includes(nextTab))
    .map((category) => {
      const items = diversifyBySource(
        category.items.filter((item) => itemMatchesQuery(item, activeQuery) && !officialShownUrls.has(item.url))
      );
      matchedItemCount += items.length;
      return { ...category, items };
    })
    .filter((category) => !activeQuery || category.items.length > 0);

  categoryGrid.replaceChildren(
    ...visible.map((category) => {
      const fragment = categoryTemplate.content.cloneNode(true);
      const column = fragment.querySelector(".category-column");
      column.dataset.accent = category.accent;
      const hasToday = category.items.some((item) => item.date === today);
      const status = fragment.querySelector(".status-chip");

      fragment.querySelector(".category-group").textContent = category.group;
      fragment.querySelector("h3").textContent = category.title;
      status.textContent = hasToday ? "本日更新" : category.items.length ? "前回分" : "未取得";
      status.classList.add(hasToday ? "good" : "stale");

      const list = fragment.querySelector(".news-list");
      if (category.items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "本日の一次情報は未検出です。速報枠に今日のメディア記事を表示します。";
        list.append(empty);
      } else {
        category.items.slice(0, 3).forEach((item) => list.append(renderNewsCard(item, category.accent)));
      }

      return column;
    })
  );

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state load-error";
    empty.textContent = "該当する保存済みニュースはありません。上段の速報、または公式ソース検索を確認してください。";
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

function renderApp(newsData, mediaData, officialData, signalData) {
  today = newsData.generatedDate || mediaData.generatedDate || officialData.generatedDate || signalData.generatedDate;
  categories = newsData.categories || [];
  mediaItems = mediaData.items || [];
  mediaCategories = mediaData.categories || [];
  officialItems = officialData.items || [];
  officialDataVendors = officialData.vendors || [];
  aiSignals = signalData.items || [];
  todayLabel.textContent = formatFullDate(today);
  freshnessLabel.textContent = "自動収集中";
  freshnessLabel.classList.remove("error");
  renderMetrics();
  renderTicker();
  renderMediaRadar();
  renderPriority();
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
  const [newsData, mediaData, officialData, signalData] = await Promise.all([
    loadJson(dataPath),
    loadJson(mediaPath, { generatedDate: "", items: [] }),
    loadJson(officialPath, { generatedDate: "", vendors: [], items: [] }),
    loadJson(signalPath, { generatedDate: "", items: [] })
  ]);
  return [newsData, mediaData, officialData, signalData];
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

keywordSearch.addEventListener("input", () => {
  activeQuery = keywordSearch.value;
  renderMediaRadar();
  renderPriority();
  renderCategories(activeTab);
});

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
    const [newsData, mediaData, officialData, signalData] = await loadAllData();
    renderApp(newsData, mediaData, officialData, signalData);
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
  .then(([newsData, mediaData, officialData, signalData]) => renderApp(newsData, mediaData, officialData, signalData))
  .catch(renderLoadError);
