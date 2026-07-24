# uAgentCli 生产化模块完善技术架构设计与研发迭代计划

> 前置文档：《uAgentCli多智能体平台源码骨架实现计划.md》《uAgentCli研发计划-Task级执行方案.md》（迭代0–6，骨架已完成，70 测试文件/534 用例全绿）。本文档承接骨架之后，回答"每个模块要长成什么样才算生产可用、参考谁、按什么顺序做"。
>
> 调研方法：对 `src/` 全量 grep 简化标记（"简化/占位/升级点/不接真实/朴素"等）+ 逐文件精读，交叉对照 `opensource/` 下 15 个开源 agent/CLI 项目（claude-code-main、opencode、goose、hermes-agent、nanobot、agentscope、zeroclaw、AgentSpace、rowboat、LobsterAI、AionUi、pi、herdr、openclaw、AionCore）。全部结论基于实际代码阅读，非泛泛而谈。
>
> **配套代码级文档**：《uAgentCli生产化模块代码级深化设计.md》——把本计划里每个模块从"参考某文件"深化到"改哪个函数、抄哪段算法、哪些常量、什么表结构 DDL、防哪个绕过"的可执行粒度（A–Q 共 17 个模块小节，逐条标注 `项目/文件:行号或函数名` 与 uAgentCli 落点，并与本文的 Task ID 一一对应）。实施每个 Task 前先读对应小节。

---

## 一、核心发现：三类技术债，优先级完全不同

调研两组模块群组后，一个结论反复出现：**"已实现但未接线"的数量和严重性都超过"未实现"**。这决定了本计划的第一原则——**先扫尾接线，再建新能力**，因为前者投入产出比通常高一个数量级。

### 债务分类

| 类型 | 特征 | 典型例子 | 修复成本 |
|---|---|---|---|
| **A. 平行存在未接线** | 新实现已经写好、测试齐全，但调用路径上还留着旧占位实现，两者互不相通 | `bash.ts` 绕过 `exec-gateway.ts`；`registry.ts` 简单过滤 vs `evaluate.ts` 完整判定链；`cache-policy.ts` 从未被 `anthropic-provider.ts` 调用；`redact.ts` 零调用方；`skills-verbose.ts` 占位符与真实 skill 发现结果**同时**出现在最终 prompt 里（双 `<skills>` 块 bug）；`channel/` 整个模块群未接入 `main.ts`（main.ts 自己直接用 readline，功能重复）；gateway 的会话状态与 `SessionStore` 完全脱节（两套互不相通的存储） | **低**，通常是几十行到一两百行的粘合代码 |
| **B. 已知简化，标记明确** | 代码里用中文注释明确写了"本迭代简化""升级点"，作者自己知道差距在哪 | 压缩触发后不调真实 LLM 摘要（占位字符串）；`risk.ts` 正则风险探测非安全边界；`exec-gateway.ts` sandbox 模式降级为 local；`long-term-store.ts` 朴素词袋检索；`glob.ts` 只支持 `*` | **中**，需要新写实现，但接口/测试骨架已经就位 |
| **C. 完全空白/惰性** | 依赖的下游实现在 `src/` 里根本不存在，只在单测里用 test double 替代 | `knowledge/` 的 `DataSource`/`Extractor`/`AdmissionPolicy` 无真实实现；`hooks/` 无配置加载器（`main.ts` 永远传空 `HookRegistry`）；`server/gateway.ts` 零鉴权、零限流；`heartbeat` 任务表纯内存无持久化 | **高**，需要新的设计决策 + 全新代码 |

### 本计划的排序逻辑

1. **A 类（接线债务）** 全部前置到迭代 7，因为修复成本低、且部分本身就是安全漏洞（bash 绕过沙盒、redact 零调用、gateway 零鉴权）。
2. **B 类**按"安全/正确性 > 成本/体验 > 便利性"排序分布到迭代 8–11。
3. **C 类**中凡是"决定产品方向"的（多租户、后台子任务、远程 skill marketplace）放到最后、且列为可选，避免在方向未定时投入大改动。

---

## 二、按模块的技术架构设计

> 每个模块给出：现状与简化点（文件级定位）→ 生产化目标（长成什么样）→ 设计要点（怎么做，含参考的开源实现）。难度/优先级标注在"三、迭代路线"里落地为具体 Task。

### A. 核心运行时 `src/core/`

**现状**：`run-loop.ts` 的压缩触发后只生成占位字符串 `"[Compacted N messages]"`（`decideCompaction()`），等于**丢弃**全部被折叠的历史；`consumeLlmStreamWithRetry` 只对 `RateLimitError`/`OverloadError` 做线性退避重试，无 jitter、不解析 `Retry-After`、无熔断器、无多 provider failover；provider 流中途报错时，已经流式吐给用户的文本被整体丢弃，重试是整轮重来而非续接。

**生产化目标**：
- 压缩触发后调用一个"便宜/快"模型做真实摘要，显式保留活跃任务/上次诉求/决策依据/标识符原文；摘要失败要有降级路径。
- 重试改为指数退避+jitter+尊重 `Retry-After`/`retry-after-ms`；区分前台交互式请求与后台任务的重试预算。
- provider registry 支持故障转移链：连续失败超阈值→冷却→半开探测（熔断器语义），而不是死绑一个 provider。
- 流式中断保留"已吐出但未提交"的部分内容，中断恢复时合成续接消息而非整轮重来。

