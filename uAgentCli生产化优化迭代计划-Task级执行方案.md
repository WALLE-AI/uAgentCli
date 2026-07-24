# uAgentCli 生产化优化迭代计划 · Task 级执行方案（迭代 7–13）

> **本文定位**：把《uAgentCli生产化模块完善技术架构设计与研发迭代计划.md》（"做什么、按什么顺序做"，下称**主计划**）与《uAgentCli生产化模块代码级深化设计.md》（"每个模块怎么改、抄哪段算法、防哪个绕过"，A–Q 共 17 节，下称**代码级设计**）合并落到**可独立开工、可独立验收的 Task 级路径**。
>
> - **上游依据**：主计划的迭代 7–13 与 Task 表（T7.1–T13.4）；代码级设计的模块 A–Q 与"待改文件 × Task 索引"。本文不重复论证，只把每个 Tx.y 细化为"谁先做、依赖谁、产出哪些文件、做到什么算完成（DoD）、属于哪个交付档位、约多少人日"。
> - **延续骨架阶段纪律**：沿用《研发计划-Task级执行方案.md》的六条执行原则（P0 地基先行 / Mock 先于真实 / 每实现类 Task 必带 `*.test.ts` 且 DoD 显列断言点 / 交付档位诚实【真跑通】【可用实现】【接口占位】/ 纪律即验收项 / 迭代闭合 Gate）。**本文全部沿用，不再复述**，仅在每个 Task 的 DoD 里落实。
> - **不改变**主计划的技术选型、模块边界、安全纪律与迭代 7–13 的宏观顺序；**只做四件"优化"**（见 §一）。

---

## 零、部署形态已确认：本地客户端 · 单机单进程（决定全局优先级）

> **前提**：uAgentCli 安装到用户客户端，**智能体运行数据与工具数据基本全部在用户本地**。这一条直接解掉主计划里两个悬置的前置决策（§六风险 4/5、原 T13.0），并反转数个模块的优先级。以下 cascade 已落进后文各 Task。

### 威胁模型的方向被确定
本地客户端的安全边界**不是"租户互隔"，而是"保护用户自己的机器/凭据/文件，免受模型、工具、不可信外部内容的伤害"**。因此：

| 模块 | 在"本地客户端"下的定位变化 | 落点 |
|---|---|---|
| **迭代 10 沙盒/执行安全（F/G/H）** | **升为最高价值**——模型直接在用户机器上跑命令、读用户的 git 仓库/`.env`/云凭据。AST 风险解析 + bwrap 隔离 + env-scrub 是本产品**核心安全卖点**，不是可选加固 | 迭代 10 整体优先级↑，跨平台降级升为一等公民（见下） |
| **迭代 13 多租户/RBAC** | **基本作废**——单机单用户，无 workspace/tenant 概念。`workspace_membership`/跨租户隔离/token 多租户表**不做** | T13.1 删除；T13.0 决策门已由本节回答 |
| **网关鉴权（T7.4）** | **远程接入已确认（见下）**——gateway 允许手机/另一台机跨网络连本地 agent。威胁是"网络上的远程设备越权 + 流量被窃听/篡改 + 远程放行危险权限"。**强制 bearer token + 设备配对 + TLS + 限流**，但**仍单用户、无多租户表** | T7.4 扩为 T7.4/T7.4b/T7.4c（见 §四） |
| **embedding（T9.2）** | **本地模型确定为默认且几乎唯一路线**——数据在本地，外发 embedding API 等于把用户私有内容外泄。外部 API 仅作显式 opt-in | T9.3 降为纯可选，T9.2 隐私为硬 DoD |
| **向量存储（已定选型）** | **SQLite + sqlite-vec `vec0` 虚拟表**，与关系数据同库同连接（M0.1 收口扩展加载）。不引入独立向量库。跨平台需打包三平台扩展二进制 | M0.1 加载扩展；T9.2/T9.7 落 `vec0` |
| **持久化并发（M0.1）** | 单进程 → **锁/事务复杂度可降**。仍要 WAL（防崩溃损坏）+ `foreign_keys`，但 `busy_timeout`/多进程抢写锁/`Semaphore` 串行**按单进程简化**（除非将来后台子任务 T12.3 与主进程并发写同库，见该 Task） | M0.1 DoD 补注 |
| **审计（M0.3）** | 仍有价值，但威胁从"防他人篡改"变为"防被入侵的工具/模型篡改本地记录 + 事后取证"。哈希链保留，签名 HMAC key 可选 | M0.3 不变 |

### 跨平台降级从"脚注"升为"一等公民"
用户客户端会装在 **macOS / Windows / Linux**，而 bwrap 仅 Linux。这不是边缘情况而是**多数安装目标**：
- **Linux/WSL2**：bwrap 完整隔离（T10.2 主路径）。
- **macOS**：需 Seatbelt（`sandbox-exec`）另一套后端——**新增 T10.2b**，不能只写"降级 local"。
- **Windows**：无等价内核隔离，明确降级为"更保守的权限 ask + 风险 AST 仍生效 + 无进程级隔离"，并向用户显式告知安全边界弱化（不能静默假装隔离）。

### 已确认：gateway 允许远程设备接入（手机/另一台机连本地 agent）
这**不改变"单用户"**（是同一用户的多台设备连自己的 agent），但**放大了网络攻击面**，安全要求随之升级为迭代 7 的硬 Gate：

| 因远程接入而**必须**做的事 | 落点 | 为什么本机回环时可省、远程时不可省 |
|---|---|---|
| **强制 bearer token（不再可选）** | T7.4 | 回环时可退化到 unix socket+文件权限；跨网络必须 token 鉴权 |
| **设备配对 / token 生命周期**（生成/列出/撤销/过期） | T7.4c | 多设备各自持独立 token，丢设备要能单独吊销 |
| **TLS（跨网络传输加密）** | T7.4b | 回环流量不出机器；跨网络明文会被窃听（token、对话、工具输出全泄） |
| **限流（per-token/per-ip 令牌桶）** | T7.4b | 远程暴露 = DoS 面 + 暴力破解 token 面 |
| **`/permission/reply` 远程加固** | T7.4 | **远程设备能放行危险权限**——最危险端点，必须校验调用者对该 sessionId 有权 + 记审计 + 可配"敏感操作禁止远程审批" |
| **绑定地址显式配置 + 默认最小暴露** | T7.4 | 默认 loopback，远程需用户显式开 `bind: 0.0.0.0` 或指定网卡，并在启动时告警暴露面 |

> **仍不做**：多租户表 / RBAC / workspace 隔离（单用户）。远程 = 同一人的设备,不是多人。
> **并发**：多设备同时连同一 session 由本地单进程 gateway 串行化,不破坏 M0.1 单进程简化(DB 仍单进程独占)。

---

## 一、相对主计划的四项优化（本文的增量价值）

主计划按迭代-模块给了 Task 表，但**若照表逐条开工会遇到三处返工/一处架构风险**。本文做四项优化：

### 优化 1 · 抽出"共享基础设施"前置 Task，消除重复建设
代码级设计里多个 Task 依赖**同一份底层机制**，若各 Task 各写一份必然漂移。前置抽出为跨迭代复用件（§三 M0.x）：

| 共享件 | 被谁复用 | 若不前置的后果 |
|---|---|---|
| **M0.1 `storage/db.ts` `openDatabase()` + 迁移框架**（PRAGMA 全套 + goose 版本号范式 + `pragma_table_info` 探测） | T7.9 / T8.1 / T8.3 / T8.6 / J-epoch / N-心跳 | 每个持久化 Task 各写一遍 PRAGMA 与建表，`foreign_keys` 每连接开关漏设→CASCADE 静默失效 |
| **M0.2 富 glob `globMatch()`**（opencode `wildcard.ts`：`*?`、路径归一化、`" .*"→"( .*)?"`、非法正则 fail-closed） | T8.x-glob（K）/ T7.10 hooks matcher（L） | 权限与 hooks 各写一套匹配，语义漂移 |
| **M0.3 审计 sink `permission/audit.ts`**（zeroclaw 哈希链 `entry_hash=sha256(prev_hash‖canonicalJSON(payload))`） | T8.2 权限决策 / T10.x 沙盒违规 / T13 gateway reply | 审计点分散，哈希链断裂 |
| **M0.4 `selectProtectedTail(messages, tailTurns)`**（倒序 turn 计数，保护最近 2 轮 + skill） | A-摘要 / E-reclaim / prune.ts | 摘要与 prune 各判各的 tail，边界不一致 |
| **M0.5 `PromptSection[]` 分段模型 + section `cacheable` 标志** | T7.6 双占位修复 / T7.7 多断点 / T11.5 section 化 | 三个 Task 同一次重构的三个收益点被拆散做三遍 |
| **M0.6 `security/redact` 收口 + `fenceUntrusted` 去牙**（Shannon 熵 + 厂商正则 + 定界符去牙 + 全角/零宽归一化） | T7.3 / T10.4 / T10.5 / T10.6 / H-围栏 | 死代码继续冒充安全特性 |

