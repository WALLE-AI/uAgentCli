# uAgentCLI 办公智能体 · 技术产品方案

> 版本：v0.4　日期：2026-07-15　（v0.4：**内核语言由 Python 改为 Go**——满足桌面安装 `resident_kernel_rss < 300MB` + 低 CPU + 信创单二进制交叉编译；Python 保留但**降级为按需 spawn 的办公 worker**（用完即退、内存回收），详见 §11.6。v0.3：交付形态定为 Electron+React 桌面 UI 与内核一体打包、一并安装；内核经 JSON-RPC/ACP 解耦。v0.2：聚焦 Agent CLI 内核 + 协议接口层）
> 配套文档：《智能体项目深度技术解读报告》（同目录，下称"**技术报告**"，引用其第 N 章记为 `[报告§N]`）
> 定位：把技术报告的**通用智能体参考架构**收敛为一个**面向政企办公场景的 Agent 产品**。
> 说明：竞品的 web 侧信息因联网工具故障未能实时核实，凡"web 未核实"处以知识库综述给出，标注待联网复核；仓库内源码级结论均逐文件核实并标注路径。

---

## 0. 关键前提与决策（评审确认项）

场景为**党建公文写作 / 合同审核 / 施工组织方案审核 / 数据分析**——政企属性 → 强隐私 + 信创合规 + 重办公文档处理。据此取如下默认（评审可改，改则仅动"形态/技术栈/MVP"章，架构主体不变）：

| 决策 | 默认取值 | 理由 |
|---|---|---|
| **产品边界/交付形态** | **架构解耦、交付一体**：headless Agent 内核（**Go**，常驻 <300MB）经 JSON-RPC/ACP 暴露；**发行产品 = Electron+React 桌面 UI 与内核一体打包、一并安装到用户电脑**（桌面 UI 为默认主客户端）；本地/内网私有化 | 内核解耦→可测试/可复用/多端；一体安装→终端用户开箱即用；对齐 opencode(ACP)/pi(JSON-RPC) [报告§7]；数据不出内网 |
| **技术栈** | **Electron+React/TS/Vite 桌面 UI** ⇄(JSON-RPC/WS)⇄ **Go 内核（常驻 <300MB）** ⇄(spawn)⇄ **Python 办公 worker（按需、用完即退）**；详见 §11 | 内核 I/O 密集、需 <300MB 常驻 + 信创单二进制交叉编译 → **Go**；重办公/数据能力仍用 Python 生态，但降为按需子进程 worker、不进常驻内核。桌面壳仍 Electron+React（用户指定） |
| **模型策略** | 多 provider 可配，**默认国产合规**（通义/DeepSeek/豆包/文心），可切 Claude/GPT，私有化接 vLLM；**分级模型**（lite 筛选 + craft 主推理） | 信创合规 + 降本（分级抄 WorkBuddy） |
| **首个 MVP** | **文档解读 + 数据分析 → web 可视化报告** | 通用性最强，是其余垂直审核场景的公共底座 |

---

## 1. 产品定位与目标用户

**一句话定位**：uAgentCLI 是一个**可私有化部署的政企办公智能体内核（Agent CLI）**——把 PDF/PPT/Word/Excel 的解读、数据分析、公文写作、方案/合同审核，以及"联企业内网系统协作"整合进一个自主规划、自主执行的 **headless Agent 内核**，以 CLI/TUI 直接使用，并**通过 ACP / JSON-RPC 协议对外暴露给任意 UI 组件**；轻量编码（数据分析脚本、生成 web 报告页）作为其自然能力，而非编码 IDE。

**产品边界（架构解耦、交付一体）**：**架构上**内核与 UI 解耦——内核（**Go**）不含任何前端渲染代码，只产出**结构化事件流 + 协议接口**（JSON-RPC/ACP），可被 CLI/IDE/其它 UI 复用与独立测试。**交付上**发行产品 = **Electron+React 桌面 UI 与 Go 内核一体打包、一并安装到用户电脑**（内核再按需 spawn Python 办公 worker），桌面 UI 是默认主客户端（同样经协议与内核通信，只是被打进同一安装包）。技术栈与打包见 §11。

**与"编码 Agent"的边界**：Codex/Trae 等是**编码中心**（IDE、代码库、终端）；uAgentCLI 是**办公文档中心**（文档、表格、规范库、公文），编码只是"为办公服务的轻量手段"（跑数据分析、出可视化页）。

**目标用户画像**：

