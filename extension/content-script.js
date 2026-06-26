/**
 * AI Test Agent — Content Script
 *
 * 注入到每个页面中，提供实际的 DOM 操作能力。
 * 通过 chrome.runtime.onMessage 接收 background 的指令。
 */

// ==================== 消息处理器 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request.action];
  if (handler) {
    handler(request).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

const handlers = {
  /** 点击元素（CSS 选择器或文本匹配） */
  async click(req) {
    const el = await findElement(req.selector, req.text);
    if (!el) throw new Error(`未找到元素: ${req.selector || req.text}`);
    el.click();
    return { success: true };
  },

  /** 填写输入框 */
  async fill(req) {
    const el = await findElement(req.selector);
    if (!el) throw new Error(`未找到输入框: ${req.selector}`);
    if (req.clear !== false) {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.focus();
    // 逐个字符输入（模拟真人）
    for (const char of req.value) {
      el.value += char;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("keydown", { bubbles: true }));
      el.dispatchEvent(new Event("keyup", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true };
  },

  /** 提取页面文字 */
  async extract(req) {
    if (req.selector) {
      const els = document.querySelectorAll(req.selector);
      if (els.length === 0) throw new Error(`未找到元素: ${req.selector}`);
      const texts = Array.from(els).map((el) => el.innerText || el.textContent || "");
      return { success: true, text: texts.join("\n---\n") };
    }
    return { success: true, text: document.body.innerText };
  },

  /** 获取 HTML */
  async getHtml(req) {
    if (req.selector) {
      const el = document.querySelector(req.selector);
      if (!el) throw new Error(`未找到元素: ${req.selector}`);
      return { success: true, html: req.outer !== false ? el.outerHTML : el.innerHTML };
    }
    return { success: true, html: document.documentElement.outerHTML };
  },

  /** 滚动页面 */
  async scroll(req) {
    const selector = req.selector;
    if (selector) {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`未找到元素: ${selector}`);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const dir = req.direction || "down";
      const amount = req.amount || 500;
      switch (dir) {
        case "top": window.scrollTo({ top: 0, behavior: "smooth" }); break;
        case "bottom": window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); break;
        case "up": window.scrollBy({ top: -amount, behavior: "smooth" }); break;
        case "down": window.scrollBy({ top: amount, behavior: "smooth" }); break;
      }
    }
    return { success: true };
  },

  /** 执行 JS */
  async evaluate(req) {
    const result = eval(req.code);
    return { success: true, result: JSON.stringify(result) };
  },
};

// ==================== 辅助函数 ====================

async function findElement(selector, text) {
  if (text) {
    // 按文本查找
    const xpath = `//*[contains(text(), "${text}")]`;
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }
  if (selector) {
    return document.querySelector(selector);
  }
  return null;
}
