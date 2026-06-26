const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "extension", "sidepanel", "panel.js");
let content = fs.readFileSync(filePath, "utf-8");

// Find and replace the loop section
const loopStart = content.indexOf("let fullDisplay = \"\";");
const loopEnd = content.indexOf('setStatus("✅ 完成", "");', loopStart);
const afterEnd = content.indexOf("\n", loopEnd) + 1;

const newCode = `const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ];

    setStatus("🤔 AI 规划中...");
    const result = await chrome.runtime.sendMessage({ action: "callAI", messages });
    if (!result.success) {
      addMessage("system", \`❌ \${result.error}\`);
      setStatus("❌ 出错", "error");
      return;
    }

    const aiText = result.text;

    const toolRegex = /<TOOL>([\\s\\S]*?)<\\/TOOL>/g;
    const tools = [];
    let m;
    while ((m = toolRegex.exec(aiText)) !== null) tools.push(m[1].trim());

    if (tools.length === 0) {
      addMessage("ai", aiText);
      setStatus("✅ 完成", "");
      return;
    }

    setStatus(\`⏳ 执行 \${tools.length} 个步骤...\`);
    const results = [];
    const images = [];
    for (let i = 0; i < tools.length; i++) {
      const toolCmd = tools[i];
      setStatus(\`⏳ (\${i + 1}/\${tools.length}) \${toolCmd.split("|")[0]}...\`);
      const r = await executeToolCommand(toolCmd);
      results.push(\`[\${toolCmd}] \${r.text.replace(/<[^>]*>/g, "").trim()}\`);
      if (r.imageUrl) images.push(r.imageUrl);
    }

    const displayText = aiText.replace(/<TOOL>[\\s\\S]*?<\\/TOOL>/g, "").trim();
    if (displayText) addMessage("ai", displayText.replace(/\\n/g, "<br>"));

    for (const imgUrl of images) {
      const imgDiv = document.createElement("div");
      imgDiv.innerHTML = \`<img src="\${imgUrl}" style="max-width:100%;border-radius:6px;margin:4px 0;box-shadow:0 2px 8px rgba(0,0,0,0.1)">\`;
      chatMessages.appendChild(imgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    setStatus("✅ 完成", "");`;

content = content.slice(0, loopStart) + newCode + content.slice(afterEnd);
fs.writeFileSync(filePath, content, "utf-8");
console.log("✅ Loop removed, single-pass execution");
