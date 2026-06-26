/**
 * AI Test Agent — Background Service Worker
 *
 * 核心职责：
 *   1. 管理侧面板（点击工具栏图标打开）
 *   2. 处理标签页通信
 *   3. 执行页面操作（截图、点击、填表等）
 *   4. 管理 AI API 调用
 */

// ==================== 初始化 ====================

// 安装时打开侧面板
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// 点击工具栏图标 → 打开侧面板
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ==================== 页面操作 API ====================

// 透传 content-script 的操作列表
const PASS_THROUGH_ACTIONS = [
  "click", "rightClick", "fill", "clear", "hover", "highlight",
  "pressKey", "select", "extract", "scroll", "evaluate",
  "getLinks", "getImages", "getTable", "getFormFields",
  "getHtml", "showImage", "screenshotElement",
  "explore",
];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request.action];
  if (handler) {
    handler(request, sender).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // 透传到 content-script
  if (PASS_THROUGH_ACTIONS.includes(request.action)) {
    sendToTab(request.tabId, request).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

const handlers = {
  // --- 导航 ---
  async navigate(req) {
    const tab = await chrome.tabs.update(req.tabId || (await getActiveTab()).id, {
      url: req.url,
    });
    return { success: true, url: tab.url };
  },

  async getUrl(req) {
    const tab = await chrome.tabs.get(req.tabId || (await getActiveTab()).id);
    return { success: true, url: tab.url };
  },

  async getTitle(req) {
    const tab = await chrome.tabs.get(req.tabId || (await getActiveTab()).id);
    return { success: true, title: tab.title };
  },

  async reload(req) {
    const tabId = req.tabId || (await getActiveTab()).id;
    await chrome.tabs.reload(tabId);
    return { success: true };
  },

  async back(req) {
    const tabId = req.tabId || (await getActiveTab()).id;
    await chrome.tabs.goBack(tabId);
    return { success: true };
  },

  async forward(req) {
    const tabId = req.tabId || (await getActiveTab()).id;
    await chrome.tabs.goForward(tabId);
    return { success: true };
  },

  async wait(req) {
    const ms = req.ms || 2000;
    await new Promise((r) => setTimeout(r, ms));
    return { success: true };
  },

  // --- 截图 ---
  async screenshot(req) {
    let tabId = req.tabId || (await getActiveTab()).id;
    // captureVisibleTab 需要 windowId，从 tab 获取
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { success: true, dataUrl };
  },

  // --- 页面交互（通过 content-script） ---
  async click(req) {
    return sendToTab(req.tabId, { action: "click", ...req });
  },

  async fill(req) {
    return sendToTab(req.tabId, { action: "fill", ...req });
  },

  async extract(req) {
    return sendToTab(req.tabId, { action: "extract", ...req });
  },

  async scroll(req) {
    return sendToTab(req.tabId, { action: "scroll", ...req });
  },

  async evaluate(req) {
    return sendToTab(req.tabId, { action: "evaluate", ...req });
  },

  async getHtml(req) {
    return sendToTab(req.tabId, { action: "getHtml", ...req });
  },

  // --- 标签页管理 ---
  async getTabs() {
    const tabs = await chrome.tabs.query({});
    return {
      success: true,
      tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
    };
  },

  async switchTab(req) {
    await chrome.tabs.update(req.tabId, { active: true });
    await chrome.windows.update((await chrome.tabs.get(req.tabId)).windowId, { focused: true });
    return { success: true };
  },

  // --- AI API ---
  async callAI(req) {
    const settings = await chrome.storage.local.get(["apiKey", "apiProvider", "apiModel", "apiUrl"]);
    const apiKey = req.apiKey || settings.apiKey;
    const provider = req.provider || settings.apiProvider || "openai";
    const apiUrl = req.apiUrl || settings.apiUrl || "";
    const model = req.model || settings.apiModel || "";

    if (!apiKey) {
      return { success: false, error: "请先设置 API Key（在侧面板设置页）" };
    }

    try {
      const result = await callAIAPI(provider, apiKey, req.messages, model, apiUrl, BROWSER_TOOLS);
      return { success: true, text: result.text || "", toolCalls: result.toolCalls || [] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // --- 设置 ---
  async saveSettings(req) {
    await chrome.storage.local.set(req.settings);
    return { success: true };
  },

  async getSettings() {
    const settings = await chrome.storage.local.get(["apiKey", "apiProvider", "apiModel", "apiUrl"]);
    return { success: true, settings };
  },

  // --- 执行测试用例 ---
  async runTest(req) {
    const steps = req.steps || [];
    const results = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const result = await handlers[step.action]({ ...step, tabId: req.tabId });
        results.push({ step: i + 1, name: step.name || `Step ${i + 1}`, success: result.success, data: result });
      } catch (err) {
        results.push({ step: i + 1, name: step.name || `Step ${i + 1}`, success: false, error: err.message });
      }
    }
    return { success: true, results };
  },
};

// ==================== 辅助函数 ====================

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("没有找到活动标签页");
  return tab;
}

async function sendToTab(tabId, msg) {
  const id = tabId || (await getActiveTab()).id;
  try {
    const result = await chrome.tabs.sendMessage(id, msg);
    return result || { success: true };
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      files: ["content-script.js"],
    });
    const result = await chrome.tabs.sendMessage(id, msg);
    return result || { success: true };
  }
}


