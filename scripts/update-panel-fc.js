const fs = require("fs");
let c = fs.readFileSync("./extension/sidepanel/panel.js", "utf-8");

const oldLoop = c.indexOf("const toolRegex = /<TOOL>");
const loopEnd = c.indexOf("      messages.push({", c.indexOf("当前页面URL:"));
const afterEnd = c.indexOf("      });", loopEnd) + 10;

const newCode = `      const toolCalls = result.toolCalls || [];
      console.log("[AI round " + round + "]", toolCalls.length + " tool calls");

      if (toolCalls.length === 0) {
        fullReply = result.text || "";
        break;
      }

      for (const tc of toolCalls) {
        if (tc.name === "done") {
          fullReply = tc.args.summary || result.text || "";
          break;
        }
        setStatus("⚡ " + tc.name);
        const r = await executeToolCall(tc);
        if (r && r.imageUrl) allImages.push(r.imageUrl);
      }
      if (fullReply) break;

      const newPage = await getCurrentTabInfo();

      for (const tc of toolCalls) {
        if (tc.name === "done") continue;
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{ id: tc.id || "call_1", type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } }]
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id || "call_1",
          content: "OK"
        });
      }
      messages.push({
        role: "user",
        content: "Current page URL: " + newPage.url + "\\nTitle: " + newPage.title
      });`;

c = c.slice(0, oldLoop) + newCode + c.slice(afterEnd);

// Also add executeToolCall function that dispatches to existing tools
// Find executeToolCommand and add executeToolCall before it
const etcPos = c.indexOf("async function executeToolCommand");
const newEtc = `async function executeToolCall(tc) {
  const name = tc.name;
  const args = tc.args || {};
  switch (name) {
    case "explore": return executeToolCommand("explore");
    case "screenshot": return executeToolCommand("screenshot");
    case "click": {
      const cmd = args.text ? "click||" + args.text : "click|" + (args.selector || "");
      return executeToolCommand(cmd);
    }
    case "fill": return executeToolCommand("fill|" + (args.selector || "") + "|" + (args.value || ""));
    case "extract": return executeToolCommand("extract" + (args.selector ? "|" + args.selector : ""));
    case "scroll": return executeToolCommand("scroll|" + (args.direction || "down") + "|" + (args.amount || 500));
    case "navigate": return executeToolCommand("navigate|" + (args.url || ""));
    case "wait": return executeToolCommand("wait|" + (args.ms || 2000));
    case "pressKey": return executeToolCommand("pressKey|" + (args.key || "Enter"));
    default: return { text: "Unknown tool: " + name };
  }
}

`;

c = c.slice(0, etcPos) + newEtc + c.slice(etcPos);

fs.writeFileSync("./extension/sidepanel/panel.js", c, "utf-8");
console.log("Done");