| 画像 | 高频任务 | 痛点 |
|---|---|---|
| 综合/文秘/党务岗 | 党建公文、总结报告、通知请示 | 格式规范繁琐、政策要准、模板散 |
| 法务/合规岗 | 合同审核、条款比对 | 逐条人工、立场易漏、规则难沉淀 |
| 工程/技术岗 | 施工组织方案审核、规范符合性 | 规范量大、危大工程易漏、缺项难查 |
| 数据/业务岗 | 多源文档解读、数据分析出报告 | 格式杂、重复劳动、可视化门槛 |

---

## 2. 竞品全景与差异化

### 2.1 竞品能力矩阵

| 维度 | WorkBuddy(腾讯) | QoderWork(阿里) | Codex CLI(OpenAI) | Trae(字节) | **uAgentCLI(本方案)** |
|---|---|---|---|---|---|
| 定位 | 桌面办公 Agent | 桌面办公 Agent | 编码 CLI | AI 原生 IDE | **政企办公 Agent(私有化)** |
| 办公文档(PDF/PPT/Word/Excel) | ✅ | ✅(pdf/pptx/docx/xlsx 技能) | ❌ 仅通用文件 | ❌ 编码中心 | ✅✅ **OOXML+OCR+建模+redline** |
| 记忆 | 三层+memorySelector | **FTS5 trigram+反思进化** | AGENTS.md | AGENTS.md 类 | **memdir+FTS5 trigram+反思** |
| 多智能体 | ✅ 16 体主从+黑板 | 上下文隔离 | 单体 | Builder/SOLO | **主从+黑板+校验轮** |
| 安全/合规 | 分级信任+沙盒 | 三重冗余会话+加密 | OS 沙盒+审批 | — | **私有化+分级审批+审计** |
| MCP/企业集成 | 40+ MCP | MCP | ✅ 客户端+server | ✅ | ✅ **一等公民+企业渠道** |
| 垂直审核规则库 | ❌ | ❌ | ❌ | ❌ | ✅✅ **合同/施工/公文规则库** |
| 信创/国产模型/私有化 | 部分 | 部分 | ❌ | ❌ | ✅✅ **默认国产+内网私有化** |

> web 未核实项：Codex/Trae 的 2026 具体特性、Cowork/ArkClaw 是否确为所指产品，联网恢复后补带引用核实版。

### 2.2 差异化打法（护城河）

1. **中文办公深度**：GB/T 9704 公文格式合规、中文 FTS5 trigram 记忆检索、参数化示例任务（选示例填参，办公用户不写 prompt）。
2. **政企私有化 + 信创合规**：数据不出内网、默认国产模型、可接本地 vLLM、全链路审计。
3. **垂直审核规则库**（横向厂商最弱、施工审核 AI 渗透最低 → 机会最大）：合同 playbook、施工 GB/JGJ 规范 + 危大工程库、公文范式 + 党建政策库，**可解释、引用条款、人审闭环**。
4. **MCP 联企业数值化系统**：把企业内部系统作 MCP server 接入同一工具池与权限管线，实现"智能体协作办公"。

---

## 3. 核心场景与工作流

> 每个场景给"输入 → Agent 步骤 → 产出物 → 复用技能/脚本（仓库已核实路径）"。

### 3.1 文档 + 数据分析 → web 报告（**MVP**）
- 输入：PDF/PPT/Word/Excel（可多份）+ 分析诉求。
- 步骤：解析（版式/表格/图保留）→ 结构化抽取 → 数据分析（有状态 Python REPL）→ 生成可视化 → 出 web 报告页。
- 产出：结论摘要 + 交互 web 报告（图表 PNG-from-model）+ 可选 Word/PDF 导出。
- 复用：`ocr-and-documents/`（PDF/OCR）、`markitdown`（office→md）、`jupyter-live-kernel/`（数据分析）、`creative/popular-web-designs`（54 套设计系统）、`excel-author/scripts/recalc.py`（LibreOffice 转换）。

### 3.2 党建公文写作
- 输入：文种 + 要点/素材（可附参考文件）。
- 步骤：选文种模板 → 党建政策库检索接地 → 生成 → **GB/T 9704 格式校验** → 审校（口吻/敬语/事实）。
- 产出：符合《党政机关公文格式》的 docx。
- 复用：`office/pack.py`+`wml.xsd`（docx 生成校验）、参数化技能（模板 `{{变量}}`）、公文范式知识库（新建）。

### 3.3 合同审核
- 输入：合同 docx/pdf + 立场（甲/乙方）+ 规则库选择。
- 步骤：条款切分抽取 → **立场感知**逐条比对 playbook → 风险分级 → 缺失条款检测 → **生成 redline 批注 + 意见书（引用法条）**。
- 产出：带修订/批注的 docx + 风险意见书。
- 复用：`office/helpers/simplify_redlines.py`+`merge_runs.py`+`RedliningValidator`（修订/批注）、法务规则库（新建）。