> M0.5/M0.6 落"接线"型 Task，其余是纯基础设施。**M0.1、M0.2、M0.5 前置到迭代 7 开头**（迭代 7 本身大量依赖它们）；M0.3、M0.4 前置到迭代 8/11 开头。

### 优化 2 · 三处依赖重排（把倒挂/返工点前移）
1. **迁移框架先于一切建表**：主计划把 PRAGMA（T7.9·迭代7）与迁移框架（T8.8·迭代8）分开，但 T7.9 之后迭代 8 的 T8.1/T8.3/T8.6 全要建表——**迁移框架应与 PRAGMA 同批（M0.1 前置到迭代 7），T8.8 降级为"补迁移用例"**。否则迭代 7 建的表在迭代 8 又要包进迁移框架＝重写建表逻辑。
2. **epoch 持久化归位**：代码级设计 J 节的 `session_context_epoch` 表与 A 节真实摘要**强耦合**（摘要产出的 baseline_seq 要落盘，resume 才不全量重放）。主计划把 J 挂在 T7.9/T8.8、A 挂在 T11.1，**跨了三个迭代**。本文将 **epoch 表 DDL 归入 M0.1（迭代7建表）**，**epoch 写入/读取归入 T11.1（与真实摘要同 Task）**，中间迭代先建表不写入。
3. **glob 先于 hooks matcher**：T7.10（hooks，迭代7）的 matcher 复用富 glob，而富 glob 主计划挂在迭代 8（K）。**M0.2 前置到迭代 7**，T7.10 与 T8-glob 都复用。

### 优化 3 · 安全 fail-closed 项升为硬 Gate（不是"注意事项"）
代码级设计反复强调的三条 fail-closed 语义，作为对应迭代 Gate 的**一票否决项**，DoD 显式列断言：
- **G-风险 AST**：解析超时/预算/异常**绝不回退旧正则**（`PARSE_ABORTED` 三态哨兵存在的唯一理由）→ 迭代 10 Gate。
- **F-沙盒**：仅 `--new-session` 不是安全边界，**必须 `--unshare-net/pid/ipc` + seccomp + cap-drop**；网络违规回调异常 fail-closed 返回 false → 迭代 10 Gate。
- **H-围栏去牙**：不做定界符去牙，攻击者塞 `</untrusted_external_content>` 即逃逸 → 迭代 7 Gate（这是**现存漏洞**，不是新能力）。

### 优化 4 · failover breaking change 专项设计评审前置门（主计划风险项 1）
`RunLoopStaticInput.provider` 单字段→provider 列表+路由，波及 core+llm+全部相关测试。**T11.3 前插入 T11.0 设计评审门**（不产实现，只产 ADR + 受影响测试清单），评审通过才准 T11.3 开工。

---

## 二、迭代路线总览（迭代 7–13）

> 沿用主计划迭代号与主题，仅补入 M0.x 前置件与 Tx.0 评审门。工作量单位：S≈0.5d，M≈1d，L≈2d，XL≈3d+。

| 迭代 | 主题 | 债务类型 | 里程碑 Gate | 前置件 |
|---|---|---|---|---|
| **迭代 7** | 接线扫尾与安全裸洞 | 主 A 类 | `tsc` 零错 + 全绿；gateway 无 key→401；bash 危险命令走 gateway 被拒；system prompt 快照无重复 `<skills>/<env>/<memory>`；**围栏去牙生效** | **M0.1/M0.2/M0.5/M0.6** |
| **迭代 8** | 持久化与审计基座 | A+B | 并发写不丢数据；审计哈希链可独立校验（改一条史记破坏后续链） | **M0.3** |
| **迭代 9** | 检索与知识库 | C | `search()` top-K 人工抽样"合理相关"；断网本地向量仍可用 | 迭代8 存储就位 |
| **迭代 10** | 沙盒与执行安全 | B | 正则绕过样本被 AST 正确识别；隔离下无法读 workspace 外/无法未授权外联 | **G/F/H fail-closed Gate** |
| **迭代 11** | 运行时韧性与成本优化 | B | 压缩后人工评审"保留关键决策+标识符"；429/529 风暴不放大请求量；nightly API 连续 3 天过 | **M0.4 + T11.0 评审门** |
| **迭代 12** | Agent/Skill 生态完善 | B+C | 改一个 agent/skill 文件热重载生效；后台子任务父循环结束仍可查状态 | 迭代7 section 模型 |
| ~~迭代 13~~ | ~~多租户与网关生产化~~ **→ 本地客户端下作废/降级** | C | 见 §零：多租户不做；仅保留"gateway 本地回环加固"并入迭代 7 | — |

**关键路径**：M0.1 → 迭代7(T7.1 沙盒接线 / T7.6+T7.7 section 化) → 迭代8(M0.3 审计+持久化) → 迭代10(G/F 沙盒真隔离) → 迭代11(A 摘要+epoch 写入 / T11.0→T11.3 failover)。迭代 9、12 可与主链部分并行；迭代 13 独立。

---

## 三、共享基础设施前置 Task（M0.x · 跨迭代复用）

