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

  /** 右键点击 */
  async rightClick(req) {
    const el = await findElement(req.selector, req.text);
    if (!el) throw new Error(`未找到元素: ${req.selector || req.text}`);
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
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
    for (const char of req.value) {
      el.value += char;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("keydown", { bubbles: true }));
      el.dispatchEvent(new Event("keyup", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true };
  },

  /** 清空输入框 */
  async clear(req) {
    const el = await findElement(req.selector);
    if (!el) throw new Error(`未找到元素: ${req.selector}`);
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true };
  },

  /** 悬停元素 */
  async hover(req) {
    const el = await findElement(req.selector, req.text);
    if (!el) throw new Error(`未找到元素: ${req.selector || req.text}`);
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return { success: true };
  },

  /** 高亮元素 */
  async highlight(req) {
    const el = await findElement(req.selector, req.text);
    if (!el) throw new Error(`未找到元素: ${req.selector || req.text}`);
    const orig = { outline: el.style.outline, bg: el.style.backgroundColor };
    el.style.outline = "3px solid #ff0000";
    el.style.backgroundColor = "rgba(255,0,0,0.1)";
    setTimeout(() => {
      el.style.outline = orig.outline;
      el.style.backgroundColor = orig.bg;
    }, (req.duration || 2000));
    return { success: true, tag: el.tagName, id: el.id, class: el.className };
  },

  /** 按键 */
  async pressKey(req) {
    const el = await findElement(req.selector);
    if (el) el.focus();
    const key = req.key || "Enter";
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    return { success: true };
  },

  /** 下拉选择 */
  async select(req) {
    const el = await findElement(req.selector);
    if (!el) throw new Error(`未找到 select: ${req.selector}`);
    if (req.value !== undefined) {
      el.value = req.value;
    } else if (req.index !== undefined) {
      el.selectedIndex = req.index;
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

  /** 获取所有链接 */
  async getLinks() {
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: a.innerText.trim().slice(0, 100),
      href: a.href,
    }));
    return { success: true, links };
  },

  /** 获取所有图片 */
  async getImages() {
    const imgs = Array.from(document.querySelectorAll("img[src]")).map((img) => ({
      alt: img.alt || "",
      src: img.src,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
    return { success: true, images: imgs };
  },

  /** 获取表格数据 */
  async getTable(req) {
    const table = document.querySelector(req.selector || "table");
    if (!table) throw new Error(`未找到表格: ${req.selector || "table"}`);
    const headers = Array.from(table.querySelectorAll("th")).map((th) => th.innerText.trim());
    const rows = Array.from(table.querySelectorAll("tr")).slice(headers.length > 0 ? 1 : 0);
    const data = rows.map((row) => {
      const cells = row.querySelectorAll("td");
      const obj = {};
      (headers.length ? headers : cells).forEach((_, i) => {
        obj[headers[i] || `col${i}`] = cells[i]?.innerText.trim() || "";
      });
      return obj;
    });
    return { success: true, data, headers };
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

  /** 截图元素 */
  async screenshotElement(req) {
    const el = await findElement(req.selector, req.text);
    if (!el) throw new Error(`未找到元素: ${req.selector || req.text}`);
    const rect = el.getBoundingClientRect();
    return {
      success: true,
      bounds: {
        x: rect.x, y: rect.y,
        width: rect.width, height: rect.height,
        centerX: rect.x + rect.width / 2,
        centerY: rect.y + rect.height / 2,
      },
    };
  },

  /** 获取表单字段 */
  async getFormFields(req) {
    const form = document.querySelector(req.selector || "form");
    if (!form) throw new Error(`未找到表单: ${req.selector || "form"}`);
    const inputs = Array.from(form.querySelectorAll("input, select, textarea")).map((el) => ({
      name: el.name || el.id || "",
      type: el.type || el.tagName.toLowerCase(),
      selector: `#${el.id}` || `[name="${el.name}"]` || el.tagName.toLowerCase(),
      placeholder: el.placeholder || "",
      value: el.value || "",
    }));
    return { success: true, fields: inputs };
  },

  /** 探索页面：返回交互元素列表供 AI 参考 */
  async explore() {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea, button, a, [role=button]")).slice(0, 50);
    const elements = inputs.map((el) => {
      const tag = el.tagName.toLowerCase();
      const text = el.innerText?.trim?.() || el.value?.trim?.() || el.placeholder?.trim?.() || el.alt?.trim?.() || "";
      const rect = el.getBoundingClientRect();
      return {
        tag,
        text: text.slice(0, 40),
        id: el.id || "",
        class: (el.className || "").slice(0, 40),
        type: el.type || "",
        name: el.name || "",
        href: el.href || "",
        visible: rect.width > 0 && rect.height > 0,
        selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : text ? tag : "",
        label: text ? `${tag}: "${text.slice(0, 30)}"` : tag,
      };
    }).filter((e) => e.visible && (e.text || e.id || e.name));

    // 提取页面摘要
    const title = document.title;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 15).map((h) => h.innerText.trim()).filter(Boolean);
    const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 30).map((a) => ({ text: (a.innerText.trim() || "").slice(0, 30), href: a.href }));

    return {
      success: true,
      title,
      url: location.href,
      headings,
      elements,
      links,
      elementCount: elements.length,
    };
  },

  /** 显示截图（新标签页中） */
  async showImage(req) {
    document.body.innerHTML = `<img src="${req.dataUrl}" style="max-width:100%;height:auto;">`;
    document.title = "截图 - AI Test Agent";
    return { success: true };
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