### 3.4 施工组织方案审核
- 输入：施工组织设计/专项方案 docx/pdf。
- 步骤：结构完整性 → **GB/JGJ 规范符合性** → **危大工程识别 + 专家论证强制标记** → 缺项/进度/资源合理性 → 出意见书。
- 产出：审核意见书 + 缺项清单 + 危大工程标记。
- 复用：文档解析 + redline + 施工规范知识库（新建，含危大工程目录）。

### 3.5 企业数值化系统 MCP 协作
- 输入：跨系统任务（如"从 ERP 取本月数据 + 生成经营分析报告"）。
- 步骤：MCP 连企业系统取数 → 数据分析 → 出报告 → 可回写。
- 产出：报告 + 系统联动结果。
- 复用：MCP 一等公民 + 企业渠道（飞书/企微/钉钉）+ OpenAI 兼容 API。

---

## 4. 系统总体架构

> **一个 Electron 安装包**内含桌面 UI 与 **Go 内核**（内核再按需 spawn Python 办公 worker）；架构上二者经协议解耦（内核也可被 CLI/IDE/内网多端复用）。

```
┌ Electron 桌面 App（一体安装包, 见 §11.2）───────────────────┐
│  renderer(React+TS+Vite, AntD)  ──IPC──►  main(Node)        │
└──────────────────────────────────────────────┬─────────────┘
   其它客户端: CLI/TUI · IDE(ACP) · 飞书/企微    │ spawn sidecar
┌──────────────────────────────────────────────▼─────────────┐
│ ★ 协议接口层 Protocol（内核对外唯一边界, 见 §11.1）        │
│  JSON-RPC(stdio)+WS(127.0.0.1) · ACP · OpenAI兼容API · 事件流│
└──────────────┬────────────────────────────────────────────┘
               │ 结构化事件流 / 会话·工具·审批 RPC
┌──────────────▼────────────────────────────────────────────┐
│ Go Agent 内核 Core（常驻 <300MB）[报告§2,6,14]（含 CLI/TUI）│
│  run-loop(状态机+恢复+DOOM守卫) · 上下文Engine(可插拔压缩)  │
│  记忆Manager(memdir+FTS5 trigram+反思) · 多智能体(主从+黑板)│
├───────────────────────────────────────────────────────────┤
│ ★ 办公能力层 = Python 按需 worker（核心增量, 见 §5/§11.6）  │
│  spawn/用完退: 文档引擎(OOXML/OCR/建模/redline) · 数据分析  │
│  (jupyter kernel) · web/可视化 · 参数化技能 · 垂直规则库    │
├───────────────────────────────────────────────────────────┤
│ 工具/MCP 层  [报告§3,12] registry+toolset+fail-closed+MCP  │
├───────────────────────────────────────────────────────────┤
│ 安全层  [报告§10] 分级信任审批 · HARD_BLOCKED · 审计       │
│ 沙盒/环境层  [报告§9] BaseEnvironment(local/docker) · shell快照│
└───────────────────────────────────────────────────────────┘
```

**取用报告 vs 办公增量**：run-loop/上下文/记忆/多智能体/工具/安全/沙盒直接取报告方案；**办公能力层**（§5）与**垂直规则库**是本产品独有增量。

---

## 5. 办公能力层设计（核心增量）

### 5.1 文档引擎
- **统一 OOXML 工具箱**（复用 `hermes-agent/skills/productivity/powerpoint/scripts/office/`）：`pack.py`（DOCX/PPTX/XLSX 统一打包 + schema 校验 + 自动修复）、`schemas/`（ISO/IEC 29500 wml/pml/sml/dml-chart XSD，校验生成物）、`helpers/simplify_redlines.py`+`merge_runs.py`（**修订/批注**，审核核心）。
- **PDF/扫描件**（复用 `ocr-and-documents/`）：pymupdf 轻量 vs marker-pdf OCR/表格/公式/90+ 语言，决策矩阵按需选；`nano-pdf` 自然语言编辑。
- **Excel 建模**（复用 `excel-author/`）：openpyxl 分色/公式优先/Checks 校验页/来源批注；`recalc.py` LibreOffice headless 重算转换。
- **通用读取**：`markitdown` 把 office→markdown 供模型阅读。

### 5.2 数据分析引擎
- **有状态 Python REPL over 活 Jupyter kernel**（复用 `data-science/jupyter-live-kernel/`）：变量跨执行持久，迭代 DataFrame/分析。
- 图表：**PNG-from-model**（从源工作簿渲染 PNG 嵌入）优于脆弱的原生 OOXML 图表。

