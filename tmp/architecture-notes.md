# Agent Network 架构定位说明（KITE-GASLESS / hop-ledger / tmp）

Last updated: 2026-03-01 (Asia/Shanghai)

本文件位于 `tmp/`，属于内部架构说明，不是对外产品文档。

## 1) 统一模型（Node / Protocol / Auditor）

### Node（节点）
- 一个可部署、可运行的执行实例，负责接收任务、执行流程、产出证据。
- 一个 Node 内可以有一个 Orchestrator 和多个 Actor（tool/agent/service）。
- PoC 阶段允许单进程承载多个 Actor（逻辑多主体，物理可单体）。

### Protocol（协议）
- 定义“如何可验证地表达执行过程”：事件结构、digest 计算、引用关系、复验规则。
- 协议目标是让第三方可独立验证“发生了什么”，而不是信任某个运行时口头描述。

### Auditor Node（审计节点）
- 消费 evidence/export，并独立复验 digest/refs/receipt 的一致性。
- 可是本地工具、CI 任务或第三方服务。

## 2) 三个位置在该模型中的准确定位

### `G:\KKK\KITE GASLESS`（GitHub: `enderzcx/KITE-GASLESS`）

定位：**Agent 网络中的一个 Node 实现（Runtime + Demo Plane）**

- 这里不是“只做 UI”，而是可运行的节点实现。
- 包含 agent 之间网络交互的 demo（node-to-node interaction demo）。
- 负责后端 API、编排、可观测、证据导出等运行时能力。
- 负责执行 parity，对齐 `hop-ledger` 参考协议，避免实现漂移。

### `G:\KKK\KITE GASLESS\tmp\plan-agent-audit-poc.md`

定位：**该 Node（OpenClaw）内部能力建设计划（Internal Capability Plan）**

- 这是后续要做的“节点内部可视化/可审计/可控制面”计划文档。
- 关注 `ops` 视图、timeline、quote/sla/rationale、verify、kill switch 等内部能力。
- 它是研发路线图，不是协议规范本体，也不是独立运行节点。

### `G:\KKK\KITE GASLESS\hop-ledger`（独立仓库）

定位：**Agent 网络之间可审计协议的参考实现（Protocol Reference / Verifier Baseline）**

- 提供 digest/evidence 一致性参考逻辑。
- 为跨节点审计与第三方复验提供“协议正确性基线”。
- 不承载产品级 orchestrator/UI 逻辑。

## 3) 依赖方向（必须保持）

- `KITE-GASLESS` 产出运行结果与证据。
- `KITE-GASLESS` 对 `hop-ledger` 做 parity 检查。
- `hop-ledger` 作为协议参考与审计基线，不反向控制 `KITE-GASLESS` 的产品编排。

一句话：
- 运行与交互在 `KITE-GASLESS`。
- 协议与复验基线在 `hop-ledger`。
- 研发推进计划在 `tmp/`。

## 4) 你问的“三者先后顺序”建议

### 推荐顺序
1. **先做 `tmp/plan-agent-audit-poc.md` 对应能力在 `KITE-GASLESS` 的落地（Phase 1/2/3/4）**
2. **并行保持 `hop-ledger` parity 持续通过（每个里程碑都跑）**
3. **最后再扩展或打磨网络交互 demo 的展示层与叙事**

### 为什么这个顺序
- 没有节点内部结构化事件与可视化，你很难稳定地演示“可审计网络交互”。
- `hop-ledger` 的价值在于“防漂移”，所以要并行校验，而不是等最后补救。
- demo 展示应建立在可复验、可解释、可中断（kill switch）的硬能力之上。

## 5) 接下来一周可执行任务（建议）

1. 在 `KITE-GASLESS` 完成 Phase 1/2 最小闭环：
   - 结构化 audit 事件落库（quote/sla/rationale/workflow/decision）。
   - `GET /api/network/runs` + `GET /api/network/audit/:traceId` + `GET /api/network/audit/:traceId/verify`。
2. 完成 Phase 3 的 kill switch：
   - 控制面接口 + 闸门拦截点落地（run/dispatch/pay/proof/order 入口前拦截）。
3. 完成 Phase 4 的 `/ops`：
   - runs 列表 + timeline + quote/sla/rationale + verify + kill + evidence 下载。
   - 每次改动后执行 `npm --prefix backend run parity:hopledger`，作为合并前门禁之一。