| Task | 名称 | 产出文件 | 依赖 | DoD（验收） | 档位 | 估 |
|---|---|---|---|---|---|---|
| **M0.1** | `openDatabase`（含 sqlite-vec 加载）+ 迁移框架 + 全表 DDL | `storage/db.ts`（`openDatabase(path)` 注入 `journal_mode=WAL/synchronous=NORMAL/busy_timeout=5000/cache_size=-64000/foreign_keys=ON`；**`db.loadExtension(sqlite-vec)` 收口在此**，向量与关系数据同库同连接；`migrate(db, migrations[])` 走 goose 版本号范式 `schema_version(version PK, applied_at)` + 加列前 `pragma_table_info` 探测）、**建全部生产表 DDL**（`approved_rule`/`audit_log`/`heartbeat_job`/`heartbeat_run_log`/`session_context_epoch`/session-memory/`device_token` 表；**均含外键 `REFERENCES … ON DELETE CASCADE`**；向量表用 `vec0` 虚拟表在 T9.2 迁移里建）、`test/storage/db.test.ts`(用 `:memory:`) | J/K/M/N 各节 DDL | **单测**：WAL/foreign_keys 逐项断言已设；**sqlite-vec 加载成功 + `vec_version()` 可查**；`migrate` 幂等；加列探测跳过已存在列；**每连接重设 foreign_keys**。**坑**：`:memory:` 库 WAL 无意义需跳过；`ADD COLUMN` 默认值必须常量；**sqlite-vec 是原生扩展，需按 Linux/macOS/Windows 三平台打包对应二进制**（§零本地客户端装 3 平台）——加载失败要有明确报错+降级（向量检索退化到 T9.1 词袋/LLM 挑选，不 crash）。**§零简化**：单进程 → 无需 `BEGIN IMMEDIATE`/进程间 `Semaphore`；WAL 仅崩溃安全。⚠例外：T12.3 后台子任务并发写同库需回补写串行 | 真跑通 | M |
| **M0.2** | 富 glob 匹配 | `permission/glob.ts`（`globMatch(input, pattern)` 照 opencode `wildcard.ts`：`replaceAll('\\','/')` 归一 → 转义 `[.+^${}()|[\]\\]` → `*`→`.*`/`?`→`.` → `" .*"→"( .*)?"` → `RegExp('^…$','s')`；非法正则 catch→false）、`test/permission/glob.test.ts` | 无 | **单测**：`*?` 生效；`cmd *` 匹配无参；路径分隔归一化；**非法正则 fail-closed 返回 false**（落默认 ask）；`findRule` 调用顺序 `globMatch(input, rule.pattern)` 不写反 | 真跑通 | S |
| **M0.3** | 审计哈希链 sink | `permission/audit.ts`（append-only `audit_log` 表或 JSONL；`AuditEvent` 字段对齐 zeroclaw：`timestamp/event_id/event_type/actor/action{command,risk_level,approved}/result/security/agent_alias/sequence/prev_hash/entry_hash`；`entry_hash=sha256(prev_hash + canonicalJSON(payload))`，genesis `prev_hash="0"*64`；启动读末条续链）、`test/permission/audit.test.ts` | M0.1 | **单测**：**canonical JSON 字段顺序固定**（改插入序 entry_hash 仍一致）；`entry_hash` 不含 prev_hash/entry_hash/signature 自身；`verifyChain` 逐条验 sequence 连续 + prev_hash 链接；**篡改任一史记→后续链全 mismatch**；HMAC key 非 32 字节显式报错 | 真跑通 | M |
| **M0.4** | 受保护 tail 选择器 | `context/tail.ts`（`selectProtectedTail(messages, tailTurns=2)` 倒序 turn 计数，保护最近 N 轮 + `PRUNE_PROTECTED_TOOLS(['skill'])` + 未完成/已折叠跳过；返回 `tailStartSeq`）、`test/context/tail.test.ts` | 无 | **单测**：默认保护最近 2 轮；skill 工具 tool_result 豁免；**tool_use（assistant）与 tool_result（下条 user）配对不拆断**；空/单轮边界 | 真跑通 | S |
| **M0.5** | Prompt 分段模型 | `prompt/section-model.ts`（`PromptSection{id, text, cacheable}`；`buildSystemPrompt(inject)` 由零参 `compute()` 改为**接受注入数据**；stable tier 空段输出稳定占位、volatile tier 空段过滤；`FIXED_SECTION_ORDER` 保留 identity→soul→doc/skill→env→memory→history）、更新 `test/prompt/system-prompt.test.ts`(golden) | 无 | **单测(golden)**：相同输入字节稳定；**仅改 volatile 段（env/memory）→ 断点前字节不变**（抄 goose `cached_prefix_is_invariant`）；纯函数铁律（skill `toSorted(localeCompare)`、memory 固定排序，无时钟/随机） | 真跑通 | M |
| **M0.6** | redact 收口 + 围栏去牙 | `security/redact.ts`（补 Shannon 熵兜底 `len>=24 && entropy>=4.375 && 含字母含数字` + 厂商正则 AWS/GitHub/JWT/PEM + protected spans 仅豁免熵启发式）、`tool/wrap.ts`（`fenceUntrusted` 加去牙：包裹前替换 output 内 `untrusted_external_content`→`untrusted-external-content` 大小写不敏感；全角/零宽归一化 + 模型控制 token 剥离；`source="{toolId}"`；32 字符下限）、`test/security/{redact,fence}.test.ts` | 无 | **单测**：熵检测不误伤 base64 图片/长 hash 路径（protected spans + 双条件）；**去牙**：output 内 `</untrusted_external_content>` 被换牙后无法闭合逃逸；`<\|im_start\|>`/`[INST]` 被剥；短输出<32 跳过 | 真跑通 | M |

---

## 四、Task 详表（按迭代）

> 每个 Task 字段：**产出文件 · 依赖 · DoD · 档位 · 估**。DoD 中 `【源】X节` 指向代码级设计对应模块，实施前先读该节。

### 迭代 7 · 接线扫尾与安全裸洞（P0，禁止跳过）

| Task | 名称 | 产出文件 | 依赖 | DoD（验收） | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T7.1a** | bash 唯一经 ExecGateway | `tool/builtin/bash.ts`（消除 `child_process.exec` 直连，改走 `ExecGateway.exec`） | M0.1 | 【源】F/I。直接 `execAsync` 路径消失；测试断言 bash 所有执行经 gateway 的 env-scrub/白名单；`test/tool/bash.gateway.test.ts` | 真跑通 | M |
| **T7.1b** | gateway 进程组 kill + 单调时钟 deadline + 流式截断 | `sandbox/exec-gateway.ts`（`detached` spawn + `kill(-pid)` 杀进程树；`performance.now()` deadline；输出流式累积截断复用 `wrap.ts:truncateOutput`，弃 `maxBuffer` 抛错） | T7.1a | 【源】I。**进程组**：kill 后子进程（curl 等）不成孤儿；单调时钟非 `Date.now()`；timeout=0→默认上限 120s；`maxBuffer` 超限不再丢全部输出；`test/sandbox/exec-gateway.kill.test.ts`(用 T0.6 subprocess fake) | 真跑通 | M |
| **T7.2** | registry 权限过滤统一到 evaluate() | `tool/registry.ts`（弃独立 `TOOL_ACTION_MAP` 简单匹配，改调 `evaluate()`）、`permission/evaluate.ts` | 无 | 【源】主计划B。两套判定不一致的既有用例改写为一致；`test/tool/registry.evaluate.test.ts` | 真跑通 | S |
| **T7.3** | 接入 redact 到工具结果回填 | `core/run-loop.ts`（`executeToolUses` 结果回填对话历史前调 `redact()`） | M0.6 | 【源】H。集成测试：含密钥格式的工具输出进历史前被脱敏；保留"加载时冻结"设计不改运行时读 env；`test/core/redact-integration.test.ts` | 真跑通 | S |
| **T7.3b** | 扩大 fenceUntrusted 覆盖 | `tool/wrap.ts`、`tool/orchestrator.ts`（所有 MCP 工具输出 + bash 输出打 `untrustedOutput`，非仅 webfetch） | M0.6 | 【源】H。所有外部内容源经去牙围栏；32 字符下限跳过；`test/tool/fence-coverage.test.ts` | 真跑通 | S |
| **T7.4** | gateway 鉴权 + 绑定策略 + reply 加固（远程接入，单用户） | `server/gateway.ts`（**强制 bearer token**：`token_hash=sha256` 查 `device_token{token_hash UNIQUE, label, created_at, last_seen_at, expires_at, revoked_at}`，失败 401，置路由最前；**绑定默认 loopback，远程需显式 `bind` 配置**并启动告警；body 大小上限→413；catch 脱敏；**`/permission/reply` 加固**：校验调用者对该 sessionId 有权 + 记 M0.3 审计 + 可配"敏感操作禁止远程审批"） | M0.1, M0.3 | 【源】M（**去多租户、留远程鉴权**）。无 token→401；查 token `WHERE revoked_at IS NULL AND expires_at>now`；非回环绑定启动打印暴露告警；**远程 reply 审批走额外校验+审计**；仍**无多租户/RBAC 表**；`test/server/gateway.auth.test.ts` | 真跑通 | M |
| **T7.4b** | gateway TLS + 限流（远程暴露必需） | `server/gateway.ts`（TLS：支持自带证书或首启自签 + 指纹告知；per-token/per-ip 令牌桶限流，`/chat/send`、`/permission/reply` 尤其；可选 CORS 白名单给远程 Web UI） | T7.4 | §零。跨网络流量加密；限流阻止 token 暴力/DoS；`test/server/gateway.tls-ratelimit.test.ts` | 真跑通 | M |
| **T7.4c** | 设备配对 + token 生命周期 | `server/gateway.ts` + `cli/`（token 生成/列出/撤销/过期 CLI 子命令；配对流程如一次性配对码换设备 token；`device_token` 表 CRUD） | T7.4 | §零。丢设备可单独吊销该 token 不影响其它设备；过期 token 拒；`test/server/device-token.test.ts` | 真跑通 | M |
| **T7.5** | gateway 接入 SessionStore | `server/gateway.ts`、`storage/session-store.ts` | M0.1, T7.4 | 【源】M。移除 `GatewaySession` 内存 Map；按 `(projectId, sessionId)` 组合键；**重启后 gateway 侧会话可恢复**；`/permission/reply` 校验调用者对该 sessionId 有权（防越权）；`test/server/gateway.session.test.ts` | 真跑通 | M |
| **T7.6** | 修复 skill 双 `<skills>` 占位块 | `prompt/sections/skills-verbose.ts`（`compute` 从 skill registry `available(agent)` 取→`formatSkills`，空返回 `''`）、`prompt/sections/memory-snapshot.ts`（从 retrieve 渲染，空 `''`） | M0.5 | 【源】D/P。输出 prompt 只有一份真实技能列表；空 section 过滤（volatile tier）；golden 无重复 `<skills>/<env>/<memory>`；`test/prompt/skills-verbose.test.ts` | 真跑通 | M |
| **T7.7a** | system 多断点接通 | `llm/anthropic-provider.ts`（`buildSystemBlocks` 接收 `PromptSection[]`，调 `resolveCacheBreakpoints` 逐段产 block、命中下标加 `cache_control`）、`prompt/cache-policy.ts`、`context/pipeline.ts`（`assembleContext` 保留 `PromptSection[]` 不 `join`） | M0.5 | 【源】D。**仅改 volatile 段不使 identity/工具定义段缓存失效**（golden 不变量测试，抄 goose）；cache_control ≤4；`test/llm/cache-breakpoint.invariant.test.ts` | 真跑通 | L |
| **T7.7b** | tools + messages 断点 | `llm/anthropic-provider.ts`（`toSdkTools` 给**最后一个** tool 加 `cache_control:ephemeral`；`toSdkMessages` 给最后一条消息最后一块打单断点）、`llm/openai-compatible-provider.ts`（provider→key 映射差异化） | T7.7a | 【源】D。tools 顺序稳定（registry Map 确定序）；cache_control 对象字面量每轮完全一致（`toSdkBlock` 不原地 mutate）；openai-compatible 用不同 key；`test/llm/tools-cache.test.ts` | 真跑通 | M |
| **T7.8** | channel 接入 main.ts | `cli/main.ts`、`channel/registry.ts`、`channel/adapters/local-cli.ts` | 无 | 【源】主计划I。main.ts 经 `ChannelAdapter` 收发，不再直持 `readline.Interface`；消灭重复实现；`test/channel/local-cli.test.ts` | 真跑通 | M |
| **T7.9** | SQLite PRAGMA 接入（复用 M0.1） | `storage/session-store.ts`（改用 `openDatabase()`；SessionStore/LongTermMemoryStore/permission 共用一连接） | M0.1 | 【源】J。并发写测试不再触发 `SQLITE_BUSY`；`message.session_id` 外键 CASCADE 生效；`test/storage/session-store.pragma.test.ts` | 真跑通 | S |
| **T7.10** | hooks 最小配置加载器 + trust gate | `hooks/types.ts`（扩事件枚举 `UserPromptSubmit/PostToolUseFailure/SessionStart/SessionEnd/Stop/SubagentStop/PreCompact`）、`hooks/registry.ts`（`list(event, toolName)` 用 M0.2 glob 匹配 + `hookDedupKey` 去重；外部脚本 `spawn`+stdin JSON+exit code 协议 `2`→deny/`0`→解析 stdout/其他→记 stderr）、`cli/main.ts`（从 `.uagent/settings.json` 三层加载，不再传空 registry） | M0.2 | 【源】L。**trust gate**：未信任来源 hook 默认不加载（内建函数 hook 可豁免）；**hook 只能收紧不能放宽**（`mergeDecisions` 最严优先，hook `allow` 不覆盖 gate 的 ask/deny）；`hookEventName` 回显正确事件；`test/hooks/{registry,trust-gate}.test.ts` | 真跑通 | L |
| **T7.11** | agent-memory 接入 resolvers（补漏·A 类接线债，见 §八） | `agent/resolvers.ts`、`memory/agent-memory.ts`（`memory/agent-memory.ts:57` 自陈"纯函数写好、真正接入 resolvers 延后"——本 Task 把 agent 级记忆纯函数真正接进 `resolveXxx`，产出进上下文装配） | 无 | 【补漏】扫描发现的**未接线纯函数**（不在原 A–Q 表）。DoD：agent-memory 函数被 resolvers 实际调用、结果进 prompt；与 T12.1 的"memory 声明→注入 read/write/edit 工具"是**两回事**（那是工具注入，这是内容接线），两者都要；`test/agent/agent-memory-wiring.test.ts` | 真跑通 | S |