### 5.3 web/可视化生成
- 复用 `creative/`：`popular-web-designs`（54 套即贴设计系统 + `triggers:` 元数据）、`claude-design`、`design-md`（DESIGN.md 令牌 + WCAG）；`infographic/` 信息图。

### 5.4 参数化技能系统（**办公 Agent vs 编码 Agent 关键差异**）
- 抄 QoderWork：`SKILL.md` + `.skill-metadata.yaml`（**参数化示例任务，中英双语，`{{变量}}` 模板**）——用户**选示例填参**即可，不写 prompt。
- 打包/校验复用 `nanobot/nanobot/skills/skill-creator/`（`init_skill.py`/`package_skill.py`/`quick_validate.py` + 三级渐进披露）与 `templates/`（Jinja2 `{{}}` prompt 系统）。
- 装载机制参考 `claude-code-main/src/skills/bundledSkills.ts`（懒解压 + "Base directory"契约）。

### 5.5 垂直规则库/知识库（护城河，新建）
- **合同 playbook**：条款清单 + 立场规则 + 风险分级 + 法条引用。
- **施工规范库**：GB/JGJ 规范 + **危大工程目录** + 专家论证触发规则。
- **公文范式库**：GB/T 9704 格式规则 + 文种模板 + 党建政策接地。
- 检索注入：走记忆层 FTS5 trigram（中文友好）+ 按 importance 排序注入预算内。

---

## 6. 记忆与上下文

- **主存**：memdir [报告§6,11]——`MEMORY.md` 索引 + `USER.md` 档案 + topic 记忆（type 分类）。
- **检索**：**SQLite + FTS5 trigram**（抄 QoderWork，中文天然友好，"上下文管理"→"上下/下文/文管/管理"，FTS5 失败回退 LIKE）+ **三级重要性**（critical/normal/low，从 low 逐级驱逐，驱逐写 `_evicted.log` 不物理删）。
- **反思进化**（抄 QoderWork）：日志累积→24h 蒸馏→反思 MEMORY/USER→**改前备份 `.reflection-bak`**→token 保留率<65% 放弃→hash 变触发重索引。
- **预筛**：memorySelector 式 **lite 模型零工具预筛 ≤5 条记忆**（抄 WorkBuddy，降本 + 防上下文膨胀）。
- **上下文压缩**：可插拔 ContextEngine [报告§5]，结构化重建（意图/关键概念/文件/错误修复/待办）。

---

## 7. 多智能体设计

- **主从 + 预制子体**（抄 WorkBuddy 16 体 + [报告§14]）：主 Agent 编排；子体 = 文档抽取/审核/写作/数据/审校/Explore，**agent=ruleset**（最小工具集，审校/压缩类 0 工具）。
- **协调用黑板/TaskList**（抄 WorkBuddy Blackboard Pattern，非消息队列）：子体各自独立、松耦合。
- **上下文隔离**：子体纯文本对主体不可见，**强制 SendMessage 摘要回传**（"信息收费站"），防上下文膨胀/注意力稀释。
- **校验轮**（办公/法务/政务要准）：审核/写作后加 verifier 子体做事实与规范复核。
- **分级模型**（抄 WorkBuddy）：lite（筛选/Explore）/ default（规划/执行）/ craft（主体、直接交互）。

---

## 8. 模型与 provider 策略

- **多 provider 抽象**（[报告§3] provider 无关）：默认国产合规（通义/DeepSeek/豆包/文心），可切 Claude/GPT。
- **私有化**：可接本地 vLLM/内网模型服务。
- **分级路由**：按任务复杂度选 lite/default/craft，降本控质。
- **OpenAI 兼容出入口**（复用 `nanobot/api/server.py`）：既能对接国产 OpenAI 兼容端点，也能被企业系统反向调用。

---

## 9. 安全与合规（政企重点）

- **部署**：本地/内网私有化，**数据不出内网**；信创适配。
- **分级信任审批**（抄 WorkBuddy + [报告§10]）：读自动 / 写审批 / 危险人工确认；`HARD_BLOCKED` 先于任何 bypass；会话隔离（Go 内核用 `context.Context`/goroutine 局部；概念抄 cc 的 AsyncLocalStorage [报告§10]）。
- **会话持久**（抄 QoderWork 三重冗余）：JSONL 流（防崩溃）+ 压缩快照（快恢复）+ **AES-GCM 加密**（防泄漏/云同步）。
- **审计**：全工具调用可审计日志；审核类产出留痕。
- **Shell 一致性**（抄 QoderWork）：会话启动抓 shell 快照（PATH/alias/conda），避免 Agent 环境与用户不一致。
- **合规红线**：审核/公文场景**不做黑箱判定**，输出引用条款 + 人审闭环，杜绝政策/法条幻觉。

