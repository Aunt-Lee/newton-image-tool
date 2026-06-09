const els = {
  apiKey: document.querySelector("#apiKey"),
  baseUrl: document.querySelector("#baseUrl"),
  saveDir: document.querySelector("#saveDir"),
  resolutionPreset: document.querySelector("#resolutionPreset"),
  resolution: document.querySelector("#resolution"),
  prompt: document.querySelector("#prompt"),
  extraJson: document.querySelector("#extraJson"),
  generate: document.querySelector("#generate"),
  checkStreaming: document.querySelector("#checkStreaming"),
  chooseDir: document.querySelector("#chooseDir"),
  clearResults: document.querySelector("#clearResults"),
  clearLog: document.querySelector("#clearLog"),
  gallery: document.querySelector("#gallery"),
  log: document.querySelector("#log"),
  statusText: document.querySelector("#statusText"),
  serverState: document.querySelector("#serverState")
};

const state = {
  mode: "chat",
  resolution: "1024x1024",
  busy: false,
  resultCount: 0,
  hasLocalApi: window.location.protocol !== "file:"
};
const LOCAL_APP_URL = "http://127.0.0.1:31880/";
const DEFAULT_BASE_URL = "https://image.newtonrouter.com";
const LEGACY_BASE_URL = "https://newtonrouter.com";
const ALLOWED_RESOLUTIONS = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
  "auto"
];

function normalizeResolutionValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ALLOWED_RESOLUTIONS.includes(normalized) ? normalized : ALLOWED_RESOLUTIONS[0];
}

function getSavedBaseUrl(fallback = DEFAULT_BASE_URL) {
  const saved = localStorage.getItem("newton.baseUrl");
  if (!saved || saved === LEGACY_BASE_URL) {
    localStorage.setItem("newton.baseUrl", fallback);
    return fallback;
  }
  return saved;
}

init();

async function init() {
  bindSegmented("[data-mode]", "mode");
  bindEvents();
  restoreSettings();

  if (!state.hasLocalApi) {
    els.baseUrl.value = getSavedBaseUrl(DEFAULT_BASE_URL);
    els.saveDir.value = localStorage.getItem("newton.saveDir") || "";
    els.serverState.textContent = "静态";
    setStatus("请通过启动脚本打开工具");
    logLine("当前是 file:// 预览模式，目录选择、生成和保存功能需要通过本地启动脚本打开。");
    return;
  }

  try {
    const config = await apiGet("/api/config");
    els.baseUrl.value = getSavedBaseUrl(config.defaultBaseUrl);
    els.saveDir.value = localStorage.getItem("newton.saveDir") || "";
    els.serverState.textContent = config.platform === "win32" ? "Windows" : config.platform === "darwin" ? "macOS" : "本地";
    logLine("已连接。");
  } catch (error) {
    setStatus("连接失败");
    logLine(`错误：${error.message}`);
  }
}

function bindSegmented(selector, key) {
  document.querySelectorAll(selector).forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(selector).forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      state[key] = button.dataset[key];
      localStorage.setItem(`newton.${key}`, state[key]);
    });
  });
}

function bindEvents() {
  els.generate.addEventListener("click", generate);
  els.checkStreaming.addEventListener("click", checkStreamingCapability);
  els.chooseDir.addEventListener("click", chooseDir);
  els.clearResults.addEventListener("click", clearResults);
  els.clearLog.addEventListener("click", () => {
    els.log.textContent = "";
  });
  els.resolutionPreset.addEventListener("change", () => {
    els.resolution.value = els.resolutionPreset.value;
    state.resolution = els.resolution.value.trim();
    localStorage.setItem("newton.resolution", state.resolution);
  });
  const syncResolutionInput = () => {
    const value = els.resolution.value.trim().toLowerCase();
    const matchedPreset = Array.from(els.resolutionPreset.options).find(option => option.value === value);
    state.resolution = matchedPreset ? matchedPreset.value : normalizeResolutionValue(state.resolution);
    els.resolutionPreset.value = state.resolution;
    localStorage.setItem("newton.resolution", state.resolution);
  };
  els.resolution.addEventListener("change", syncResolutionInput);
  els.resolution.addEventListener("input", syncResolutionInput);

  ["apiKey", "baseUrl", "saveDir"].forEach(key => {
    els[key].addEventListener("change", () => localStorage.setItem(`newton.${key}`, els[key].value));
  });
}