**Gate-7**：`tsc --noEmit` 零错；`vitest run` 全绿；手验 gateway 无 token→401 且非回环绑定有启动告警；手验 TLS 生效 + 限流触发；手验**远程设备无权对某 session 调 `/permission/reply` 被拒**；手验 bash 硬线命令走 gateway 被拒非直接执行；system prompt 快照无重复 `<skills>/<env>/<memory>`；**围栏去牙：注入 `</untrusted_external_content>` 无法逃逸（一票否决）**。

---

### 迭代 8 · 持久化与审计基座

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T8.1** | 权限规则持久化迁移 SQLite | `permission/persist.ts`（弃"读整 JSON→push→全量重写"，迁 `approved_rule(… UNIQUE(scope,action,pattern,decision))`；`always` 分支改 `INSERT OR IGNORE`；保留 local/user/project 三层 scope） | M0.1 | 【源】K。并发写不互相覆盖、无重复；`INSERT OR IGNORE` 依赖唯一索引先建；`test/permission/persist.sqlite.test.ts`(并发写压力) | 真跑通 | M |
| **T8.2** | 权限决策统一审计 sink | `permission/gate.ts`、`permission/manager.ts`、`permission/reply.ts`（每次 gate 判定尤其 fail-closed 降级 gate、每次 `reply always` 各记一条，带 `agent_alias`） | M0.3 | 【源】K。审计哈希链可独立校验；`manager.settle` 幂等不被审计层破坏；`test/permission/audit-integration.test.ts` | 真跑通 | M |
| **T8.3** | heartbeat 任务定义持久化 | `heartbeat/scheduler.ts`（`register` 改 upsert `heartbeat_job` + 落 `next_run_at_ms`；`drainDueJobs` 后写 `last_run_at_ms`/`heartbeat_run_log`） | M0.1 | 【源】N。重启后任务表不丢；部分索引 `WHERE next_run_at_ms IS NOT NULL`；`test/heartbeat/persist.test.ts` | 真跑通 | M |
| **T8.4** | heartbeat 错过 tick 补偿（显式决策） | `heartbeat/scheduler.ts`（改 `next_run_at_ms` 驱动非"当前分钟匹配"；错过多周期**只补跑一次**：`prev=previousCronRun(cron,now)`，仅 `last_run_at_ms!=null && prev>last_run_at_ms` 补，然后跳未来；启动洪峰 `maxMissedJobsPerRestart`+`staggerMs`；timer `MIN_REFIRE_GAP_MS` floor + `MAX` clamp) | T8.3 | 【源】N。**coalesce 非 backfill**（错过 100 周期跑 1 次）；**重启不误推进未来 job**（只重算缺失/过期）；`setTimeout(0)` 无热循环；>2^31ms 远期 job clamp；时钟回拨不误跳；`test/heartbeat/missed-tick.test.ts`(冻结时钟) | 真跑通 | L |
| **T8.5** | webhook 触发源共享密钥校验 | `heartbeat/trigger-engine.ts` | M0.3 | 【源】主计划I。无密钥/错密钥→拒并记审计；`test/heartbeat/webhook-auth.test.ts` | 真跑通 | S |
| **T8.6** | session-memory 持久化 | `memory/session-memory.ts`（进程内 Map→SQLite；`retrieve` 接受 query） | M0.1 | 【源】主计划G。重启后不丢；`test/memory/session-memory.persist.test.ts` | 真跑通 | S |
| **T8.7** | curated-notes 原子锁修复 | `memory/curated-notes.ts`（`existsSync`+`writeFileSync` TOCTOU → `O_EXCL` 或 `proper-lockfile`） | 无 | 【源】O。并发写不撞；`test/memory/curated-notes.lock.test.ts` | 真跑通 | S |
| **T8.8** | storage 迁移用例补齐 + 游标分页 | `storage/session-store.ts`（`listMessages` keyset `WHERE seq>? ORDER BY seq LIMIT ?` + `idx_message_session_seq`；补入迁移数组用例，复用 M0.1 框架） | M0.1 | 【源】J。**降级为"补用例"**（框架已在 M0.1）；长会话不全量入内存；分页正确；`test/storage/pagination.test.ts` | 真跑通 | S |
| **T8.9** | mailbox 并发多读者加锁 | `channel/mailbox.ts`（加锁或迁 SQLite 事务队列） | M0.1 | 【源】主计划I。多读者不重复消费；`test/channel/mailbox.concurrent.test.ts` | 可用实现 | M |

