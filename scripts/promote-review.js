const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const newsPath = path.join(root, "data", "news.json");
const reviewPath = path.join(root, "data", "review.json");
const candidatesPath = path.join(root, "data", "candidates.json");
const sourcesPath = path.join(root, "data", "sources.json");
const localizedOverridesPath = path.join(root, "data", "localized-overrides.json");

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const replace = args.has("--replace");
const accept = args.has("--accept");
const minPriority = Number(getArg("--min-priority=", "60"));
const maxAgeDays = Number(getArg("--max-age-days=", "30"));

const categoryMeta = {
  "jp-cases": {
    group: "国内",
    title: "AI活用・成果事例",
    accent: "adoption",
    tab: ["all", "japan"]
  },
  "jp-research": {
    group: "国内",
    title: "国産AI・研究・論文",
    accent: "research",
    tab: ["all", "japan", "research"]
  },
  "jp-governance": {
    group: "国内",
    title: "倫理・法規制",
    accent: "governance",
    tab: ["all", "japan", "governance"]
  },
  "global-cases": {
    group: "海外",
    title: "AI活用・成果事例",
    accent: "adoption",
    tab: ["all", "global"]
  },
  "global-research": {
    group: "海外",
    title: "海外AI・研究・モデル",
    accent: "research",
    tab: ["all", "global", "research"]
  },
  "global-governance": {
    group: "海外",
    title: "倫理・法規制",
    accent: "governance",
    tab: ["all", "global", "governance"]
  },
  "product-release": {
    group: "横断",
    title: "新モデル・プロダクト",
    accent: "product",
    tab: ["all", "research"]
  },
  security: {
    group: "横断",
    title: "AIセキュリティ・悪用対策",
    accent: "security",
    tab: ["all", "governance"]
  },
  business: {
    group: "横断",
    title: "ビジネス・投資・M&A",
    accent: "business",
    tab: ["all", "business"]
  },
  infrastructure: {
    group: "横断",
    title: "半導体・クラウド・電力",
    accent: "infrastructure",
    tab: ["all", "business"]
  }
};

const sourceTypeLabels = {
  company_newsroom: "公式発表",
  official_blog: "公式ブログ",
  research_lab: "論文・技術文書",
  research_institute: "論文・技術文書",
  paper_index: "論文・技術文書",
  conference_index: "論文・技術文書",
  government: "公式発表",
  regulator: "公式発表",
  standards_body: "公式文書",
  official_github: "技術文書",
  model_registry: "技術文書"
};

const curatedSummaries = new Map([
  [
    "https://huggingface.co/blog/agentic-resource-discovery-launch",
    "エージェントがツール、スキル、他エージェントを実行時に探索できるようにするAgentic Resource Discovery仕様の紹介。MCP、Skills、A2Aの前段に置かれる発見レイヤーとして、エージェント基盤の標準化動向を見る材料です。"
  ],
  [
    "https://huggingface.co/blog/openenv-agentic-rl",
    "Agentic RL向け実行環境OpenEnvを、複数組織が関わるオープンな運営へ移す発表。エージェント訓練環境の標準化、再現性、オープンソース化に関わる動きとして研究価値があります。"
  ],
  [
    "https://claude.com/solutions/agents",
    "AnthropicがClaudeを使ったAIエージェント活用を整理した公式ページ。個別ニュースというより、エージェント設計、導入時の論点、プロダクト訴求を一次情報として確認する位置づけです。"
  ],
  [
    "https://huggingface.co/blog/ngxson/make-your-own-rag",
    "Hugging Face上のRAG実装入門記事。基礎理解には有用ですが、公開時期が古いため、日次の主要ニュースではなくキーワード調査候補として扱うのが妥当です。"
  ]
]);

function getArg(prefix, fallback) {
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
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

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || ""));
}

function isMostlyEnglish(value) {
  const text = normalizeSpaces(value);
  if (!text) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const japanese = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/gu) || []).length;
  return latin >= 12 && latin > japanese * 2;
}

