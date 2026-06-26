/**
 * AI Test Agent — Side Panel 主逻辑
 */

// ==================== DOM 引用 ====================

const $ = (id) => document.getElementById(id);
const chatMessages = $("chatMessages");
const chatInput = $("chatInput");
const chatSend = $("chatSend");
const statusBar = $("statusBar");
const toolResult = $("toolResult");

// 当前标签页 ID
let currentTabId = null;

// ==================== 初始化 ====================

async function init() {
  // 获取当前标签页
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) currentTabId = tabs[0].id;
  } catch {}

  // 加载设置
  const { settings } = await chrome.runtime.sendMessage({ action: "getSettings" });
  if (settings.apiKey) $("apiKey").value = settings.apiKey;
  if (settings.apiProvider) $("apiProvider").value = settings.apiProvider;
  if (settings.apiModel) $("apiModel").value = settings.apiModel;
}

// ==================== 标签切换 ====================

document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    const tabId = btn.dataset.tab;
    document.getElementById(`tab-${tabId}`).classList.add("active");
  });
});

// ==================== 聊天功能 ====================

chatSend.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // 读取设置
  const { settings } = await chrome.runtime.sendMessage({ action: "getSettings" });
  if (!settings.apiKey) {
    addMessage("system", "请先在设置页配置 API Key");
    switchTab("settings");
    return;
  }

  chatInput.value = "";
  addMessage("user", text);
  setStatus("🤔 AI 思考中...", "info");
  chatSend.disabled = true;

  try {
    // 构建系统提示词
    const systemPrompt = `你是 AI Test Agent，一个浏览器自动化测试助手。
你通过调用浏览器工具来完成任务。当前页面信息：
- URL: ${(await getCurrentTabInfo()).url}
- Title: ${(await getCurrentTabInfo()).title}

可用工具（通过 chrome.runtime.sendMessage 调用）：
1. screenshot → 截图当前页面
2. click(selector) / click(selector, text) → 点击元素
3. fill(selector, value) → 填写输入框
4. extract(selector) → 提取文字
5. scroll(direction, amount) → 滚动
6. navigate(url) → 跳转页面
7. evaluate(code) → 执行 JS

回复格式：先说明要做什么，然后调用对应工具。`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ];

    const result = await chrome.runtime.sendMessage({
      action: "callAI",
      messages,
    });

    if (!result.success) {
      addMessage("system", `❌ ${result.error}`);
      setStatus("❌ 出错", "error");
      return;
    }

    addMessage("ai", result.text);
    setStatus("✅ 完成", "");
  } catch (err) {
    addMessage("system", `❌ ${err.message}`);
    setStatus("❌ 出错", "error");
  } finally {
    chatSend.disabled = false;
  }
}

async function getCurrentTabInfo() {
  try {
    const tab = await chrome.tabs.get(currentTabId);
    return { url: tab.url, title: tab.title };
  } catch {
    return { url: "未知", title: "未知" };
  }
}

function addMessage(type, content) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;

  if (type === "tool") {
    div.innerHTML = `<div class="tool-result">${content}</div>`;
  } else {
    div.innerHTML = content.replace(/\n/g, "<br>");
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function switchTab(tabName) {
  document.querySelector(`[data-tab="${tabName}"]`).click();
}

function setStatus(text, type) {
  statusBar.textContent = text;
  statusBar.className = "status" + (type ? ` ${type}` : "");
}

// ==================== 工具按钮 ====================

document.querySelectorAll(".tool-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.action;
    toolResult.style.display = "none";
    setStatus(`⏳ 执行 ${action}...`, "info");

    try {
      let result;
      switch (action) {
        case "screenshot":
          result = await chrome.runtime.sendMessage({ action: "screenshot", tabId: currentTabId });
          if (result.success) {
            showResult(`✅ 截图成功 (${result.dataUrl.length} bytes)`);
            // 在新标签页显示图片
            const img = window.open().document;
            img.write(`<img src="${result.dataUrl}" style="max-width:100%">`);
          }
          break;
        case "getUrl":
          result = await chrome.runtime.sendMessage({ action: "getUrl" });
          showResult(`当前 URL: ${result.url}`);
          break;
        case "extract":
          result = await chrome.runtime.sendMessage({ action: "extract" });
          showResult(result.text?.slice(0, 2000) || "无内容");
          break;
        case "getTitle":
          result = await chrome.runtime.sendMessage({ action: "getTitle" });
          showResult(`标题: ${result.title}`);
          break;
        case "scrollDown":
          result = await chrome.runtime.sendMessage({
            action: "scroll",
            direction: "down",
            amount: 500,
          });
          showResult("已向下滚动 500px");
          break;
        case "scrollTop":
          result = await chrome.runtime.sendMessage({
            action: "scroll",
            direction: "top",
          });
          showResult("已回到顶部");
          break;
      }
      setStatus("✅ 完成", "");
    } catch (err) {
      showResult(`❌ ${err.message}`);
      setStatus("❌ 出错", "error");
    }
  });
});