**Gate-8**：并发写权限规则/心跳任务压力测试不丢数据；审计哈希链改一条史记破坏后续链（独立校验通过）。

---

### 迭代 9 · 检索与知识库

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T9.1** | 记忆检索低成本过渡 | `memory/long-term-store.ts`（memory 表加 `description` 列；`retrieve` query 非空且 rows 多时拼 `(id,description)` manifest 走一次结构化 LLM 调用输出 `{selected_ids}`，`validIds.has()` 过滤；词袋作 fallback） | 迭代8 存储 | 【源】O。**LLM 挑选必 `validIds.has()` 兜底**（防幻觉 id 空指针）；LLM 不可用/abort→词袋 fallback（fail-open）；`test/memory/retrieve.transitional.test.ts` | 可用实现 | M |
| **T9.2** | 本地向量化 + sqlite-vec（**已定选型**） | `memory/vector-store.ts`（TS 化 `VectorStoreBase`：`insert(VectorRecord[])/search(queryVector, topK, metadataFilter?)` 落在 **sqlite-vec `vec0` 虚拟表**，复用 M0.1 的连接与扩展；`VectorRecord{vector, documentId, chunk}` 与 chunk 解耦）、`memory/embedding-cache.ts`（key=`sha256({model,text})`，双淘汰线 mtime FIFO）、embedding 层（量化 MiniLM/bge-small via transformers.js/ONNX） | T9.1, M0.1 | 【源】O。**sqlite-vec 单一向量后端**（不引入独立向量库）；`vec0` 虚拟表 **dimension 建表时固定，换 embedding 模型必须重建表**（迁移里加 `embedding_dim`/`model` 治理列，换模型触发重建）；**query 与 index 同一模型**；`metadataFilter` 用 `agentName` 命名空间隔离且 search+insert 两处都应用；**threat-scan 在向量召回出口保留**，`blocked`→`[BLOCKED]`；**断网仍可用**；`test/memory/vector-store.test.ts` | 可用实现 | XL |
| **T9.3** | 外部 embedding API 仅显式 opt-in（§零隐私） | `memory/long-term-store.ts`（外部 API 默认关闭，需用户显式开启并告知"内容将外发"；离线不静默失败） | T9.2 | 【源】主计划G/§零。**默认本地、外部需显式 opt-in + 外发告知**（本地客户端隐私）；`test/memory/embedding-provider.test.ts` | 可用实现 | S |
| **T9.4** | IndexStore 加 search() | `knowledge/types.ts`、`knowledge/index-store.ts`（`search(query, topK, metadataFilter?)`；去重 key=`(documentId, chunkIndex)` 取最高分；`InMemoryIndexStore` 先词袋兜底，向量后端按 `VectorStoreBase`） | T9.2 | 【源】O。**去重用 `(documentId, chunkIndex)` 非 uuid**（reindex uuid 变会重复召回）；`test/knowledge/search.test.ts` | 可用实现 | M |
| **T9.5** | 真实 DataSource/AdmissionPolicy/Chunker | `knowledge/` 新增（文件扫描 DataSource / gitignore 感知 AdmissionPolicy / `ApproxTokenChunker` 移植 `tokens≈len(utf8)//4`, `chunk_size=512/overlap=50`, `max(next_start, start+1)` 防死循环） | T9.4 | 【源】O。**Chunker 五契约**：不跨 Section 合并 / DataBlock 直通 / chunk_index 全局连续 0..N-1 / total_chunks==N / source 继承；`test/knowledge/chunker.contract.test.ts` | 可用实现 | L |
| **T9.6** | lastSeenHash 持久化 | `knowledge/pipeline.ts`（`runOnce` 的 `index.upsert` 改先 `delete(candidate.id)` 再 insert；`lastSeenHash` 落盘） | T9.5 | 【源】O。重启不全量重抽；**`lastSeenHash` 只在 admitted 后写入**（被拒候选下轮仍算变化，有意为之）；`test/knowledge/incremental.test.ts` | 可用实现 | M |
| **T9.7** | 记忆与知识库共用同一 sqlite-vec 库 | `knowledge/`、`memory/` | T9.2, T9.5 | 【源】O。**单一 SQLite 文件同时装关系表 + `vec0` 向量表**（复用 M0.1 连接），避免两套存储栈；记忆/知识用不同 `vec0` 表或 `source` 命名空间区分；`test/knowledge/shared-store.test.ts` | 可用实现 | S |

**Gate-9**：`search()` 对种子语料 top-K 人工抽样"合理相关"；断网本地向量路线仍可用。

---

### 迭代 10 · 沙盒与执行安全（fail-closed 硬 Gate）

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T10.1a** | tree-sitter-bash AST 解析 | `sandbox/risk.ts`（引 `web-tree-sitter`+`tree-sitter-bash.wasm`；`getBashParser()` 模块级 `parserPromise ??= load().catch(()=>{parserPromise=null})`；`parse()` 传 `progressCallback` 500ms 超时；`command.length>10000`→too-complex；用完 `tree.delete()`） | 无 | 【源】G。**fail-closed**：`tree===null‖timedOut‖异常`→too-complex，**绝不回退旧正则**（`PARSE_ABORTED` 三态哨兵）；**字节偏移→字符索引转换**（中文/emoji 不错位）；`tree.delete()` 防 WASM 泄漏；`test/sandbox/risk.ast.test.ts` | 真跑通 | L |
| **T10.1b** | 变量作用域快照 + 权限接线 | `sandbox/risk.ts`（`collectCommands` 递归 `STRUCTURAL_TYPES` 产 `SimpleCommand[]`；`&&/;` 线性携带 varScope、`||/\|/&` 重置快照）、`permission/gate.ts`（`argv[0]`+`checkSemantics` 驱动：EVAL_LIKE/DANGEROUS→hardline/contentAsk；too-complex→`requiresUserInteraction=true`） | T10.1a | 【源】G。**flag-omission 防御**：`true \|\| FLAG=--dry-run && cmd $FLAG` 被正确识别（纯正则无此防御）；命令替换 `$()` 内外都过规则；未引号 heredoc→too-complex；现有 `HARDLINE_PATTERNS` 保留为 argv 级补充；`test/sandbox/risk.scope.test.ts`(含一组已知正则绕过样本) | 真跑通 | L |
| **T10.2** | Linux bubblewrap namespace 隔离 | `sandbox/exec-gateway.ts`（`wrapWithBwrap(cmd,args,cfg)`：`--unshare-net/pid/ipc/uts --die-with-parent --new-session --seccomp <内置默认 profile> --unshare-user --uid/--gid`；workspace RW、其余 ro/tmpfs 遮盖；平台门 Linux/WSL2 + `which bwrap socat` 检测）、`sandbox/types.ts`（`NetworkRestrictionConfig/FsWriteRestrictionConfig/FsReadRestrictionConfig/SandboxViolationEvent/SandboxAskCallback`；denyWrite 默认种子 settings.json/`.claude/skills`/裸 git 文件） | T7.1a | 【源】F。**不 `--new-session` 单发不算隔离**：必须 `--unshare-net/pid/ipc`+seccomp+cap-drop；裸 git 逃逸 denyWrite 覆盖 `HEAD/objects/refs/hooks/config`+事后 `scrubBareGitRepoFiles`；bwrap 无 glob，Edit/Read 规则 `*?[]` 预警降级；`test/sandbox/bwrap.isolation.test.ts` | 真跑通 | XL |
| **T10.2b** | macOS Seatbelt 后端（§零跨平台一等公民） | `sandbox/seatbelt-adapter.ts`（`sandbox-exec` + `.sb` profile：workspace RW、其余 ro、网络默认拒；与 T10.2 共用 `Fs/NetworkRestrictionConfig` 类型） | T10.2 | 【源】F/§零。macOS 用户不再"降级 local"；profile 网络默认拒 + workspace 外只读；`test/sandbox/seatbelt.test.ts`(平台门跳过非 macOS) | 可用实现 | L |
| **T10.2c** | Windows 显式降级 + 用户告知 | `sandbox/exec-gateway.ts`（Windows 无内核隔离：风险 AST 仍生效 + 更保守权限 ask + 无进程级隔离，**启动时向用户显式告知安全边界弱化**，不静默假装隔离） | T10.1b | §零。Windows 下不假装隔离；危险命令仍走 AST+ask；`isSandboxingEnabled()===false` 时告知语句可断言；`test/sandbox/windows-degrade.test.ts` | 可用实现 | S |
| **T10.3** | 网络出口白名单 + 违规回调 | `sandbox/exec-gateway.ts`（`network none` 默认；按 `allowedDomains` 起 socat/HTTP 代理；命中未允许域→`SandboxViolationEvent`→`SandboxAskCallback` 接 `permission/gate.ts`；记 M0.3 审计） | T10.2, M0.3 | 【源】F。**回调异常 fail-closed 返回 false**；违规记审计；`test/sandbox/network-egress.test.ts` | 真跑通 | L |
| **T10.4** | env-scrub 清单扩充 | `security/env-scrub.ts`（补 `CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_AUTH_TOKEN/OTEL_EXPORTER_OTLP_*_HEADERS/AWS_BEARER_TOKEN_BEDROCK/GOOGLE_APPLICATION_CREDENTIALS/AZURE_CLIENT_SECRET/ACTIONS_ID_TOKEN_REQUEST_*/ACTIONS_RUNTIME_*`+`INPUT_<NAME>` 变体；**显式保留 `GITHUB_TOKEN/GH_TOKEN`** 逐条注释理由；保留 `_TOKEN$/_SECRET$` 后缀模式） | 无 | 【源】H。清单逐条有理由注释；后缀模式不删；`test/security/env-scrub.list.test.ts` | 真跑通 | S |
| **T10.5** | redact 信息熵兜底（复用 M0.6） | `security/redact.ts`（M0.6 已实现主体，本 Task 补覆盖率+边界样本） | M0.6 | 【源】H。未知格式高熵密钥被脱敏、protected spans 不误伤；`test/security/redact.entropy.test.ts` | 真跑通 | S |
| **T10.6** | threat-scan 分级评分 | `security/threat-scan.ts`（返回 `{score, category, verdict}`；6 类别 system_override(1.0)/role_confusion(0.9)/tool_injection(0.8)/secret_extraction(0.95)/command_injection(0.6)/jailbreak(0.85)；阻断 `max_score>0.7`；现有 8 条中英正则映射进类别；`\|head/tail/grep` 跳过、短 `&&`<100 字符跳过误报抑制） | 无 | 【源】H。全角/零宽同形字**匹配前**归一化；command_injection 误报抑制；4 处既有调用点兼容新返回结构；`test/security/threat-scan.scoring.test.ts` | 真跑通 | M |

