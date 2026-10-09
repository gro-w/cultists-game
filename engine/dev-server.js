/* eslint-env node */
/**
 * dev-server.js — local development server for the project root (Phase 1).
 *
 * Serves the project root as static files and exposes a write-only JSON API scoped to
 * the project-relative directory declared by #data-location. Binds to 127.0.0.1 only
 * — this is a local dev tool, not a production server, and must never be
 * exposed publicly (plan §3.2).
 *
 * The dev server never serves data back out through /api/ — developer-mode
 * tools must read game data the same way the game itself does (a normal
 * static fetch() of data/..., e.g. via DataLoader), not through this API.
 * This API exists purely so a developer can persist edits to disk. Remote or
 * out-of-project data URLs remain readable but are not writable through it.
 *
 * Usage:
 *   node engine/dev-server.js [--port 8000]
 *   Then open: http://127.0.0.1:8000/
 *
 * API surface (all under /api/):
 *   POST /api/file?f=<name> → validates JSON body, then atomically
 *                             writes <configured-data-root>/<name>, creating it (and any
 *                             missing parent directories under the configured root) if it
 *                             does not already exist, or overwriting it
 *                             atomically if it does.
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(path.dirname(fs.realpathSync(__filename)), "..");
const DEFAULT_PORT = 8000;
const HOST = "127.0.0.1";

const port = (() => {
  const idx = process.argv.indexOf("--port");
  if (idx !== -1 && process.argv[idx + 1]) {
    const parsed = Number(process.argv[idx + 1]);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_PORT;
})();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** Resolve the page-selected local data root, never assuming a fixed `data/`. */
function resolveConfiguredDataDirectory(referer) {
  let htmlPath = path.join(ROOT, "index.html");
  if (referer) {
    let pageUrl;
    try { pageUrl = new URL(referer, `http://${HOST}:${port}`); } catch { return null; }
    if (pageUrl.origin !== `http://${HOST}:${port}`) return null;
    let pathname;
    try { pathname = decodeURIComponent(pageUrl.pathname); } catch { return null; }
    const pagePath = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
    const pageRelative = path.relative(ROOT, pagePath);
    if (pageRelative.startsWith("..") || path.isAbsolute(pageRelative)) return null;
    try {
      if (fs.statSync(pagePath).isDirectory()) htmlPath = path.join(pagePath, "index.html");
      else htmlPath = pagePath;
    } catch { return null; }
  }
  let html;
  try { html = fs.readFileSync(htmlPath, "utf8"); } catch { return null; }
  const match = html.match(/<div\s+id=["']data-location["']\s*>([^<]*)<\/div>/i);
  if (!match) return null;
  let configuredPath;
  try { configuredPath = decodeURIComponent(match[1].trim()); } catch { return null; }
  if (!configuredPath || /^[a-z][a-z0-9+.-]*:/i.test(configuredPath) || path.isAbsolute(configuredPath)) return null;
  const resolved = path.resolve(path.dirname(htmlPath), configuredPath);
  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

/** Resolve `name` inside the data root selected by the referring page. */
function resolveDataFile(name, request) {
  const dataDir = resolveConfiguredDataDirectory(request.headers.referer);
  if (!dataDir || typeof name !== "string" || !name || name.includes("\0")) return null;
  const resolved = path.resolve(dataDir, name);
  const relative = path.relative(dataDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, "Bad request", "text/plain");
  }
  const relative = decodedPathname === "/" ? "index.html" : decodedPathname.slice(1);
  const filePath = path.resolve(ROOT, relative);
  if (path.relative(ROOT, filePath).startsWith("..")) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || "application/octet-stream");
  });
}

function handleApi(req, res, pathname, query) {
  if (pathname === "/api/file" && req.method === "POST") {
    const filePath = resolveDataFile(query.f, req);
    if (!filePath) {
      return send(res, 400, JSON.stringify({ error: "invalid or unknown file name" }));
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        JSON.parse(body);
      } catch {
        return send(res, 400, JSON.stringify({ error: "invalid JSON" }));
      }
      fs.mkdir(path.dirname(filePath), { recursive: true }, (mkdirErr) => {
        if (mkdirErr) return send(res, 500, JSON.stringify({ error: "write failed" }));
        const tmpPath = `${filePath}.tmp`;
        fs.writeFile(tmpPath, body, (writeErr) => {
          if (writeErr) return send(res, 500, JSON.stringify({ error: "write failed" }));
          fs.rename(tmpPath, filePath, (renameErr) => {
            if (renameErr) return send(res, 500, JSON.stringify({ error: "write failed" }));
            send(res, 200, JSON.stringify({ ok: true }));
          });
        });
      });
    });
    return;
  }

  send(res, 404, JSON.stringify({ error: "unknown API route" }));
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${HOST}`);
  const pathname = requestUrl.pathname;
  const query = Object.fromEntries(requestUrl.searchParams);
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname, query);
  serveStatic(req, res, pathname);
});

server.listen(port, HOST, () => {
  console.log(`ng dev server listening on http://${HOST}:${port}/`);
});
