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

/**
 * 在指定标签页中执行操作
 * 由 sidepanel 或 content-script 调用
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request.action];
  if (handler) {
    handler(request, sender).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // 异步响应
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

  // --- 截图 ---
  async screenshot(req) {
    const tabId = req.tabId || (await getActiveTab()).id;
    const dataUrl = await chrome.tabs.captureVisibleTab(tabId, { format: "png" });
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
      const result = await callAIAPI(provider, apiKey, req.messages, model, apiUrl);
      return { success: true, text: result };
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

async function callAIAPI(provider, apiKey, messages, model, apiUrl) {
  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages,
        temperature: 0.7,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || "API 调用失败");
    return data.choices[0].message.content;
  }

  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-3-haiku-20240307",
        messages,
        max_tokens: 4096,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || "API 调用失败");
    return data.content[0].text;
  }

  // 自定义（兼容 OpenAI 协议）
  const baseUrl = (apiUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages,
      temperature: 0.7,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "API 调用失败");
  return data.choices[0].message.content;
}
