const fs = require("fs");

let c = fs.readFileSync("./extension/background.js", "utf-8");

// Tools definition
const toolsDef = `
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
];`;

// 1. Insert toolsDef before callAIAPI
c = c.replace("async function callAIAPI(", toolsDef + "\n\nasync function callAIAPI(");

// 2. Replace callAI handler to pass tools
c = c.replace(
  `const result = await callAIAPI(provider, apiKey, req.messages, req.model, apiUrl);`,
  `const result = await callAIAPI(provider, apiKey, req.messages, model, apiUrl, BROWSER_TOOLS);`
);
c = c.replace(
  `const result = await callAIAPI(provider, apiKey, req.messages, model, apiUrl);`,
  `const result = await callAIAPI(provider, apiKey, req.messages, model, apiUrl, BROWSER_TOOLS);`
);

// 3. Update return to pass toolCalls
c = c.replace(
  `return { success: true, text: result };`,
  `return { success: true, text: result.text || "", toolCalls: result.toolCalls || [] };`
);

// 4. Replace callAIAPI function body with tool-use version
const oldFunc = c.match(/async function callAIAPI[\s\S]*?\n\}/);
if (oldFunc) {
  const newFunc = `async function callAIAPI(provider, apiKey, messages, model, apiUrl, tools) {
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
  const base = (apiUrl || "https://api.openai.com/v1").replace(/\\/+$/, "");
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
}`;
  c = c.replace(oldFunc[0], newFunc);
}

fs.writeFileSync("./extension/background.js", c, "utf-8");
console.log("Done");