**设计要点/参考实现**：
- 真实摘要压缩：`opensource/openclaw-2026.7.1/src/agents/compaction.ts`（`summarizeChunks` 分块摘要 + `MERGE_SUMMARIES_INSTRUCTIONS` 合并 + 显式保留 TODO/标识符）、`opensource/opencode/packages/opencode/src/session/compaction.ts`（"只摘要 head、保留 tail 不进摘要输入"的边界策略）。
- 退避+jitter：`opensource/claude-code-main/src/services/api/withRetry.ts`（`BASE_DELAY_MS*2^n` 封顶 32s + `Math.random()*0.25*base` 抖动，按前台/后台分类容忍度）；`opensource/opencode/packages/opencode/src/session/retry.ts`（优先读 `retry-after` 头）。
- 熔断器+多模型 failover+流式续接：`opensource/nanobot/nanobot/providers/fallback_provider.py`（半开探测式熔断器 + `on_stream_recover()` 在新 fallback 模型上续接已吐出内容——这是本项目"整轮重来"问题的直接解法）。
- 中断恢复消息合成：`opensource/claude-code-main/src/utils/conversationRecovery.ts`（`detectTurnInterruption()` 分类最后一条消息，合成 `"Continue from where you left off."`）。

### B. 工具子系统 `src/tool/`

**现状**：`bash.ts` 注释自陈"本迭代占位实现：直接调用 Node 子进程，不经过沙盒/权限网关"——`exec-gateway.ts` 与实际执行路径**平行存在但未接线**；`orchestrator.ts` 无超时/无长任务流式进度回传；`mcp/client.ts` 只有 Streamable HTTP，无 stdio 传输（大量社区 MCP server 仍是 stdio-first）；`registry.ts` 的权限过滤是硬编码 `TOOL_ACTION_MAP` + 简单 last-match，与 `permission/evaluate.ts` 的完整 9 步判定链是**两套独立实现**，存在语义漂移风险；`task.ts` 的后台任务（`task_id` resume）显式未实现。

**生产化目标**：
- bash 工具**唯一**经过 `ExecGateway`，消灭"平行存在"。
- `registry.ts` 的过滤逻辑直接调用 `evaluate()`，消除两套判定。
- MCP client 补齐 stdio 传输（优先复用官方 `@modelcontextprotocol/sdk` 而非继续自研协议细节）。
- 编排器增加 per-tool 超时、可选的长任务流式增量输出。
- `task` 工具支持真正的后台任务（不阻塞父 run-loop，可轮询/可取消）。

**设计要点/参考实现**：
- MCP stdio + 官方 SDK：`opensource/rowboat/apps/cli/src/mcp/mcp.ts`（`@modelcontextprotocol/sdk` 的 `StdioClientTransport`/`StreamableHTTPClientTransport`/`SSEClientTransport`，HTTP 失败自动降级 SSE）；`opensource/openclaw-2026.7.1/src/agents/mcp-stdio-transport.ts`（进程树 kill 的超时分级，避免僵尸进程）。
- 工具超时+输出截断：`opensource/opencode/packages/core/src/tool/bash.ts`（`Effect.sleep` 与进程完成竞速）、`opensource/nanobot/nanobot/agent/tools/exec_session.py`（单调时钟 deadline + 分级 wait/kill）。
- 并发原语简化：`opensource/opencode/.../processor.ts:574` 用 Effect `{concurrency:"unbounded"}` 替代手写冲突检测数组，可作为 `orchestrator.ts` 重构参考（非必须，风险自担）。

### C. 权限系统 `src/permission/`

**现状**：`glob.ts` 只支持 `*` 通配；`manager.ts` 的 pending 请求纯内存 Map，重启即丢，`settle()` 不落审计记录；`persist.ts` 的规则落盘是无锁 JSON 读改写，并发写会互相覆盖；判定链本身（`gate.ts`/`evaluate.ts`）设计扎实、fail-closed，无明显简化，但完全是单用户模型，无 RBAC/多租户；全局没有统一的审计日志出口。

**生产化目标**：
- 规则持久化迁移到 SQLite（项目已有 `storage/` 基础设施同源存储）或至少加文件锁，消除并发写丢失。
- 引入结构化审计日志：每次权限决策（action/pattern/mode/decision/依据/时间/发起方）落盘为哈希链（防篡改）。
- 更丰富的 glob（至少 `**`+路径归一化）。
- 多租户/RBAC 列为可选，视产品方向决定是否投入。

**设计要点/参考实现**：
- 哈希链审计日志：`opensource/zeroclaw/crates/zeroclaw-runtime/src/security/audit.rs`（`entry_hash = SHA256(prev_hash||canonical_json)`，可选 HMAC 签名）——设计可直接移植。
- 规则持久化迁移 SQLite：`opensource/opencode/packages/core/src/permission/saved.ts`（drizzle-orm + SQLite，`onConflictDoNothing()` 天然 ACID）。
- 若坚持 JSON 文件：`opensource/pi/packages/coding-agent/src/core/project-trust.ts`（`proper-lockfile` 加锁+重试）。
- 多租户授权表参考（可选）：`opensource/AgentSpace/packages/db/src/runtime-grants.ts`（workspace/user 授权 + 软撤销 `revoked_at`）。
- 更丰富 glob：`opensource/opencode/packages/core/src/util/wildcard.ts`。

### D. 沙盒 `src/sandbox/`

