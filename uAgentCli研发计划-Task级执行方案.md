# uAgentCli 研发计划 · Task 级执行方案

> 本文是对《uAgentCli 多智能体平台源码骨架实现计划.md》的**执行层拆解**：把该计划的十大模块与 12 步实施路径、横切关注点 §A–§L，拆成可独立开工、可独立验收的 **Task 级迭代路径**。
>
> - **上游依据**：`uAgentCli多智能体平台源码骨架实现计划.md`（设计与证据源，本文不重复论证，只引用其结论与文件落点）。
> - **本文定位**：谁先做、依赖谁、产出哪些文件、做到什么算完成（DoD）、属于哪个交付档位。
> - **不改变**原计划的技术选型、目录结构、模块边界与安全纪律；只把"做什么"细化为"按什么顺序做、每步交付什么"。

---

## 一、执行原则（贯穿所有 Task）

1. **P0 地基先行**：横切 §A（Message/ContentBlock 超集）、§B（RunContext/AbortSignal 全链穿透）、§C（Runner steering 语义）必须先于任何 run-loop 代码落地——它们是 provider 适配、取消传播、转向语义的确定目标形状。对应 **迭代 0 + 迭代 4 前置**。
2. **Mock 先于真实**：§I 的 `MockLlmProvider` 与 run-loop 集成测试先于接真实 API——最高风险的循环代码必须先能确定性、不烧 token 地测。
3. **纯函数可测优先**：能被单测钉死的模块（`evaluate`、`deriveSubagentSessionPermission`、`buildSystemPrompt` 幂等、`budget` 阈值、`token-counter`）在其所在迭代内必须带单测交付，不留到最后。
4. **交付档位诚实**：每个 Task 标注 `【真跑通】/【可用实现】/【接口占位】` 三档（对应原计划"本阶段范围的诚实重述"表），占位类 Task 只交付"目录+类型+标注延后"，不假装闭环。
5. **纪律即验收项**：缓存前缀稳定、ephemeral 只进 user 消息、信息收费站、权限纵深 bypass-immune、机密双向围栏——这些不是"注意事项"而是对应 Task 的**硬 DoD**，在验收栏显式列出。
6. **迭代闭合**：每个迭代末尾有一个**可演示/可测试的里程碑（Gate）**，未过 Gate 不进入下一迭代。

---

## 二、迭代路线总览

| 迭代 | 主题 | 覆盖模块 / 横切 | 里程碑 Gate | 交付档位 |
|---|---|---|---|---|
| **迭代 0** | 脚手架 + P0 地基类型 | 工程骨架、`types/`、`permission/types`、`context` 类型；§A/§B | `tsc --noEmit` 通过；核心类型可被空实现引用 | 真跑通(地基) |
| **迭代 1** | Prompt 资产 + Tool/Agent 声明面 | `prompt/`、`tool/`(类型+编排+4内置)、`agent/`(声明面+加载器) | 零编码放一个 `.uagent/agents/*.md` 能被 loader 解析；`buildSystemPrompt` 幂等单测过 | 真跑通 / 可用实现 |
| **迭代 2** | 权限引擎 + 执行网关 + 机密治理 | `permission/`(全)、`sandbox/`、`security/` | gate 判定链单测（bypass-immune）过；env-scrub/redact 冻结开关验证 | 真跑通 |
| **迭代 3** | 上下文 + 存储 + 记忆 + 技能 | `storage/`、`context/`、`memory/`、`skill/` | 装配顺序表产出字节稳定 system；SQLite 会话读写通 | 真跑通(上下文) / 可用实现(记忆·技能) |
| **迭代 4** | Run Loop 主链路打通（核心） | `llm/`、`core/`(runner/run-loop/terminal)、`cli/`、`server/`；§C/§D/§E/§F/§G/§H/§I | mock 五场景集成测试全过；真实 Anthropic 端到端跑通一次对话+一次工具调用 | 真跑通 |
| **迭代 5** | 子智能体调用打通 | `tool/builtin/task.ts`、`memory/extractor.ts`、subagent 隔离验证 | `explore` 子 agent 端到端；只回 `<task_result>`；越权工具被拒 | 可用实现 |
| **迭代 6** | 骨架模块 + 测试收尾 + 多协议族回归 | `heartbeat/`、`channel/`、`knowledge/`、`hooks/`、`tool/mcp/`；OpenAI 兼容族回归 | 全量 `npm test` 绿；OpenAI 兼容族跑通同链路；安全验证四项过 | 接口占位 / 真跑通(回归) |

