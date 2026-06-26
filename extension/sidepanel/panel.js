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
    const systemPrompt = `你是一个浏览器助手。一次性规划所有步骤并发出所有指令。

规则：
- 用户说"截图"才截图，否则只操作不截图
- 每个指令独立放在 <TOOL></TOOL> 中
- 所有指令一次发出，不要分步
- 完成后回复 ✅ 完成

示例：打开网页搜索并截图：
<TOOL>navigate|url</TOOL>
<TOOL>fill|#s|关键词</TOOL>
<TOOL>pressKey|Enter</TOOL>
<TOOL>wait|2000</TOOL>
<TOOL>screenshot</TOOL>

当前 URL: ${pageInfo.url}`

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ];

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ];

    setStatus("🤔 AI 规划中...");
    const result = await chrome.runtime.sendMessage({ action: "callAI", messages });
    if (!result.success) {
      addMessage("system", `❌ ${result.error}`);
      setStatus("❌ 出错", "error");
      return;
    }

    const aiText = result.text;

    const toolRegex = /<TOOL>([\s\S]*?)<\/TOOL>/g;
    const tools = [];
    let m;
    while ((m = toolRegex.exec(aiText)) !== null) tools.push(m[1].trim());

    if (tools.length === 0) {
      addMessage("ai", aiText);
      setStatus("✅ 完成", "");
      return;
    }

    setStatus(`⏳ 执行 ${tools.length} 个步骤...`);
    const results = [];
    const images = [];
    for (let i = 0; i < tools.length; i++) {
      const toolCmd = tools[i];
      setStatus(`⏳ (${i + 1}/${tools.length}) ${toolCmd.split("|")[0]}...`);
      const r = await executeToolCommand(toolCmd);
      results.push(`[${toolCmd}] ${r.text.replace(/<[^>]*>/g, "").trim()}`);
      if (r.imageUrl) images.push(r.imageUrl);
    }

    const displayText = aiText.replace(/<TOOL>[\s\S]*?<\/TOOL>/g, "").trim();
    if (displayText) addMessage("ai", displayText.replace(/\n/g, "<br>"));

    for (const imgUrl of images) {
      const imgDiv = document.createElement("div");
      imgDiv.innerHTML = `<img src="${imgUrl}" style="max-width:100%;border-radius:6px;margin:4px 0;box-shadow:0 2px 8px rgba(0,0,0,0.1)">`;
      chatMessages.appendChild(imgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

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
 * 返回 { text, imageUrl }
 */
async function executeToolCommand(cmd) {
  try {
    const parts = cmd.split("|").map((s) => s.trim());
    const action = parts[0];
    const params = parts.slice(1);

    switch (action) {
      case "screenshot": {
        const r = await chrome.runtime.sendMessage({ action: "screenshot", tabId: currentTabId });
        if (r.success) return { text: "✅ 截图成功", imageUrl: r.dataUrl };
        return { text: `❌ 截图失败: ${r.error}` };
      }
      case "click":
      case "rightClick": {
        const r = await chrome.runtime.sendMessage({ action, tabId: currentTabId, selector: params[0], text: params[1] });
        return { text: `${r.success ? "✅" : "❌"} ${action}: ${params[0] || params[1]}` };
      }
      case "fill": {
        const r = await chrome.runtime.sendMessage({ action: "fill", tabId: currentTabId, selector: params[0], value: params.slice(1).join("|") });
        return { text: `${r.success ? "✅" : "❌"} 填写 ${params[0]}` };
      }
      case "clear": {
        const r = await chrome.runtime.sendMessage({ action: "clear", tabId: currentTabId, selector: params[0] });
        return { text: `${r.success ? "✅" : "❌"} 清空 ${params[0]}` };
      }
      case "hover": {
        const r = await chrome.runtime.sendMessage({ action: "hover", tabId: currentTabId, selector: params[0], text: params[1] });
        return { text: `${r.success ? "✅" : "❌"} 悬停` };
      }
      case "highlight": {
        const r = await chrome.runtime.sendMessage({ action: "highlight", tabId: currentTabId, selector: params[0], text: params[1] });
        return { text: `${r.success ? "✨" : "❌"} 高亮` };
      }
      case "pressKey": {
        const r = await chrome.runtime.sendMessage({ action: "pressKey", tabId: currentTabId, key: params[0] || "Enter" });
        return { text: `${r.success ? "✅" : "❌"} 按键: ${params[0] || "Enter"}` };
      }
      case "select": {
        const r = await chrome.runtime.sendMessage({ action: "select", tabId: currentTabId, selector: params[0], value: params[1] });
        return { text: `${r.success ? "✅" : "❌"} 选择` };
      }
      case "extract": {
        const r = await chrome.runtime.sendMessage({ action: "extract", tabId: currentTabId, selector: params[0] || undefined });
        return { text: r.success ? `📄 ${(r.text || "").slice(0, 500)}` : `❌ ${r.error}` };
      }
      case "getLinks": {
        const r = await chrome.runtime.sendMessage({ action: "getLinks", tabId: currentTabId });
        if (r.success) {
          const count = (r.links || []).length;
          const samples = (r.links || []).slice(0, 10).map((l) => `${l.text || "无文本"}: ${l.href}`).join("\n");
          return { text: `🔗 ${count} 个链接:\n${samples}` };
        }
        return { text: `❌ ${r.error}` };
      }
      case "getImages": {
        const r = await chrome.runtime.sendMessage({ action: "getImages", tabId: currentTabId });
        if (r.success) {
          const counts = (r.images || []).map((img) => `${img.alt || "无alt"} (${img.width}×${img.height})`).join("\n");
          return { text: `🖼️ ${(r.images || []).length} 张图片:\n${counts}` };
        }
        return { text: `❌ ${r.error}` };
      }
      case "getTable": {
        const r = await chrome.runtime.sendMessage({ action: "getTable", tabId: currentTabId, selector: params[0] || undefined });
        if (r.success) {
          const headers = (r.headers || []).join(" | ");
          const rows = (r.data || []).slice(0, 5).map((row) => Object.values(row).join(" | ")).join("\n");
          return { text: `📊 ${(r.data || []).length} 行\n${headers}\n${rows}` };
        }
        return { text: `❌ ${r.error}` };
      }
      case "getFormFields": {
        const r = await chrome.runtime.sendMessage({ action: "getFormFields", tabId: currentTabId, selector: params[0] || undefined });
        if (r.success) {
          const fields = (r.fields || []).map((f) => `${f.name || f.selector} (${f.type})`).join("\n");
          return { text: `📝 表单字段:\n${fields}` };
        }
        return { text: `❌ ${r.error}` };
      }
      case "scroll": {
        await chrome.runtime.sendMessage({ action: "scroll", tabId: currentTabId, direction: params[0], amount: parseInt(params[1]) || 500 });
        return { text: `✅ 滚动 ${params[0]}` };
      }
      case "reload": {
        await chrome.runtime.sendMessage({ action: "reload", tabId: currentTabId });
        return { text: "✅ 刷新页面" };
      }
      case "back": {
        await chrome.runtime.sendMessage({ action: "back", tabId: currentTabId });
        return { text: "✅ 后退" };
      }
      case "forward": {
        await chrome.runtime.sendMessage({ action: "forward", tabId: currentTabId });
        return { text: "✅ 前进" };
      }
      case "navigate": {
        const r = await chrome.runtime.sendMessage({ action: "navigate", tabId: currentTabId, url: params[0] });
        return { text: `${r.success ? "✅ 已跳转到" : "❌"} ${params[0]}` };
      }
      case "getUrl": {
        const r = await chrome.runtime.sendMessage({ action: "getUrl" });
        return { text: `🔗 ${r.url || r.error}` };
      }
      case "getTitle": {
        const r = await chrome.runtime.sendMessage({ action: "getTitle" });
        return { text: `📌 ${r.title || r.error}` };
      }
      case "evaluate": {
        const r = await chrome.runtime.sendMessage({ action: "evaluate", tabId: currentTabId, code: params[0] });
        return { text: r.success ? `结果: ${r.result}` : `❌ ${r.error}` };
      }
      case "wait": {
        await chrome.runtime.sendMessage({ action: "wait", ms: parseInt(params[0]) || 2000 });
        return { text: `⏱️ 等待 ${params[0] || 2000}ms` };
      }
      default:
        return { text: `⚠️ 未知指令: ${action}` };
    }
  } catch (err) {
    return { text: `❌ 执行出错: ${err.message}` };
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
