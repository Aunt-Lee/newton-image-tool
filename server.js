const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number(process.env.PORT || 31876);
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, "public");
const DEFAULT_SAVE_DIR = path.join(os.homedir(), "Downloads", "NewtonImageTool");
const SIZE_MAP = {
  "1K": "1024x1024",
  "2K": "2048x2048",
  "4K": "4096x4096"
};

if (typeof fetch !== "function") {
  console.error("Node.js 18 or newer is required because this tool uses built-in fetch().");
  process.exit(1);
}

const mimeByExt = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function normalizeBaseUrl(input) {
  const value = String(input || "https://newtonrouter.com").trim().replace(/\/+$/, "");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Base URL must start with http:// or https://.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function expandHome(input) {
  const value = String(input || "").trim();
  if (!value) return DEFAULT_SAVE_DIR;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function ensureSaveDir(saveDir) {
  const resolved = path.resolve(expandHome(saveDir));
  await fsp.mkdir(resolved, { recursive: true });
  const stat = await fsp.stat(resolved);
  if (!stat.isDirectory()) throw new Error("Save path is not a folder.");
  return resolved;
}

function buildHeaders(apiKey, extraHeaders) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream"
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (extraHeaders && typeof extraHeaders === "object" && !Array.isArray(extraHeaders)) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value !== undefined && value !== null && String(key).trim()) {
        headers[key] = String(value);
      }
    }
  }
  return headers;
}

function parseExtraJson(raw) {
  if (!raw || !String(raw).trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Extra JSON must be an object.");
  }
  return parsed;
}

function deepFindImages(value, found = []) {
  if (!value) return found;

  if (typeof value === "string") {
    findImagesInText(value, found);
    return found;
  }

  if (Array.isArray(value)) {
    for (const item of value) deepFindImages(item, found);
    return found;
  }

  if (typeof value !== "object") return found;

  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (typeof child === "string") {
      if (lower.includes("b64") || lower.includes("base64")) {
        const normalized = normalizeBase64(child);
        if (normalized) found.push({ type: "base64", value: normalized });
      } else if (lower === "url" || lower.endsWith("_url") || lower.includes("image_url")) {
        if (/^https?:\/\//i.test(child)) found.push({ type: "url", value: child });
        findImagesInText(child, found);
      } else {
        findImagesInText(child, found);
      }
    } else {
      deepFindImages(child, found);
    }
  }
  return found;
}

function findImagesInText(text, found) {
  const dataUrlRe = /data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=_-]+)/gi;
  let dataMatch;
  while ((dataMatch = dataUrlRe.exec(text))) {
    found.push({ type: "base64", value: dataMatch[2], mime: `image/${dataMatch[1]}` });
  }

  const urlRe = /https?:\/\/[^\s"'<>)]*\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>)]*)?/gi;
  let urlMatch;
  while ((urlMatch = urlRe.exec(text))) {
    found.push({ type: "url", value: urlMatch[0] });
  }
}

function normalizeBase64(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  const dataUrl = trimmed.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  const value = dataUrl ? dataUrl[1] : trimmed;
  if (value.length < 80) return "";
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) return "";
  return value;
}

function uniqueImageKey(image) {
  if (image.type === "url") return `url:${image.value}`;
  const hash = crypto.createHash("sha1").update(image.value.slice(0, 4096)).digest("hex");
  return `b64:${hash}:${image.value.length}`;
}

function extensionFromMime(mime) {
  const lower = String(mime || "").toLowerCase();
  if (lower.includes("webp")) return ".webp";
  if (lower.includes("jpeg") || lower.includes("jpg")) return ".jpg";
  if (lower.includes("gif")) return ".gif";
  return ".png";
}

function extensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext;
  } catch (_) {}
  return ".png";
}

