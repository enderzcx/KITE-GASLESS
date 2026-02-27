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
- `agent-network` 前端工程已就绪（Next.js + TypeScript + Tailwind + shadcn/ui + reactflow + framer-motion）。
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
1. `35c8e46` docs(plan): refresh AGENT_NETWORK_PLAN for current execution
2. `9e33b21` docs(readme): mark btc overview page for vnext removal
3. `0765757` docs(handoff): remove legacy sidecar naming references
4. `983eb7b` docs(handoff): record openalice cleanup status
5. `30717da` refactor(analysis): remove legacy OpenAlice runtime remnants
6. `2917b19` refactor(backend): extract message provider analysis service

## 3) 下一步（默认执行顺序）
### P0（当前轮必须完成）
1. 在 `agent-network` 交付单页可视化：`Agent Network` + `Powered by XMTP × x402 × ERC8004`（前端展示全英文）。
2. 基于 React Flow 严格按架构图实现 A2A / ATAPI 双路径与编号 `①②③④⑤`。
3. 完成 6 步流程演示与控制：`开始 / 暂停 / 下一步 / 重播`，并实现节点/连线时序高亮。
4. 完成审计面板与支付弹窗：`Audit Trail`（timestamp/step/key data/copy）+ `x402` 四阶段动画（challenge -> pay+proof -> verify -> unlock）。
5. 数据策略固定为 backend-first：优先读取后端接口，失败回退 mock，且日志标记 `source=fallback`。
6. 保持后端基线不回退：`start:one` 可用、结构化错误返回、`requestId + txHash` 证据链保持完整。

### P1（P0 后执行）
1. 补 5 次端到端回归记录：成功率/耗时/失败原因分布（A2A + ATAPI 各覆盖）。
2. 收敛 `backend/server.js` 到可维护区间（继续按服务化拆分）。
3. 前端可视化稳定后，删除后端已废弃依赖接口并补兼容说明。

## 4) 固定验收标准（每轮都要过）
1. 一条命令可启动 backend（含 token 注入 + XMTP runtime）。
2. “仅消息面，不要技术面”只返回消息面 + x402 证据。
3. 失败必须结构化返回 `error + reason`。
4. 直接下单（市价/限价/TP/SL）不强制先跑分析。
5. 每次改动后必须 commit（不 push）。
6. `agent-network` 页面验收通过：`npm run lint`、`npm run build`、`npm run dev` 手测流程可跑通。

## 5) 执行命令模板
### 5.1 本地验证
```powershell
node --check "G:\KKK\KITE GASLESS\backend\server.js"
npm --prefix "G:\KKK\KITE GASLESS\backend" run verify:agent001:intent
npm --prefix "G:\KKK\KITE GASLESS\backend" run start:one
npm --prefix "G:\KKK\KITE GASLESS\agent-network" run lint
npm --prefix "G:\KKK\KITE GASLESS\agent-network" run build
npm --prefix "G:\KKK\KITE GASLESS\agent-network" run dev
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
- 风险 R4：前端流程动画状态较多（节点、边、日志、弹窗）易出现状态竞争。
  - 应对：统一单一状态机驱动（step index + playback state），避免多处并发定时器。

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