**Gate-10（fail-closed 一票否决）**：一组正则绕过样本（引号/变量拼接）在 AST 版被正确识别；bwrap 隔离下沙盒进程无法读 workspace 外文件、无法未授权外联；**解析超时/异常不回退旧正则、网络违规回调异常 fail-closed 返回 false**（验证）。

---

### 迭代 11 · 运行时韧性与成本优化

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T11.0** | ⚠failover 专项设计评审门（前置，不产实现） | `docs/adr/failover-provider-routing.md`（`RunLoopStaticInput.provider` 单字段→provider 列表+路由的 ADR；受影响 core/llm/测试清单；冷却状态机设计） | 无 | 主计划风险项1。**评审通过才准 T11.3 开工**；产出受影响测试清单 | 真跑通 | M |
| **T11.1** | 真实 LLM 摘要压缩 + epoch 写入 | `context/summarize.ts`（`summarizeHistory` 分块滚动锚定：`computeAdaptiveChunkRatio` 移植 0.4/0.15/1.2；`previousSummary` 作下块锚；三级降级 rethrow/`PartialSummaryError`/兜底串；`MERGE_SUMMARIES_INSTRUCTIONS` MUST PRESERVE 活动任务/批量进度/决策/TODO/标识符）、`core/run-loop.ts`（`decideCompaction:48` 真 summary 替占位、`compactEpoch` baseline 前移到 `tailStartSeq`；`:463` 强制路径改调）、`context/epoch.ts`（upsert `session_context_epoch`）、`storage`（`listMessagesFromEpoch`） | M0.4, M0.1 | 【源】A/J。**孤儿 tool_result 校验**（tail 首条非孤儿，防 400）；摘要请求自身预留 `SUMMARIZATION_OVERHEAD≈4096`+output 防死循环；摘要前 tool_result 过 redact+threat-scan；**resume 读 baseline_seq 不全量重放**（epoch 过滤 `type='system'` 单独放行）；`sanitizeCompactionMessages`（tool_result.details/runtime-context 永不进摘要 LLM）；`test/context/summarize.test.ts`(replay) | 真跑通 | XL |
| **T11.2** | 重试指数退避+jitter+Retry-After | `core/run-loop.ts`（`consumeLlmStreamWithRetry:203` 移植 `getRetryDelay`：`min(500*2^(n-1),32000)+random()*0.25*base`；max_tokens 溢出自愈 `parseMaxTokensContextOverflowError` 调低 maxTokens 重试非直接压缩）、`llm/anthropic-provider.ts:91`（`RateLimitError/OverloadError` 携 `retryAfterMs` 解析 `retry-after`+`anthropic-ratelimit-unified-reset`）、`RunLoopStaticInput`（加 `querySource:'foreground'\|'background'`） | 无 | 【源】B。**sleep 可被 signal 打断**（现 `:188 sleep` 不接 signal 需补）；**前后台预算差异**：background（summaries/内部）529 立即 bail 抛 `CannotRetryError` 不指数放大；Retry-After 绕上限但仍封顶防病态 header；`model_error.detail` 带 reason/status/provider；`test/core/retry.test.ts`(冻结时钟) | 真跑通 | L |
| **T11.3** | 多 provider 熔断+failover | `llm/failover.ts`（`classifyFailoverReason(error):FailoverReason` 精简 anthropic+openai；瞬时集 `rate_limit/overloaded/unknown/empty_response/timeout` 切 provider、永久集 `model_not_found/format/auth/session_expired` 不消耗探测槽；per-provider 冷却状态机 `Map<providerId,{cooldownUntil,probeSlots}>`）、`llm/registry.ts`（`getFallbackChain(modelId)`）、`core/run-loop.ts:489`（`model_error` 分支切候选） | T11.0（评审通过） | 【源】B。**本地协调错误中止 failover 链**（session 写锁争用/missing_tool_result 换模型也撞同条件，直接 abort 不消耗槽）；永久错误绝不进指数重试；`test/llm/failover.test.ts` | 真跑通 | L |
| **T11.4** | 流式中断续接 | `core/recovery.ts`（`detectTurnInterruption(messages):{kind, syntheticMessage?}`；过滤流水线 `filterUnresolvedToolUses`→`filterOrphanedThinkingOnlyMessages`→`filterWhitespaceOnlyAssistantMessages`；`interrupted_turn`→注入合成 `"Continue from where you left off."`(`isMeta`)）、`cli/main.ts` resume 分支、`server/gateway.ts` 重启加载 | 无 | 【源】C。**判定靠"未配对 tool_use"非 finishReason**；删未配对 tool_use 后不留孤儿 tool_result；**合成消息幂等**（resume 多次不叠加多条 Continue）；合成哨兵不被 CLI 渲染；`test/core/recovery.test.ts` | 真跑通 | L |
| **T11.5** | 统一内容丢弃编排 reclaim | `context/reclaim.ts`（`reclaimContext` 按代价从低到高：`applyToolResultBudget`→`microcompact`→`contextCollapse`(保护 tail 2 轮+skill，用 M0.4)→`autoCompactDecision`→真实摘要；统一软删除标 `compacted` 时间戳；阈值收敛单一 `BudgetConfig`）、`context/{budget,prune}.ts`（合并两份阈值） | M0.4, T11.1 | 【源】E。在 `decideCompaction` 前调用（先无损回收摘要作最后手段）；**别为小收益破前缀**（`pruned>PRUNE_MINIMUM(20k)` 才提交）；不越压缩边界（遇 baselineSeq 停）；protected 工具豁免；**软删除后 token 按折叠后算**（否则 overflow 判定失效）；`test/context/reclaim.test.ts` | 真跑通 | L |
| **T11.6** | section 化重构消除重复标签（复用 M0.5） | `context/pipeline.ts`（`<env>/<memory>` 重复标签消除；M0.5 分段模型落地到 pipeline） | M0.5, T7.7a | 【源】E/主计划E。与 T7.6/T7.7 同一次重构收尾；`test/context/pipeline.section.test.ts`(golden) | 真跑通 | S |
| **T11.7** | 确认官方 token 计数 API 注入 | `context/token-counter.ts`（集成层配置） | 无 | 【源】主计划E。生产环境非长期停留字符估算；`test/context/token-counter.test.ts` | 真跑通 | S |
| **T11.8** | 真实 API 集成测试纳入 CI | `.github/workflows/*`（nightly） | T11.1–T11.4 | 【源】主计划F。nightly job 连续 3 天过 | 真跑通 | S |