async function saveImage(image, saveDir, index) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let bytes;
  let ext = ".png";
  let source = image.value;

  if (image.type === "url") {
    const upstream = await fetch(image.value);
    if (!upstream.ok) {
      throw new Error(`Could not download image URL (${upstream.status}).`);
    }
    const arrayBuffer = await upstream.arrayBuffer();
    bytes = Buffer.from(arrayBuffer);
    ext = extensionFromMime(upstream.headers.get("content-type")) || extensionFromUrl(image.value);
  } else {
    bytes = Buffer.from(image.value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    ext = extensionFromMime(image.mime);
    source = `data:image/${ext.slice(1)};base64,${image.value}`;
  }

  const fileName = `gpt-image-2-${stamp}-${String(index).padStart(2, "0")}${ext}`;
  const filePath = path.join(saveDir, fileName);
  await fsp.writeFile(filePath, bytes);
  return {
    fileName,
    filePath,
    bytes: bytes.length,
    previewUrl: `/api/preview?path=${encodeURIComponent(filePath)}`,
    source
  };
}

function buildGenerationPayload(input, size, extra) {
  const body = {
    model: input.model || "gpt-image-2",
    prompt: input.prompt,
    size,
    n: Number(input.count || 1)
  };
  if (input.responseFormat) body.response_format = input.responseFormat;
  return { ...body, ...extra };
}

function buildChatPayload(input, size, extra) {
  const content = [{ type: "text", text: input.prompt }];
  const body = {
    model: input.model || "gpt-image-2",
    stream: true,
    messages: [{ role: "user", content }],
    size
  };
  return { ...body, ...extra, stream: true };
}

async function callGenerations(input) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const saveDir = await ensureSaveDir(input.saveDir);
  const extra = parseExtraJson(input.extraJson);
  const extraHeaders = extra.headers;
  delete extra.headers;

  const size = SIZE_MAP[input.resolution] || SIZE_MAP["1K"];
  const payload = buildGenerationPayload(input, size, extra);
  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: buildHeaders(input.apiKey, extraHeaders),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  if (!response.ok) {
    const detail = json?.error?.message || json?.message || text.slice(0, 800);
    throw new Error(`Generations request failed (${response.status}): ${detail}`);
  }
  if (!json) throw new Error("Generations response was not JSON.");

  const seen = new Set();
  const images = deepFindImages(json).filter(image => {
    const key = uniqueImageKey(image);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const saved = [];
  for (const image of images) {
    saved.push(await saveImage(image, saveDir, saved.length + 1));
  }

  return {
    mode: "generations",
    endpoint: `${baseUrl}/v1/images/generations`,
    request: payload,
    saveDir,
    saved,
    rawText: text
  };
}

async function callChatStream(input, res) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const saveDir = await ensureSaveDir(input.saveDir);
  const extra = parseExtraJson(input.extraJson);
  const extraHeaders = extra.headers;
  delete extra.headers;

  const size = SIZE_MAP[input.resolution] || SIZE_MAP["1K"];
  const payload = buildChatPayload(input, size, extra);
  const endpoint = `${baseUrl}/v1/chat/completions`;
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(input.apiKey, extraHeaders),
    body: JSON.stringify(payload)
  });

  sendSse(res, "meta", { endpoint, saveDir, request: payload });

  if (!upstream.ok) {
    const text = await upstream.text();
    let detail = text.slice(0, 1000);
    try {
      const json = JSON.parse(text);
      detail = json?.error?.message || json?.message || detail;
    } catch (_) {}
    throw new Error(`Chat completions request failed (${upstream.status}): ${detail}`);
  }

  const seen = new Set();
  const saved = [];
  let buffer = "";
  let transcript = "";
  const decoder = new TextDecoder();

  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLines = frame
        .split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim());
      if (!dataLines.length) continue;
      const data = dataLines.join("\n");
      if (data === "[DONE]") {
        sendSse(res, "done", { saved, transcript });
        return;
      }

      let json;
      try {
        json = JSON.parse(data);
      } catch (_) {
        transcript += data;
        sendSse(res, "text", { text: data });
        continue;
      }

      const text = extractText(json);
      if (text) {
        transcript += text;
        sendSse(res, "text", { text });
      }

      const images = deepFindImages(json).filter(image => {
        const key = uniqueImageKey(image);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      for (const image of images) {
        const savedImage = await saveImage(image, saveDir, saved.length + 1);
        saved.push(savedImage);
        sendSse(res, "image", savedImage);
      }
    }
  }

  if (buffer.trim()) {
    try {
      const json = JSON.parse(buffer.trim().replace(/^data:\s*/i, ""));
      const images = deepFindImages(json);
      for (const image of images) {
        const key = uniqueImageKey(image);
        if (!seen.has(key)) {
          seen.add(key);
          const savedImage = await saveImage(image, saveDir, saved.length + 1);
          saved.push(savedImage);
          sendSse(res, "image", savedImage);
        }
      }
    } catch (_) {}
  }
  sendSse(res, "done", { saved, transcript });
}