function sentenceTrim(value, maxLength) {
  const text = normalizeSpaces(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[、。,. ]+$/u, "")}...`;
}

function removeLeadingDuplicate(value, title) {
  const text = normalizeSpaces(value);
  const normalizedTitle = normalizeSpaces(title);

  if (normalizedTitle && text.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
    return normalizeSpaces(text.slice(normalizedTitle.length));
  }

  return text;
}

function cleanExtractedText(value, title = "") {
  return removeLeadingDuplicate(value, title)
    .replace(/-->+/g, " ")
    .replace(/\bRead more\b/gi, " ")
    .replace(/\bread more\b/gi, " ")
    .replace(/メインコンテンツへ移動/g, " ")
    .replace(/Access Japanese single\.php TOP News/gi, " ")
    .replace(/Center for Advanced Intelligence Project/gi, " ")
    .replace(/template-parts\/content-post\.php/gi, " ")
    .replace(/Information Facebook Share X Share/gi, " ")
    .replace(/Log In Sign Up Back to Articles/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakDescription(value) {
  const text = normalizeSpaces(value).toLowerCase();
  if (!text) return true;
  return [
    "a blog post by",
    "join the discussion on this paper page",
    "we're on a journey to advance and democratize artificial intelligence",
    "we’re on a journey to advance and democratize artificial intelligence"
  ].some((pattern) => text.includes(pattern));
}

function displayTitle(item, candidate) {
  const rawTitle = normalizeSpaces(item.title || candidate?.title || item.url);
  const sourceName = normalizeSpaces(item.sourceName || candidate?.sourceName);

  if (sourceName && rawTitle.toLowerCase() === sourceName.toLowerCase()) {
    const description = cleanExtractedText(item.description, rawTitle);
    const excerpt = cleanExtractedText(item.excerpt, rawTitle);
    const replacement = description || excerpt;
    if (replacement) {
      return sentenceTrim(replacement, 96);
    }
  }

  return rawTitle;
}

function titleJaForItem(item, title, existingItem, localizedOverride) {
  const llmTitle = normalizeSpaces(item.llmTitle);
  const overrideTitleJa = normalizeSpaces(localizedOverride?.titleJa);
  const existingTitleJa = normalizeSpaces(existingItem?.titleJa);
  if (!llmTitle && overrideTitleJa) return sentenceTrim(overrideTitleJa, 120);
  if (!llmTitle && existingTitleJa) return sentenceTrim(existingTitleJa, 120);
  if (!llmTitle || hasJapanese(title)) return "";
  if (llmTitle.toLowerCase() === normalizeSpaces(title).toLowerCase()) return "";
  return sentenceTrim(llmTitle, 120);
}

function inferImpact(categoryId) {
  if (categoryId.includes("governance") || categoryId === "security") return "規制インパクト";
  if (categoryId.includes("research")) return "研究価値";
  if (categoryId === "product-release" || categoryId === "infrastructure") return "技術重要度";
  return "社会的影響";
}

function normalizeCategory(categoryId, fallbackCategories) {
  if (categoryMeta[categoryId]) return categoryId;
  return (fallbackCategories || []).find((id) => categoryMeta[id]) || "global-research";
}

function impactNote(categoryId) {
  if (categoryId.includes("governance")) {
    return "規制対応、公共調達、企業ガバナンスへの影響を確認する価値があります。";
  }
  if (categoryId.includes("research")) {
    return "モデル評価、研究テーマ、実装アーキテクチャの変化を見る材料になります。";
  }
  if (categoryId === "product-release") {
    return "プロダクト選定、PoC設計、業務導入ロードマップへの影響を確認したい内容です。";
  }
  if (categoryId === "infrastructure") {
    return "推論基盤、GPU/クラウド調達、エージェント実装環境への影響を確認する材料です。";
  }
  if (categoryId === "security") {
    return "悪用対策、レッドチーム、セキュリティ運用の観点で押さえるべき内容です。";
  }
  return "導入事例、業務変革、AI活用戦略への示唆を確認する価値があります。";
}

function conciseDetail(item, title) {
  const description = cleanExtractedText(item.description, title);
  const excerpt = cleanExtractedText(item.excerpt, title);
  const rawDetail = isWeakDescription(description) ? excerpt : description;
  const detail = sentenceTrim(rawDetail || title, 150);

  if (!detail || detail === title) {
    return sentenceTrim(title, 120);
  }

  return detail;
}

function buildSummary(item, categoryId, title, existingItem, localizedOverride) {
  if (item.llmSummary) {
    return {
      summary: sentenceTrim(normalizeSpaces(item.llmSummary), 170),
      status: "llm-ja"
    };
  }

  if (localizedOverride?.summary) {
    return {
      summary: sentenceTrim(localizedOverride.summary, 170),
      status: "manual-ja"
    };
  }

  if (existingItem?.summary && hasJapanese(existingItem.summary)) {
    return {
      summary: sentenceTrim(existingItem.summary, 170),
      status: existingItem.summaryStatus || "existing-ja"
    };
  }

  if (curatedSummaries.has(item.url)) {
    return {
      summary: sentenceTrim(curatedSummaries.get(item.url), 170),
      status: "curated-ja"
    };
  }

  const detail = conciseDetail(item, title);
  if (hasJapanese(detail) || !isMostlyEnglish(detail)) {
    return {
      summary: sentenceTrim(detail, 170),
      status: hasJapanese(detail) ? "extracted-ja" : "extracted"
    };
  }

  return {
    summary: "日本語要約は未生成です。APIキーを設定して「今すぐ取得」を実行すると、この記事の内容を日本語で要約します。",
    status: "missing-ja-summary"
  };
}

function parseDateFromText(...values) {
  const text = values.map((value) => String(value || "")).join(" ");
  const monthMap = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12"
  };

  const isoMatch = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(Number(isoMatch[2])).padStart(2, "0")}-${String(Number(isoMatch[3])).padStart(2, "0")}`;
  }

  const jpMatch = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (jpMatch) {
    return `${jpMatch[1]}-${String(Number(jpMatch[2])).padStart(2, "0")}-${String(Number(jpMatch[3])).padStart(2, "0")}`;
  }

  const match = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s+(20\d{2})\b/i.exec(text);
  if (!match) return "";
  const month = monthMap[match[1].toLowerCase().replace(".", "")];
  const day = String(Number(match[2])).padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function ageInDays(dateValue, todayValue) {
  if (!dateValue) return 0;
  const itemDate = new Date(`${dateValue}T00:00:00+09:00`);
  const todayDate = new Date(`${todayValue}T00:00:00+09:00`);
  return Math.floor((todayDate - itemDate) / 86400000);
}