function restoreSettings() {
  for (const key of ["apiKey", "baseUrl", "saveDir"]) {
    const value = localStorage.getItem(`newton.${key}`);
    if (value) els[key].value = value;
  }

  const savedMode = localStorage.getItem("newton.mode");
  if (savedMode) {
    const button = document.querySelector(`[data-mode="${savedMode}"]`);
    if (button) button.click();
  }

  const savedResolution = localStorage.getItem("newton.resolution");
  if (savedResolution) {
    state.resolution = normalizeResolutionValue(savedResolution);
    els.resolution.value = state.resolution;
    els.resolutionPreset.value = state.resolution;
  } else {
    els.resolution.value = state.resolution;
    els.resolutionPreset.value = state.resolution;
  }
}

async function chooseDir() {
  if (!state.hasLocalApi) {
    setStatus("正在打开本地工具...");
    logLine("当前页面是 file:// 预览模式，正在尝试切换到本地运行地址，以便使用文件夹选择器。");
    window.location.href = LOCAL_APP_URL;
    return;
  }

  setStatus("正在打开文件夹选择器...");
  try {
    const result = await apiPost("/api/select-folder", {});
    if (result.path) {
      els.saveDir.value = result.path;
      localStorage.setItem("newton.saveDir", result.path);
      setStatus("已选择保存目录");
      logLine(`保存目录：${result.path}`);
    } else {
      setStatus("已取消选择");
    }
  } catch (error) {
    setStatus("无法打开文件夹选择器");
    logLine(`错误：${error.message}`);
  }
}

async function generate() {
  if (state.busy) return;
  if (!state.hasLocalApi) {
    setStatus("正在打开本地工具...");
    logLine("当前页面是 file:// 预览模式，正在尝试切换到本地运行地址，以便生成并保存图片。");
    window.location.href = LOCAL_APP_URL;
    return;
  }

  if (!els.saveDir.value.trim()) {
    setStatus("请先选择保存位置");
    logLine("请先点击“...”选择保存位置。");
    return;
  }

  const payload = collectPayload();
  if (!payload.apiKey) {
    setStatus("请先填写 API 密钥");
    els.apiKey.focus();
    return;
  }
  if (!payload.prompt) {
    setStatus("请先填写提示词");
    els.prompt.focus();
    return;
  }
  payload.resolution = payload.resolution.toLowerCase();
  if (!ALLOWED_RESOLUTIONS.includes(payload.resolution)) {
    setStatus("请选择可用尺寸");
    logLine("可用尺寸为：1024x1024、1536x1024、1024x1536、2048x2048、2048x1152、3840x2160、2160x3840、auto。");
    els.resolution.focus();
    return;
  }

  setBusy(true);
  localStorage.setItem("newton.apiKey", payload.apiKey);
  localStorage.setItem("newton.baseUrl", payload.baseUrl);
  localStorage.setItem("newton.saveDir", payload.saveDir);

  try {
    if (state.mode === "chat") {
      await runChatStream(payload);
    } else {
      await runGenerations(payload);
    }
  } catch (error) {
    setStatus("生成失败");
    logLine(`错误：${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function checkStreamingCapability() {
  if (!state.hasLocalApi) {
    setStatus("正在打开本地工具...");
    logLine("当前页面是 file:// 预览模式，正在尝试切换到本地运行地址，以便检测流式能力。");
    window.location.href = LOCAL_APP_URL;
    return;
  }

  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    setStatus("请先填写 API 密钥");
    els.apiKey.focus();
    return;
  }

  setStatus("正在检测流式能力...");
  els.checkStreaming.disabled = true;
  try {
    const result = await apiPost("/api/check-streaming", {
      apiKey,
      baseUrl: els.baseUrl.value.trim() || DEFAULT_BASE_URL,
      extraJson: els.extraJson.value.trim(),
      resolution: els.resolution.value.trim() || state.resolution
    });

    if (result.supported) {
      setStatus("支持流式");
      logLine(`流式检测成功：${result.detail}`);
    } else {
      setStatus("暂不支持流式");
      logLine(`流式检测结果：${result.detail}`);
    }
  } catch (error) {
    setStatus("流式检测失败");
    logLine(`错误：${error.message}`);
  } finally {
    els.checkStreaming.disabled = false;
  }
}

function collectPayload() {
  return {
    apiKey: els.apiKey.value.trim(),
    baseUrl: els.baseUrl.value.trim() || DEFAULT_BASE_URL,
    saveDir: els.saveDir.value.trim(),
    prompt: els.prompt.value.trim(),
    extraJson: els.extraJson.value.trim(),
    mode: state.mode,
    resolution: els.resolution.value.trim() || state.resolution
  };
}

async function runGenerations(payload) {
  setStatus("正在生成图片...");
  logLine(`已提交图片生成请求，尺寸：${payload.resolution}。`);
  const result = await apiPost("/api/generate", payload);
  if (result.request?.size) {
    logLine(`服务端实际发送尺寸：${result.request.size}`);
  }
  logLine(`已保存 ${result.saved.length} 张图片。`);
  if (!result.saved.length) {
    logLine("本次返回中没有可保存的图片，请检查参数后再试。");
  }
  result.saved.forEach(addImageCard);
  setStatus(result.saved.length ? `完成：${result.saved.length} 张图片` : "请求完成，但未找到图片");
}

async function runChatStream(payload) {
  setStatus("正在生成图片...");
  logLine(`已提交实时生成请求，尺寸：${payload.resolution}。`);
  const response = await fetch("/api/chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok || !response.body) {
    throw new Error(`本地服务返回 ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let savedCount = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseFrame(frame);
      if (!event) continue;
      if (event.event === "meta") {
        logLine(`保存目录：${event.data.saveDir}`);
        if (event.data.request?.size) {
          logLine(`服务端实际发送尺寸：${event.data.request.size}`);
        }
      } else if (event.event === "text" && event.data.text) {
        logInline(event.data.text);
      } else if (event.event === "image") {
        savedCount += 1;
        addImageCard(event.data);
        setStatus(`已保存 ${savedCount} 张图片，流式响应仍在继续...`);
      } else if (event.event === "error") {
        throw new Error(event.data.error || "流式请求失败");
      } else if (event.event === "done") {
        const total = event.data.saved?.length || savedCount;
        logLine(`\n处理完成，已保存 ${total} 张图片。`);
        if (event.data.note) {
          logLine(event.data.note);
        }
        if (!total && event.data.debug) {
          const { frameCount, textChunkCount, imageCount, sampleKeys, contentTypes } = event.data.debug;
          logLine(
            `流式诊断：frames=${frameCount || 0}，text=${textChunkCount || 0}，images=${imageCount || 0}，keys=${(sampleKeys || []).join(", ") || "none"}，contentTypes=${(contentTypes || []).join(", ") || "none"}`
          );
        }
        if (!total && event.data.transcript) {
          const preview = String(event.data.transcript).replace(/\s+/g, " ").trim().slice(0, 240);
          if (preview) {
            logLine(`返回文本预览：${preview}`);
          }
        }
        setStatus(total ? `完成：${total} 张图片` : "流式响应结束，但未找到图片");
      }
    }
  }
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const eventLine = lines.find(line => line.startsWith("event:"));
  const dataLines = lines.filter(line => line.startsWith("data:"));
  if (!eventLine || !dataLines.length) return null;
  const event = eventLine.slice(6).trim();
  const data = JSON.parse(dataLines.map(line => line.slice(5).trim()).join("\n"));
  return { event, data };
}