**现状**：`exec-gateway.ts` 明确写"`sandbox` 模式本迭代降级为 local（无真实容器/命名空间隔离）"；`risk.ts` 用正则/分词做风险探测，自陈"不是安全边界"，可被引号/变量拼接绕过；无网络出口控制；无 CPU/内存资源上限（只有 timeout）；bash 工具目前根本不调这个 gateway，等于"沙盒层写好了没人用"。

**生产化目标**：
- 用 tree-sitter-bash（AST 解析）替换正则风险探测。
- 至少 Linux 下的 namespace/bubblewrap 级隔离（workspace 目录读写、其余只读或不可见），补上网络隔离。
- 显式的网络出口白名单 + 文件系统读写范围配置（内核级而非仅应用层路径前缀检查）。
- 把 `bash.ts` 真正接入这套 gateway。

**设计要点/参考实现**：
- 完整生产级架构形态："类型化限制配置+违规事件+ask 回调"：`opensource/claude-code-main/src/utils/sandbox/sandbox-adapter.ts`（`NetworkRestrictionConfig`/`FsReadRestrictionConfig`/`FsWriteRestrictionConfig`/`SandboxViolationEvent`）——长期架构目标形态。
- 现实起点——轻量级 bubblewrap 隔离：`opensource/nanobot/nanobot/agent/tools/sandbox.py`（`bwrap` 只挂载 workspace 读写、父目录 tmpfs 遮盖、独立 `/proc`/`/dev`/`/tmp`；注意其自身缺网络隔离 `--unshare-net`，移植时需补上）。体量小、依赖少，是"给 exec-gateway 加真隔离"性价比最高的落地路径。
- 云沙盒 backend（可选路线）：`opensource/agentscope/src/agentscope/workspace/_sandboxed_base.py` + `_daytona_backend.py`（委托给 Daytona/Docker/E2B/K8s 远端沙盒）。
- tree-sitter-bash 风险解析：`opensource/claude-code-main/src/utils/bash/{parser.ts,ast.ts,ParsedCommand.ts}`；WASM 版本带防 DoS 限制：`opensource/openclaw-2026.7.1/src/infra/command-explainer/tree-sitter-runtime.ts`（128KiB 输入上限+500ms 解析超时）。

### E. 上下文装配 `src/context/`

**现状**：`pipeline.ts` 有已知的结构性债务——`<env>`/`<memory>` 标签在输出里各出现两次（迭代1 静态占位段 + 迭代3 真实数据段并存），MCP instructions 恒为空；`budget.ts` 的硬截断、`run-loop.ts` 的假摘要压缩、`prune.ts` 的跨消息裁剪是**三套独立的"丢信息"机制**，触发条件和优先级互不统一；`token-counter.ts` 默认走字符数估算降级路径，需确认生产环境是否真的注入了官方计数 API。

**生产化目标**：
- 重构 `assembleContext`/`buildSystemPrompt` 为单一职责 section 列表装配（每个 section 只产出一次），消除重复标签。
- 统一"内容丢弃"决策：一套逻辑覆盖 tool_result 截断/跨消息 pruning/整体压缩摘要的触发顺序与优先级。
- 确认生产环境注入官方 token 计数 API，而非长期停留在字符数估算。

**设计要点/参考实现**：
- section 化装配的类型化返回：`opensource/claude-code-main/src/utils/systemPrompt.ts`（5 级优先级链 + 返回类型化 block 数组而非拼接字符串）——与下面"F/L"两节的 cache-policy 接线是同一次重构的两个收益点，建议合并到同一个 Task 里做。

### F. LLM Provider `src/llm/`

**现状**：`anthropic-provider.ts` 的 `buildSystemBlocks` 把整个 system 合并成一个 block，只打一个 `cache_control` 断点（"范围简化"）——`prompt/cache-policy.ts` 里已经实现了正确的多断点算法（连续可缓存前缀+遇 volatile 段即停），且测试完整，**但从未被调用**；实际效果是 `environment.ts` 里的实时日期/cwd 一变，整个 system prompt（含本应稳定的 identity/工具定义/skills）全部缓存失效；`openai-compatible-provider.ts` 无 prompt caching；`llm/registry.ts` 无 fallback。

**生产化目标**：
- 把 system prompt 从拼接字符串改为分段 content-block 数组（对齐 `cache-policy.ts` 的输入形状），在 `anthropic-provider.ts` 中真正调用 `resolveCacheBreakpoints`，按其结果放置 `cache_control`（尊重 ≤4 断点上限，工具定义单独占一个断点）。
- provider registry 支持 fallback 链（与"A. 核心运行时"的熔断器设计是同一份工作）。
- 真实 API 集成测试纳入 CI（哪怕低频 nightly），不再长期依赖人工核对。

**设计要点/参考实现**：
- 多断点缓存放置的最佳参照：`opensource/goose/crates/goose-provider-types/src/formats/anthropic.rs`（工具规格单独打尾部断点 + 显式不变量测试"volatile turn-context 必须位于每个缓存断点之后"）——这是 uAgentCli 目前"合并成一个 block"侥幸避开、但拆分 section 后必须认真处理的坑。
- 按 provider 差异化应用：`opensource/opencode/packages/opencode/src/provider/transform.ts`。

### G. 记忆 `src/memory/`

**现状**：`long-term-store.ts` 是原始词重叠计数（非 TF-IDF/余弦相似度，无长度归一化），全表扫描后 JS 内打分；`session-memory.ts` 进程内 Map，重启即丢，`retrieve` 甚至不接受 query；`curated-notes.ts` 的"原子写"锁是 `existsSync`+`writeFileSync` 两次系统调用，存在 TOCTOU 竞态；`extractor.ts` 同步阻塞、无去重。

