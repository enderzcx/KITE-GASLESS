# KITE GASLESS Rolling Handoff

本文件是“新对话唯一优先入口”。
每次完成一轮可交付改动后，必须同步更新本文件的“当前状态/下一步/风险/最近提交”。

## 1) 新对话启动规则（必须先做）
1. 先读 `HANDOFF.md`。
2. 再读 `README.md`、`CHANGELOG.md`、`AGENT_NETWORK_PLAN.md`、`backend/server.js`、`重要信息.md`。
3. 用 8 行内复述：当前状态、今天目标、进行中任务、风险。
4. 明确说明：准备修改哪些文件。
5. 直接开始实现，不停留在方案讨论。

## 2) 当前状态（Last Updated: 2026-02-27）
- 核心目标：单终端启动后端（含 XMTP）+ AGENT001 闭环（身份校验 -> 报价 -> x402 -> 结果）+ 持续瘦身。
- 一键启动：`backend/scripts/start-backend-one.ps1` + `npm --prefix backend run start:one` 已可加载 `重要信息.md` 里的 token 并注入 `OPENNEWS/TWITTER`。
- 已完成意图修复：`4822a29`（“仅消息面/不要技术面”不再误判）。
- 后端瘦身已做三轮，`backend/server.js` 约从 `15186` 行降到 `14353` 行。
- 当前主线可用：消息面/技术面/交易执行、x402 证据回传（`requestId/txHash`）、失败结构化返回。

## 3) 最近提交（新对话先看这几条）
1. `2917b19` `refactor(backend): extract message provider analysis service`
2. `c5843ca` `refactor(backend): extract x402 receipt and graph helpers`
3. `b9e283a` `refactor(backend): extract agent001 planning helpers`
4. `0c2b9e8` `refactor(backend): extract agent001 execution helpers and prune deprecated routes`
5. `97b9e6e` `refactor(backend): extract orchestrator and remove legacy btc auto polling`

## 4) 下一步（默认按顺序执行）
1. 继续瘦身 `backend/server.js`：优先抽离 workflow/A2A handler 大段路由逻辑到 `backend/services/`。
2. 每抽一批就本地验证并提交，确保行为不变。
3. 维持单终端启动路径不回退：`npm --prefix backend run start:one`。
4. 不主动改前端大改区域，除非用户明确要求。

## 5) 硬规则（必须遵守）
1. 默认直接改代码并本地验证。
2. 每次改动后必须 commit（先不 push）。
3. PowerShell 禁用 `&&`，命令用分号或分行。
4. 阻塞时立即反馈“原因 + 需要用户提供什么”。
5. 每次交付必须给“服务器更新命令 + 验证命令”。
6. 回复中文、结论优先、简洁。

## 6) 禁止误改区域（除非用户明确点名）
- `frontend/src/gokite-aa-sdk.js`
- `data/`
- `tmp/`
- 其他用户已标注的脏文件

## 7) 本地验收命令（默认）
```powershell
node --check "G:\KKK\KITE GASLESS\backend\server.js"
npm --prefix "G:\KKK\KITE GASLESS\backend" run verify:agent001:intent
npm --prefix "G:\KKK\KITE GASLESS\backend" run start:one
```

## 8) 服务器更新命令模板（每次交付都要带）
```bash
set -e
cd /srv/kiteclaw/app
git fetch --all --prune
git checkout main
git pull --ff-only origin main

cd /srv/kiteclaw/app/frontend
npm ci
npm run build

cd /srv/kiteclaw/app/backend
npm ci
pm2 restart kiteclaw-backend
pm2 save

nginx -t
systemctl reload nginx
```

## 9) 在线验证命令模板
```bash
curl -s https://kiteclaw.duckdns.org/ | head -n 20
curl -s http://127.0.0.1:3001/api/health
curl -s http://127.0.0.1:3001/api/market/services | head -c 800
pm2 status
```

## 10) 何时必须更新本文件
1. 新增或删除核心功能模块后。
2. 启动/验证命令变化后。
3. 验收标准变化后。
4. 新提交完成后（至少更新“最近提交”和“下一步”）。
5. 出现已知风险或阻塞后。

## 11) 新对话可直接复制的指令
```text
先读 HANDOFF.md，再读 README.md、CHANGELOG.md、AGENT_NETWORK_PLAN.md、backend/server.js、重要信息.md。
8 行内复述现状/目标/风险，然后直接改代码并本地验证。
每次改动后 commit，不要 push；交付时必须带服务器更新命令和验证命令。
```
