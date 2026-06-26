const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "extension", "sidepanel", "panel.js");
let content = fs.readFileSync(filePath, "utf-8");

// Find the system prompt
const marker = "const systemPrompt";
const start = content.indexOf(marker);
const templateEnd = content.indexOf("`;", start);

const newPrompt = `    const systemPrompt = \`你是一个浏览器助手。一次性规划所有步骤并发出所有指令。

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

当前 URL: \${pageInfo.url}\``;

content = content.slice(0, start) + newPrompt + content.slice(templateEnd + 2);
fs.writeFileSync(filePath, content, "utf-8");
console.log("✅ system prompt updated");
