# Claude Code 深度技术架构流程图

> 基于 `opensource/claude-code-main/src` 源码逐模块深度剖析（~1900 文件 / 512K+ 行 TypeScript，Bun 运行时，React + Ink 终端 UI）。
> 所有关键路径均标注 `文件:行号`，可直接跳转源码。

---

## 目录

1. [顶层系统架构总览](#1-顶层系统架构总览)
2. [启动与入口分发流程](#2-启动与入口分发流程)
3. [核心 Agent 循环（query loop）](#3-核心-agent-循环query-loop)
4. [模型调用与流式处理](#4-模型调用与流式处理)
5. [工具系统抽象与执行编排](#5-工具系统抽象与执行编排)
6. [权限系统（两层设计）](#6-权限系统两层设计)
7. [上下文与 Token 管理（压缩机制）](#7-上下文与-token-管理压缩机制)
8. [Slash 命令系统](#8-slash-命令系统)
9. [外部服务层（MCP / Auth / LSP / GrowthBook）](#9-外部服务层mcp--auth--lsp--growthbook)
10. [多 Agent 编排（Coordinator / Swarm / Tasks）](#10-多-agent-编排coordinator--swarm--tasks)
11. [Skills 与 Plugins 系统](#11-skills-与-plugins-系统)
12. [记忆系统（三套）](#12-记忆系统三套)
13. [生命周期 Hooks 系统](#13-生命周期-hooks-系统)
14. [IDE Bridge / Remote / Server](#14-ide-bridge--remote--server)
15. [端到端一次对话完整时序](#15-端到端一次对话完整时序)
16. [关键文件索引](#16-关键文件索引)

---

## 1. 顶层系统架构总览

```mermaid
graph TB
    subgraph ENTRY["入口层 (Entry)"]
        CLI["entrypoints/cli.tsx<br/>快速路径路由 main()"]
        MAIN["main.tsx<br/>Commander.js + 模式分发"]
        INIT["entrypoints/init.ts<br/>初始化(memoized)"]
    end

    subgraph UI["UI 层 (Ink/React TUI)"]
        REPL["screens/REPL.tsx<br/>主交互组件"]
        PROMPT["components/PromptInput<br/>键盘输入"]
        MSG["components/messages/*<br/>消息渲染"]
        PERM["components/permissions/*<br/>权限对话框"]
        INK["ink/ink.tsx<br/>自定义 React Reconciler + Yoga"]
    end

    subgraph CORE["核心引擎 (Core Engine)"]
        QUERY["query.ts<br/>queryLoop while(true)<br/>核心 Agent 循环"]
        QENGINE["QueryEngine.ts<br/>SDK/REPL 包装器"]
        CLAUDE["services/api/claude.ts<br/>queryModel 模型调用"]
        ORCH["services/tools/<br/>toolOrchestration<br/>StreamingToolExecutor"]
    end

    subgraph TOOLS["工具层 (Tools)"]
        TREG["tools.ts<br/>工具注册表"]
        TDEF["Tool.ts<br/>Tool 类型定义"]
        TIMPL["tools/*<br/>~40 个工具实现"]
        PERMSYS["hooks/toolPermission/<br/>utils/permissions/<br/>权限判定"]
    end

    subgraph CMD["命令层 (Commands)"]
        CREG["commands.ts<br/>命令注册表"]
        CIMPL["commands/*<br/>~50 slash 命令"]
    end

    subgraph SVC["服务层 (Services)"]
        MCP["services/mcp/<br/>MCP 协议"]
        OAUTH["services/oauth/<br/>OAuth 2.0 + PKCE"]
        LSP["services/lsp/<br/>语言服务器"]
        GB["services/analytics/<br/>GrowthBook 特性开关"]
        COMPACT["services/compact/<br/>上下文压缩"]
    end

    subgraph AGENT["多 Agent 与任务"]
        COORD["coordinator/<br/>协调者模式"]
        SWARM["utils/swarm/<br/>团队/蜂群"]
        TASKS["tasks/*<br/>后台任务"]
        SKILLS["skills/<br/>技能"]
        PLUGINS["plugins/<br/>插件"]
    end

    subgraph PERSIST["持久化与记忆"]
        MEMDIR["memdir/<br/>跨会话自动记忆"]
        SESSMEM["services/SessionMemory<br/>会话记忆"]
        TEAMMEM["services/teamMemorySync<br/>团队记忆(服务端同步)"]
        STATE["state/AppStateStore<br/>应用状态"]
        BOOT["bootstrap/state.ts<br/>全局状态(cost/otel/session)"]
    end

    subgraph EXT["外部连接"]
        BRIDGE["bridge/<br/>IDE/claude.ai 远程控制"]
        REMOTE["remote/<br/>CCR 云会话"]
        SERVER["server/<br/>本地直连服务"]
    end

    CLI --> MAIN --> INIT
    MAIN --> REPL
    REPL --> PROMPT
    PROMPT --> QUERY
    REPL --> QENGINE --> QUERY
    QUERY --> CLAUDE
    QUERY --> ORCH
    ORCH --> TREG
    TREG --> TDEF
    TREG --> TIMPL
    ORCH --> PERMSYS
    PERMSYS --> PERM
    QUERY --> CMD
    CREG --> CIMPL
    CLAUDE --> OAUTH
    TREG --> MCP
    QUERY --> COMPACT
    TIMPL --> AGENT
    COORD --> TASKS
    SWARM --> TASKS
    AGENT --> PERSIST
    QUERY --> PERSIST
    MAIN --> EXT
    BRIDGE --> REPL
    CLAUDE -.gates.-> GB
    QUERY --> MSG

    classDef entry fill:#e1f5ff,stroke:#0277bd
    classDef core fill:#fff3e0,stroke:#e65100
    classDef tool fill:#f3e5f5,stroke:#6a1b9a
    classDef svc fill:#e8f5e9,stroke:#2e7d32
    classDef persist fill:#fce4ec,stroke:#c2185b
    class CLI,MAIN,INIT entry
    class QUERY,QENGINE,CLAUDE,ORCH core
    class TREG,TDEF,TIMPL,PERMSYS tool
    class MCP,OAUTH,LSP,GB,COMPACT svc
    class MEMDIR,SESSMEM,TEAMMEM,STATE,BOOT persist
```

**技术栈**：Bun 运行时 · TypeScript(strict) · React + Ink(终端 React) · Commander.js(CLI 解析) · Zod v4(schema) · ripgrep(搜索) · MCP SDK + LSP · Anthropic SDK · OpenTelemetry + gRPC(遥测) · GrowthBook(特性开关) · OAuth 2.0/JWT/Keychain(认证)。

**两套"开关"机制**（贯穿全局）：
- `feature('X')`（来自 `bun:bundle`）：**构建期** 死代码消除宏（全库 196 处），按构建口味(external / ant)裁剪整段代码。
- **GrowthBook** 运行时标志：远程评估的按用户灰度开关，`getFeatureValue_CACHED_MAY_BE_STALE()`。

---

## 2. 启动与入口分发流程

```mermaid
flowchart TD
    START([进程启动]) --> CLIENTRY["cli.tsx:302 void main()"]
    CLIENTRY --> FASTPATH{"快速路径路由<br/>(全动态 import)"}

    FASTPATH -->|"--version"| VER["零导入返回版本"]
    FASTPATH -->|"remote-control/rc/bridge"| BRIDGE["bridgeMain()<br/>远程控制"]
    FASTPATH -->|"--daemon-worker"| DAEMON["精简守护进程"]
    FASTPATH -->|"mcp serve"| MCPSRV["startMCPServer()"]
    FASTPATH -->|"默认路径"| CAPTURE["startCapturingEarlyInput()<br/>缓冲加载期键盘输入"]

    CAPTURE --> IMPORTMAIN["import('../main.js')<br/>cliMain()"]
    IMPORTMAIN --> MAINFN["main.tsx:585 main()"]

    MAINFN --> ARGV["argv 改写<br/>(direct-connect/deeplink/ssh)"]
    ARGV --> MODEDET{"模式判定<br/>-p/--print? isTTY?"}
    MODEDET --> EAGER["eagerLoadSettings()<br/>预解析 --settings"]
    EAGER --> RUN["run() → Commander"]

    RUN --> PREACTION["program.hook('preAction')<br/>共享初始化门"]
    PREACTION --> JOIN["Promise.all([<br/>MDM设置, Keychain预取])"]
    JOIN --> INITFN["init() 初始化<br/>configs/OAuth/GrowthBook/<br/>预连接API/mTLS/agents"]
    INITFN --> SINKS["initSinks() + runMigrations()"]

    SINKS --> ACTION{".action 分支"}
    ACTION -->|"非交互 isNonInteractive"| HEADLESS["runHeadless()<br/>print.js 驱动 query()"]
    ACTION -->|"--init-only"| INITONLY["setup + SessionStart hook 后退出"]
    ACTION -->|"交互 REPL"| SETUP["setup.ts:56 setup()<br/>cwd/hooks快照/worktree/<br/>session memory/tengu_started"]

    SETUP --> RENDER["createRoot()<br/>new Ink() 实例"]
    RENDER --> DIALOGS["showSetupScreens<br/>onboarding/trust/MCP批准"]
    DIALOGS --> LAUNCH["launchRepl()"]
    LAUNCH --> MOUNT["renderAndRun()<br/>root.render(&lt;App&gt;&lt;REPL/&gt;&lt;/App&gt;)"]
    MOUNT --> DEFER["startDeferredPrefetches()<br/>首帧后预热缓存"]
    DEFER --> WAIT["waitUntilExit() 阻塞"]

    classDef fast fill:#e3f2fd,stroke:#1565c0
    classDef init fill:#fff8e1,stroke:#f9a825
    classDef ui fill:#f1f8e9,stroke:#558b2f
    class FASTPATH,VER,BRIDGE,DAEMON,MCPSRV fast
    class PREACTION,JOIN,INITFN,SINKS init
    class RENDER,DIALOGS,LAUNCH,MOUNT,DEFER ui
```

**启动优化三板斧**：
- **模块级并行预取**（`main.tsx:1-20`，在重导入前触发）：`startMdmRawRead()`（MDM 子进程，重叠 ~135ms 导入）、`startKeychainPrefetch()`（macOS 钥匙串双读并行，省 ~65ms）。在 `preAction` 处 join。
- **懒加载**：几乎每个屏幕/对话框都是动态 `import()`；OpenTelemetry(~400KB)、gRPC(~700KB) 延迟到实际使用。
- **API 预连接**：`preconnectAnthropicApi()` 在 init 阶段与后续 action 处理重叠 TLS 握手。

---

## 3. 核心 Agent 循环（query loop）

> `query.ts` 的 `queryLoop()` 是真正的 Agent 主循环（`query.ts:307` 的 `while(true)`）。`QueryEngine.ts` 只是 SDK/REPL 侧包装器，本身不含循环。

```mermaid
flowchart TD
    ENTRY["query() query.ts:219<br/>→ queryLoop() :241"] --> STATE["初始化可变 State<br/>messages/toolUseContext/<br/>turnCount/transition..."]
    STATE --> LOOP{{"while(true) :307"}}

    LOOP --> REQSTART["yield stream_request_start"]
    REQSTART --> PREP["上下文预处理管线<br/>(均在 API 调用前)"]

    subgraph PREP_PIPE["压缩管线(顺序)"]
        P1["applyToolResultBudget<br/>工具结果预算裁剪"]
        P2["snip (HISTORY_SNIP)"]
        P3["microcompact<br/>按 tool_use_id 折叠"]
        P4["contextCollapse 投影"]
        P5["autoCompact 自动压缩<br/>阈值触发"]
        P1-->P2-->P3-->P4-->P5
    end
    PREP --> PREP_PIPE

    PREP_PIPE --> BLOCK{"硬阻塞限制?<br/>calculateTokenWarningState"}
    BLOCK -->|"是"| TERMBLOCK["return Terminal<br/>{blocking_limit}"]
    BLOCK -->|"否"| MODELCALL

    MODELCALL["while(attemptWithFallback)<br/>for await deps.callModel(...)"] --> STREAM["流式处理事件"]
    STREAM --> COLLECT["收集 assistant 消息<br/>过滤 tool_use 块"]
    COLLECT --> TOOLDETECT{"有 tool_use 块?"}

    STREAM -.捕获.-> FALLBACK["FallbackTriggeredError<br/>→ 切换 fallbackModel<br/>重置执行器, continue"]

    TOOLDETECT -->|"needsFollowUp=true"| RUNTOOLS["执行工具(见 §5)"]
    TOOLDETECT -->|"false 无工具"| ENDPATH["终止判定路径"]

    subgraph ENDPATH_DETAIL["终止判定(无工具时)"]
        E1["413/媒体错误恢复<br/>collapse/reactiveCompact"]
        E2["max_output_tokens 恢复<br/>升级 ESCALATED_MAX_TOKENS"]
        E3["handleStopHooks<br/>Stop/SubagentStop hooks"]
        E4["checkTokenBudget<br/>预算未尽→注入nudge继续"]
        E1-->E2-->E3-->E4
    end
    ENDPATH --> ENDPATH_DETAIL

    ENDPATH_DETAIL -->|"preventContinuation"| TERMSTOP["return {stop_hook_prevented}"]
    ENDPATH_DETAIL -->|"blockingErrors"| CONTHOOK["注入错误, continue<br/>{stop_hook_blocking}"]
    ENDPATH_DETAIL -->|"预算继续"| CONTBUDGET["注入nudge, continue<br/>{token_budget_continuation}"]
    ENDPATH_DETAIL -->|"正常完成"| TERMDONE["return {completed}"]

    RUNTOOLS --> COLLECTRES["收集 toolResults<br/>+ attachments/队列命令/<br/>memory/skill 预取"]
    COLLECTRES --> MAXTURN{"maxTurns 超限?"}
    MAXTURN -->|"是"| TERMMAX["return {max_turns}"]
    MAXTURN -->|"否"| NEXTSTATE["state = {messages:[...msgs,<br/>...assistant,...toolResults],<br/>transition:next_turn}"]
    NEXTSTATE --> LOOP

    CONTHOOK --> LOOP
    CONTBUDGET --> LOOP
    FALLBACK --> MODELCALL

    classDef term fill:#ffebee,stroke:#c62828
    classDef cont fill:#e8f5e9,stroke:#2e7d32
    class TERMBLOCK,TERMSTOP,TERMDONE,TERMMAX term
    class CONTHOOK,CONTBUDGET,NEXTSTATE cont
```

**循环关键点**：
- **工具检测靠 tool_use 块存在性**（非 `stop_reason`，注释 `query.ts:554` 指出后者不可靠）。
- **Terminal 终止原因**：`blocking_limit / image_error / model_error / aborted_streaming / prompt_too_long / completed / stop_hook_prevented / aborted_tools / hook_stopped / max_turns`。
- **Continue 续跑原因**：`collapse_drain_retry / reactive_compact_retry / max_output_tokens_escalate / max_output_tokens_recovery / stop_hook_blocking / token_budget_continuation / next_turn`。
- **Stop hook 可强制模型继续工作**：返回 `blockingErrors` 时注入并 continue。

---

## 4. 模型调用与流式处理

> `deps.callModel = queryModelWithStreaming`（`claude.ts:752`）→ `queryModel`（`claude.ts:1017`）。

```mermaid
flowchart TD
    CALL["queryModelWithStreaming<br/>claude.ts:752"] --> VCR["withStreamingVCR<br/>录制/回放包裹"]
    VCR --> QMODEL["queryModel claude.ts:1017"]

    QMODEL --> BUILD["构建请求参数"]
    subgraph PARAMS["请求组装"]
        TH["Thinking 模式<br/>自适应: {type:enabled}<br/>或 budget_tokens 计算"]
        CACHE["addCacheBreakpoints<br/>恰好1个 cache_control 标记<br/>(length-1 或 skipCacheWrite时-2)"]
        TOOLSEARCH["Tool Search 延迟工具过滤<br/>defer_loading beta 头"]
        BETAS["getMergedBetas 合并 beta 头"]
    end
    BUILD --> PARAMS

    PARAMS --> RETRY["withRetry(getClient, op)"]
    RETRY --> APICALL["anthropic.beta.messages.create<br/>{...params, stream:true}<br/>.withResponse()"]

    RETRY -.重试决策.-> RD{"withRetry.ts"}
    RD -->|"连续3次529+有fallback"| FBERR["throw FallbackTriggeredError"]
    RD -->|"400 上下文溢出"| RECOMP["重算 maxTokens, continue"]
    RD -->|"可重试"| BACKOFF["指数退避<br/>BASE_DELAY=500ms"]
    RD -->|"不可重试"| CANTRETRY["throw CannotRetryError"]

    APICALL --> STREAMLOOP["for await part of stream<br/>claude.ts:1940"]
    STREAMLOOP --> SWITCH{"switch(part.type)"}
    SWITCH -->|"message_start"| MS["usage/ttft 采集"]
    SWITCH -->|"content_block_start"| CBS["累积 tool_use/text/<br/>thinking/server_tool_use"]
    SWITCH -->|"message_delta"| MD["最终 usage + stop_reason<br/>→ 成本累加"]
    SWITCH -->|"message_stop"| MSTOP["结束"]
    SWITCH --> REEMIT["yield {type:stream_event,<br/>event:part}"]

    STREAMLOOP -.90s空闲.-> WATCHDOG["idle-timeout 看门狗<br/>中止挂起流→非流式回退"]
    WATCHDOG --> NONSTREAM["executeNonStreamingRequest<br/>claude.ts:818"]

    MD --> COST["addToTotalSessionCost<br/>cost-tracker.ts:278"]
    COST --> COSTDETAIL["按模型累积 usage +<br/>OTel counters +<br/>advisor 子用量递归计费"]

    classDef err fill:#ffebee,stroke:#c62828
    class FBERR,CANTRETRY,RECOMP err
```

**要点**：
- **Thinking 模式**：开启时 `temperature` 强制为 1（API 要求）；关闭时才可自定义温度。
- **Prompt 缓存**：`skipCacheWrite`（fire-and-forget fork）时缓存标记放 `length-2`，共享父级缓存。
- **多 Provider**：`getAnthropicClient` 按 env 分支 Bedrock / Foundry(Azure) / Vertex / 第一方。

---

## 5. 工具系统抽象与执行编排

### 5.1 Tool 类型抽象（`Tool.ts`）

```mermaid
graph LR
    subgraph TOOLTYPE["Tool&lt;Input,Output,P&gt; 类型 (Tool.ts:362)"]
        ID["身份: name/aliases/searchHint<br/>inputSchema(Zod)/inputJSONSchema"]
        PRED["行为谓词:<br/>isEnabled/isReadOnly<br/>isConcurrencySafe/isDestructive<br/>shouldDefer/alwaysLoad"]
        VALID["校验+权限:<br/>validateInput→checkPermissions<br/>preparePermissionMatcher<br/>backfillObservableInput"]
        EXEC["执行: call(args,ctx,<br/>canUseTool,parentMsg,onProgress)<br/>→ Promise&lt;ToolResult&gt;"]
        RENDER["渲染: renderToolUseMessage<br/>renderToolResultMessage 等<br/>React 节点"]
    end

    BUILDTOOL["buildTool(def)<br/>Tool.ts:757<br/>TOOL_DEFAULTS 失败关闭填充"]
    BUILDTOOL --> TOOLTYPE
```

`buildTool` 默认值（fail-closed）：`isEnabled→true`、`isConcurrencySafe→false`、`isReadOnly→false`、`isDestructive→false`、`checkPermissions→{allow}`。

### 5.2 工具注册与组装

```mermaid
flowchart TD
    BASE["getAllBaseTools() tools.ts:193<br/>所有可能工具"] --> GATES["条件裁剪"]
    subgraph GATE_DETAIL["裁剪条件"]
        G1["USER_TYPE==='ant'<br/>→Config/Tungsten/REPL"]
        G2["feature('X') 构建期<br/>→Sleep/Cron/Monitor/Workflow"]
        G3["运行时: isTodoV2Enabled<br/>isWorktreeModeEnabled<br/>isAgentSwarmsEnabled<br/>hasEmbeddedSearchTools"]
    end
    GATES --> GATE_DETAIL

    GATE_DETAIL --> GETTOOLS["getTools(permCtx) tools.ts:271"]
    GETTOOLS --> SIMPLE{"CLAUDE_CODE_SIMPLE?"}
    SIMPLE -->|"是"| SIMPLETOOLS["仅 Bash/Read/Edit"]
    SIMPLE -->|"否"| DENYFILTER["filterToolsByDenyRules<br/>移除黑名单(含 mcp__server 前缀)"]
    DENYFILTER --> REPLMODE["REPL模式隐藏原语工具"]
    REPLMODE --> ISENABLED["isEnabled() 过滤"]

    ISENABLED --> ASSEMBLE["assembleToolPool tools.ts:345<br/>内置 + MCP工具"]
    ASSEMBLE --> DEDUP["uniqBy(name) 内置优先<br/>内置连续前缀(缓存优化)"]

    subgraph AGENTSCOPE["Agent 作用域裁剪 constants/tools.ts"]
        A1["ALL_AGENT_DISALLOWED_TOOLS<br/>(禁递归 AgentTool 等)"]
        A2["ASYNC_AGENT_ALLOWED_TOOLS<br/>子agent可用集"]
        A3["COORDINATOR_MODE_ALLOWED_TOOLS"]
    end
    DEDUP --> AGENTSCOPE
```

### 5.3 工具执行编排（两条路径）

```mermaid
flowchart TD
    QUERYLOOP["query.ts:1380 选择执行器"] --> WHICH{"streamingToolExecutor?"}

    WHICH -->|"流式路径(默认)"| STREAM["StreamingToolExecutor"]
    WHICH -->|"非流式路径"| RUNTOOLS["runTools()<br/>toolOrchestration.ts:19"]

    subgraph STREAMPATH["A. 流式执行器"]
        SADD["addTool(block) 边流边派发<br/>query.ts:842"]
        SPROC["processQueue()<br/>canExecuteTool 并发判定"]
        SDRAIN["getCompletedResults()<br/>流中途即回填 tool_result"]
        SSIB["每工具子 AbortController<br/>Bash错误→中止兄弟(sibling_error)"]
        SADD-->SPROC-->SDRAIN-->SSIB
    end
    STREAM --> STREAMPATH

    subgraph SERIALPATH["B. 非流式编排"]
        PART["partitionToolCalls<br/>按 concurrency-safe 分批"]
        CONC["安全批: runToolsConcurrently<br/>all(gen, max=10)"]
        SER["非安全批: runToolsSerially<br/>逐个执行, 立即应用 ctxModifier"]
        PART-->CONC
        PART-->SER
    end
    RUNTOOLS --> SERIALPATH

    STREAMPATH --> RESULTS["结果收集 query.ts:1384"]
    SERIALPATH --> RESULTS
    RESULTS --> NORM["normalizeMessagesForAPI<br/>→ toolResults(user角色)"]
    NORM --> SUMMARY["generateToolUseSummary<br/>(Haiku,非阻塞,主线程)"]

    classDef safe fill:#e8f5e9,stroke:#2e7d32
    class CONC,STREAMPATH safe
```

**并发模型**：连续的 **只读/并发安全** 工具组成一批并发执行（默认上限 10，env `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`）；**写/非安全** 工具串行执行且立即应用上下文修改。

### 5.4 单个工具执行内部流程（以 FileEdit 为例）

```mermaid
flowchart LR
    CALL["工具 call()"] --> VI["validateInput<br/>重校验:未读/过期/old_string缺失<br/>密钥泄露/deny目录"]
    VI -->|"失败"| VIERR["返回 errorCode 给模型"]
    VI -->|"通过"| CP["checkPermissions<br/>checkWritePermissionForTool"]
    CP --> CANUSE["canUseTool 权限判定(见§6)"]
    CANUSE -->|"allow"| EXEC["原子读改写:<br/>再校验staleness→备份历史→<br/>writeTextContent→LSP didChange<br/>→更新readFileState"]
    CANUSE -->|"deny/ask"| BLOCKED["阻断/提示用户"]
    EXEC --> RENDER["renderResult 渲染 diff"]
```

---

## 6. 权限系统（两层设计）

```mermaid
flowchart TD
    CANUSE["CanUseToolFn(tool,input,ctx,...)<br/>useCanUseTool.tsx:27"] --> LAYERA

    subgraph LAYERA["A层: 纯策略 hasPermissionsToUseTool"]
        S1a["1a getDenyRuleForTool<br/>整工具黑名单"]
        S1b["1b getAskRuleForTool<br/>整工具 ask 规则"]
        S1c["1c tool.checkPermissions()<br/>工具特定逻辑"]
        S1d["1d 工具返回 deny → 直接拒"]
        S1e["1e requiresUserInteraction+ask<br/>(bypass免疫)"]
        S1f["1f 内容级 ask 规则(bypass免疫)"]
        S1g["1g safetyCheck ask<br/>.git/.claude/shell配置<br/>(bypass免疫)"]
        S2a["2a bypass模式→allow"]
        S2b["2b toolAlwaysAllowedRule→allow"]
        S3["3 passthrough→ask"]
        S1a-->S1b-->S1c-->S1d-->S1e-->S1f-->S1g-->S2a-->S2b-->S3
    end

    LAYERA --> MODEXFORM{"模式变换"}
    MODEXFORM -->|"dontAsk"| ASK2DENY["ask→deny"]
    MODEXFORM -->|"auto(ant)"| CLASSIFIER["AI 安全分类器<br/>替代用户提示"]
    MODEXFORM -->|"default"| LAYERB

    subgraph LAYERB["B层: UI/副作用 useCanUseTool"]
        H1["handleCoordinatorPermission"]
        H2["handleSwarmWorkerPermission"]
        H3["speculative Bash 分类器竞速"]
        H4["handleInteractivePermission<br/>→ pushToQueue 权限对话框"]
        H1-->H2-->H3-->H4
    end

    LAYERB --> DIALOG["components/permissions/<br/>PermissionRequest 按工具身份分发"]
    DIALOG --> USER{"用户决策"}
    USER -->|"allow"| PERSIST["persistPermissions<br/>更新规则/上下文"]
    USER -->|"deny"| REJECT["cancelAndAbort"]

    classDef immune fill:#fff3e0,stroke:#e65100
    class S1e,S1f,S1g immune
```

**权限模式**：

| 模式 | 效果 |
|---|---|
| `default` | 完整管线，`ask` 提示用户 |
| `plan` | 只读意图；若从 bypass 启动亦可放行 |
| `acceptEdits` | 编辑经工具 checkPermissions 快速放行 |
| `bypassPermissions` | 2a 全放行，除 1d/1e/1f/1g 免疫项 |
| `dontAsk` | `ask` → `deny` |
| `auto`(ant) | `ask` 走 AI 安全分类器而非用户 |

**规则来源分层**：`userSettings / projectSettings / localSettings / flagSettings / policySettings / cliArg / command / session`。Shell 命令按 AST 拆分匹配（`ls && git push` 会触发 `Bash(git *)` 规则）。

---

## 7. 上下文与 Token 管理（压缩机制）

```mermaid
flowchart TD
    MSGS["消息历史"] --> BUDGET["applyToolResultBudget<br/>工具结果聚合上限"]
    BUDGET --> SNIP["snip (HISTORY_SNIP)<br/>裁剪历史"]
    SNIP --> MICRO["microcompact<br/>按 tool_use_id 折叠工具结果<br/>(缓存变体延迟边界)"]
    MICRO --> COLLAPSE["contextCollapse 投影<br/>(CONTEXT_COLLAPSE)"]
    COLLAPSE --> AUTO{"shouldAutoCompact?<br/>tokenCount ≥ 阈值"}

    AUTO -->|"是"| DOCOMPACT["autoCompactIfNeeded"]
    DOCOMPACT --> SESSMEM{"trySessionMemory<br/>Compaction?"}
    SESSMEM -->|"成功"| POSTCOMPACT["buildPostCompactMessages<br/>yield 摘要消息"]
    SESSMEM -->|"否"| TRADITIONAL["compactConversation<br/>传统总结压缩"]
    TRADITIONAL --> POSTCOMPACT

    AUTO -->|"否"| CONTINUE["继续正常调用"]

    DOCOMPACT -.失败.-> CB["circuit breaker<br/>连续3次失败停止"]

    subgraph THRESH["阈值计算 autoCompact.ts"]
        T1["effectiveWindow =<br/>contextWindow − min(maxOut,20k)"]
        T2["autoCompactThreshold =<br/>effectiveWindow − 13k(buffer)"]
        T3["blockingLimit =<br/>effectiveWindow − 3k"]
    end

    POSTCOMPACT --> REACTIVE["响应式压缩(REACTIVE_COMPACT)<br/>413/媒体错误后触发"]
    REACTIVE --> RECOVER["先 recoverFromOverflow<br/>再 tryReactiveCompact"]
```

**核心概念**：`task_budget.remaining` 跨压缩边界追踪服务端可见预算（每次压缩减去触发点的最终上下文窗口）。**Token 预算**（`TOKEN_BUDGET`）：预算未尽且未见收益递减时注入 nudge 消息续跑。

---

## 8. Slash 命令系统

```mermaid
flowchart TD
    INPUT["用户输入 /cmd args"] --> PARSE["parseSlashCommand<br/>slashCommandParsing.ts:25"]
    PARSE --> DISPATCH["processSlashCommand<br/>processSlashCommand.tsx:309"]
    DISPATCH --> HAS{"hasCommand?"}
    HAS -->|"否"| ISPATH{"是文件路径?"}
    ISPATH -->|"是"| ASPROMPT["当作普通 prompt"]
    ISPATH -->|"否"| UNKNOWN["Unknown skill 消息"]
    HAS -->|"是"| GETMSG["getMessagesForSlashCommand<br/>switch(command.type)"]

    GETMSG --> TYPE{"命令类型(3种)"}
    TYPE -->|"prompt"| PC["PromptCommand<br/>getPromptForCommand()<br/>→ ContentBlockParam[]<br/>→ query(shouldQuery:true)"]
    TYPE -->|"local"| LC["LocalCommand<br/>call()→{text|compact|skip}<br/>内联执行"]
    TYPE -->|"local-jsx"| LJC["LocalJSXCommand<br/>call(onDone)→ Ink UI<br/>setToolJSX"]

    PC --> FORK{"context==='fork'?"}
    FORK -->|"是"| FORKED["executeForkedSlashCommand<br/>子agent"]
    FORK -->|"否"| INLINE["内联注入消息"]

    subgraph REGISTRY["命令注册表 commands.ts"]
        R1["COMMANDS() 静态+feature()门"]
        R2["loadAllCommands(cwd):<br/>skills⊕plugins⊕workflows⊕MCP prompts"]
        R3["meetsAvailabilityRequirement<br/>(不缓存: /login 中途生效)"]
    end
    GETMSG -.查询.-> REGISTRY
```

**命令三态**（区分核心）：`prompt`(转成查询/skills/MCP prompts) · `local`(内联返回文本/压缩) · `local-jsx`(渲染 Ink UI)。示例：`/compact`(local)、`/review`(prompt)、`/mcp`/`/config`/`/resume`/`/model`(local-jsx)。

---

## 9. 外部服务层（MCP / Auth / LSP / GrowthBook）

### 9.1 MCP 集成

```mermaid
flowchart TD
    CONFIGS["getAllMcpConfigs()<br/>config.ts:1258"] --> LAYER["配置分层(优先级)"]
    subgraph LAYER_D["分层合并"]
        L1["enterprise(独占控制)"]
        L2["local"]
        L3["project(仅已批准)"]
        L4["user"]
        L5["plugin"]
        L6["claude.ai 连接器(最低)"]
        L1-.独占.->L2-->L3-->L4-->L5-->L6
    end
    LAYER --> LAYER_D
    LAYER_D --> POLICY["策略过滤<br/>isMcpServerAllowedByPolicy"]

    POLICY --> CONNECT["connectToServer()<br/>client.ts:595 (memoized)"]
    CONNECT --> TRANSPORT{"传输类型"}
    TRANSPORT -->|"stdio"| T1["StdioClientTransport<br/>SIGINT→SIGTERM→SIGKILL"]
    TRANSPORT -->|"sse"| T2["SSEClientTransport<br/>ClaudeAuthProvider"]
    TRANSPORT -->|"http"| T3["StreamableHTTPClientTransport"]
    TRANSPORT -->|"ws"| T4["WebSocketTransport mTLS"]
    TRANSPORT -->|"in-process"| T5["Chrome/ComputerUse<br/>LinkedTransportPair"]

    CONNECT --> DISCOVER["并行发现"]
    subgraph DISC["发现(memoized LRU)"]
        D1["fetchToolsForClient<br/>mcp__server__tool"]
        D2["fetchCommandsForClient<br/>prompts→Command"]
        D3["fetchResourcesForClient"]
        D4["fetchMcpSkillsForClient"]
    end
    DISCOVER --> DISC
    DISC --> MERGE["onConnectionAttempt<br/>→ AppState.mcp"]
```

### 9.2 认证流程

```mermaid
flowchart LR
    OAUTH["OAuthService<br/>PKCE codeVerifier"] --> FLOW["startOAuthFlow<br/>本地localhost监听 + 手动粘贴竞速"]
    FLOW --> EXCHANGE["exchangeCodeForTokens"]
    EXCHANGE --> TOKENS["OAuthTokens<br/>{access,refresh,expiresAt,<br/>subscriptionType,rateLimitTier}"]
    TOKENS --> CLIENT["getAnthropicClient<br/>client.ts:88"]
    CLIENT --> PROVIDER{"Provider 分支"}
    PROVIDER -->|"claude.ai订阅"| BEARER["authToken: Bearer OAuth"]
    PROVIDER -->|"console"| APIKEY["x-api-key"]
    PROVIDER -->|"Bedrock/Vertex/Foundry"| CLOUD["各云 SDK 凭证"]
```

### 9.3 特性开关（双机制）
- **`feature('X')`**：构建期宏（`bun:bundle`）→ 整段死代码消除。
- **GrowthBook**：`getGrowthBookClient()`(memoized，**trust 建立后** 才带认证头)；`getFeatureValue_CACHED_MAY_BE_STALE()`(首选，非阻塞：env→config→内存→磁盘缓存→默认)。登录/登出时 `refreshGrowthBookAfterAuthChange()` 重建客户端。

**设置分层**（后覆盖前）：`userSettings < projectSettings < localSettings < flagSettings < policySettings`。**模型选择优先级**：`/model` 覆盖 > `--model` > `ANTHROPIC_MODEL` > `settings.model` > 订阅默认。

---

## 10. 多 Agent 编排（Coordinator / Swarm / Tasks）

> 两种正交的多 Agent 模型：**Coordinator/Worker**（单领导派发一次性异步 worker）与 **Swarm/Team**（持久化领导 + 命名长活 teammate 互相通信）。

```mermaid
flowchart TD
    subgraph COORD_M["Coordinator 模式 coordinator/"]
        LEADER["领导 getCoordinatorSystemPrompt<br/>工具:AgentTool/SendMessage/TaskStop"]
        LEADER -->|"AgentTool"| WORKER["异步 worker<br/>(local_agent 后台任务)"]
        WORKER -->|"完成"| NOTIF["&lt;task-notification&gt; XML<br/>作为 user 消息回报领导"]
        NOTIF --> LEADER
    end

    subgraph SWARM_M["Swarm/Team 模式 utils/swarm/"]
        TEAMCREATE["TeamCreateTool<br/>→ TeamFile(磁盘注册表)"]
        TEAMCREATE --> SPAWN["spawnInProcessTeammate<br/>AsyncLocalStorage隔离"]
        SPAWN --> RUNNER["inProcessRunner<br/>邮箱轮询500ms"]
        RUNNER <-->|"SendMessageTool"| MAILBOX["文件邮箱/内存队列<br/>writeToMailbox"]
        RUNNER -->|"Stop hook"| IDLE["idle通知→领导邮箱"]
    end

    subgraph TASK_SYS["任务系统 tasks/"]
        REGISTRY["AppState.tasks{taskId:State}"]
        POLL["pollTasks 1s轮询<br/>framework.ts:255"]
        POLL --> DELTA["getTaskOutputDelta<br/>偏移量读取(不全量加载)"]
        DELTA --> ENQUEUE["enqueueTaskNotification<br/>→ &lt;task-notification&gt;"]
        DISK["DiskTaskOutput<br/>O_NOFOLLOW|O_EXCL 防符号链接<br/>5GB上限"]
    end

    subgraph TASKTYPES["任务类型 Task.ts"]
        TT1["local_bash: LocalShellTask"]
        TT2["local_agent: LocalAgentTask<br/>(异步worker/子agent)"]
        TT3["remote_agent: RemoteAgentTask<br/>(Ultraplan/PR自动修复)"]
        TT4["in_process_teammate"]
        TT5["dream: DreamTask(记忆整合)"]
    end

    WORKER --> REGISTRY
    SPAWN --> REGISTRY
    REGISTRY --> POLL
    WORKER -.写.-> DISK
    REGISTRY --> TASKTYPES

    classDef coord fill:#e3f2fd,stroke:#1565c0
    classDef swarm fill:#f3e5f5,stroke:#6a1b9a
    class LEADER,WORKER,NOTIF coord
    class TEAMCREATE,SPAWN,RUNNER,MAILBOX swarm
```

**AgentTool 递归**：`call()` → `runAgent()` 返回 Message 异步迭代器（嵌套 query 引擎回合）。子 agent 用受限工具集(`ASYNC_AGENT_ALLOWED_TOOLS`)，`createSubagentContext` 隔离(`setAppState` no-op)，`queryTracking={chainId,depth}` 追踪递归深度。非 ant 用户的 `AgentTool` 在禁用列表中防止无限递归。**自动后台化**：foreground agent 运行 120s 后自动翻转为 `isBackgrounded`。

---

## 11. Skills 与 Plugins 系统

```mermaid
flowchart TD
    subgraph SKILLS_SYS["Skills skills/"]
        SDIR["SKILL.md 目录格式<br/>parseSkillFrontmatterFields"]
        SDIR --> SCMD["createSkillCommand<br/>→ Command(type:prompt)"]
        SDISCOVER["getSkillDirCommands<br/>managed/user/project/--add-dir<br/>realpath去重"]
        SBUNDLED["bundledSkills<br/>verify/remember/simplify/loop..."]
        SCOND["条件技能(paths:)<br/>文件触碰时激活"]
        SDIR --> SDISCOVER
    end

    SCMD --> SKILLTOOL["SkillTool.call()"]
    SKILLTOOL --> SEXEC{"context?"}
    SEXEC -->|"fork"| SFORK["executeForkedSkill<br/>独立子agent+token预算"]
    SEXEC -->|"inline"| SINLINE["注入当前对话"]

    subgraph PLUGINS_SYS["Plugins plugins/ utils/plugins/"]
        PBUILTIN["builtinPlugins<br/>{name}@builtin"]
        PMARKET["marketplace/git/npm"]
        PLOADER["pluginLoader.loadAllPlugins"]
        PMARKET --> PLOADER
        PBUILTIN --> PLOADER
        PLOADER --> PCOMP["各组件加载器"]
        PCOMP --> PC1["loadPluginCommands"]
        PCOMP --> PC2["loadPluginAgents"]
        PCOMP --> PC3["loadPluginHooks"]
        PCOMP --> PC4["mcpPluginIntegration"]
        PCOMP --> PC5["lspPluginIntegration"]
    end

    PC1 --> APPSTATE["AppState.plugins/mcp"]
    SDISCOVER --> COMMANDS["getCommands(cwd)"]
    SBUNDLED --> COMMANDS
```

---

## 12. 记忆系统（三套）

```mermaid
flowchart TD
    subgraph AUTOMEM["1. 自动记忆(跨会话持久) memdir/"]
        ENTRY["MEMORY.md 入口<br/>始终载入系统提示<br/>(≤200行/25KB截断)"]
        TOPICS["主题文件(细节)"]
        WRITE["写路径: 回合结束 stopHook<br/>→ extractMemories(fork agent)"]
        RECALL["读路径: findRelevantMemories<br/>Sonnet选≤5相关文件"]
        WRITE --> ENTRY
        WRITE --> TOPICS
        RECALL -.扫描.-> TOPICS
    end

    subgraph SESSMEM["2. 会话记忆(单对话) SessionMemory/"]
        SM["postSampling hook 定期更新<br/>fork subagent<br/>被压缩机制消费"]
    end

    subgraph TEAMMEM["3. 团队记忆(服务端同步) teamMemorySync/"]
        TM["按 git-remote hash 分repo<br/>GET/PUT 增量上传<br/>secretScanner 密钥防护<br/>250KB/文件上限"]
    end

    subgraph DREAM["自动整合 autoDream/"]
        DR["三门:时间→会话数→锁<br/>/dream fork → 蒸馏日志<br/>→ DreamTask UI 药丸"]
    end

    WRITE -.互斥.-> DR
```

**关键设计**：主 agent 若本回合已写记忆，fork 提取器跳过该区间（互斥）。团队记忆 pull=服务端优先/key，push=仅变更 hash 增量(删除不传播)。

---

## 13. 生命周期 Hooks 系统

> 注意区分：**生命周期 Hooks**(`utils/hooks.ts` 设置驱动) vs **React Hooks**(`hooks/*.tsx` UI 状态) vs **编程式 Hooks**(`postSamplingHooks`)。

```mermaid
flowchart TD
    EVENTS["28种 HOOK_EVENTS<br/>coreTypes.ts:25"] --> TYPES["5种 Hook 类型"]
    subgraph HTYPE["Hook 类型"]
        HT1["command(shell)"]
        HT2["prompt"]
        HT3["agent"]
        HT4["http"]
        HT5["function(进程内)"]
    end
    TYPES --> HTYPE

    HTYPE --> ENGINE["executeHooks() 生成器<br/>hooks.ts:1952"]
    ENGINE --> TRUST{"shouldSkipHookDueToTrust<br/>(交互模式需信任, RCE防护)"}
    TRUST --> MATCH["getMatchingHooks<br/>matcher+if条件"]
    MATCH --> RUN["按类型执行"]
    RUN --> OUTPUT["processHookJSONOutput<br/>permissionDecision/<br/>additionalContext/blockingError"]

    subgraph SEAMS["生命周期挂载点"]
        SE1["工具执行: runPreToolUseHooks<br/>(可 allow/deny/interrupt)"]
        SE2["用户输入: executeUserPromptSubmitHooks"]
        SE3["会话: SessionStart/SessionEnd"]
        SE4["回合结束: executeStopHooks<br/>(可强制续跑)"]
        SE5["压缩: PreCompact/PostCompact"]
    end
    OUTPUT --> SEAMS
```

**关键事件**：`PreToolUse / PostToolUse / UserPromptSubmit / SessionStart / SessionEnd / Stop / SubagentStop / PreCompact / PostCompact / PermissionRequest / TeammateIdle / TaskCreated/Completed` 等。安全门：交互模式下**所有** hook 需工作区信任(防 RCE)。

---

## 14. IDE Bridge / Remote / Server

```mermaid
flowchart TD
    subgraph CONTROLLER["外部控制器"]
        CLAUDEAI["claude.ai 网页/移动端"]
        IDE["VS Code / JetBrains"]
    end

    CLAUDEAI -->|"环境API轮询"| BRIDGELOOP["bridgeMain.runBridgeLoop<br/>register→pollForWork→WorkSecret"]
    BRIDGELOOP -->|"spawn"| CHILD["sessionRunner<br/>子进程 claude --print --sdk-url<br/>NDJSON stream-json"]
    CHILD -->|"stdout"| PARSE["解析: activities +<br/>control_request(can_use_tool) +<br/>user消息"]
    PARSE -->|"权限请求上浮"| SENDPERM["sendPermissionResponseEvent"]

    subgraph SHARED["共享传输 bridgeMessaging(无状态)"]
        HANDLE["handleIngressMessage<br/>路由 control_response/request/user"]
        SERVERREQ["handleServerControlRequest<br/>initialize/set_model/interrupt"]
        DEDUP["BoundedUUIDSet 去重"]
    end
    PARSE --> SHARED
    CLAUDEAI -->|"WS control_request"| SHARED

    JWT["jwtUtils.tokenRefreshScheduler<br/>exp前5min刷新"]
    BRIDGELOOP -.token.-> JWT

    subgraph REPLBRIDGE["REPL Bridge(控制当前会话)"]
        RB["initReplBridge→initBridgeCore<br/>⇄ useReplBridge.tsx<br/>BridgePermissionCallbacks"]
    end

    subgraph REMOTE_M["remote/ CCR云会话"]
        RSM["RemoteSessionManager<br/>⇄ SessionsWebSocket<br/>⇄ useRemoteSession"]
    end

    subgraph SERVER_M["server/ 本地直连"]
        DCM["DirectConnectSessionManager<br/>createDirectConnectSession<br/>⇄ useDirectConnect"]
    end

    IDE --> REPLBRIDGE
    CLAUDEAI --> REMOTE_M
```

**三种远程传输**：`bridge/`(claude.ai/IDE 远程控制，spawn 子进程或附着 REPL) · `remote/`(CCR 云容器会话，WS 订阅) · `server/`(自托管本地直连，无 claude.ai 后端)。

---

## 15. 端到端一次对话完整时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant PI as PromptInput
    participant REPL as REPL.tsx
    participant PUI as processUserInput
    participant Q as query.ts (queryLoop)
    participant API as claude.ts (queryModel)
    participant ANTHROPIC as Anthropic API
    participant TOOL as 工具执行器
    participant PERM as 权限系统

    U->>PI: 键盘输入 + Enter
    PI->>REPL: onSubmit(input)
    REPL->>REPL: awaitPendingHooks (SessionStart)
    REPL->>PUI: handlePromptSubmit → processUserInput
    PUI->>PUI: 解析 slash/bash/attachments
    PUI->>PUI: executeUserPromptSubmitHooks
    PUI->>REPL: onQuery(messages)
    REPL->>REPL: 组装 systemPrompt+userContext+systemContext
    REPL->>Q: for await query({messages,...})

    loop while(true) 每回合
        Q->>Q: 压缩管线(snip→micro→collapse→autoCompact)
        Q->>API: deps.callModel(...)
        API->>ANTHROPIC: beta.messages.create(stream:true)
        ANTHROPIC-->>API: 流式 content_block/tool_use
        API-->>Q: yield stream_event
        Q-->>REPL: onQueryEvent → 渲染消息

        alt 有 tool_use 块
            Q->>TOOL: runTools / StreamingToolExecutor
            TOOL->>PERM: canUseTool(tool,input)
            PERM-->>U: 权限对话框(若 ask)
            U-->>PERM: allow/deny
            PERM-->>TOOL: 决策
            TOOL-->>Q: toolResults
            Q->>Q: state=下一回合, continue
        else 无工具
            Q->>Q: handleStopHooks
            Q->>Q: extractMemories(fork)
            Q-->>REPL: return Terminal{completed}
        end
    end

    REPL->>U: onTurnComplete 显示结果
```

---

## 16. 关键文件索引

| 子系统 | 核心文件 |
|---|---|
| **入口/启动** | `entrypoints/cli.tsx` · `main.tsx`(`main`/`run`/`.action`) · `entrypoints/init.ts` · `setup.ts` |
| **全局状态** | `bootstrap/state.ts`(cost/otel/session) · `state/AppStateStore.ts`(AppState) |
| **核心循环** | `query.ts`(`queryLoop` while循环) · `QueryEngine.ts` · `query/{config,deps,stopHooks,tokenBudget}.ts` |
| **模型调用** | `services/api/claude.ts`(`queryModel`) · `services/api/withRetry.ts` · `cost-tracker.ts` |
| **工具系统** | `Tool.ts`(类型) · `tools.ts`(注册表) · `tools/*`(~40实现) · `services/tools/{toolOrchestration,StreamingToolExecutor}.ts` |
| **权限** | `utils/permissions/permissions.ts`(策略) · `hooks/useCanUseTool.tsx`(UI) · `hooks/toolPermission/PermissionContext.ts` · `constants/tools.ts`(agent作用域) |
| **压缩** | `services/compact/{autoCompact,compact,microCompact,reactiveCompact,sessionMemoryCompact}.ts` |
| **命令** | `commands.ts` · `types/command.ts` · `utils/processUserInput/{processSlashCommand,processUserInput}.tsx` |
| **MCP** | `services/mcp/{client,config,types}.ts` |
| **认证** | `services/oauth/{index,client}.ts` · `services/api/client.ts` · `utils/{http,auth}.ts` |
| **LSP** | `services/lsp/{config,LSPServerManager,manager}.ts` |
| **特性开关** | `services/analytics/growthbook.ts` · `bun:bundle` feature() |
| **设置/模型** | `utils/settings/{constants,settings}.ts` · `utils/model/model.ts` |
| **多 Agent** | `coordinator/coordinatorMode.ts` · `utils/swarm/{spawnInProcess,inProcessRunner,teamHelpers}.ts` · `tools/{AgentTool,TeamCreateTool,SendMessageTool}` |
| **任务** | `Task.ts` · `tasks/*` · `utils/task/{framework,diskOutput}.ts` |
| **Skills/Plugins** | `skills/{bundledSkills,loadSkillsDir}.ts` · `tools/SkillTool` · `plugins/builtinPlugins.ts` · `utils/plugins/pluginLoader.ts` |
| **记忆** | `memdir/{paths,findRelevantMemories}.ts` · `services/{extractMemories,SessionMemory,autoDream,teamMemorySync}` |
| **Hooks** | `utils/hooks.ts`(执行引擎) · `utils/hooks/*` · `entrypoints/sdk/coreTypes.ts`(事件) |
| **UI** | `screens/REPL.tsx` · `ink/ink.tsx` · `components/{messages,permissions,PromptInput}/*` |
| **Bridge/Remote** | `bridge/{bridgeMain,sessionRunner,replBridge,bridgeMessaging,jwtUtils}.ts` · `remote/RemoteSessionManager.ts` · `server/directConnectManager.ts` |
| **键盘/Vim** | `keybindings/{schema,resolver,match}.ts` · `vim/{types,transitions,operators}.ts` |

---

> 文档基于 6 份并行深度源码分析报告汇总（覆盖:入口启动 / 核心循环 / 工具权限 / 命令服务 / 多Agent技能插件 / Bridge远程UI）。所有 Mermaid 图可在支持 Mermaid 的 Markdown 查看器(如 VS Code + Markdown Preview Mermaid、Typora、GitHub)中渲染。
