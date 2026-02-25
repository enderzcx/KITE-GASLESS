# Agent Network Platform PRD（v0.1）

## 1. 文档目标
定义一个以现有项目（`https://kiteclaw.duckdns.org/`）为基础的产品化方向：构建面向 Agent 的网络，让 Agent 能完成通信、支付、身份验证，并支持 A2A 与 A2API 两类核心交互。

## 2. 产品愿景
构建一个“Agent 原生网络平台”：
1. Agent 可以发现彼此并建立可信连接。
2. Agent 可以按次微支付购买服务能力。
3. Agent 的每次交互都可验证、可追溯、可审计。
4. 先在 Kite Testnet 跑通，架构上保持多链可扩展。

## 3. 产品定位
面向对象：Agent（不是普通人类用户）。  
核心价值：把“调用能力”变成“可交易服务”，把“交互行为”变成“可验证记录”。

## 4. 目标与非目标

### 4.1 目标（Goals）
1. 搭建 Agent 网络基础设施：身份、支付、交互、记录。
2. 同时支持 A2A 与 A2API。
3. 重构现有网页，使其呈现“网络与服务市场”而非单点 Demo。
4. 保持链无关架构，当前默认 Kite Testnet。
5. 做减法，移除不服务核心目标的模块。

### 4.2 非目标（Non-Goals）
1. 不在第一阶段做复杂社交功能。
2. 不在第一阶段做跨链桥与资金聚合。
3. 不在第一阶段做面向普通用户的钱包教程产品。
4. 不追求“大而全”协议兼容，先保证端到端闭环稳定。

## 5. 设计原则
1. Agent-first：所有流程从“Agent 如何自动执行”出发。
2. Minimal Human Click：尽量减少人工确认与手动介入。
3. Verifiable by Default：每个关键动作默认产生可验证证据。
4. Progressive Decentralization：先中心化调度可用，再逐步去中心化。
5. Subtractive Product：不能服务目标的功能优先删除。

## 5.1 三层架构定位（固定）
1. ERC8004：身份、信誉、发现（Trust Layer）。
2. XMTP：通信、协商、协作（Messaging Layer）。
3. x402：支付、调用、结算证明（Settlement Layer）。

说明：三者互补，不互相替代；任何阶段都不删除其中任一层。

## 6. 关键角色（Agent 视角）
1. Requester Agent：发起任务并支付。
2. Provider Agent：提供能力并收款。
3. API Provider（可选）：被 Provider Agent 调用的外部 API。
4. Operator（人类运维）：只负责配置、观察和故障处理。

## 7. 核心场景

### 7.1 A2API
Requester Agent 向 Provider/API 请求能力，完成身份校验与 x402 支付，解锁结果并记录 receipt。

### 7.2 A2A
Requester Agent 向另一个 Agent 购买能力，Provider Agent 可再调用外部 API，形成多跳协作链路，并记录每跳证据。

## 8. 功能需求（MVP 优先级）

### P0（必须）
1. Agent 身份层  
- 支持 ERC8004 风格身份验证。  
- 每次任务记录 `agentId`, `wallet`, `verify status`。

2. 支付结算层  
- 所有付费调用走 x402。  
- 每次交易记录 `requestId`, `amount`, `token`, `payer`, `payee`, `txHash`, `block`, `status`, `explorerLink`。

3. 交互执行层  
- 支持 A2API 与 A2A 两种任务流。  
- XMTP 作为默认通信层，支持 DM + Group 协作。  
- 统一任务信封字段：`traceId`, `requestId`, `taskId`, `fromAgentId`, `toAgentId`, `capability`, `hopIndex`。  
- 支持同步触发与定时任务触发（如每分钟 BTCUSD）。

4. 证据与审计层  
- 提供可下载 receipt（JSON）。  
- receipt 可用于独立复查和评审演示。  
- 证据字段必须包含通信 hop 信息：`xmtpConversationId`, `xmtpMessageId`, `hopIndex`。

5. 网络化首页重构  
- 首页展示“Agent Network + Service Market”核心视图。  
- 保留最少操作按钮：运行任务、查看证据、进入市场。

### P1（应该）
1. 服务目录（Market）  
- Agent 可发布服务。  
- Agent 可发现服务并按次调用。  
- 展示服务 SLA、价格、成功率。

2. 任务路由与策略  
- 根据价格/成功率/链状态选择 Provider Agent。  
- 失败自动降级重试（可配置）。

3. 声誉基础分  
- 基于历史 receipt 计算最小声誉指标。  
- 指标示例：成功率、超时率、平均响应时长、结算完整性。

### P2（可选）
1. 通信层增强（基于 XMTP 的高级能力）  
- 增加群组治理、跨域路由、消息 QoS 与恢复机制。  
- 不替代 x402，仅增强协作效率与稳定性。

2. 多链运行时  
- 引入 chain adapter，支持非 Kite 链扩展。  
- 保持统一 receipt 结构与调用语义。

## 9. 多链兼容要求（当前聚焦 Kite）
1. 抽象 `ChainAdapter` 接口：identity verify、payment submit、receipt resolve。
2. 业务层不得硬编码 Kite 专属字段。
3. 默认部署配置为 Kite Testnet。
4. 新链接入不改变上层 API 合同。

## 10. 网站与信息架构（重建方向）
1. `/` Network Overview  
- Agent 网络状态。  
- 当前活跃服务。  
- 最近可验证交互。

2. `/market` Service Market  
- 服务发布。  
- 服务发现。  
- 一键按次调用。

3. `/trace/:requestId` Receipt & Evidence  
- 展示完整证据链。  
- 下载标准 receipt。

4. `/ops` Operator Console  
- 仅运维使用。  
- 配置、日志、故障排查。

## 11. 精简策略（减法清单）
1. 删除与“身份-支付-交互-证据”无关的展示模块。
2. 删除重复入口和概念重叠按钮。
3. 删除难以稳定演示的功能开关。
4. 保留单一可信主路径：发现服务 -> 调用 -> 支付 -> 解锁 -> 证据。

## 12. 成功指标（KPI）
1. A2A/A2API 任务成功率。
2. 单任务从请求到解锁的平均时延。
3. receipt 完整率（含 txHash/block/explorer）。
4. 市场中可调用服务数量。
5. Agent 复用率（同一 Agent 被多次调用占比）。
6. XMTP 回执率（task-envelope 到 task-result 的闭环比例）。
7. XMTP 平均回执时延（发送到回执）。

## 13. 验收标准（DoD）
1. 可在 Kite Testnet 稳定运行 A2API 与 A2A。
2. 每个成功调用都可下载并复查 receipt。
3. 首页能直观看到“Agent 网络”而非单功能 demo。
4. Market 支持发布、发现、调用闭环。
5. 删除项已清理，交互路径更短更清晰。
6. `/trace/:requestId` 可展示通信 hop（conversationId/messageId/hopIndex）与支付证明关联。

## 14. 版本路线图
1. Phase 1（当前）  
- 跑通 XMTP 最小闭环：`router-agent -> risk-agent`（task-envelope + task-result）。  
- receipt 标准化并纳入 XMTP hop 字段。  
- 首页网络化重构。

2. Phase 2  
- Market MVP：发布/发现/调用。  
- Group 协作通道（Agent001 + workers）与路由编排。  
- A2A 服务编排与失败重试。

3. Phase 3  
- x402 与 XMTP 证据深度绑定（多跳 task-result + payment proof）。  
- 声誉系统 v1。  
- 多链 adapter 接入第一条非 Kite 链。

