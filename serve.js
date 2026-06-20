const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const logPath = path.join(root, "server-runtime.log");
let updateProcess = null;

function logRuntime(message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

process.on("uncaughtException", (error) => {
  logRuntime(`uncaughtException: ${error.stack || error.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logRuntime(`unhandledRejection: ${error?.stack || error}`);
  process.exit(1);
});

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(response, status, body) {
  send(response, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function readJson(relativePath, fallback) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return fallback;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function writeJson(relativePath, data) {
  const absolutePath = path.join(root, relativePath);
  fs.writeFileSync(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function tokenMatches(text, token) {
  if (!token) return false;

  if (/^[a-z0-9-]+$/i.test(token) && token.length <= 4) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  }

  return text.includes(token);
}

function tokenizeQuery(query) {
  return normalizeText(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreCandidate(candidate, tokens) {
  const title = normalizeText(candidate.title);
  const url = normalizeText(candidate.url);
  const source = normalizeText(candidate.sourceName);
  let score = 0;

  for (const token of tokens) {
    if (tokenMatches(title, token)) score += 6;
    if (tokenMatches(source, token)) score += 2;
    if (tokenMatches(url, token)) score += 1;
  }

  return score;
}

function extractCandidatesFromHtml(html, source, query) {
  const tokens = tokenizeQuery(query);
  const candidates = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = decodeEntities(match[1]);
    const title = stripTags(match[2]);

    if (!href || !title || title.length < 8) continue;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;

    const absoluteUrl = new URL(href, source.url).href;
    const candidate = {
      title,
      url: absoluteUrl,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.sourceType,
      categories: source.categories,
      trustLevel: source.trustLevel
    };
    const score = scoreCandidate(candidate, tokens);

    if (score > 0) {
      candidates.push({ ...candidate, score });
    }
  }

  return candidates;
}

async function fetchSourceHtml(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "AI-News-Catchup/0.1"
      }
    });

    if (!response.ok) {
      return { ok: false, source, status: response.status, candidates: [] };
    }

    return {
      ok: true,
      source,
      status: response.status,
      html: await response.text()
    };
  } catch (error) {
    return { ok: false, source, status: "ERROR", error: error.message, candidates: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSearch(requestUrl, response) {
  const query = requestUrl.searchParams.get("q") || "";
  const limit = Math.min(Number(requestUrl.searchParams.get("limit") || 12), 20);

  if (query.trim().length < 2) {
    sendJson(response, 400, { error: "Query must be at least 2 characters." });
    return;
  }

  const sources = JSON.parse(fs.readFileSync(path.join(root, "data", "sources.json"), "utf8"));
  const searchSources = sources.sources
    .filter((source) => source.enabled && source.fetchMethod === "html")
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .slice(0, limit);

  const fetched = await Promise.all(searchSources.map(fetchSourceHtml));
  const deduped = new Map();

  for (const result of fetched) {
    if (!result.ok) continue;
    const candidates = extractCandidatesFromHtml(result.html, result.source, query);

    for (const candidate of candidates) {
      const existing = deduped.get(candidate.url);
      if (!existing || candidate.score > existing.score) {
        deduped.set(candidate.url, candidate);
      }
    }
  }

  const results = Array.from(deduped.values())
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 20);

  sendJson(response, 200, {
    query,
    searchedSources: searchSources.length,
    skippedSources: sources.sources.filter((source) => source.enabled && source.fetchMethod !== "html").length,
    results
  });
}

async function handleCandidates(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = await readRequestBody(request);
  const payload = JSON.parse(body || "{}");
  const results = Array.isArray(payload.results) ? payload.results : [];
  const candidates = readJson("data/candidates.json", {
    schemaVersion: 1,
    updatedDate: new Date().toISOString().slice(0, 10),
    items: []
  });
  const byUrl = new Map(candidates.items.map((item) => [item.url, item]));
  let added = 0;
  let updated = 0;

  for (const result of results) {
    if (!result.url || !result.title) continue;

    const now = new Date().toISOString();
    const existing = byUrl.get(result.url);
    const item = {
      id: crypto.createHash("sha256").update(result.url).digest("hex").slice(0, 24),
      query: payload.query || "",
      title: result.title,
      url: result.url,
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      sourceType: result.sourceType,
      categories: result.categories || [],
      trustLevel: result.trustLevel,
      score: result.score || 0,
      status: existing?.status && existing.status !== "expired" ? existing.status : "candidate",
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now
    };

    if (byUrl.has(result.url)) {
      updated += 1;
    } else {
      added += 1;
    }

    byUrl.set(result.url, item);
  }

  candidates.updatedDate = new Date().toISOString().slice(0, 10);
  candidates.items = Array.from(byUrl.values()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  writeJson("data/candidates.json", candidates);
  sendJson(response, 200, { added, updated, total: candidates.items.length });
}

function runDailyUpdate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/daily-update.js"], {
      cwd: root,
      windowsHide: true
    });
    updateProcess = child;
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      updateProcess = null;
      resolve({ code, stdout, stderr });
    });
  });
}

async function handleUpdate(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (updateProcess) {
    sendJson(response, 409, { error: "Daily update is already running." });
    return;
  }

  const startedAt = new Date().toISOString();
  logRuntime("manual daily update started");
  const result = await runDailyUpdate();
  const ok = result.code === 0;
  const collectMatch = /Saved candidates: added=(\d+), updated=(\d+), total=(\d+)/.exec(result.stdout);
  const prepareMatch = /Prepare review write: prepared (\d+), failed (\d+), total (\d+)/.exec(result.stdout);
  const promoteMatch = /Promote review write: promoted (\d+), skipped (\d+), categories (\d+)/.exec(result.stdout);

  logRuntime(`manual daily update finished code=${result.code}`);
  sendJson(response, ok ? 200 : 500, {
    ok,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.code,
    summary: {
      candidates: collectMatch
        ? { added: Number(collectMatch[1]), updated: Number(collectMatch[2]), total: Number(collectMatch[3]) }
        : null,
      review: prepareMatch
        ? { prepared: Number(prepareMatch[1]), failed: Number(prepareMatch[2]), total: Number(prepareMatch[3]) }
        : null,
      promoted: promoteMatch
        ? { promoted: Number(promoteMatch[1]), skipped: Number(promoteMatch[2]), categories: Number(promoteMatch[3]) }
        : null
    },
    stdoutTail: result.stdout.split(/\r?\n/).slice(-20).join("\n"),
    stderrTail: result.stderr.split(/\r?\n/).slice(-20).join("\n")
  });
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requestPath = decoded === "/" ? "/index.html" : decoded;
  const absolutePath = path.resolve(root, `.${requestPath}`);

  if (!absolutePath.startsWith(root)) {
    return null;
  }

  return absolutePath;
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/search") {
    try {
      await handleSearch(requestUrl, response);
    } catch (error) {
      logRuntime(`search error: ${error.stack || error.message}`);
      sendJson(response, 500, { error: "Search failed." });
    }
    return;
  }

  if (requestUrl.pathname === "/api/candidates") {
    try {
      await handleCandidates(request, response);
    } catch (error) {
      logRuntime(`candidate save error: ${error.stack || error.message}`);
      sendJson(response, 500, { error: "Candidate save failed." });
    }
    return;
  }

  if (requestUrl.pathname === "/api/update") {
    try {
      await handleUpdate(request, response);
    } catch (error) {
      updateProcess = null;
      logRuntime(`manual update error: ${error.stack || error.message}`);
      sendJson(response, 500, { error: "Manual update failed." });
    }
    return;
  }

  const absolutePath = resolveRequestPath(request.url || "/");

  if (!absolutePath) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, body) => {
    if (error) {
      send(response, error.code === "ENOENT" ? 404 : 500, error.code || "Server error");
      return;
    }

    send(response, 200, body, contentTypes[path.extname(absolutePath)] || "application/octet-stream");
  });
});

server.listen(port, "127.0.0.1", () => {
  const message = `AI News Catchup running at http://localhost:${port}/`;
  logRuntime(message);
  console.log(message);
});

server.on("error", (error) => {
  logRuntime(`server error: ${error.stack || error.message}`);
  process.exit(1);
});