**关键路径（critical path）**：迭代0 → 迭代1(tool/agent) → 迭代2(permission) → 迭代4(run-loop) → 迭代5(task)。迭代3 的 storage/context 与迭代2 可部分并行，但 run-loop（迭代4）依赖迭代1/2/3 全部就位。

---

## 三、模块 → 迭代 映射矩阵（十大模块 + 新增模块）

| 原计划模块 | 主迭代 | 关键 Task |
|---|---|---|
| ① Run Loop `core/` | 迭代4 | T4.4–T4.7 |
| ② Tools `tool/` | 迭代1 | T1.4–T1.7 |
| ③ 技能池 `skill/` | 迭代3 | T3.7 |
| ③+ 子智能体池 `agent/` | 迭代1/5 | T1.8–T1.11、T5.x |
| ④ 上下文 `context/` | 迭代3 | T3.3–T3.6 |
| ⑤ 记忆 `memory/` | 迭代3/5 | T3.8–T3.10、T5.3 |
| ⑥ 心跳 `heartbeat/` | 迭代6 | T6.1 |
| ⑦ 渠道 `channel/` | 迭代4/6 | T4.9(local-cli)、T6.2 |
| ⑧ 沙盒 `sandbox/` | 迭代2 | T2.7–T2.8 |
| ⑨ 权限 `permission/` | 迭代2 | T2.1–T2.6 |
| ⑩ 知识库 `knowledge/` | 迭代6 | T6.3 |
| Prompt `prompt/`（新增一等公民） | 迭代1 | T1.1–T1.3 |
| `security/`（新增） | 迭代2 | T2.9–T2.10 |
| `storage/`（新增） | 迭代3 | T3.1–T3.2 |
| `llm/`（协议族） | 迭代4 | T4.1–T4.3、T6.6 |
| `hooks/` `tool/mcp/` `channel/mailbox`（占位） | 迭代6 | T6.4–T6.5 |

---

## 四、Task 详表（按迭代）

> 每个 Task 字段：**产出文件** · **依赖** · **DoD（Definition of Done）** · **档位**。工作量单位为相对人日估算（S≈0.5d，M≈1d，L≈2d，XL≈3d+）。

### 迭代 0 · 脚手架 + P0 地基类型

| Task | 名称 | 产出文件 | 依赖 | DoD（验收） | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T0.1** | 工程脚手架 | `package.json`(deps: `@anthropic-ai/sdk`/`openai`/`zod`/`better-sqlite3`/`tsx`/`typescript`/`vitest`)、`tsconfig.json`(path alias `src/*`)、`.env.example`(各家 KEY 变量)、`.gitignore` 补 `.uagent/settings.local.json`/`agent-memory/`/`sessions/` | — | `npm i` 成功；`tsc --noEmit` 空过；`vitest` 可启动 | 真跑通 | S |
| **T0.2** | §A 核心消息类型 | `src/types/message.ts`（`ContentBlock` 五类块 text/tool_use/tool_result/thinking/image + `Message{role,content,seq}`） | T0.1 | 类型编译通过；覆盖两协议族公共超集；`seq` 字段供 epoch/prune 定位 | 真跑通 | M |
| **T0.3** | 品牌 ID 类型 | `src/types/ids.ts`（`SessionID/MessageID/ToolCallID` 品牌类型） | T0.1 | 品牌类型防串用；编译通过 | 真跑通 | S |
| **T0.4** | §B AbortSignal 载体 | `src/types/abort.ts`（`RunContext{signal,sessionID,depth,权限ctx}`） | T0.3 | 载体类型定义完整，为逐层穿透留唯一入参形状 | 真跑通 | S |
| **T0.5** | 权限 & 上下文基础类型 | `src/permission/types.ts`（`Rule/Ruleset/Action`）、`src/context/types.ts`（占位类型） | T0.2 | 类型可被后续引用，无循环依赖 | 真跑通 | S |