---

## 10. MCP 与企业系统集成

- **MCP 一等公民**（[报告§3,12]）：企业数值化系统作 MCP server 接入，工具并入**同一工具池 + 同一权限管线**（不旁路）。
- transport：stdio / Streamable HTTP + OAuth；断连重连 + watchdog。
- **企业渠道**（复用 `nanobot/channels/`）：飞书/企微/钉钉/Teams 自动发现接入。
- **反向暴露**：OpenAI 兼容 API + 自身可作 MCP server，供企业系统调用 uAgentCLI 能力（与 §11.1 协议接口层同一出入口）。

---

## 11. 交付形态、技术栈与打包（Electron+React 桌面端 + Go 内核 + Python 办公 worker）

> **架构解耦、交付一体**：内核是 **headless Agent 内核（Go，常驻 <300MB）**、只经协议暴露，重办公能力由内核**按需 spawn Python worker**（用完即退，见 §11.6）；发行产品 = Electron+React 桌面 UI 与 Go 内核一体打包，一并安装到用户电脑——桌面 UI 是**默认主客户端**，内部经 JSON-RPC/ACP 与内核通信。"解耦"保证内核可被 CLI/IDE/其它 UI 复用与可测试；"一体"保证终端用户开箱即用。

### 11.1 协议接口层（内核对外唯一边界，桌面 UI 也走它）

UI 不嵌入内核，一律经协议接入——**Electron 桌面 UI 同样是"协议客户端"**，只是被打进同一安装包。内核只产出**结构化事件流**并暴露 RPC 方法，前端负责渲染。

| 协议 | 用途 | 借鉴 | 传输 |
|---|---|---|---|
| **ACP（Agent Client Protocol）** | 编辑器/IDE 插件集成（会话、工具调用、审批、diff 展示） | opencode ACP [报告§7] | stdio |
| **JSON-RPC（行分隔）** | 通用 UI 客户端驱动内核（`prompt/steer/followUp/abort`、订阅事件） | pi RPC 模式（`RpcClient` spawn 子进程） | stdio / socket |
| **事件流** | UI 实时渲染 assistant 增量 / 工具状态 / 审批请求 | cc NDJSON、opencode SSE/WS | NDJSON(stdout) / SSE / WS |
| **OpenAI 兼容 API** | 被企业系统/第三方反向调用 | nanobot `api/server.py` | HTTP |
| **生成式 SDK** | 由协议 schema 生成的强类型客户端 | opencode SDK | 库 |

**接口契约要点**：
- 内核**无任何前端渲染代码**，只发**结构化事件**（`text.delta` / `tool.pending` / `tool.result` / `permission.request` / `turn.end`，对齐 [报告§2.5] LoopEvent）。
- **审批渠道化**：`permission.request` 事件推给任意已连接 UI，多路**竞速**响应（本地 TUI / IDE / 远程），首个胜出 [报告§10]。
- **steering**：UI 经 RPC 调 `steer()/followUp()/nextTurn()` 中途插话改向（三队列 [报告§2.5]）。
- **一份内核，多端接入**：桌面壳、Web、IDE 插件、飞书/企微机器人都是同一协议的客户端，可并存、可替换。

### 11.2 推荐技术栈（Electron main ↔ React renderer ↔ Go 内核 ↔ 按需 Python worker）

**进程模型**：Electron `main`（Node）在应用启动时 **spawn Go 内核作 sidecar 子进程**（内核再**按需 spawn Python 办公 worker**，任务完成即退出、内存回收），经 JSON-RPC(stdio) + 本地环回 WS(127.0.0.1) 通信；`renderer`(React) 只与 `main` 经 Electron IPC 通信，不直连内核（安全边界）。

```
┌ Electron 桌面 App（一个安装包）──────────────────────────────┐
│  renderer (React+TS+Vite)  ──IPC(contextBridge)──►  main(Node) │
│                                                        │ spawn  │
│                                          JSON-RPC(stdio)+WS(127.0.0.1)
│                                                        ▼        │
│              Go Agent 内核 (sidecar, 单静态二进制, 常驻 <300MB)  │
│              run-loop / 记忆 / MCP / 工具 / 安全 / 协议服务       │
│                 └─按需 spawn─▶ Python 办公 worker(用完即退回收)  │
└────────────────────────────────────────────────────────────────┘
```