**生产化目标**：检索需要真正的向量相似度；`curated-notes` 锁需原子 `O_EXCL` 或 `proper-lockfile`；`session-memory` 持久化；`extractor` 异步化+去重。

**关键决策——本地小模型 vs 外部 embedding API**：鉴于项目已有 `threatScan` 在每次 retrieve 前做网关式检查（说明重视隐私/离线能力），**建议默认走本地小模型**（量化 MiniLM/bge-small，走 transformers.js/ONNX，CPU 推理几十毫秒级），外部 API 作为可选 provider，避免离线时静默失败或秘密内容外泄。

**设计要点/参考实现**：
- chunk 与 embedding 分离的抽象：`opensource/agentscope/src/agentscope/rag/_vdb/_vector_store.py`（`VectorStoreBase`/`VectorRecord`）；本地单文件向量库：`_vdb/_milvus_lite.py`（佐证 sqlite-vec 路线可行）；embedding 结果磁盘缓存：`agentscope/embedding/_file_cache.py`。
- **低成本过渡方案（不建向量库）**：`opensource/claude-code-main/src/memdir/findRelevantMemories.ts`——只扫描记忆文件 frontmatter（文件名+摘要），用一次廉价 LLM 调用挑相关文件。可作为向量检索落地前的第一步。
- 非向量路线的佐证：`opensource/goose/crates/goose-mcp/src/memory/mod.rs`（纯分类/标签检索，说明并非必须走向量路线）。

### H. 知识库 `src/knowledge/`

**现状**：比记忆模块更原始——`IndexStore` 是 `Map<string,string[]>`，**没有 search() 方法**，目前完全无法回答"什么和 X 相关"；`pipeline.ts` 的编排逻辑（增量扫描/变更检测）健全，但其依赖的 `DataSource`/`ChangeDetector`/`AdmissionPolicy`/`Extractor` 在 `src/` 里**没有任何真实实现**，只在单测里用 test double；`lastSeenHash` 是内存 Map，重启后全部文件视为"从未见过"。

**生产化目标**：给 `IndexStore` 加 `search(query, topK, filter?)`；实现真实的 chunker/文件扫描 DataSource/gitignore 感知的 AdmissionPolicy；持久化 `lastSeenHash`；embedding 存储可与记忆模块共用同一 sqlite-vec 文件，避免两套存储栈。

**设计要点/参考实现**：`opensource/agentscope/src/agentscope/rag/_knowledge.py`（`KnowledgeBase`：embedding model + vector store + metadata_filter 绑定为窄接口，正是 IndexStore+pipeline 该长成的样子）；`_chunker/_base.py`（不跨结构边界合并的 chunking 契约）；`_dimension_policy.py`（embedding 维度治理，防止换模型后向量混用）。

### I. 渠道 `src/channel/` + 心跳 `src/heartbeat/`

**现状（channel）**：整个模块群**未被 `main.ts` 调用**——main.ts 自己直接用 `readline`，与 `local-cli.ts` 适配器功能重复；`FileMailbox` 对并发多读者无保护（单读者单写者场景是安全的，这是有意识的范围限制）。

**现状（heartbeat）**：手写 cron 解析器不支持范围/命名值/时区；任务表纯内存，重启即丢；**完全没有"错过 tick"补偿逻辑**——进程宕机跨越一次调度时间，该次触发永久丢失；webhook 外部触发源零鉴权；`emit()` 内部错误被 `void` 静默吞掉。

**生产化目标**：
- channel：先把 registry/local-cli 真正接入 main.ts 消灭重复实现，再考虑新增适配器；mailbox 加锁或迁移到 SQLite 事务队列。
- heartbeat：任务定义持久化（SQLite 表）；明确错过 tick 策略（跳过 vs 补跑一次 vs 补跑 N 次，需要显式决策而非隐式行为）；webhook 加共享密钥校验。

**设计要点/参考实现**：
- 六种正交的消息总线模式（drain queue/replay log/broadcast/distributed lock/registry）：`opensource/agentscope/src/agentscope/app/message_bus/_base.py` + `_redis_message_bus.py`——mailbox 演进到 Redis Streams 的现成蓝图。
- "把协议实现委托给单一外部网关进程"模式：`opensource/LobsterAI/src/main/im/imGatewayManager.ts`（多渠道配置+连通性自检，app 侧只做瘦配置同步）。
- **"错过 tick"是真实高频难题的确凿证据**：LobsterAI 仓库中有 4 个版本反复修复"cron-skip-missed-jobs"的 patch——本项目应在设计阶段就明确策略，而非等生产事故后打补丁。

### J. 存储 `src/storage/` + 网关 `src/server/gateway.ts`

**现状（storage）**：`session-store.ts` 用 better-sqlite3，schema 只有两表，无迁移框架/无 schema_version；无外键约束；**代码里完全没有任何 PRAGMA**（无 WAL/无 `foreign_keys=ON`/无 `busy_timeout`），默认 rollback journal 模式并发读写极易触发 `SQLITE_BUSY`；`listMessages` 无分页，长会话全量加载入内存。

**现状（gateway）**：自称"极简 HTTP+SSE gateway"——**零鉴权**（任何客户端可读写任意 sessionId）；`GatewaySession` 纯内存 Map，与 `SessionStore` 的 SQLite 持久化**完全脱节**（两套互不相通）；`readBody()` 无请求体大小上限（内存耗尽 DoS 风险）；无 CORS/TLS；session 无 TTL/GC；错误直接把 `error.message` 返回客户端（信息泄露）；SSE 广播疑似未完全接线（`/chat/send` 未观察到实际推送路径）。

