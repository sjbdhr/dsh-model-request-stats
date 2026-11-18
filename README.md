# dsh-model-request-stats

**Per-session model request statistics for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — including an honest `tok/s` that pays for connection, queueing and retry time.**

English | [简体中文](#简体中文)

The built-in composer `tok/s` divides output tokens by the decode window only (first token → message). It silently drops the time spent connecting to the model, waiting in a queue, and retrying after a timeout or a failed attempt. This plugin shows a second reading next to it:

```
Requests 12 · Failed 3 · Overall 84.2 tok/s
```

- **Requests / Failed** — model request attempts in the open session, and how many of them failed.
- **Overall tok/s** — all output tokens ÷ the sum of each request's full wall time: `step/start` → the step's last model settle. Connection, queueing, retry backoff and failed attempts inside the step are all included.
- Click the pill for a panel with attempts, completed, failed, cancelled, failure rate, model time, output tokens, overall speed, retries, a ranked breakdown of failure reasons (with proportional bars), and the latest failure detail.

## Install

```sh
# Web profile
dsh plugin --profile web add github:sjbdhr/dsh-model-request-stats

# Desktop profile
dsh plugin --profile desktop add github:sjbdhr/dsh-model-request-stats
```

Requires DSH `>=0.2.2-rc.1` (also compatible with 0.2.0-rc.2 / 0.2.1-rc.2 profiles) and the session projection registry, which every standard profile mounts.

No build step, no native modules, no network calls: `host.js` is plain ESM and `client.js` is a self-contained module-loader bundle.

## What the numbers mean

Every figure folds from the session's durable log, so reloads, resume, paging and compaction do not change it. The plugin never sends a model request and never writes to the session.

| Reading | Meaning |
|---|---|
| Requests | Every model request attempt recorded in the log: `assistant/message` (committed) plus `assistant/attempt` (no message: failed, retried or cancelled). |
| Completed | Attempts that committed a non-interrupted message. |
| Failed | Attempts that ended in an error. A user cancellation is **not** a failure. |
| Cancelled | Attempts the user or turn cancelled (interrupted message or aborted stream). |
| Failure rate | `failed / (completed + failed)` — cancellations are excluded. |
| Model time | Sum over steps of `step/start` → the step's last settle, once per step. |
| Retries | `llm/retry` events recorded by the retry executor. |
| Overall speed | `tokens / model time`. This is the reading the built-in `tok/s` understates. |
| Failure reasons | Provider failure code + optional HTTP status, ranked by count. A failure whose reason never reaches the log lands in **Reason not recorded** instead of being guessed. |

Notes:

- A cancelled step assembles no message, so it contributes no model time; it is still counted as a request/cancellation.
- The pill renders only once the session has at least one model request; the speed segment appears once tokens and model time exist.
- Subagent sessions are their own sessions and have their own reading.

## How it works

```
host.js    → registers the modelRequestStats session projection unit (a pure fold over committed events)
client.js  → registers one entry in conversation.composer.dock and renders the pill + panel
```

The client reads the projection value through `useProjection('modelRequestStats')`; it folds no events itself, so the browser always renders the same whole-session numbers a reload would.

Failure attribution order, from the log only:

1. The attempt's embedded stream finish chunk, when it carries an error.
2. The following `llm/retry` event, when the attempt is retried.
3. The closing `turn/end` error reason, when the attempt ends the turn.

## Development

No toolchain required — Node 22+ or 24+:

```sh
node verify/fold.test.mjs     # projection fold: counting, attribution, idempotent replay
node verify/client.test.mjs   # module-loader bundle: id, dictionaries, dock registration
```

## License

MIT © 2026 sjbdhr

---

## 简体中文

**会话级模型请求统计插件——把连接模型、排队和重试等待都算进去的 `tok/s`。**

内置的 `tok/s` 只用「首个 token → 消息」的解码窗口做分母，连接模型、排队、超时与失败重试的耗时都被排除在外。本插件在输入框下方的停靠栏增加一个读数：

```
访问 12 · 失败 3 · 整体 84.2 tok/s
```

- **访问 / 失败**：当前会话的模型请求次数与失败次数。
- **整体 tok/s**：全部输出 tokens ÷ 每次请求的完整耗时（`step/start` → 该步最后一次模型落定）。连接、排队、重试等待与步内失败尝试都计入其中。
- 点击读数展开面板：访问、成功、失败、已取消、失败率、模型耗时、输出 tokens、整体速度、重试次数，按次数排序的失败原因比例条，以及最近一次失败的详情。

### 安装

```sh
dsh plugin --profile web add github:sjbdhr/dsh-model-request-stats
```

需要 DSH `>=0.2.2-rc.1`，以及标准配置默认挂载的会话投影注册表。无需构建、无原生模块、无网络请求。

### 口径说明

所有数字都来自会话持久日志的折叠，刷新、恢复、翻页与压缩都不会改变；插件不发起模型请求，也不写会话。

| 读数 | 含义 |
|---|---|
| 访问 | 日志中的每次模型请求尝试：`assistant/message`（落定消息）与 `assistant/attempt`（无消息：失败/重试/取消）。 |
| 成功 | 落定了非中断消息的尝试。 |
| 失败 | 以错误结束的尝试；用户主动取消**不计**为失败。 |
| 已取消 | 用户或轮次取消的尝试。 |
| 失败率 | `失败 / (成功 + 失败)`，不含取消。 |
| 模型耗时 | 每个 step 的 `step/start` → 最后一次落定之和，一步只计一次。 |
| 重试 | 重试执行器记录的 `llm/retry` 事件数。 |
| 整体速度 | `tokens / 模型耗时`。 |

某个 step 被取消时不会组装消息，因此不贡献模型耗时，但仍计入访问与取消；日志中没有记录原因的失败会归入「未记录原因」，不做推测。