| 层 | 推荐选型 | 理由 |
|---|---|---|
| **桌面壳** | **Electron**（`main`/`preload`/`renderer` 三段） | 用户指定；生态成熟、信创 Linux 可跑 |
| **安全基线** | `contextIsolation:true` + `nodeIntegration:false` + `preload` 经 `contextBridge` 白名单暴露 API + `sandbox:true` | Electron 安全刚需，防 renderer 直碰 Node/内核 |
| **前端框架** | **React + TypeScript + Vite**（renderer 构建/HMR） | 用户指定 React；Vite 开发体验最佳 |
| **UI 组件库** | **Ant Design 5**（政企/中文办公首选；表格/表单/上传强）或 shadcn/ui+Tailwind（更轻定制） | 办公场景重表格/表单/文件上传；AntD 中文生态好 |
| **状态管理** | **Zustand**（轻）+ **TanStack Query**（异步/缓存） | 会话/工具状态轻量；避免 Redux 样板 |
| **流式渲染** | 订阅内核事件流（`text.delta`/`tool.*`/`permission.request`），main 经 IPC `webContents.send` 增量推给 renderer | 对齐 [报告§2.5] LoopEvent；打字机式渲染 |
| **Markdown/文档预览** | react-markdown + 代码高亮；docx/pdf 预览走内核转 HTML/图 | 办公产出需内嵌预览 |
| **内核语言** | **Go 1.22+（常驻内核）** + **Python 3.11+（办公 worker，按需 spawn）** | 内核 I/O 密集、需 <300MB 常驻 + 信创交叉编译单二进制 → Go；办公/OOXML/数据全在 Python 生态 → 保留但降为子进程 worker、用完即退不占常驻。详见 §11.6 |
| **内核↔main IPC** | **JSON-RPC 行分隔(stdio)** 主通道 + **本地 WS(127.0.0.1)** 事件流 | 对齐 pi(stdio RPC)/opencode(WS)；stdio 生命周期跟随 App，WS 便于流式与多窗口 |
| **办公依赖** | python-docx / openpyxl / pandas / **PyMuPDF(默认轻量)** / markitdown / Jupyter kernel | 见 §5.1/5.2；核心装机小 |
| **重型可选件** | **LibreOffice / marker-pdf(OCR) / 本地 LLM** 作**按需下载的可选组件**（不进核心包） | LibreOffice ~300MB–1GB、marker-pdf 含 GB 级模型，全量打包会撑爆安装体积 |

### 11.3 Go 内核 + Python 办公 worker 打包进桌面 App（关键工程）

- **内核编译为单静态二进制**：Go **交叉编译**出 `uagent-kernel(.exe)`（无运行时依赖、启动快、天然源码保护、RSS 小）。**办公 worker** 用 **PyInstaller（one-folder）/Nuitka**（信创/IP 保护建议 Nuitka）冻结成 `uagent-office-worker(.exe)`，由 Go 内核**按需 spawn、用完即退**。
- **打进 Electron**：作为 `electron-builder` 的 `extraResources` 随包分发；`main` 在启动时定位并 spawn 它（开发期直接 spawn 系统 Python，生产期 spawn 冻结二进制）。
- **重型件按需**：核心安装包只带 PyMuPDF 等轻依赖；**LibreOffice/OCR/本地模型首次使用时检测系统安装或从内网源下载**（可插拔后端，见 [报告§9] BaseEnvironment），既控体积又保离线可用。
- **多架构**：Go 内核对 x64 / arm64 / **loong64（含信创 麒麟/统信 UOS + 龙芯/飞腾/鲲鹏）** 一条命令交叉编译单二进制；Python 办公 worker 与 Electron 包分架构产出。

### 11.4 安装、更新、签名、部署

- **安装器**：**electron-builder** —— Windows `NSIS`、macOS `dmg`(公证/notarization)、Linux `AppImage`/`deb`(信创)。
- **代码签名**：Windows Authenticode + macOS 签名公证（政企对未签名包告警敏感）。
- **自动更新**：`electron-updater`；**私有化/内网默认关闭公网更新，走内网更新服务器**或企业统一分发。
- **配置/数据**：`~/.uagent/config.json`（Pydantic）+ 文件系统布局见 [报告§11]；**数据全落本地，不出内网**。
- **两种运行拓扑**：① **单机内嵌**（App 内 spawn 内核，默认，最简）；② **内网服务**（内核常驻服务器、多台桌面 App 经 WS/HTTP 接同一内核，对齐 opencode Client/Server，适合团队/多租户）。

### 11.5 工程结构与开发体验