**生产化目标**：
- storage：连接建立时设置 WAL/`foreign_keys`/`busy_timeout`/`synchronous`；引入版本化迁移文件；加外键+`ON DELETE CASCADE`；游标分页。
- gateway：**最低限度 API key/bearer token 鉴权**（当前零鉴权是部署前必须解决的硬阻塞项）；把 gateway 接入 `SessionStore` 而非独立内存 Map；请求体 schema 校验+大小上限；错误脱敏；确认或修复 SSE 推送链路。

**设计要点/参考实现**：
- PRAGMA 初始化+迁移文件模式：`opensource/opencode/packages/core/src/database/database.ts` + `database/migration/*.ts`（可直接复用初始化代码）；`session_context_epoch` 表（baseline+snapshot，避免每次 resume 全量重放）。
- 轻量迁移备选：`opensource/goose/.../session_manager.rs`（`pragma_table_info` 检测缺失列做原地迁移，比完整迁移框架轻）。
- 多租户鉴权完整模型（gateway 未来若要多租户）：`opensource/AgentSpace/packages/db/src/postgres-schema.ts`（token_hash/expires_at/revoked_at + workspace_membership + CASCADE）。
- 客户端 token 附加约定：`opensource/rowboat/apps/cli/src/models/gateway.ts`（`authedFetch`）。
- 限流：三个参考项目均未见可复用中间件，建议直接用标准库（如 `express-rate-limit` 思路），不必强行照抄。

### K. Agent `src/agent/` + Skill `src/skill/`

**现状（agent）**：`AgentRegistry` 只在启动时同步扫描一次，无热重载；frontmatter schema 薄（缺 `disallowedTools`/`permissionMode`/per-agent `mcpServers`/`hooks`/`effort`）；`task.ts` 明确未实现后台/异步 subagent（诚实暴露而非隐藏）；`AgentMode.teammate` 是类型里存在但代码从未真正区分行为的死枚举值；同名 agent 覆盖静默无警告。

**现状（skill，含一个已确诊真实 bug）**：`discovery.ts`/`registry.ts` 是真实实现，已被 `main.ts` 调用产出真实 skillsVerboseText——**但 `prompt/sections/skills-verbose.ts` 的硬编码空占位符同时作为固定 section 顺序的一部分被拼入最终 prompt**，导致模型收到的 prompt 里**同时存在一份真实技能列表和一份"未发现技能"的空占位块**。此外 discovery 只扫描单一硬编码目录，无用户级目录、无热重载，同名 skill 无冲突警告。

**生产化目标**：
- agent：扩展 frontmatter 字段对齐生产级 schema；实现真正的后台/异步子任务执行（涉及会话生命周期，是本模块最大的一块工作）；文件热重载；同名覆盖记录警告。
- skill：**优先修复双 `<skills>` 块 bug**（重构 `buildSystemPrompt` 接受注入数据而非零参 `compute()`）；多来源发现（用户级/项目级向上遍历）；热重载；同名冲突显式优先级+日志；按 `agent.permission` 过滤技能可见性。

**设计要点/参考实现**：
- agent 权限合并模式：`opensource/opencode/packages/opencode/src/agent/agent.ts`（`Permission.merge(defaults, overrides)` 合并式而非替换式）；生产级 AgentJsonSchema：`opensource/claude-code-main/tools/AgentTool/loadAgentsDir.ts`。
- **skill 最佳单一参照**：`opensource/opencode/packages/opencode/src/skill/index.ts`——多来源合并扫描、内置 skill 先注册磁盘同名后覆盖、同名冲突记 `logWarning`、`available(agent)` 按权限过滤（`Permission.evaluate("skill",...)`），其 `fmt()` 输出格式已与本项目 `formatSkills` 高度一致，说明格式设计本身没问题，只是接线点需要修。
- 热重载最佳实践：`opensource/claude-code-main/.../skillChangeDetector.ts`（chokidar + `awaitWriteFinish` 1s 稳定阈值 + 300ms 防抖，规避 Bun 下 fs.watch 死锁的已知坑）。

### L. Security `src/security/` + Prompt `src/prompt/`

**现状（security）**：`threat-scan.ts` 是 8 个硬编码正则的关键词启发式（已接线到 4 处调用点）；`env-scrub.ts` 是正则后缀+精确名单，纯变量名匹配不检查值（已接线到 exec-gateway）；**`redact.ts` 有完整实现和单测，但 `grep` 确认在 `src/` 其他任何地方都没有被调用**——这是"死代码冒充安全特性"，比简化更严重。

**现状（prompt）**：`sections/skills-verbose.ts`/`sections/memory-snapshot.ts` 是已确认占位符，但背后的真实实现都已存在（与 K 节 skill bug 同一根因）；`cache-policy.ts` 正确实现但从未被调用（与 F 节同一根因）；`system-prompt.ts` 5 个 section 顺序硬编码，无条件跳过空 section。

**生产化目标**：
- **最优先接入 `redact()`**到工具结果回填对话历史的路径。
- 扩充 `env-scrub` 覆盖 Azure/GCP/OTLP/CI 令牌类别，逐条注释理由。
- `redact` 增加信息熵兜底检测（未知格式密钥）。
- `threat-scan` 升级为分级评分+可配置动作（warn/sanitize/block），而非二元判定。
- prompt：把 system prompt 改为分段 content-block 数组（与 E/F 节是同一次重构），接入 `cache-policy.ts`；接线 `skills-verbose`/`memory-snapshot` 到真实数据源。