**Gate-11**：长对话压缩后人工评审"保留关键决策与标识符";模拟 429/529 风暴观察重试不放大请求量;真实 API nightly 连续 3 天过。

---

### 迭代 12 · Agent/Skill 生态完善

| Task | 名称 | 产出文件 | 依赖 | DoD | 档位 | 估 |
|---|---|---|---|---|---|---|
| **T12.1** | agent frontmatter 扩展 + 容错 | `agent/types.ts`、`agent/loader.ts`（补 `disallowedTools/effort/permissionMode/mcpServers/hooks/skills/initialPrompt/isolation`；校验改"逐字段警告不废 agent"）、`agent/resolvers.ts`（`disallowedTools`→deny 优先于 tools allow；`memory` 声明自动补 `read/write/edit`） | T7.10(hooks 类型) | 【源】Q。**可选字段非法不废整个 agent**（现 `loader.ts:82-99` 任一错就丢，过激）；`model:'inherit'` 小写归一；memory 注入去重；`test/agent/frontmatter.test.ts` | 真跑通 | M |
| **T12.2** | agent 文件热重载 | `agent/registry.ts`（chokidar 监听 `.uagent/agents`） | T12.6(watcher 复用) | 【源】Q。改文件无需重启生效;`test/agent/hot-reload.test.ts` | 可用实现 | M |
| **T12.3** | 后台/异步子任务执行 | `tool/builtin/task.ts`（`background:true`→detached run 复用 `runOuterLoop` 不阻塞父循环;`task_id` 句柄恢复;`isolation:'worktree'` 接 git worktree）、`core/run-loop.ts` | 迭代11(run-loop 稳定) | 【源】Q。后台子任务父循环结束仍可查状态;`isolation:'remote'` gate（uAgentCli 无 ant 概念可整体不支持）;`test/tool/task.background.test.ts` | 可用实现 | XL |
| **T12.4** | 同名 agent 覆盖警告 | `agent/registry.ts`（`logWarning`；覆盖优先级=遍历顺序 builtin<user<project<flag） | 无 | 【源】Q。同名覆盖记警告；`test/agent/override-warn.test.ts` | 真跑通 | S |
| **T12.5** | skill 多来源发现 | `skill/discovery.ts`（`dirs:string[]`→分层来源 内置→`~/.uagent/skills`+`~/.claude/skills`+`~/.agents/skills`→向上找项目级→config paths→urls；`found.push`→`Map<name,SkillInfo>`，覆盖 `logWarning`） | 无 | 【源】P。**注册顺序=优先级**（内置先注册才能被磁盘覆盖）；同名冲突不再静默丢失；`test/skill/discovery.multi.test.ts` | 真跑通 | M |
| **T12.6** | skill 热重载 | `skill/watcher.ts`（chokidar `depth:2`+`awaitWriteFinish{1000,500}`+300ms reload 去抖；变更重建 registry 并 emit 供 skills-verbose 重算） | T12.5 | 【源】P。**awaitWriteFinish 必需**（编辑器/git checkout 触发多次不等稳定读半截）；**reload 去抖必需**（git 一次动几十 SKILL.md）；Bun 走 polling；`test/skill/watcher.test.ts` | 可用实现 | M |
| **T12.7** | skill 同名冲突显式优先级+日志 | `skill/registry.ts`（建 SkillRegistry 先注册内置→discover 覆盖；`get/all/available(agent)`） | T12.5 | 【源】P。同名"最后写入胜"+`logWarning`；`test/skill/registry.conflict.test.ts` | 真跑通 | S |
| **T12.8** | skill 按 agent.permission 过滤可见性 | `skill/registry.ts`、`permission/evaluate.ts`（加 `'skill'` 到 `Action`；`available(agent)` 用 `evaluate('skill', name, agent.permission).decision!=='deny'`，ask 也放行） | T12.7 | 【源】P。deny 的 skill 不进列表、ask 放行；先 `toSorted(localeCompare)`；`test/skill/permission-filter.test.ts` | 真跑通 | S |

**Gate-12**：热重载改一个 agent/skill 文件无需重启生效;一个后台子任务父 run-loop 结束后仍继续运行并可查状态。

---

### ~~迭代 13 · 多租户与网关生产化~~ → 本地客户端下作废（§零）

**决策已定**：uAgentCli 是本地客户端、单机单用户，**无 workspace/tenant 概念**。原 T13.0 决策门由 §零 回答，原 T13.1（RBAC+多租户授权表）、T13.2（多租户隔离+TLS）**不做**。仅保留两项、且已改挂到别处：

| 原 Task | 处置 | 去向 |
|---|---|---|
| T13.0 决策门 | ✅ 已由 §零 回答（本地单机） | — |
| T13.1 RBAC+多租户表 | ❌ **删除**（本地单用户无租户） | — |
| T13.2 gateway 多租户+TLS | ⤵ **降级并合并**为"gateway 本地回环加固" | 已并入 **T7.4**（迭代 7） |
| T13.3 渠道适配器扩展（Slack/Discord…） | ⏸ 与本地形态不冲突，但**属能力扩展非生产化必需**，单独按需排期 | 保留为独立可选项（下表） |
| T13.4 消息总线升级 | ⏸ 单机单进程无需分布式总线；仅当引入远程/多设备再议 | 保留为独立可选项（下表） |

> **远程/多设备访问已确认为必需**（§零），不再是可选项——已落到迭代 7 的 **T7.4 / T7.4b / T7.4c**（鉴权+绑定+reply 加固 / TLS+限流 / 设备配对+token 生命周期）。

**可选扩展（非生产化必需，按产品需要单独排期，不占主里程碑）**：

| Task | 名称 | 依赖 | 备注 | 估 |
|---|---|---|---|---|
| X.1 | 渠道适配器扩展（委托外部网关，Slack/Discord 等） | T7.8 | 若要让本地 agent 接收外部渠道消息；采用"委托外部网关"模式，app 侧瘦配置 | L |

---

## 五、跨迭代依赖拓扑（关键顺序约束）

```
M0.1 openDatabase+迁移+全表DDL ─┬─ T7.9 PRAGMA接入
                                ├─ T8.1/T8.3/T8.6/T8.8/T8.9 持久化
                                ├─ T7.4/T7.5 gateway鉴权+SessionStore
                                └─ T11.1 epoch写入（表在M0.1，写入在迭代11）
M0.2 富glob ───┬─ T7.10 hooks matcher
               └─ T8-glob（并入M0.2，不再单列）
M0.3 审计sink ─┬─ T8.2 权限决策审计
               ├─ T10.3 沙盒违规审计
               └─ T13.2 gateway reply审计
M0.4 tail选择器 ─┬─ T11.1 摘要head/tail
                 └─ T11.5 reclaim保护tail
M0.5 分段模型 ─┬─ T7.6 双占位修复
               ├─ T7.7a system多断点
               └─ T11.6 section化重构（同一次重构三收益）
M0.6 redact+去牙 ─┬─ T7.3 接入redact
                  ├─ T7.3b 扩大围栏覆盖
                  └─ T10.5 熵兜底（M0.6已实现主体）
T7.1a bash接gateway ─┬─ T7.1b 进程组kill
                     └─ T10.2 bwrap隔离
T11.0 failover评审门 ── T11.3 多provider failover（评审通过才开工）
T7.1a bash接gateway ─ T10.2 bwrap(Linux) ─┬─ T10.2b macOS Seatbelt
                                          └─ T10.2c Windows降级+告知
（迭代13 多租户链已删除——§零本地客户端确定无租户维度）
```