const BROWSER_TOOLS = [
  { type: "function", function: { name: "explore", description: "扫描页面，返回所有交互元素及其选择器", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "click", description: "点击元素", parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } } } } },
  { type: "function", function: { name: "fill", description: "填写输入框", parameters: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } }, required: ["selector", "value"] } } },
  { type: "function", function: { name: "extract", description: "提取页面文字", parameters: { type: "object", properties: { selector: { type: "string" } } } } },
  { type: "function", function: { name: "scroll", description: "滚动页面", parameters: { type: "object", properties: { direction: { type: "string", enum: ["down","up","top","bottom"] }, amount: { type: "number" } }, required: ["direction"] } } },
  { type: "function", function: { name: "navigate", description: "跳转URL", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "wait", description: "等待毫秒数", parameters: { type: "object", properties: { ms: { type: "number" } }, required: ["ms"] } } },
  { type: "function", function: { name: "pressKey", description: "按键", parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } } },
  { type: "function", function: { name: "screenshot", description: "截图", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "done", description: "任务完成时调用", parameters: { type: "object", properties: { summary: { type: "string" } } } } },
];

async function callAIAPI(provider, apiKey, messages, model, apiUrl, tools) {
  const hasTools = tools && tools.length > 0;

  if (provider === "openai") {
    const body = { model: model || "gpt-4o", messages, temperature: 0.7 };
    if (hasTools) { body.tools = tools; body.tool_choice = "auto"; }
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || "API error");
    const msg = data.choices[0].message;
    const text = msg.content || "";
    const toolCalls = (msg.tool_calls || []).map(tc => ({
      id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}"),
    }));
    return { text, toolCalls };
  }

  if (provider === "anthropic") {
    const body = { model: model || "claude-sonnet-4-20250514", messages, max_tokens: 4096 };
    if (hasTools) {
      body.tools = tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
    }
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || "API error");
    let text = "";
    const toolCalls = [];
    for (const block of data.content || []) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input });
    }
    return { text, toolCalls };
  }

  // Custom
  const base = (apiUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : base + "/chat/completions";
  const body = { model: model || "gpt-4o", messages, temperature: 0.7 };
  if (hasTools) { body.tools = tools; body.tool_choice = "auto"; }
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "API error");
  const msg = data.choices[0].message;
  const text = msg.content || "";
  const toolCalls = (msg.tool_calls || []).map(tc => ({
    id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}"),
  }));
  return { text, toolCalls };
}