**设计要点/参考实现**：
- 分级评分+三态动作：`opensource/zeroclaw/crates/zeroclaw-runtime/src/security/prompt_guard.rs`（6 类别评分：system_override/role_confusion/tool_injection/secret_extraction/command_injection/jailbreak，0-1 归一化，可配置灵敏度阈值）——`threat-scan.ts` 升级的直接蓝图。
- 信息熵检测：`opensource/zeroclaw/.../security/leak_detector.rs`（Shannon 熵检测长度≥24 的高熵孤立 token）。
- env-scrub 清单+逐条理由：`opensource/claude-code-main/src/utils/subprocessEnv.ts`（~20 条清单，含"为什么保留 GITHUB_TOKEN"这类说理注释，风格值得整体照搬）。

---

## 三、研发迭代路线总览

延续骨架阶段"迭代 0–6"的编号，生产化阶段从**迭代 7**开始。每个迭代仍然要求"验收 Gate 全过才进下一迭代"，与前六迭代的执行原则一致。

| 迭代 | 主题 | 债务类型 | 目标 |
|---|---|---|---|
| 迭代 7 | 接线扫尾与安全裸洞 | 主要是 A 类 | 消灭"平行存在未接线"，堵上已确认的安全裸洞（bash 绕沙盒、redact 零调用、gateway 零鉴权、skill 双占位块） |
| 迭代 8 | 持久化与审计基座 | A+B 类 | 权限规则/心跳任务/会话记忆从内存/无锁 JSON 迁移到带审计的持久化存储 |
| 迭代 9 | 检索与知识库 | C 类 | 记忆模块从词袋检索升级向量检索；知识库从"完全惰性"到有 `search()` 能力 |
| 迭代 10 | 沙盒与执行安全 | B 类 | tree-sitter-bash 风险解析 + bubblewrap 隔离，让"沙盒"名副其实 |
| 迭代 11 | 运行时韧性与成本优化 | B 类 | 真实压缩摘要、重试熔断/多 provider failover、Anthropic 多段缓存断点 |
| 迭代 12 | Agent/Skill 生态完善 | B+C 类 | frontmatter 扩展、热重载、后台子任务执行 |
| 迭代 13（可选） | 多租户与网关生产化 | C 类，视产品方向 | RBAC、gateway 多租户/限流/CORS/TLS、渠道适配器扩展 |

**为什么这个顺序**：迭代 7 的每一项都是"低成本、高杠杆"（接线 vs 新建），应该在做任何新能力之前完成——否则新功能会建立在"看起来存在实际没接线"的地基上。迭代 8（持久化/审计）先于迭代 9-12 的原因是后续几乎所有新能力（向量索引、沙盒违规事件、agent 热重载）最终都要落盘，晚做等于返工。迭代 13 独立可选，因为多租户是否需要完全取决于产品方向，不应该默认投入。

---

## 四、Task 详表（按迭代）

### 迭代 7 · 接线扫尾与安全裸洞（P0，禁止跳过）

| Task | 内容 | 涉及文件 | 验收 |
|---|---|---|---|
| T7.1 | bash 工具唯一经过 ExecGateway | `tool/builtin/bash.ts`, `sandbox/exec-gateway.ts` | 直接调用 `child_process.exec` 的代码路径消失；bash 工具的所有执行都能在测试里断言经过了 gateway 的 env-scrub/白名单检查 |
| T7.2 | registry.ts 权限过滤统一到 evaluate() | `tool/registry.ts`, `permission/evaluate.ts` | `getTools()` 不再维护独立的 `TOOL_ACTION_MAP` 简单匹配，改为调用 `evaluate()`；两套判定不一致的既有测试用例全部消失或改写为一致 |
| T7.3 | 接入 `redact()` 到工具结果回填路径 | `security/redact.ts`, `core/run-loop.ts`（`executeToolUses` 结果回填处） | 新增集成测试：一个模拟输出含密钥格式字符串的工具，结果进入对话历史前被脱敏 |
| T7.4 | gateway 最低限度鉴权 | `server/gateway.ts` | 未带合法 API key/bearer token 的请求一律 401；补充请求体大小上限校验 |
| T7.5 | gateway 接入 SessionStore | `server/gateway.ts`, `storage/session-store.ts` | 移除 `GatewaySession` 独立内存 Map，会话状态统一走 SessionStore；重启后 gateway 侧会话可恢复 |
| T7.6 | 修复 skill 双 `<skills>` 占位块 bug | `prompt/system-prompt.ts`, `prompt/sections/skills-verbose.ts` | `buildSystemPrompt` 改为接受注入数据而非零参 `compute()`；输出 prompt 里只有一份真实技能列表，golden 测试更新 |
| T7.7 | cache-policy.ts 接入 anthropic-provider.ts | `llm/anthropic-provider.ts`, `prompt/cache-policy.ts`, `prompt/system-prompt.ts` | system prompt 改为分段 content-block 数组；`resolveCacheBreakpoints` 结果被真实用于放置 `cache_control`；新增测试断言"仅改动 volatile 段不会使 identity/工具定义段缓存失效" |
| T7.8 | channel 接入 main.ts，消灭 readline 重复实现 | `cli/main.ts`, `channel/registry.ts`, `channel/adapters/local-cli.ts` | main.ts 通过 `ChannelAdapter` 接口收发消息，不再直接持有 `readline.Interface` |
| T7.9 | SQLite PRAGMA 调优 | `storage/session-store.ts` | 连接建立时设置 WAL/`foreign_keys=ON`/`busy_timeout`/`synchronous`；新增并发写测试验证不再触发 `SQLITE_BUSY` |
| T7.10 | hooks 最小配置加载器 + trust gate | `hooks/registry.ts`, `cli/main.ts` | `main.ts` 不再永远传入空 `HookRegistry`，能从配置文件加载至少一个真实 hook；新增 trust gate（不信任来源的 hook 默认不加载） |