**Gate-0**：`tsc --noEmit` 通过；`types/` 三文件 + `permission/types` 可被空 stub 引用。**这是"必须先于 run-loop"的硬前置**（原计划实施步骤 2）。

---

### 迭代 1 · Prompt 资产 + Tool/Agent 声明面

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T1.1** | Prompt 类型 + section 池 | `prompt/types.ts`(`PromptSection{name,compute,cacheable}`/`PromptTier`)、`sections/{identity,tool-policy,environment,memory-snapshot,skills-verbose}.ts` | T0.5 | 五个具名 section 各自独立；environment 日期只到天（字节稳定）；memory-snapshot 包 `<system-reminder>/<memory>` 数据标签 | 真跑通 | M |
| **T1.2** | 模型族模板 + 子 agent 提示词 | `model-variants/{default,anthropic,openai}.txt`、`agent-prompts/{explore,plan,general,compaction,title}.txt` | T1.1 | 每模型族一份完整 prompt(非 diff)；openai.txt 供兼容族共用 | 真跑通 | M |
| **T1.3** | 三层拼装 + 缓存策略 | `prompt/system-prompt.ts`(`buildSystemPrompt(agent,model)` stable/context/volatile 三层 + 按 model.id 选模板 + 显式优先级 override>agent.prompt>自定义>默认)、`cache-policy.ts` | T1.2 | **幂等单测过**：相同输入逐字节相同输出；ephemeral 路由到 user 消息不落 system | 真跑通 | L |
| **T1.4** | Tool 契约 + wrap | `tool/types.ts`(`Tool.Def`: id/description/parameters(zod)/execute + isReadOnly/isConcurrencySafe/isDestructive fail-closed 默认 + `untrustedOutput?`)、`wrap.ts`(校验+执行+截断 + 不可信外部内容语义围栏) | T0.4 | wrap 对 `untrustedOutput` 工具加"外部数据非指令"围栏；截断落盘 | 真跑通 | M |
| **T1.5** | 工具编排器 | `tool/orchestrator.ts`(只读并发上限8/写串行、写路径重叠不并发、结果按调用序重排、中断补占位 tool_result) | T1.4 | 单测：并发批结果按原 tool_use 序重排；写冲突不并发；中断补占位维持配对 | 真跑通 | L |
| **T1.6** | 四个内置工具 | `tool/builtin/{bash,read,write,edit}.ts`、`tool/prompts/{bash,read,write,edit,grep,glob,webfetch,task,skill}.txt`、`prompts/shell-template.ts`(唯一动态模板) | T1.4 | 四工具可独立单元调用；工具描述与 Def 分离静态导入；bash 描述按 os/shell/cwd 渲染 | 真跑通 | L |
| **T1.7** | 工具注册表 | `tool/registry.ts`(`register/getTools(permCtx)` 按会话/agent 过滤) | T1.6 | 按 permCtx 过滤工具池；注册幂等 | 真跑通 | S |
| **T1.8** | Agent 声明面 | `agent/types.ts`(完整 `AgentInfo`: name/description/mode/source/prompt/tools?/permission?/model?/memory?/background?/omitProjectDoc?/maxTurns?) | T0.5 | 声明面与原计划"如何新增子智能体"节完全一致；`memory` 为枚举非 boolean | 真跑通 | M |
| **T1.9** | 四正交 resolver | `agent/resolvers.ts`(`resolveTools/resolveModel/resolvePrompt/resolvePermission`；tools 列表翻译成 ruleset、memory 声明触发注入 read/write/edit) | T1.8, T1.7 | 四函数互不耦合；`tools:[read,grep]` 正确翻译成 allow+其余 deny | 真跑通 | M |
| **T1.10** | 子 agent 加载器 | `agent/loader.ts`(扫 `~/.uagent/agents` 与 `./.uagent/agents` 下 `*.md`，解析 frontmatter+正文即 prompt) | T1.9 | 放一个示例 `.uagent/agents/db-reviewer.md` 能被解析成 `AgentInfo`；**零编码扩展验证** | 可用实现 | M |
| **T1.11** | 注册表 + 子权限继承 | `agent/registry.ts`(内置 build/plan/general/explore + compactor/memory-extractor 零工具；三源合并 内置<user<project<flag)、`subagent-permissions.ts`(移植 `deriveSubagentSessionPermission`) | T1.10 | **单测：deny-only 继承**——子权限=父 deny+external_directory，不继承 allow；task/todowrite 默认强制 deny | 真跑通 | M |

