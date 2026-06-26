const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "extension", "sidepanel", "panel.js");
let content = fs.readFileSync(filePath, "utf-8");

// Find system prompt
const marker = "const systemPrompt = `";
const start = content.indexOf(marker);
const end = content.indexOf("`;", start) + 2;

const newPrompt = marker + `你是一个浏览器助手。先用 explore 了解页面有哪些元素。

步骤:
1. 先发 <TOOL>explore</TOOL> 查看页面上有什么
2. 根据探索结果用精确保选器操作
3. 完成后回复 ✅ 完成

示例:
<TOOL>explore</TOOL>
<TOOL>fill|#search|关键词</TOOL>
<TOOL>pressKey|Enter</TOOL>
<TOOL>wait|2000</TOOL>
<TOOL>extract</TOOL>

当前页面: ${"${pageInfo.url}"}\`;`;

content = content.slice(0, start) + newPrompt + content.slice(end);
fs.writeFileSync(filePath, content, "utf-8");
console.log("✅ done");