**并行机会**：
- 迭代 9（检索/知识库）除依赖迭代 8 存储外，与迭代 10（沙盒）**无耦合，可两人分头推进**。
- 迭代 12 的 skill 链（T12.5–T12.8）与 agent 链（T12.1–T12.4）除 watcher 复用外基本独立。
- M0.1–M0.6 六件基础设施可在迭代 7 开工前**并行预制**（除 M0.5/M0.6 是接线型需读现有代码）。

**⚠已修复的三处依赖问题**（对应 §一优化 2）：
1. 迁移框架从"迭代8 T8.8"前移并入 **M0.1（迭代7）**，避免迭代7 建表在迭代8 重包进框架。
2. epoch 表 DDL 归 M0.1、写入归 T11.1，打开原"J(迭代7/8)↔A(迭代11)"的跨迭代耦合。
3. 富 glob 从"迭代8 K节"前移为 **M0.2**，T7.10（迭代7 hooks）与迭代8 权限共用。

---

## 六、风险与前置确认项（继承主计划 §六，落到 Task）

| 风险 | 说明 | 缓解 Task |
|---|---|---|
| **failover breaking change** | `RunLoopStaticInput.provider` 单字段→列表+路由，波及 core+llm+测试 | **T11.0 评审门前置**，产 ADR+受影响测试清单，通过才准 T11.3 |
| **embedding 模型选型** | 本地 vs 外部 API，依赖体积（transformers.js/ONNX）与延迟权衡 | **T9.1 低成本过渡先验证检索质量收益**，再决定 T9.2 是否上向量 |
| **bwrap 依赖系统安装** | 非 Linux（macOS/Windows）需明确降级 | **T10.2 DoD 显式非 Linux 降级策略**（local + 更保守 ask）；macOS Seatbelt 另一套后端 |
| ~~多租户过度设计~~ **已消解** | §零确认本地单机单用户，无租户维度 | **迭代 13 多租户作废**，不投入 |
| ~~SQLite 部署形态未定~~ **已确认** | §零：单进程本地客户端 | **M0.1 按单进程简化**锁/事务；唯一例外 T12.3 后台子任务并发写需回补串行 |
| **跨平台隔离缺口（新增，§零）** | 用户装在 macOS/Windows，bwrap 仅 Linux | **T10.2b macOS Seatbelt + T10.2c Windows 显式降级+告知**，不静默假装隔离 |
| **本地内容外泄（新增，§零）** | 数据全在本地，外发 embedding 即泄露 | **T9.3 外部 API 仅 opt-in+告知** |
| **远程接入网络攻击面（新增，§零已确认）** | 手机/另一台机跨网络连本地 agent：token 窃听/暴力、远程放行危险权限、DoS | **T7.4 强制 token+reply 加固 / T7.4b TLS+限流 / T7.4c 设备配对+可撤销**；仍单用户无多租户 |
| **fail-closed 被当"注意事项"** | AST 超时回退正则/沙盒仅 `--new-session`/围栏不去牙=漏洞 | **升为迭代 7/10 Gate 一票否决项**（§一优化 3） |
| **section 化三 Task 拆散重复做** | T7.6/T7.7/T11.5 同一次重构 | **抽 M0.5 分段模型一次做**，三 Task 复用 |

---

## 七、里程碑交付节奏（继承主计划 §七）

- **里程碑 1（迭代 7 完成）**：无已知安全裸洞和数据不一致隐患，内部小范围试用起点。
- **里程碑 2（迭代 8–9 完成）**：持久化+审计+基础检索，支撑多会话/长期使用，beta 发布节点。
- **里程碑 3（迭代 10–11 完成）**：沙盒与运行时韧性达标，对外提供服务的安全底线，对外发布节点。
- **里程碑 4（迭代 12 完成）**：agent/skill 生态热重载+后台任务，长期演进稳定基座。
- **~~迭代 13~~**：多租户在本地客户端形态下**作废**（§零）；仅"渠道扩展 X.1 / 远程访问 X.2"作独立可选项按产品需要单独排期，不占主里程碑。

> **§零复盘**：本地客户端形态把安全重心从"租户隔离"移到"保护用户本机"，因此**里程碑 3（迭代 10–11）实际上是本产品的安全底线核心**——沙盒真隔离 + 跨平台降级 + 风险 AST，直接决定"能不能让模型在用户机器上放心跑命令"。建议 macOS/Windows 用户占比高时，把 T10.2b/T10.2c 视为里程碑 3 的 Gate 项而非可选。

---

## 八、文件级覆盖确认（src 全量核对结果）

> 主计划/代码级设计声称"对 src 全量 grep 简化标记 + 逐文件精读"，但 A–Q 只深读**有生产化欠债的文件**。本节把覆盖从"模块级"补到**文件级**：对 src 19 个模块全部 `.ts` 做标记扫描 + stub 迹象扫描，结果分三类。

### 8.1 已在 A–Q / Tx.y 覆盖（有欠债、已排期）
19 个顶层模块**全部**有文件进入迭代 7–13 的 Task，模块级零遗漏。带简化标记且已排期的文件见"附·待改文件 × Task 索引"（代码级设计）。

### 8.2 扫描新发现的漏排项（本次已补入计划）
| 文件:行 | 标记 | 债务类型 | 处置 |
|---|---|---|---|
| `memory/agent-memory.ts:57` | "纯函数写好、真正接入 resolvers 延后" | **A 类接线债** | ✅ 新增 **T7.11**（迭代 7） |
| `core/runner.ts:28` | "`shell`/`shellThenRun` 无真实交互式 shell 绑定，状态机语义完整可测" | **B 类已知简化** | ⏭ **确认延后为独立《cli-interactive-mode 升级计划》专项优化**（用户已拍板），**不纳入生产化迭代 7–13**。此处仅登记边界，避免两份计划互相遗漏；该专项启动时再单独定位其文档与排期 |

### 8.3 无标记、无 stub 迹象的骨架文件（已核实，无需生产化改动）
下列文件**从未被 A–Q 深读**，本次补扫确认**零简化标记、零 stub 迹象**，视为"真跑通骨架"，不排期：

- **内置工具**（8 个）：`tool/builtin/{edit,glob,grep,read,walk,write,webfetch,skill}.ts`
- **其它**：`llm/proxy-agent.ts`、`cli/repl-commands.ts`、`storage/identity-files.ts`、`core/{session-run-state,terminal}.ts`、`permission/boundary.ts`、`channel/{registry,types}.ts`
- **基础类型**：`types/{abort,ids,message,not-implemented}.ts`、各模块 `types.ts`

> ⚠**边界诚实**：8.3 的"已核实"仅指**静态标记/stub 扫描通过**，非"逐行功能审计"。个别文件行数偏短（如 `webfetch.ts` 50 行、`edit.ts` 56 行），若你需要"功能级完备性"背书（例如 webfetch 是否真做 HTML→markdown、edit 是否处理多命中/CRLF），可另开一轮针对性 spot-check，不属本计划范围。

---

## 附 · 工作量汇总（相对人日估算）

| 迭代 | Task 数 | 估算合计 | 备注 |
|---|---|---|---|
| M0.x 前置 | 6 | ~7d | 迭代 7 开工前并行预制 |
| 迭代 7 | 16 | ~15.5d | 含安全裸洞 + 远程接入加固（T7.4/b/c）+ 补漏 T7.11，禁止跳过 |
| 迭代 8 | 9 | ~8d | 复用 M0.1/M0.3 |
| 迭代 9 | 7 | ~13d | T9.2 向量化 XL 是大头 |
| 迭代 10 | 10 | ~18d | T10.2 bwrap XL + 新增 macOS Seatbelt/Windows 降级（§零跨平台） |
| 迭代 11 | 9 | ~16d | T11.1 摘要+epoch XL |
| 迭代 12 | 8 | ~11d | T12.3 后台子任务 XL |
| ~~迭代 13~~ | — | — | **本地客户端下作废**（§零），仅 gateway 回环加固并入 T7.4 |

> 估算为相对量级（S≈0.5d/M≈1d/L≈2d/XL≈3d+），用于排期与并行切分，非承诺工期。实施每个 Task 前先读代码级设计对应 A–Q 节。
