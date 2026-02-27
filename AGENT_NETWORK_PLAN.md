# AGENT_NETWORK_PLAN (Rolling, Local)

> Last Updated: 2026-02-27
> Scope: 本地执行计划（可提交到仓库），默认不 push，等用户确认。

## 0) 本文件用途
- 新对话先读本文件，30 秒内知道“现在做到哪、下一步干什么、怎么验收”。
- 每次完成一轮改动并 commit 后，必须同步更新：
  - `1) 当前状态`
  - `2) 最近提交`
  - `3) 下一步`
  - `7) 风险与阻塞`

## 1) 当前状态（必须真实）
### 1.1 已稳定可用
- 单终端启动后端（含 XMTP）：`npm --prefix backend run start:one`
- 启动脚本自动读取 `重要信息.md` 末尾 token，注入：
  - `OPENNEWS_TOKEN`
  - `TWITTER_TOKEN`
- AGENT001 已支持：
  - 仅消息面
  - 仅技术面
  - 交易计划
  - 直接下单（市价/限价/止盈止损）
- 失败返回要求：结构化错误（不能无响应）。
- x402 证据要求：成功结果必须可追踪 `requestId + txHash`。

### 1.2 已完成关键修复
- `4822a29`：修复“仅消息面，不要技术面”意图误判。
- 服务价格已统一调整到 `0.00015`（如后续调整，需同步 README + CHANGELOG + 本文件）。

### 1.3 代码瘦身进度（backend）
- `server.js` 已从约 `15186` 行降到约 `14353` 行。
- 已抽离模块：
  - `backend/services/agent001Orchestrator.js`
  - `backend/services/agent001ExecutionService.js`
  - `backend/services/agent001PlanningService.js`
  - `backend/services/x402ReceiptService.js`
  - `backend/services/messageProviderAnalysisService.js`

## 2) 最近提交（按时间倒序）
1. `2917b19` refactor(backend): extract message provider analysis service
2. `c5843ca` refactor(backend): extract x402 receipt and graph helpers
3. `b9e283a` refactor(backend): extract agent001 planning helpers
4. `0c2b9e8` refactor(backend): extract agent001 execution helpers and prune deprecated routes
5. `97b9e6e` refactor(backend): extract orchestrator and remove legacy btc auto polling
6. `4822a29` fix(intent): info-only should not trigger technical analysis

## 3) 下一步（默认执行顺序）
### P0（当前轮必须完成）
1. 继续瘦身 `backend/server.js`：优先抽离 workflow/A2A 大段 handler 到 `backend/services/`。
2. 保证“直接挂单指令”不再额外触发消息面/技术面分析链路（hard bypass）。
3. 保持标准流程硬约束：先身份通过，再报价，再 x402，再返回结果。
4. 保持单终端启动路径不回退：`start:one` 必须持续可用。

### P1（P0 后执行）
1. 补 5 次端到端回归记录：成功率/耗时/失败原因分布。
2. 收敛 `server.js` 到可维护区间（继续按服务化拆分）。
3. 前端大改前，先删除后端已废弃依赖接口并补兼容说明。

## 4) 固定验收标准（每轮都要过）
1. 一条命令可启动 backend（含 token 注入 + XMTP runtime）。
2. “仅消息面，不要技术面”只返回消息面 + x402 证据。
3. 失败必须结构化返回 `error + reason`。
4. 直接下单（市价/限价/TP/SL）不强制先跑分析。
5. 每次改动后必须 commit（不 push）。

## 5) 执行命令模板
### 5.1 本地验证
```powershell
node --check "G:\KKK\KITE GASLESS\backend\server.js"
npm --prefix "G:\KKK\KITE GASLESS\backend" run verify:agent001:intent
npm --prefix "G:\KKK\KITE GASLESS\backend" run start:one
```

### 5.2 服务器更新
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

### 5.3 服务器验证
```bash
curl -s https://kiteclaw.duckdns.org/ | head -n 20
curl -s http://127.0.0.1:3001/api/health
curl -s http://127.0.0.1:3001/api/market/services | head -c 800
pm2 status
```

## 6) 关键约束（不可违反）
1. 先改代码再讨论，默认直接执行。
2. PowerShell 不用 `&&`，只用分号或分行。
3. 不误改用户脏文件：`frontend/src/gokite-aa-sdk.js`、`data/`、`tmp/` 等。
4. 阻塞时立即报告：`原因 + 需要用户提供什么`。
5. 每次交付必须附“服务器更新命令 + 验证命令”。

## 7) 风险与阻塞
- 风险 R1：`server.js` 仍偏大，回归风险随改动批次上升。
  - 应对：每次只拆一块、每块单独验证并 commit。
- 风险 R2：直连下单与分析链路可能存在历史耦合路径。
  - 应对：对“下单意图”做优先级短路，并加回归脚本。
- 风险 R3：外部消息源 token/限流抖动。
  - 应对：保留 provider 降级 + 结构化错误，不允许 silent fail。

## 8) 地址校对（禁止改错）
- Router EOA: `0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29`
- Risk EOA3: `0xf02Fe12689e5026707d1be150B268E0Fa5a37320`
- Router AA: `0x220c8c911bB99A330d132c8573122eBb6ef9f307`
- Risk AA: `0x514AE5F90bCFD2a6CD61aEa032f76702861FcEE4`
- 注意：XMTP 聊天地址使用 EOA，不是 AA。

## 9) 更新触发器（必须执行）
满足任一条件必须更新本文件后再结束本轮：
1. 完成新的 commit。
2. 启动命令或验收命令有变化。
3. 新增/删除核心模块或 API。
4. 风险状态变化（新增阻塞或解除阻塞）。

## 10) 新对话启动口令（可复制）
```text
先读 HANDOFF.md，再读 AGENT_NETWORK_PLAN.md、README.md、CHANGELOG.md、backend/server.js、重要信息.md。
8 行内复述现状/目标/风险，然后直接改代码并本地验证。
每次改动后 commit，不 push；交付时必须附服务器更新命令和验证命令。
```
