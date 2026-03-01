# One-Person Company OpenClaw Demo

这个目录是 KITE-GASLESS 的“节点内部”业务流演示，主题是 `一人公司（One-Person Company）`。

## 目标
- 在单节点内模拟“一人公司”最小业务闭环：
  `获客需求 -> 双路分析 -> 协商条款 -> 审计追踪`。
- 对应输出：
  - run 摘要：`/api/network/runs`
  - timeline + 协商条款：`/api/network/audit/:traceId`

## 业务流程（Demo 版）
1. Lead Intake（接单）
2. Info + Technical 双路分析（两个 Actor 并行）
3. Quote/SLA/Rationale 结构化选择
4. 审计沉淀（run/timeline，可继续导出 evidence）

## 前置条件
- 后端已启动（默认 `http://127.0.0.1:3001`）。
- 如果鉴权开启，提供 `agent/viewer` API Key。

## 运行

```bash
node demo/one-person-company-openclaw/run-one-person-company-demo.mjs --base http://127.0.0.1:3001 --api-key <KITECLAW_API_KEY_AGENT>
```

可选参数：
- `--wait-ms 15000`
- `--no-retry-on-timeout`
- `--no-auto-start`

## 输出
- Run traceId
- run 摘要表
- 协商条款（Quote/SLA/Rationale）
- timeline 预览（前 12 条）