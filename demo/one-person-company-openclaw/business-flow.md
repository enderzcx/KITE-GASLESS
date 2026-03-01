# 一人公司 OpenClaw 基本业务流程（Demo 基线）

## 设计原则
- 单人运营：流程要可自动化、可暂停、可复验。
- Agent 网络化：每个关键动作都要留下结构化审计事件。
- 可扩展：后续可以从单节点切到多节点/XMTP，不改展示模型。

## 基本流程（V1）
1. 需求进入（Lead Intake）
- 输入用户目标与约束（预算、时效、风险偏好）。
- 产出标准化任务请求（traceId/requestId）。

2. 双路分析（Info + Technical）
- Info Actor 负责信息摘要、上下文补全。
- Technical Actor 负责技术/风险分析。
- 两路并行执行，返回结构化结果。

3. 协商与选择（Quote/SLA/Rationale）
- Quote: `{amount, tokenAddress, expiresAt, capability, actorId}`
- SLA: `{timeoutMs, retries, maxLatencyMs}`
- Rationale: `{selectedActorId, reasonCodes[], explanation}`
- Orchestrator 进行最终选择并记录理由。

4. 执行与审计（Run + Timeline）
- 执行结果落地到 run 概览与 timeline。
- 审计事件支持后续 verify / evidence export。

5. 复验与交付（Verify + Evidence）
- 对 trace 做一致性校验（digest/ref/seq）。
- 交付证据包给业务方或审计方复验。

## 在 KITE-GASLESS 的接口映射
- 触发 demo run: `POST /api/network/demo/router-info-technical/run`
- 查询 runs: `GET /api/network/runs`
- 查询 timeline: `GET /api/network/audit/:traceId`
- 导出证据: `GET /api/evidence/export?traceId=...`
- 协议一致性门禁: `npm --prefix backend run parity:hopledger`

## 本地验收清单
- [ ] 能稳定触发一次 demo run 并得到 traceId
- [ ] `/api/network/runs` 能看到该 trace
- [ ] `/api/network/audit/:traceId` 包含 Quote/SLA/Rationale
- [ ] parity 命令通过