function extractText(json) {
  const parts = [];
  const choices = Array.isArray(json?.choices) ? json.choices : [];
  for (const choice of choices) {
    const delta = choice.delta || choice.message || {};
    if (typeof delta.content === "string") parts.push(delta.content);
    if (Array.isArray(delta.content)) {
      for (const item of delta.content) {
        if (typeof item === "string") parts.push(item);
        if (typeof item?.text === "string") parts.push(item.text);
      }
    }
  }
  return parts.join("");
}

function chooseFolder() {
  return new Promise((resolve, reject) => {
    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "Choose an image save folder")'],
        { timeout: 120000 },
        (err, stdout) => {
          if (err) {
            if (err.code === 1) resolve("");
            else reject(err);
            return;
          }
          resolve(stdout.trim());
        }
      );
      return;
    }

    if (process.platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$dialog.Description = 'Choose an image save folder'",
        "$dialog.ShowNewFolderButton = $true",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }"
      ].join("; ");
      execFile(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", script],
        { timeout: 120000 },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        }
      );
      return;
    }

    resolve("");
  });
}

function openFolder(targetPath) {
  const folder = path.resolve(expandHome(targetPath || DEFAULT_SAVE_DIR));
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer.exe"
      : "xdg-open";
  const child = spawn(command, [folder], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${HOST}`);
  const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeByExt[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") sendJson(res, 404, { error: "Not found" });
    else sendJson(res, 500, { error: error.message });
  }
}

async function handleApi(req, res) {
  const requestUrl = new URL(req.url, `http://${HOST}`);
  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/config") {
      sendJson(res, 200, {
        defaultBaseUrl: "https://newtonrouter.com",
        defaultSaveDir: DEFAULT_SAVE_DIR,
        sizeMap: SIZE_MAP,
        platform: process.platform
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/check-folder") {
      const input = await readJson(req);
      const saveDir = await ensureSaveDir(input.path);
      sendJson(res, 200, { path: saveDir });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/select-folder") {
      const selected = await chooseFolder();
      sendJson(res, 200, { path: selected });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/open-folder") {
      const input = await readJson(req);
      openFolder(input.path);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/preview") {
      const filePath = path.resolve(expandHome(requestUrl.searchParams.get("path")));
      const data = await fsp.readFile(filePath);
      res.writeHead(200, {
        "Content-Type": mimeByExt[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-store"
      });
      res.end(data);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/generate") {
      const input = await readJson(req);
      const result = await callGenerations(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/chat-stream") {
      const input = await readJson(req);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      try {
        await callChatStream(input, res);
      } catch (error) {
        sendSse(res, "error", { error: error.message });
      } finally {
        res.end();
      }
      return;
    }

    sendJson(res, 404, { error: "Unknown API route." });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

function listen(port) {
  server.once("error", error => {
    if (error.code === "EADDRINUSE" && port < DEFAULT_PORT + 20) {
      listen(port + 1);
      return;
    }
    console.error(error);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}`;
    console.log(`Newton Image Tool is running at ${url}`);
    if (process.env.NO_OPEN !== "1") openUrl(url);
  });
}

function openUrl(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

listen(DEFAULT_PORT);