function showResult(text) {
  toolResult.style.display = "block";
  const pre = toolResult.querySelector("pre");
  pre.textContent = text;
}

// ==================== 设置功能 ====================

// 切换提供商时自动填充 API 地址
const DEFAULT_API_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  custom: "http://localhost:11434/v1",
};

$("apiProvider").addEventListener("change", () => {
  $("apiUrl").value = DEFAULT_API_URLS[$("apiProvider").value] || "";
  // 自定义时聚焦地址输入框提示用户修改
  if ($("apiProvider").value === "custom") $("apiUrl").focus();
});

// 输入 Key 后自动加载模型列表
let keyTimer = null;
$("apiKey").addEventListener("input", () => {
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => {
    if ($("apiKey").value.trim().length > 10) fetchModels();
  }, 800);
});

// 刷新模型按钮
$("fetchModelsBtn").addEventListener("click", fetchModels);

async function fetchModels() {
  const provider = $("apiProvider").value;
  const apiKey = $("apiKey").value.trim();
  const apiUrl = $("apiUrl").value.trim();

  if (!apiKey) {
    $("settingsStatus").textContent = "⚠️ 请先输入 API Key";
    return;
  }

  $("settingsStatus").textContent = "⏳ 加载模型列表...";
  const select = $("apiModel");

  try {
    let models = [];

    if (provider === "openai") {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("API Key 无效");
      const data = await resp.json();
      models = data.data
        .filter((m) => m.id.startsWith("gpt") || m.id.startsWith("o"))
        .map((m) => m.id)
        .sort();
    } else if (provider === "anthropic") {
      // Anthropic 模型列表相对固定，预置常用模型
      models = [
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
      ];
    } else if (provider === "custom") {
      const baseUrl = (apiUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
      // 如果地址已经包含 /chat/completions，替换为 /models
      const modelUrl = baseUrl.includes("/chat/completions")
        ? baseUrl.replace("/chat/completions", "/models")
        : `${baseUrl}/models`;
      const resp = await fetch(modelUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("无法获取模型列表，请检查 API 地址和 Key");
      const data = await resp.json();
      models = (data.data || []).map((m) => m.id).sort();
    }

    if (models.length === 0) {
      $("settingsStatus").textContent = "⚠️ 未找到可用模型";
      return;
    }

    // 更新下拉框
    select.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    // 默认选中第一个
    if (models.length > 0) select.value = models[0];

    $("settingsStatus").textContent = `✅ 已加载 ${models.length} 个模型`;
    setTimeout(() => { $("settingsStatus").textContent = ""; }, 3000);
  } catch (err) {
    $("settingsStatus").textContent = `❌ ${err.message}`;
    // 允许手动输入模型名
    select.innerHTML = `<option value="">点击加载或输入...</option>`;
    select.setAttribute("type", "text");
  }
}

$("saveSettings").addEventListener("click", async () => {
  const settings = {
    apiKey: $("apiKey").value.trim(),
    apiProvider: $("apiProvider").value,
    apiModel: $("apiModel").value.trim(),
    apiUrl: $("apiUrl").value.trim(),
  };

  if (!settings.apiKey) {
    $("settingsStatus").textContent = "⚠️ 请输入 API Key";
    return;
  }

  await chrome.runtime.sendMessage({ action: "saveSettings", settings });
  $("settingsStatus").textContent = "✅ 设置已保存";
  setTimeout(() => { $("settingsStatus").textContent = ""; }, 2000);
});

// ==================== 启动 ====================

init();