**Gate-1**：`buildSystemPrompt` 幂等单测过；`deriveSubagentSessionPermission` deny-only 单测过；示例 `.uagent/agents/*.md` 被 loader 解析成功（零编码扩展能力验证）。

---

### 迭代 2 · 权限引擎 + 执行网关 + 机密治理

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T2.1** | last-match-wins 评估器 | `permission/evaluate.ts`(移植 OpenCode `evaluate()`，`findLast` 默认 ask) | T0.5 | **单测：last-match-wins**；无匹配默认 ask | 真跑通 | M |
| **T2.2** | reply 级联重评估 | `permission/reply.ts`(once/always/reject + 级联重评估同会话其余 pending) | T2.1 | 单测：`always` 推规则进 approved 并级联放行同会话 pending；`reject` 级联拒 | 真跑通 | M |
| **T2.3** | 挂起管理器 | `permission/manager.ts`(pending Deferred 登记 + 广播审批事件；两条回填通道: CLI 终端 / gateway RPC) | T2.2 | pending 登记/settle 幂等；多端"先到先得+其余 no-op"兜底(§G) | 真跑通 | M |
| **T2.4** | 主 agent 有序判定链 | `permission/gate.ts`(`checkToolPermission`: deny→ask→tool自判→需交互→内容级ask→safetyCheck→bypass→alwaysAllow→默认ask) | T2.3 | **单测：前六步 bypass-immune**——bypass/yolo 下 deny/需交互/内容ask/safety 仍拦截 | 真跑通 | L |
| **T2.5** | 权限模式 + 冻结护栏 | `permission/mode.ts`(default/acceptEdits/plan/dontAsk/bypass/yolo；启动冻结开关快照 + 可选 fail-closed 分类器) | T2.4 | yolo/bypass 开关启动读一次即冻结；分类器不可用降级为 ask | 真跑通 | M |
| **T2.6** | 审批分层落盘 + 边界 | `permission/persist.ts`(once 不落盘 / always 进内存 approved + 写 local/user/project 三层)、`permission/boundary.ts`(`isPathInBoundary` cwd+additionalDirs；`.env` 读要问；DANGEROUS_FILES/危险删除走 safetyCheck) | T2.5 | 单测：once 本轮弃/always 三层落盘；越界产出 external_directory ask | 真跑通 | M |
| **T2.7** | 执行网关 | `sandbox/exec-gateway.ts`(统一子进程 Builder，PATH 白名单，禁裸 spawn；AbortSignal 穿透到 kill；派生前调 env-scrub)、`sandbox/types.ts`(`ExecutionMode` local/auto/sandbox) | T0.4, T2.9 | 子进程经统一 Builder；abort 触发子进程 kill；sandbox 档落回 local+人工审批 | 真跑通 | M |
| **T2.8** | 风险识别两档 | `sandbox/risk.ts`(`detectDangerous` 软线 shell-quote 分词+标 tree-sitter 升级点 / `detectHardline` 硬线 rm-rf//fork bomb 即便 yolo 也拒) | T2.7 | 单测：硬线命令任何模式拒；软线产出 ask；**明确标注"启发式非安全边界"(§J)** | 可用实现 | M |
| **T2.9** | 子进程 env 擦除 | `security/env-scrub.ts`(派生前剥 `*_API_KEY`/`AWS_SECRET_ACCESS_KEY` 等 SCRUB_LIST，父留子不见) | T0.1 | 单测：子进程环境不含机密变量；父进程保留 | 真跑通 | S |
| **T2.10** | 输出脱敏 | `security/redact.ts`(回填前正则脱敏 sk-/API_KEY/Bearer/DB密码；**开关启动读一次即冻结**) | T0.1 | 单测：脱敏命中样本；运行时改 env 无法关闭脱敏(冻结) | 真跑通 | M |

**Gate-2**：gate 判定链 bypass-immune 单测过；`detectHardline` 任何模式拒；env-scrub 子进程无机密 + redact 冻结开关验证。

---

### 迭代 3 · 上下文 + 存储 + 记忆 + 技能

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T3.1** | 落盘路径 + 会话存储 | `storage/paths.ts`(scope 解析 UAGENT_HOME/project + 优先级；cwd→project_id 消毒)、`storage/session-store.ts`(SQLite session/message 表 + parent_session_id + permission JSON 列 + active 过滤 resume；与 persist 共用连接) | T0.2, T2.6 | 会话/消息 CRUD 通；按 project_id 索引查会话；子会话 parent_session_id 行 | 真跑通 | L |
| **T3.2** | 身份文件加载 | `storage/identity-files.ts`(SOUL.md 读+种子 DEFAULT_SOUL 用户改过不回写+threat-scan；AGENT.md walk-up 首命中 兼容 AGENTS.md/CLAUDE.md 别名) | T3.1 | SOUL 首启种入、改过不覆盖；AGENT.md **首命中即停不跨祖先堆叠**；读入过 threat-scan | 真跑通 | M |
| **T3.3** | Token 计数口径 | `context/token-counter.ts`(§E 统一口径: Anthropic countTokens/本地估算兜底；结果按 seq 缓存) | T0.2 | budget 阈值判定唯一来源；seq 不变不重算 | 真跑通 | M |
| **T3.4** | 压缩阈值 + prune | `context/budget.ts`(applyToolResultBudget/snip/microcompact/contextCollapse/autoCompact **阈值可配置非硬编码**)、`context/prune.ts`(移植 OpenCode Prune 常量) | T3.3 | 单测：阈值裁剪；PRUNE 常量与保护清单落地 | 真跑通 | M |
| **T3.5** | Context Epoch | `context/epoch.ts`(baseline/baselineSeq；压缩产物原子替换历史+压缩后重建 system) | T3.4 | 原子替换被压区间；baselineSeq 前移；界定可见历史 | 真跑通 | M |
| **T3.6** | 装配管线 | `context/pipeline.ts`(`assembleContext` 固定装配顺序表 身份→项目文档/技能→MCP→env→记忆→历史；调 `system-prompt.ts`；接 `resolveProjectDoc`；ephemeral 只进 user) | T3.2, T1.3 | **产出 system 对相同输入字节稳定**；ephemeral 一律 user 消息 | 真跑通 | L |
| **T3.7** | 技能池 | `skill/types.ts`、`skill/discovery.ts`(扫 `.agents/skills` 下 SKILL.md)、`skill/registry.ts`(`fmt(list,{verbose})` verbose XML/terse markdown 双版本) | T1.1 | verbose 版接入 skills-verbose section；正文按需加载(渐进披露) | 可用实现 | M |
| **T3.8** | 记忆接口 + 两层 | `memory/types.ts`(write/retrieve(topK)/forget)、`memory/session-memory.ts`、`memory/long-term-store.ts`(SQLite + 内存向量近似；按 agentName 命名空间；**retrieve 入快照前 threat-scan**) | T3.1 | retrieve 返回条目过 threat-scan；命名空间隔离(主/子不可见) | 可用实现 | L |
| **T3.9** | 子 agent 隔离记忆 | `memory/agent-memory.ts`(`agent-memory/<agentName>/MEMORY.md`，声明 memory scope 即注入 read/write/edit) | T3.8, T1.9 | 声明 memory 的 agent 自动获文件工具；物理命名空间隔离 | 可用实现 | M |
| **T3.10** | 人工可编辑笔记 | `memory/curated-notes.ts`(USER.md/MEMORY.md §分隔解析+逐条 threat-scan+冻结快照+原子写(.lock/漂移检测)+字符上限记账) | T3.8, T3.2 | 冻结快照(中途写盘不改本会话 prompt)；超限截断+用量表头；投毒条目→`[BLOCKED]` | 可用实现 | L |

**Gate-3**：SQLite 会话读写通；`assembleContext` 对相同输入产出字节稳定 system；记忆 retrieve 入快照前 threat-scan 验证。

---

### 迭代 4 · Run Loop 主链路打通（核心里程碑）

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T4.1** | LLM 契约 + Mock | `llm/types.ts`(`LlmProvider.streamChat(req,signal)→AsyncIterable<LlmEvent>`；归一化 text_delta/tool_call/thinking/finish)、`llm/errors.ts`(RateLimit/Overload/ContextLengthExceeded/ContentFilter)、`llm/mock-provider.ts`(吐预设 event 序列) | T0.2 | mock 可确定性吐序列；错误类型齐备供 run-loop 分支 | 真跑通 | M |
| **T4.2** | Anthropic Provider | `llm/anthropic-provider.ts`(Messages API 流式+tool_use 解析+cache_control 注入 对接 cache-policy)、`llm/registry.ts`(按 provider 路由) | T4.1, T1.3 | Message↔SDK 双向映射；cache_control 断点注入；重试/错误映射(§H) | 真跑通 | L |
| **T4.3** | Runner 状态机 | `core/runner.ts`(移植 Idle/Running/Shell/ShellThenRun + ensureRunning)、`core/session-run-state.ts`(Map<SessionID,Runner> 单会话单飞 + `inject` 子→父异步回灌接口先行) | T3.1, T0.4 | **单测(§C)：运行中追加消息→转向而非取消重启**；ensureRunning 幂等 | 真跑通 | L |
| **T4.4** | 终止判定 | `core/terminal.ts`(具名 Terminal/Continue 枚举；**只看 tool_use 存在性+异常 finish，不信 stop_reason**) | T4.1 | 单测：带 tool_use 续/无 tool_use 完成/孤儿中断补 error result/content_filter 终止/max_turns | 真跑通 | M |
| **T4.5** | 两级循环 | `core/run-loop.ts`(外层 steering drain pending + 内层 tool-drain: 顶部压缩→装配→streamChat→tool_use 检测→orchestrator 执行→截断回填→terminal 判定；AbortSignal 全链穿透 + §H 错误分支 + §七 maxIterations 天花板+grace call) | T4.2,T4.3,T4.4,T3.6,T1.5,T2.4 | 全链穿 ctx.signal；错误分支不裸奔；max_turns 允许一次 grace call | 真跑通 | XL |
| **T4.6** | Mock 五场景集成测试 | `test/run-loop.integration.test.ts` | T4.5 | **五场景全绿(§I)**：多 tool_use 并发→回填→续跑 / 运行中追加消息 steering(§C) / 畸形 tool_call 自纠(§H) / 越阈值压缩+baselineSeq 前移(§F) / abort 各层停(§B) | 真跑通 | L |
| **T4.7** | CLI 入口 + Gateway | `cli/main.ts`(端到端本地对话)、`server/gateway.ts`(HTTP+SSE: chat.send/history/abort + permission.reply；abort 触发 signal)、`channel/adapters/local-cli.ts`+`channel/types.ts`+`channel/registry.ts` | T4.5, T2.3 | CLI 起会话；ask 走终端交互；gateway permission.reply RPC 回填(§G) | 真跑通 | M |
| **T4.8** | 真实 Anthropic 跑通 | （无新文件，验证任务） | T4.7 | 真实 API 跑一次对话+至少一次工具调用(读目录触发 bash/read)；**人工核对 cache_control 断点多轮连续命中(stable/context 逐字节相同)** | 真跑通 | M |

**Gate-4（核心）**：mock 五场景集成测试全过；真实 Anthropic 端到端跑通一次对话+一次工具调用+权限确认+结果回填；缓存断点连续命中人工核对通过。**这是整个方案"可端到端运行一次真实对话"的目标达成点。**

---

### 迭代 5 · 子智能体调用打通

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T5.1** | task 工具递归 | `tool/builtin/task.ts`(深度检查 subagentDepth→permission 审批 task→session-run-state 建**全新子 session**(不 fork 父历史)→阻塞等待→只取最后一条 assistant 文本包 `<task_result>` 回填) | T4.5, T1.11 | 递归调用同一 run-loop；`background?` 字段预留恒 false；`task_id` 传入报"未实现" | 可用实现 | L |
| **T5.2** | explore 子 agent 端到端验证 | （验证任务） | T5.1 | **子 agent 只读工具(grep/read)能跑、写/task/todowrite 被强制拒**；父上下文只见 `<task_result>` 摘要、见不到子内部工具调用；完整子 transcript 留独立 session 记录不进父 | 可用实现 | M |
| **T5.3** | 记忆抽取子任务 | `memory/extractor.ts`(阈值触发 fork `memory-extractor` lite档/零工具；MVP 同步跑一次验证，标注异步化为后续) | T5.1, T3.8 | 抽取结果写入 long-term-store；**其余状态不泄漏回父会话**；阈值触发非每回合(§F) | 可用实现 | M |

**Gate-5**：`explore` 子 agent 端到端（隔离/权限/`<task_result>` 回传三项验证）；记忆抽取子任务写库且不泄漏。

---

### 迭代 6 · 骨架模块 + 测试收尾 + 多协议族回归

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T6.1** | 心跳骨架 | `heartbeat/scheduler.ts`(cron 解析+到期入队+偏移量轮询)、`heartbeat/trigger-engine.ts`(事件驱动触发最小可扩展骨架) | T4.5 | 目录+类型+最小示例；标注五方共同空白、非生产 | 接口占位 | M |
| **T6.2** | 渠道骨架 + 邮箱占位 | `channel/mailbox.ts`(teammate agent↔agent 文件邮箱占位，本阶段不实现) | T4.7 | 仅占位；`SendMessage` 只发 mode:'teammate' agent 的约束标注 | 接口占位 | S |
| **T6.3** | 知识库骨架 | `knowledge/types.ts`(DataSource/变更检测/准入/抽取 各阶段接口)、`knowledge/pipeline.ts`(增量扫描骨架，heartbeat 驱动非阻塞) | T6.1 | 目录+类型+标注延后 | 接口占位 | M |
| **T6.4** | Hooks 安全 interposition 占位 | `hooks/`(PreToolUse/PostToolUse 事件枚举 + permissionDecision allow/deny/ask 契约) | T2.4 | 只留接口不实现(§L)；主链路审批仍全走 gate | 接口占位 | S |
| **T6.5** | MCP client 占位 | `tool/mcp/client.ts`(`connect/listTools/callTool` 接口签名，标注延后) | T1.7 | 接口签名齐；不实现(§J) | 接口占位 | S |
| **T6.6** | OpenAI 兼容族 + 回归 | `llm/openai-compatible-provider.ts`(Chat Completions 流式+tool_calls 解析，参数化 baseURL/apiKey/extraHeaders/quirks)、`llm/provider-config.ts`(openai/deepseek/qwen/openrouter/custom 端点表) | T4.2 | 切 registry 跑同一链路；**验证主链路行为一致(工具→审批→执行→续跑)非缓存一致**；OpenAI 官方端点跑通即证整族可用，DeepSeek/Qwen/OpenRouter 换配置抽测 | 真跑通 | L |
| **T6.7** | 纯函数单测补齐 | `test/*`(runner 状态机4态、evaluate last-match-wins、budget 阈值、subagent-permissions deny-only、system-prompt 幂等、token-counter) | T5.3 | `npm test` 全绿、CI 不依赖真实 API | 真跑通 | M |
| **T6.8** | 安全运行机制端到端验证 | （验证任务，对应原计划"验证方式"末四项） | T6.6 | ①gate 链 bypass-immune(写.env/越界/危险删除仍拦)+hardline 拒 ②reply always 级联+三层落盘 ③`echo $ANTHROPIC_API_KEY` 子进程无 key+输出脱敏+冻结不可关 ④投毒记忆被 threat-scan 降级+以数据形式注入 | 真跑通 | M |

**Gate-6**：全量 `npm test` 绿；OpenAI 兼容族跑通同链路；安全验证四项全过；三档交付度与原计划"诚实重述"表一致。

---

## 五、跨迭代依赖拓扑（关键顺序约束）

```
迭代0 (types §A/§B/§C载体)
  ├─→ 迭代1 (prompt / tool / agent 声明面)
  │       └─→ T1.3 buildSystemPrompt ──┐
  │       └─→ T1.5 orchestrator ───────┤
  │       └─→ T1.11 subagent-perm ─────┤
  ├─→ 迭代2 (permission / sandbox / security)
  │       └─→ T2.4 gate ───────────────┤
  │       └─→ T2.7 exec-gateway ───────┤
  ├─→ 迭代3 (storage / context / memory / skill)   ← 可与迭代2部分并行
  │       └─→ T3.1 session-store ──────┤
  │       └─→ T3.6 pipeline ───────────┤
  │                                     ▼
  └────────────────────────────→ 迭代4 (run-loop 汇聚全部) ──T4.5 核心──→ Gate-4
                                          └─→ 迭代5 (task 递归) ──→ Gate-5
                                          └─→ 迭代6 (骨架+回归) ──→ Gate-6
```

**并行机会**：迭代2 与迭代3 除 `exec-gateway↔env-scrub`（T2.7 依赖 T2.9）、`session-store↔persist`（T3.1 依赖 T2.6）两处交叉外，可由两人分头推进。迭代6 的占位类 Task（T6.1–T6.5）可在迭代4 完成后随时插空做。

---

## 六、每迭代的验收 Gate 汇总（必须全过才进下一迭代）

| Gate | 硬验收项 | 对应原计划验证方式 |
|---|---|---|
| **Gate-0** | `tsc --noEmit` 过；P0 类型就位 | 实施步骤 2 |
| **Gate-1** | `buildSystemPrompt` 幂等 + `deriveSubagentSessionPermission` deny-only 单测过；零编码扩展验证 | 实施步骤 3/4 |
| **Gate-2** | gate 链 bypass-immune + hardline 拒 + redact 冻结 单测/验证过 | 安全节 §一/§四/§五 |
| **Gate-3** | SQLite 会话读写通；system 字节稳定；retrieve threat-scan | 实施步骤 7；安全节 §六 |
| **Gate-4** | mock 五场景全绿 + 真实 Anthropic 端到端 + 缓存断点命中 | 验证方式 `npm test`+`npm run dev` |
| **Gate-5** | explore 子 agent 隔离/权限/`<task_result>` 三验证 | 验证方式"触发子智能体"项 |
| **Gate-6** | 全量 test 绿 + OpenAI 兼容族回归 + 安全四项 | 验证方式"主 agent 安全验证"四项 |

---

## 七、前置风险项（开工前必须确认，源自横切 §A–§L）

| 风险项 | 说明 | 缓解措施 / 落点 Task |
|---|---|---|
| **P0-1 Message 超集设计错** | §A 是"最高风险一段代码"，类型钉错则所有 provider 适配返工 | T0.2 先冻结类型；T4.2/T6.6 provider 适配以它为唯一目标形状 |
| **P0-2 AbortSignal 事后加** | §B 不允许任何层"事后加取消" | T0.4 载体先行；T4.5 逐层穿 ctx 作 DoD |
| **P0-3 steering 语义漏测** | §C 四态状态机的存在理由，最易被写成"取消+重启" | T4.3 单测构造"运行中追加消息"场景 |
| **P1-1 缓存前缀被打破** | ephemeral 混进 system / 时间戳到分钟 → 每轮 miss | T1.3/T3.6 DoD：字节稳定 + ephemeral 只进 user；T4.8 人工核对 |
| **P1-2 provider 缓存差异被当一致** | §D：三层缓存纪律仅 Anthropic 生效，兼容族 no-op | T6.6 DoD 明确"验证主链路行为一致非缓存一致" |
| **能力边界过度承诺** | §J：`sandbox/` 非真隔离、MCP 占位 | T2.8/T6.5 DoD 显式标注"启发式非安全边界"/"接口占位" |
| **记忆抽取拖垮每轮延迟** | §F：每回合抽取会翻倍费用 | T5.3 DoD：阈值触发非每回合、lite 档零工具 |

---

## 八、里程碑交付节奏建议

- **M1（地基就绪）** = Gate-0 + Gate-1：可零编码扩展子 agent、prompt 资产成型。
- **M2（安全与上下文就绪）** = Gate-2 + Gate-3：权限纵深、机密治理、SQLite 持久、上下文装配全部可测。
- **M3（主链路可运行）** = Gate-4：**核心交付——一次真实对话端到端跑通**（对应原计划总目标）。
- **M4（子智能体可用）** = Gate-5：委派/隔离/回传闭环。
- **M5（交付验收）** = Gate-6：多协议族回归 + 安全四项 + 全量测试绿，交付度对齐"真跑通/可用实现/接口占位"三档。

> **建议**：M3（Gate-4）是不可压缩的核心，其余里程碑的骨架/占位 Task 可视资源情况裁剪或后置，但 M1→M2→M3 的关键路径顺序不可调换（P0 地基 → 权限/上下文 → run-loop）。