### 迭代 8 · 持久化与审计基座

| Task | 内容 | 涉及文件 |
|---|---|---|
| T8.1 | 权限规则持久化迁移 SQLite（或加 `proper-lockfile`） | `permission/persist.ts`, `storage/` |
| T8.2 | 哈希链审计日志：权限决策统一 sink | `permission/gate.ts`, `permission/manager.ts`, `permission/reply.ts`, 新增 `permission/audit.ts` |
| T8.3 | heartbeat 任务定义持久化（SQLite 表） | `heartbeat/scheduler.ts`, `storage/` |
| T8.4 | heartbeat 错过 tick 策略（显式决策：跳过/补跑一次/补跑 N 次） | `heartbeat/scheduler.ts` |
| T8.5 | webhook 外部触发源加共享密钥校验 | `heartbeat/trigger-engine.ts` |
| T8.6 | session-memory 持久化 | `memory/session-memory.ts` |
| T8.7 | curated-notes 原子锁修复（`O_EXCL` 或 `proper-lockfile`） | `memory/curated-notes.ts` |
| T8.8 | storage 迁移框架 + 外键 + 游标分页 | `storage/session-store.ts` |
| T8.9 | mailbox 并发多读者加锁或迁移 SQLite 事务队列 | `channel/mailbox.ts` |

### 迭代 9 · 检索与知识库

| Task | 内容 | 涉及文件 |
|---|---|---|
| T9.1 | 记忆检索：先接入"低成本过渡方案"（frontmatter+摘要+LLM 挑选相关文件） | `memory/long-term-store.ts` |
| T9.2 | 记忆检索：本地小模型向量化 + sqlite-vec 存储（默认路线） | `memory/long-term-store.ts`, 新增 embedding 层 |
| T9.3 | 记忆检索：外部 embedding API 作为可选 provider | `memory/long-term-store.ts` |
| T9.4 | `knowledge/types.ts` 的 `IndexStore` 增加 `search(query, topK, filter?)` | `knowledge/types.ts`, `knowledge/index-store.ts` |
| T9.5 | 实现真实 `DataSource`（文件扫描）/`AdmissionPolicy`（gitignore 感知）/`Extractor`（chunker） | `knowledge/` 新增实现文件 |
| T9.6 | `lastSeenHash` 持久化，避免重启后全量重新抽取 | `knowledge/pipeline.ts` |
| T9.7 | embedding 存储与记忆模块共用同一 sqlite-vec 文件 | `knowledge/`, `memory/` |

### 迭代 10 · 沙盒与执行安全

| Task | 内容 | 涉及文件 |
|---|---|---|
| T10.1 | tree-sitter-bash 风险解析替换正则（WASM 版本，限制输入大小/解析耗时） | `sandbox/risk.ts` |
| T10.2 | Linux bubblewrap namespace 隔离（workspace 读写、其余只读/不可见） | `sandbox/exec-gateway.ts` |
| T10.3 | 补充网络隔离（`--unshare-net` + 域名白名单出口） | `sandbox/exec-gateway.ts` |
| T10.4 | env-scrub 清单扩充（Azure/GCP/OTLP/CI 令牌类别，逐条注释理由） | `security/env-scrub.ts` |
| T10.5 | redact 信息熵兜底检测 | `security/redact.ts` |
| T10.6 | threat-scan 升级为分级评分+可配置动作 | `security/threat-scan.ts` |

### 迭代 11 · 运行时韧性与成本优化

| Task | 内容 | 涉及文件 |
|---|---|---|
| T11.1 | 真实 LLM 摘要压缩（分块摘要+合并+失败降级） | `core/run-loop.ts`（`decideCompaction`） |
| T11.2 | 重试指数退避+jitter+`Retry-After` 头解析 | `core/run-loop.ts`（`consumeLlmStreamWithRetry`） |
| T11.3 | 多 provider 熔断器+failover（半开探测） | `llm/registry.ts`, `core/run-loop.ts` |
| T11.4 | 流式中断续接（保留已吐出内容，中断恢复合成续接消息） | `core/run-loop.ts` |
| T11.5 | context 装配 section 化重构，消除 `<env>`/`<memory>` 重复标签 | `context/pipeline.ts` |
| T11.6 | 统一"内容丢弃"策略（tool_result 截断/pruning/摘要压缩三层协调） | `context/budget.ts`, `context/prune.ts`, `core/run-loop.ts` |
| T11.7 | 确认生产环境注入官方 token 计数 API | `context/token-counter.ts`（集成层配置） |
| T11.8 | 真实 API 集成测试纳入 CI（nightly） | CI 配置 |

### 迭代 12 · Agent/Skill 生态完善

