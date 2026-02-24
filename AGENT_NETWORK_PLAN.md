# Agent Network Demo Plan

> Last Updated: 2026-02-24

## 1. 项目目标（北极星）
构建一个可演示的 Agent Network：
- 交流层：Agent 与 Agent / Agent 与 API 可稳定通信（A2A + A2API）
- 支付层：每次能力调用可按次结算（x402）
- 验证层：每次交互可追溯、可审计、可下载证据（receipt）

核心闭环：发现服务 -> 调用 -> 支付 -> 解锁 -> 证据。

## 2. 网络地基设计
### 2.1 交流层（Communication）
- 使用 XMTP 作为 Agent 间“普通交流层”
- 支持 DM（点对点）+ Group（多 Agent 协作）混合模式
- XMTP 负责消息协作，不替代支付结算

### 2.2 支付层（Payment）
- 保持 x402 作为统一结算通道
- 每一跳调用都记录结算字段：
  - requestId, amount, token, payer, payee, txHash, block, status, explorerLink

### 2.3 验证层（Verification）
- 每次调用产出标准 receipt JSON
- `/trace/:requestId` 展示完整证据链并支持下载

## 3. 演示用 Agent 拓扑（MVP）
最少 5 个 demo agents：
1. router-agent（路由编排）
2. risk-agent（A2A 能力）
3. reader-agent（A2API 能力）
4. price-agent（行情能力）
5. executor-agent（执行/聚合）

每个 Agent 都必须可：发现、调用、支付、验证。

## 4. 网站信息架构（保持一致）
1. `/` Network Overview
2. `/market` Service Market
3. `/trace/:requestId` Receipt & Evidence
4. `/ops` Operator Console

## 5. 分阶段计划（粗略）
### Phase 1：地基跑通（当前优先）
- [ ] 建立 Agent Registry（展示网络节点）
- [ ] 跑通 A2A + A2API 的统一任务信封
- [ ] 绑定 x402 支付到每一跳
- [ ] 产出并聚合多跳 receipt
- [ ] 首页体现“网络视角”而非单功能 demo

### Phase 2：市场闭环增强
- [ ] 服务发布 / 发现 / 调用完整闭环
- [ ] 路由策略（价格 / 成功率 / 链状态）
- [ ] 失败自动降级重试（可配置）

### Phase 3：可扩展能力
- [ ] 声誉基础分 v1
- [ ] ChainAdapter 接口抽象（identity verify / payment submit / receipt resolve）
- [ ] 保持默认 Kite Testnet，预留多链接入位

## 6. 每天小步交付规则
每天至少交付 1 个可验证的小变更：
1. 完成代码改动
2. 本地通过：
   - `node --check backend/server.js`
   - `npm run build`（frontend）
3. 提供对应 curl/页面验证步骤
4. 执行 `commit + push`
5. 附服务器更新命令

## 7. 演示验收（DoD）
- [ ] Kite Testnet 上 A2A + A2API 稳定可跑
- [ ] 每次成功调用都可下载并复查 receipt
- [ ] 首页直观看到 Agent Network
- [ ] Market 支持发布、发现、调用闭环
- [ ] 主路径清晰：发现 -> 调用 -> 支付 -> 解锁 -> 证据

## 8. 当前已确认决策
- 节奏：每天小步
- 方向：优先 Agent Network 地基（交流/支付/验证）
- 通信：XMTP 可作为普通交流层
- 协作：DM 和 Group 可一起使用

## 9. 待你拍板（可随时修改）
- [ ] XMTP 环境：先 dev 还是直接 production
- [ ] 首批演示默认拓扑：DM 优先 / Group 优先 / 混合
- [ ] 首个迭代优先页：`/` 或 `/market`

---
更新规则：每次计划变更，直接修改本文件并记录更新时间。
