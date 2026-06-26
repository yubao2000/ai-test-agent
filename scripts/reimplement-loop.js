const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "extension", "sidepanel", "panel.js");
let c = fs.readFileSync(filePath, "utf-8");

const start = c.indexOf('const systemPrompt = `');
const end = c.indexOf("当前页面: ${pageInfo.url}`;") + 28;

const newSysPrompt = `    const systemPrompt = \`你是一个浏览器助手。每轮先 <TOOL>explore</TOOL> 查看页面，再操作。

规则:
- 每轮先 explore 再看页面有什么可操作
- 操作跟在 explore 后面一起发
- 不要截图
- 完成后回复 ✅ 完成

示例:
<TOOL>explore</TOOL>
<TOOL>click||广州二手房</TOOL>
<TOOL>wait|2000</TOOL>
<TOOL>explore</TOOL>
<TOOL>click||价格排序</TOOL>
<TOOL>extract</TOOL>

当前页面: \${pageInfo.url}\`;`;

c = c.slice(0, start) + newSysPrompt + c.slice(end);

// Now replace the single-pass execution with loop
const oldExec = c.indexOf('setStatus("🤔 AI 规划中...");');
const oldExecEnd = c.indexOf('setStatus("✅ 完成", "");', oldExec) + 25;

const newExec = `    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ];

    let maxRounds = 6;
    let round = 0;
    let allImages = [];
    let fullReply = "";

    while (round < maxRounds) {
      round++;
      setStatus(\`🤔 第 \${round}/\${maxRounds} 轮...\`);

      const result = await chrome.runtime.sendMessage({ action: "callAI", messages });
      if (!result.success) {
        addMessage("system", \`❌ \${result.error}\`);
        setStatus("❌ 出错", "error");
        return;
      }

      const aiText = result.text;
      console.log(\`[AI 第\${round}轮]\`, aiText.slice(0, 300));

      const toolRegex = /<TOOL>([\\\\s\\\\S]*?)<\\/TOOL>/g;
      const tools = [];
      let m;
      while ((m = toolRegex.exec(aiText)) !== null) tools.push(m[1].trim());

      if (tools.length === 0) {
        fullReply = aiText;
        break;
      }

      for (let i = 0; i < tools.length; i++) {
        const toolCmd = tools[i];
        setStatus(\`⚡ \${toolCmd.split("|")[0]} (\${i + 1}/\${tools.length})\`);
        const r = await executeToolCommand(toolCmd);
        if (r.imageUrl) allImages.push(r.imageUrl);
      }

      const newPage = await getCurrentTabInfo();
      messages.push({ role: "assistant", content: aiText });
      messages.push({
        role: "user",
        content: \`已执行。当前页面URL: \${newPage.url}\\n标题: \${newPage.title}\\n\\n继续操作或回复 ✅ 完成。\`,
      });
    }

    if (fullReply) {
      const displayText = fullReply.replace(/<TOOL>[\\\\s\\\\S]*?<\\/TOOL>/g, "").trim();
      if (displayText) addMessage("ai", displayText.replace(/\\\\n/g, "<br>"));
    } else {
      addMessage("system", round >= maxRounds ? "⚠️ 步骤较多已自动结束" : "✅ 完成");
    }

    for (const imgUrl of allImages) {
      const imgDiv = document.createElement("div");
      imgDiv.innerHTML = \`<img src="\${imgUrl}" style="max-width:100%;border-radius:6px;margin:4px 0;box-shadow:0 2px 8px rgba(0,0,0,0.1)">\`;
      chatMessages.appendChild(imgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    setStatus("✅ 完成", "");`;

c = c.slice(0, oldExec) + newExec + c.slice(oldExecEnd);

fs.writeFileSync(filePath, c, "utf-8");
console.log("✅ Done - loop reimplemented with 6 max rounds");