| Task | 内容 | 涉及文件 |
|---|---|---|
| T12.1 | agent frontmatter 扩展（`disallowedTools`/`permissionMode`/per-agent `mcpServers`/`hooks`/`effort`） | `agent/types.ts`, `agent/loader.ts` |
| T12.2 | agent 文件热重载 | `agent/registry.ts` |
| T12.3 | 后台/异步子任务执行（`task_id` resume） | `tool/builtin/task.ts`, `core/run-loop.ts` |
| T12.4 | 同名 agent 覆盖时记录警告 | `agent/registry.ts` |
| T12.5 | skill 多来源发现（用户级/项目级向上遍历） | `skill/discovery.ts` |
| T12.6 | skill 热重载（chokidar + 防抖） | `skill/discovery.ts` |
| T12.7 | skill 同名冲突显式优先级+日志 | `skill/registry.ts` |
| T12.8 | skill 按 `agent.permission` 过滤可见性 | `skill/registry.ts`, `agent/subagent-permissions.ts` |

### 迭代 13 · 多租户与网关生产化（可选，需先决策产品方向）

| Task | 内容 | 涉及文件 |
|---|---|---|
| T13.1 | permission RBAC + 多租户授权表 | `permission/`, `storage/` |
| T13.2 | gateway 多租户隔离 + 限流 + CORS/TLS 部署指引 | `server/gateway.ts` |
| T13.3 | 渠道适配器扩展（Slack/Discord 等），采用"委托外部网关"模式 | `channel/adapters/` |
| T13.4 | 消息总线模式升级（drain queue → replay log/broadcast，视规模需要） | `channel/mailbox.ts` |

---

## 五、验收 Gate（每迭代必须全过才进下一迭代）

- **迭代 7**：`npx tsc --noEmit` 零错误；`npx vitest run` 全绿；手动验证 gateway 无 API key 请求返回 401；手动验证 bash 工具的一次危险命令（如硬线正则命中）走 exec-gateway 被拒绝而非直接执行；system prompt 快照测试确认无重复 `<skills>`/`<env>`/`<memory>` 块。
- **迭代 8**：并发写权限规则/心跳任务的压力测试不丢数据；审计日志哈希链可独立校验（改一条历史记录会破坏后续哈希链）。
- **迭代 9**：知识库 `search()` 对种子语料的 top-K 召回率达到人工评估的"合理相关"标准（无需数值化 KPI，允许人工抽样评审）；向量检索关闭网络时仍可用（本地模型路线）。
- **迭代 10**：一组已知的正则绕过样本（引号拼接/变量拼接的危险命令）在 tree-sitter-bash 版本下能被正确识别；bubblewrap 隔离下沙盒进程无法读取 workspace 之外的文件、无法发起沙盒未授权的网络请求。
- **迭代 11**：长对话触发压缩后，人工评审摘要质量"保留了关键决策与标识符"；故意打断网络模拟 429/529 风暴，观察重试不放大请求量；真实 API nightly job 连续 3 天通过。
- **迭代 12**：热重载改一个 agent/skill 文件，无需重启进程即生效；一个后台子任务可以在父 run-loop 结束后仍继续运行并可查询状态。
- **迭代 13**（如启动）：多租户下 A 租户无法读取 B 租户的会话数据（渗透式测试用例）。

---

## 六、风险与前置确认项

1. **迭代 11 的多 provider 故障转移会 breaking change `RunLoopStaticInput.provider`**（从单一字段变成 provider 列表+路由策略），影响面覆盖 `core`+`llm`+相关测试，建议在迭代 11 开工前先出一份专项设计评审，而不是直接开工。
2. **迭代 9 的 embedding 模型选型**（本地小模型 vs 外部 API）涉及依赖体积（transformers.js/ONNX runtime 会显著增加安装包大小）与推理延迟的权衡，建议先用"低成本过渡方案"（T9.1）验证检索质量收益是否值得后续投入，再决定是否上向量方案。
3. **迭代 10 的 bubblewrap 隔离依赖系统安装 `bwrap`**，非 Linux 环境（macOS/Windows）需要明确降级策略（如继续走 local 模式 + 更保守的权限 ask），不能假设所有部署环境都能用。
4. **迭代 13 完全可选**——多租户/RBAC 是架构级改动，涉及 `core`+`llm`+`permission`+`storage`+`server` 全链路加 tenant 维度，在没有明确多用户产品需求前不建议启动，避免过度设计。
5. 所有迁移到 SQLite 的持久化改动（迭代 8）都要注意：项目当前是"单进程 CLI"心智模型，如果目标场景本身不需要多进程共享同一份 SQLite 文件，加锁/事务的复杂度可以适当简化——先确认部署形态（单机单进程 vs 多进程/多机）再决定持久化方案的复杂度上限。

---

## 七、里程碑交付节奏建议

- **里程碑 1（迭代 7 完成）**：项目从"骨架能跑通"变成"没有已知的安全裸洞和数据不一致隐患"，可以作为内部小范围试用的起点。
- **里程碑 2（迭代 8-9 完成）**：具备持久化+审计能力+基础检索能力，可以支撑"多会话/长期使用"场景，适合作为 beta 发布节点。
- **里程碑 3（迭代 10-11 完成）**：沙盒与运行时韧性达标，具备对外提供服务（而非仅本机 CLI 使用）的基本安全底线，适合作为对外发布节点。
- **里程碑 4（迭代 12 完成）**：agent/skill 生态可用性达到"可持续迭代"的门槛（热重载+后台任务），适合作为长期演进的稳定基座。
- **迭代 13 视产品方向单独排期，不纳入上述里程碑节奏。**
