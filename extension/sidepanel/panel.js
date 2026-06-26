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

  const { settings } = await chrome.runtime.sendMessage({ action: "getSettings" });
  if (!settings.apiKey) {
    addMessage("system", "请先在 ⚙️ 设置页配置 API Key");
    switchTab("settings");
    return;
  }

  chatInput.value = "";
  addMessage("user", text);
  setStatus("🤔 AI 思考中...", "info");
  chatSend.disabled = true;

  try {
    const pageInfo = await getCurrentTabInfo();
    const systemPrompt = `你是 AI Test Agent，一个浏览器自动化测试助手。

当前页面信息：
- URL: ${pageInfo.url}
- Title: ${pageInfo.title}

你可以使用以下工具来操作浏览器。当你需要执行操作时，在回复中插入下方格式的指令：

截图当前页面：<TOOL>screenshot</TOOL>
点击元素：<TOOL>click|.selector</TOOL> 或 <TOOL>click||登录</TOOL>
填写输入框：<TOOL>fill|#username|admin</TOOL>
提取文字：<TOOL>extract</TOOL> 或 <TOOL>extract|.article</TOOL>
滚动页面：<TOOL>scroll|down|500</TOOL> 或 <TOOL>scroll|top</TOOL>
跳转页面：<TOOL>navigate|https://example.com</TOOL>
执行 JS：<TOOL>evaluate|document.title</TOOL>
获取 URL：<TOOL>getUrl</TOOL>
获取标题：<TOOL>getTitle</TOOL>

示例回复：
"我来帮你截图当前页面：
<TOOL>screenshot</TOOL>
截图完成！"`;

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

    // 解析并执行 AI 回复中的工具指令
    const aiText = result.text;
    const toolRegex = /<TOOL>([\s\S]*?)<\/TOOL>/g;
    let match;
    let lastIdx = 0;
    let finalText = "";

    while ((match = toolRegex.exec(aiText)) !== null) {
      // 添加工具指令前的文本
      finalText += aiText.slice(lastIdx, match.index);
      lastIdx = toolRegex.lastIndex;

      const toolCmd = match[1].trim();
      finalText += await executeToolCommand(toolCmd);
    }
    finalText += aiText.slice(lastIdx);

    addMessage("ai", finalText);
    setStatus("✅ 完成", "");
  } catch (err) {
    addMessage("system", `❌ ${err.message}`);
    setStatus("❌ 出错", "error");
  } finally {
    chatSend.disabled = false;
  }
}

/**
 * 执行 AI 发出的工具指令
 * 格式: action|param1|param2 或 action
 */
async function executeToolCommand(cmd) {
  try {
    const parts = cmd.split("|").map((s) => s.trim());
    const action = parts[0];
    const params = parts.slice(1);

    switch (action) {
      case "screenshot": {
        const r = await chrome.runtime.sendMessage({ action: "screenshot", tabId: currentTabId });
        if (r.success) {
          return `<div class="tool-result">✅ 截图成功</div><img src="${r.dataUrl}" style="max-width:100%;border-radius:4px;margin:4px 0">`;
        }
        return `<div class="tool-result">❌ 截图失败: ${r.error}</div>`;
      }
      case "click": {
        const r = await chrome.runtime.sendMessage({ action: "click", tabId: currentTabId, selector: params[0], text: params[1] });
        return `<div class="tool-result">${r.success ? "✅" : "❌"} 点击: ${params[0] || params[1]} ${r.success ? "成功" : r.error}</div>`;
      }
      case "fill": {
        const r = await chrome.runtime.sendMessage({ action: "fill", tabId: currentTabId, selector: params[0], value: params.slice(1).join("|") });
        return `<div class="tool-result">${r.success ? "✅" : "❌"} 填写 ${params[0]} ${r.success ? "成功" : r.error}</div>`;
      }
      case "extract": {
        const r = await chrome.runtime.sendMessage({ action: "extract", tabId: currentTabId, selector: params[0] || undefined });
        return `<div class="tool-result">${r.success ? `📄 ${(r.text || "").slice(0, 500)}` : `❌ ${r.error}`}</div>`;
      }
      case "scroll": {
        const r = await chrome.runtime.sendMessage({ action: "scroll", tabId: currentTabId, direction: params[0], amount: parseInt(params[1]) || 500 });
        return `<div class="tool-result">✅ 滚动 ${params[0]}</div>`;
      }
      case "navigate": {
        const r = await chrome.runtime.sendMessage({ action: "navigate", tabId: currentTabId, url: params[0] });
        return `<div class="tool-result">${r.success ? "✅" : "❌"} 跳转: ${params[0]}</div>`;
      }
      case "getUrl": {
        const r = await chrome.runtime.sendMessage({ action: "getUrl" });
        return `<div class="tool-result">🔗 ${r.url || r.error}</div>`;
      }
      case "getTitle": {
        const r = await chrome.runtime.sendMessage({ action: "getTitle" });
        return `<div class="tool-result">📌 ${r.title || r.error}</div>`;
      }
      case "evaluate": {
        const r = await chrome.runtime.sendMessage({ action: "evaluate", tabId: currentTabId, code: params[0] });
        return `<div class="tool-result">${r.success ? `结果: ${r.result}` : `❌ ${r.error}`}</div>`;
      }
      default:
        return `<div class="tool-result">⚠️ 未知指令: ${action}</div>`;
    }
  } catch (err) {
    return `<div class="tool-result">❌ 执行出错: ${err.message}</div>`;
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
            // 后台打开新标签页显示截图
            chrome.tabs.create({ url: "about:blank" }, (tab) => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, {
                  action: "showImage",
                  dataUrl: result.dataUrl,
                });
              }, 300);
            });
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