function addImageCard(image) {
  if (els.gallery.classList.contains("empty")) {
    els.gallery.classList.remove("empty");
    els.gallery.textContent = "";
  }
  state.resultCount += 1;

  const card = document.createElement("article");
  card.className = "image-card";

  const img = document.createElement("img");
  img.src = `${image.previewUrl}&t=${Date.now()}`;
  img.alt = image.fileName || `generated image ${state.resultCount}`;

  const meta = document.createElement("div");
  meta.className = "image-meta";

  const title = document.createElement("strong");
  title.textContent = image.fileName || `image-${state.resultCount}`;

  const pathLine = document.createElement("code");
  pathLine.textContent = image.filePath || "";

  const actions = document.createElement("div");
  actions.className = "image-actions";

  const download = document.createElement("a");
  download.href = image.previewUrl;
  download.download = image.fileName || "gpt-image-2.png";
  download.textContent = "下载";

  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "打开目录";
  open.addEventListener("click", () => openDir(els.saveDir.value));

  actions.append(download, open);
  meta.append(title, pathLine, actions);
  card.append(img, meta);
  els.gallery.prepend(card);
}

function clearResults() {
  state.resultCount = 0;
  els.gallery.className = "gallery empty";
  els.gallery.innerHTML = '<div class="empty-state"><strong>还没有图片</strong><span>生成成功后会自动保存到指定目录，并在这里预览。</span></div>';
}

async function openDir(path) {
  if (!state.hasLocalApi) {
    setStatus("正在打开本地工具...");
    logLine("当前页面是 file:// 预览模式，正在尝试切换到本地运行地址。");
    window.location.href = LOCAL_APP_URL;
    return;
  }

  try {
    await apiPost("/api/open-folder", { path });
  } catch (error) {
    logLine(`错误：${error.message}`);
  }
}

function setBusy(isBusy) {
  state.busy = isBusy;
  els.generate.disabled = isBusy;
  els.generate.textContent = isBusy ? "处理中..." : "生成并保存";
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function logLine(text) {
  const stamp = new Date().toLocaleTimeString();
  els.log.textContent += `[${stamp}] ${text}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function logInline(text) {
  els.log.textContent += text;
  els.log.scrollTop = els.log.scrollHeight;
}

async function apiGet(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