- **Monorepo**：`pnpm workspace`（`app-electron` + `ui-react` + `sdk` 生成式客户端）+ `kernel-python`（`uv`/`poetry` 管理）。
- **开发期**：Vite dev server（renderer HMR）+ `electronmon`（main 热重启）+ 内核独立 `python -m uagent.kernel` 由 main spawn/attach；`concurrently` 一键起。
- **CI/交付**：分平台/架构矩阵构建（Go 内核交叉编译 → 冻结 Python 办公 worker → 组装 Electron → 出签名安装包）；离线安装包 + 信创适配包并行产出。

### 11.6 内核语言与内存预算（v0.4 决策更新：内核 Python → Go）

**决策变更**：内核语言由 **Python** 改为 **Go**；Python 保留，但**降级为按需 spawn 的办公 worker**（用完即退、内存回收）。

**动因（桌面安装硬约束）**：`resident_kernel_rss < 300MB`、低 CPU、信创多架构私有化。

**关键判断（为什么不是语言洁癖）**：
- 内核这层（run-loop / 工具编排 / 上下文 / 记忆 / 权限 / MCP / 协议服务）是 **I/O 密集**，本地不做重计算——语言对其内存影响很小。
- 真正撑爆预算的是**在常驻进程 `import pandas / PyMuPDF / OCR`**（+40~200MB 且基本不释放）。既然重办公能力**注定要子进程化**才能回收内存，内核就不再需要 Python 生态 → 用 **Go** 换取更小足迹（常驻 5~15MB）、**信创单二进制交叉编译**（`GOARCH=loong64/arm64` 一条命令）、编译级源码保护。

**架构落法（内核瘦、办公外挂）**：
```
Go 内核（常驻目标 RSS <300MB，空载 <50MB）
├─ run-loop / 工具注册 / 上下文(可插拔压缩) / 记忆(memdir+FTS5) / 权限 / MCP / JSON-RPC·ACP 服务
└─ 按需 spawn ─▶ Python 办公 worker（PDF/OCR/Excel/pandas/OOXML/公文/可视化）任务结束即退出、内存回收
```

**内存指标口径（重要，写入验收指标）**：
- `300MB = 常驻内核 RSS`，**不含**运行中的办公 worker（pandas 单进程瞬时 200~400MB，**独立进程、独立计量、干完回收**）。
- **本地量化 LLM 不进 300MB**：即便 0.5B Q4 也 ~400MB → 走 API 或独立 sidecar 进程；"量化"仅约束该独立模型进程，不影响内核选型。

**取舍与备选**：
- **Go（首选）**：足迹 + 信创交叉编译 + goroutine 并发 + 开发速度；`claude-code-analysis/` 已有 Go 重写方案，方向一致。
- **Rust（备选）**：极致最小足迹 + 源码保护最强，参照 `opensource/goose`（Rust 生产级 agent 内核）；代价开发慢、MCP 生态略逊。
- **Python（若团队速度/生态压倒足迹）**：纪律严明的 Python 内核也能 <300MB——前提是**绝不在内核 import 重办公库、全部 subprocess**；代价是信创打包更重、GC/启动更慢、源码保护更弱。

**受影响的既有决策**：§0 决策表、§4 架构图、§11.2/11.3、§12 P1、§13 风险 4/5 已同步；办公能力层（§5）由"内核内子系统"重定位为"按需 Python worker"。多智能体/上下文/记忆/工具/安全等机制取用不变（仍取 [报告§2,3,5,6,10,14]，只是宿主语言从 Python 换 Go 重写骨架）。

---

## 12. 分阶段路线图

| 阶段 | 交付能力 | 对标水位 |
|---|---|---|
| **P1 MVP** | 文档解读 + 数据分析 → web 报告；memdir + AGENT.md/USER.md 注入；**Go 内核(CLI/TUI + JSON-RPC) + 按需 Python 办公 worker + Electron/React 桌面 UI 一体打包安装**；分级审批 | 可装机可用的办公助手 |
| **P2 垂直审核** | 合同/施工/公文**规则库 + redline + 意见书 + 校验轮**；参数化示例任务技能 | 差异化落地 |
| **P3 主动性** | durable cron + 监控/闲时触发 + 记忆反思进化 + FTS5 跨会话 | 主动 7×24 [报告§8] |
| **P4 企业集成** | MCP 联企业数值化系统 + 飞书/企微/钉钉渠道 + OpenAI 兼容 API + 私有化信创 | 企业协作办公 |
| **P5 编排/自进化** | 多智能体黑板编排 + 分级模型 + Curator 自进化技能 + 全事件 hook | 工业级 |