function shouldPromote(item, candidate, today) {
  if (item.status !== "needs_review" && item.status !== "accepted") return false;
  if ((item.initialPriority || 0) < minPriority) return false;
  if (isEvergreenOrIndexPage(item, candidate)) return false;

  const publishedDate = parseDateFromText(
    candidate?.publishedDate,
    item.title,
    item.description,
    item.excerpt,
    candidate?.title
  );
  const age = ageInDays(publishedDate, today);

  return Boolean(publishedDate) && age >= 0 && age <= maxAgeDays;
}

function isEvergreenOrIndexPage(item, candidate) {
  const title = normalizeSpaces(item.title || candidate?.title).toLowerCase();
  const urlPath = (() => {
    try {
      return new URL(item.url || candidate?.url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();

  return [
    "カテゴリ別一覧",
    "サステナビリティ報告方針",
    "esg方針",
    "企業・ir",
    "ai saas | pksha"
  ].some((pattern) => title.includes(pattern.toLowerCase())) ||
    /(?:\/category\/|\/tag\/|\/tags\/|\/corp\/ir\/|\/corp\/sustainability\/|\/sustainability\/policy\/|\/ai-saas\/?$)/i.test(urlPath);
}

function toNewsItem(item, candidate, today, existingItem, localizedOverride) {
  const categoryId = normalizeCategory(item.suggestedCategory, item.categories);
  const title = displayTitle(item, candidate);
  const titleJa = titleJaForItem(item, title, existingItem, localizedOverride);
  const summaryResult = buildSummary(item, categoryId, title, existingItem, localizedOverride);
  const publishedDate = parseDateFromText(
    candidate?.publishedDate,
    item.title,
    item.description,
    item.excerpt,
    candidate?.title
  );
  const age = ageInDays(publishedDate, today);
  const date = publishedDate || today;

  return {
    title,
    titleJa,
    summary: summaryResult.summary,
    summaryStatus: summaryResult.status,
    impact: inferImpact(categoryId),
    source: item.sourceName || candidate?.sourceName || "一次情報",
    type: sourceTypeLabels[item.sourceType || candidate?.sourceType] || "一次情報",
    date,
    url: item.url,
    priority: Math.max(1, Math.min(100, Number(item.initialPriority || candidate?.score || 50))),
    scoreBasis: "注目テーマ判定。公開日が今日で、AIエージェント、規制、研究採択、社会実装、基盤モデル、セキュリティなどのAI関連テーマに該当する記事を優先。",
    new: publishedDate === today,
    candidateId: item.candidateId
  };
}

function main() {
  const today = todayInTokyo();
  const news = readJson(newsPath, { generatedDate: today, categories: [] });
  const review = readJson(reviewPath, { schemaVersion: 1, updatedDate: today, items: [] });
  const candidates = readJson(candidatesPath, { schemaVersion: 1, updatedDate: today, items: [] });
  const sources = readJson(sourcesPath, { sources: [] });
  const localizedOverrides = readJson(localizedOverridesPath, {});
  const candidateById = new Map(candidates.items.map((item) => [item.id, item]));
  const existingItemByUrl = new Map(
    (news.categories || []).flatMap((category) => (category.items || []).map((item) => [item.url, item]))
  );
  const enabledSourceIds = new Set(sources.sources.filter((source) => source.enabled).map((source) => source.id));

  const categories = news.categories.map((category) => ({
    ...category,
    ...(categoryMeta[category.id] || {}),
    items: replace ? [] : [...(category.items || [])]
  }));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const promotedIds = new Set();
  let skipped = 0;

  const promotableItems = review.items
    .filter((item) => {
      const candidate = candidateById.get(item.candidateId);
      const sourceId = item.sourceId || candidate?.sourceId;
      if (sourceId && !enabledSourceIds.has(sourceId)) {
        skipped += 1;
        return false;
      }
      const ok = shouldPromote(item, candidate, today);
      if (!ok) skipped += 1;
      return ok;
    })
    .sort((a, b) => (b.initialPriority || 0) - (a.initialPriority || 0));

  for (const item of promotableItems) {
    const candidate = candidateById.get(item.candidateId);
    const categoryId = normalizeCategory(item.suggestedCategory, item.categories);
    const category = categoryById.get(categoryId);
    if (!category || category.items.length >= 3) continue;

    const duplicate = categories.some((entry) =>
      (entry.items || []).some((newsItem) => newsItem.url === item.url)
    );
    if (duplicate) continue;

    category.items.push(toNewsItem(item, candidate, today, existingItemByUrl.get(item.url), localizedOverrides[item.url]));
    promotedIds.add(item.candidateId);
  }

  for (const category of categories) {
    category.items = (category.items || [])
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, 3);
  }

  const nextNews = {
    generatedDate: today,
    categories
  };

  if (accept) {
    for (const item of review.items) {
      if (promotedIds.has(item.candidateId) && item.status === "needs_review") {
        item.status = "accepted";
        item.acceptedAt = new Date().toISOString();
      }
    }

    for (const item of candidates.items) {
      if (promotedIds.has(item.id)) {
        item.status = "accepted";
        item.acceptedAt = new Date().toISOString();
      }
    }
  }

  review.updatedDate = today;
  candidates.updatedDate = today;

  console.log(`${write ? "Promote review write" : "Promote review dry-run"}: promoted ${promotedIds.size}, skipped ${skipped}, categories ${categories.length}`);

  if (write) {
    writeJson(newsPath, nextNews);
    if (accept) {
      writeJson(reviewPath, review);
      writeJson(candidatesPath, candidates);
    }
  }
}

main();
