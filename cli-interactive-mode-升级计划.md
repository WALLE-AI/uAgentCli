## Plan: lightweight interactive-mode upgrades for cli/main.ts (borrowing from Claude Code's REPL, staying readline-based)

### Context

用户希望参考 `opensource/claude-code-main` 的 CLI 交互模式，给现在的 CLI 做优化。Claude Code 的 REPL（`src/screens/REPL.tsx` + `src/ink/`）是一整套自研的 React/Ink 终端渲染框架（自定义 reconciler、原生 Yoga 布局引擎，几千行代码）——照搬会让这个项目的规模暴涨。用户已确认方向：**借鉴高价值的交互模式，用原生终端手段实现，保持现在的 `node:readline` 架构，不引入 TUI 框架。**

对照 Claude Code 找到的几个值得借鉴的点，以及 `src/cli/main.ts` 现状的差距：

1. **流式输出**——Claude Code 增量渲染 `text_delta`。我们的 `consumeLlmStream()`（`src/core/run-loop.ts`）把整轮回复默默攒完才返回，CLI 只在全部跑完后打印 `extractFinalText()`——长回复完全看不到进度。
2. **Slash 命令**——Claude Code 有统一的命令注册表（`src/commands.ts`）。我们现在只在 `rl.on('line', ...)` 里内联特判了一个 `/abort`。
3. **Ctrl+C 中断**——Claude Code 的 `useCancelRequest.ts`：单次按下中断当前轮，短时间窗口内连按两次退出进程。我们现在完全没有 SIGINT 处理。
4. **权限模式切换**——`permission/mode.ts` 已经定义了 `default | acceptEdits | plan | dontAsk | bypass | yolo`，但 `cli/main.ts` 到处硬编码 `mode: 'default'`，用户从终端根本没法切换。
5. **输入历史**——Node 的 `readline.createInterface` 在 TTY 下本来就自带上下箭头历史，不用写代码，现场确认一下就行。

**排查过程中发现的既存 bug**：`runRepl()` 给整个 REPL 进程只建了一个 `AbortController`，每一轮都复用同一个 `ctx`（也就是同一个 `signal`）。`/abort` 一旦触发过一次，`controller.signal.aborted` 就永远是 `true`——后面每一轮 `runInnerLoop` 第一件事就检测到 `ctx.signal.aborted` 为真，直接判定为 `aborted` 终止。**`/abort` 现在一个 REPL 会话里只能用一次**。这个必须在加 Ctrl+C 处理的同时一起修（根因相同）。

### 改动内容

**1. 流式输出**（`src/core/run-loop.ts` + `src/cli/main.ts`）
- 给 `RunLoopStaticInput` 加一个可选字段 `onTextDelta?: (text: string) => void`。
- 穿透到 `consumeLlmStream`/`consumeLlmStreamWithRetry`/`runInnerLoop` 的调用点（纯增量可选字段，不影响任何现有调用点和测试）。
- `cli/main.ts` 里设成 `onTextDelta: (text) => process.stdout.write(text)`，回复变成增量打印。
- 在 `test/core/run-loop.unit.test.ts` 加一个用 mock provider 吐多个 `text_delta` 事件、断言回调按序收到每个分片的单测。

**2. Slash 命令注册表**（新建 `src/cli/repl-commands.ts`，接入 `runRepl()`）
- 小而可测的模块：`dispatchReplCommand(input, ctx): boolean`。
- 命令：`/help`（列出命令）、`/clear`（把 `state` 重置成全新 epoch/messages）、`/exit`（优雅 `rl.close()`）、`/abort`（走 `ctx.requestAbort()`）、`/mode [name]`（不带参数打印当前模式；带参数校验是否属于 `PermissionMode` 联合类型，设置 `toolDeps.mode` 并确认；未知模式名给出清晰的可选列表）。
- 配套 `test/cli/repl-commands.test.ts`：每个命令的效果、未知命令 fallthrough 返回 `false`、`/mode badname` 被拒绝。

**3. Ctrl+C 中断 + 顺带修掉 abort 复用 bug**（`src/cli/main.ts`）
- 先修根因：`runRepl()` 里每一轮都要用**全新**的 `AbortController`/`ctx.signal`，不能只在 `bootstrap()` 里建一次。`/abort` 和 Ctrl+C 操作的都是"当前这一轮"的 controller。
- 用一个 `isRunning` 布尔量包住 `runOuterLoop(...)` 调用。
- `rl.on('SIGINT', ...)`：如果当前有轮次在跑，中断它并给提示；如果没有，要求 ~2 秒内连按两次才真正退出（否则重新出现提示符）——按这个项目的体量借鉴 Claude Code 的"确认窗口"模式，不需要它那套"杀掉所有后台 agent"的逻辑。

**4. 确认 `/mode` 真的生效**
- 已确认（读了 `run-loop.ts` 的 `resolveToolPermission`）：`checkToolPermission()` 运行时实际读的是 `toolDeps.mode`，不是 `ctx.permission.mode`——`/mode` 必须改的是 `toolDeps.mode`（本来就是普通可变字段，非 readonly）才能真正生效。

**5. 输入历史**
- 不用改代码。现场验证：跑起 REPL，发两条消息，确认按上箭头能翻回去。

### 验证

- `npx tsc --noEmit` + `npx vitest run`（现状 66 文件 / 486 用例，必须保持全绿）。
- 真实 API（`.env` 已配好 DeepSeek）现场跑：
  - 一次 `--once` 调用，确认输出是增量打印而不是等全部跑完才一次性出现。
  - 一次 REPL 会话：`/help`、`/mode acceptEdits`（或 `bypass`）后触发一次写/改动确认真的跳过了确认提示、`/clear` 后追问确认上文真的没了、**同一会话里连续 `/abort` 两次**确认复用 bug 真的修好了、长回复中途 Ctrl+C 确认单击中断/双击退出。