---

## 13. 风险与开放问题

1. **模型合规/幻觉**：审核与公文场景对政策/法条幻觉零容忍 → 强制引用 + 人审闭环 + 校验轮；国产模型能力评估。
2. **OOXML 生成保真**：复杂 Word/Excel 版式/修订的生成与校验（schema 校验 + LibreOffice 重算兜底）。
3. **垂直规则库冷启动**：合同/施工/公文规则库需精编与持续维护——是护城河也是成本，需专家共建。
4. **内核↔worker 边界成本**：内核改选 **Go**（<300MB 常驻 + 信创单二进制），Python 降为**按需办公 worker**——新增内核↔worker 的进程/协议边界（spawn 策略、超时回收、内存配额、序列化开销、worker 池预热）需设计与评审（见 §11.6）。
5. **Go 内核 + Python worker + Electron 打包复杂度**：Go 交叉编译（含 loong64）+ 办公 worker 冻结（PyInstaller/Nuitka）+ 重型件（LibreOffice/OCR）按需下载 + 安装体积控制 + 签名公证——是本形态的主要工程成本（见 §11.3/11.4）。
6. **协议成熟度**：JSON-RPC/ACP 接口需保证跨客户端稳定与向后兼容；事件 schema 需版本化，避免前后端脱节。
5. **私有化运维**：离线模型、依赖（LibreOffice/marker-pdf 体积）、信创环境适配的交付复杂度。

---

## 14. 附录

### 14.1 办公能力复用资产清单（仓库已核实路径）

| 能力 | 复用来源（`opensource/` 下） |
|---|---|
| OOXML 打包/校验/redline | `hermes-agent/skills/productivity/powerpoint/scripts/office/{pack.py,schemas/,helpers/}` |
| PDF/OCR | `hermes-agent/skills/productivity/ocr-and-documents/{SKILL.md,scripts/extract_pymupdf.py,extract_marker.py}`、`nano-pdf/` |
| Excel 建模/转换 | `hermes-agent/optional-skills/finance/excel-author/{SKILL.md,scripts/recalc.py}` |
| 数据分析 | `hermes-agent/skills/data-science/jupyter-live-kernel/` |
| web/可视化 | `hermes-agent/skills/creative/{popular-web-designs,claude-design,design-md}`、`infographic/` |
| 技能打包/参数化 | `nanobot/nanobot/skills/skill-creator/`、`templates/`、`claude-code-main/src/skills/bundledSkills.ts` |
| Python Agent 运行时 | `nanobot/nanobot/{agent/,providers/,api/server.py,channels/}` |
| 记忆(反思/FTS5) 范式 | QoderWork/WorkBuddy 竞品文档（`QoderWork.md`、`workbuddy分析.md`）+ [报告§6,11] |

### 14.2 竞品与标准锚点
- 竞品：`QoderWork.md`、`workbuddy分析.md`（仓库）；Codex/Trae/垂直厂商（web 未核实，待补引用）。
- 标准：GB/T 9704《党政机关公文格式》；GB/JGJ 施工规范 + 危大工程目录；ISO/IEC 29500(OOXML)。

### 14.3 术语
- **参数化示例任务**：SKILL.md + metadata 定义带 `{{变量}}` 的示例，用户选示例填参而非写 prompt（QoderWork）。
- **FTS5 trigram**：SQLite 全文索引 trigram 分词，中文天然友好、无需额外分词器。
- **反思进化**：Agent 定期蒸馏日志、反思并更新长期记忆，改前备份、token 保留率校验（QoderWork）。
- **redlining**：Word 修订/批注（tracked changes），审核类产出核心。
- **危大工程**：危险性较大的分部分项工程，需专家论证——施工方案审核强制标记项。
- **黑板模式(Blackboard)**：多子体经共享状态空间协调而非互发消息（WorkBuddy）。
- **ACP（Agent Client Protocol）**：编辑器/IDE 与 Agent 内核之间的标准协议（会话/工具/审批），走 stdio，UI 与内核解耦（opencode）。
- **JSON-RPC（行分隔）**：UI 客户端经 stdio/socket 驱动内核的通用 RPC，`prompt/steer/abort` + 事件订阅（pi）。
- **headless 内核**：不含任何前端渲染、只产结构化事件流并暴露协议接口的 Agent 本体；与 UI 架构解耦（但可同包分发、一并安装）。

---

> 本方案基于仓库内四家开源项目 + 二家竞品文档逐文件/逐文档核实撰写。竞品 web 侧信息待联网复核后增补带引用版本。评审通过后可据 §12 路线图开工 P1 MVP。
