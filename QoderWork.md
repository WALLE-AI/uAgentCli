最近桌面 Agent很火，Agent部署在电脑终端，又叫桌面Agent，具备自主规划、自主执行，能覆盖全部办公场景 。国外有ClaudeCode、Codex、Cowork等，国内有腾讯WorkBuddy、阿里QoderWork、字节Trae和ArkClaw，赛道挤得满满当当。
所以，可以做个拆解，最近一个发现， 可以借助Agent工具自身，去从代码的角度，分析安装包，从而结构出实现机制，包括记忆机制、包括架构机制、agent架构等 。
带着这种方式，我们前文看了 workbuddy ，现在看看 QoderWork ，重点看看它的记忆层级和一些差异性，如下：
[图片]
然后再看看一些特性，比如上下文隔离、skill这块的，也蛮有趣的。
一、QoderWork的Agent记忆细节
QoderWork搞了个叫意识系统(Awareness)的东西，在这里叫做A gent的记忆与人格 ，是QoderWork架构中设计很有趣的的子系统之一。
在实现上，主要依赖数据库。 在文件夹awareness/main/下有一个独立的.index.sqlite、memory_meta.json做记忆分级（normal/critical）、hash-state.json 做增量检测，所以说，它不是一个轻量级的记忆引擎，不是简单的Markdown读取。
[图片]
基于此， 它不是把Markdown拼进prompt，而是对文件做了chunk→FTS5索引→检索→注入的完整管道 ，再用一个独立的反射循环来维护记忆质量。（有点openclaw 记忆的意思）
[图片]
细分看：
1、文件系统
[图片]
2、SQLite+FTS5全文索引
这是区别于简单文件读取的分水岭，代码.index.sqlite里有一个完整的RAG流程：
[图片]
从数据库里拉出来的实际数据：
[图片]
这个有个点， Trigram分词器选型，没有用porter/unicode61/simple，选了trigram 。原因是trigram对中文天然友好。"上下文管理"会被切成"上下/下文/文管/管理"，不需要额外分词器。 同时英文也能正常工作 。
[图片]
此外，files表里只存hash+mtime，不做内容存储。chunks表存的是分块文本，但理论上可以从Markdown文件完整重建。 这意味着一件事。即使.index.sqlite损坏，删除后重新索引即可恢复，不会丢记忆 。
3、检索注入
会话启动时不预载所有文件，而是JIT热加载 ：根据当前会话主题构造FTS5查询->检索chunks_fts得到相关chunks->按.memory_meta.json中的importance排序（c ritical>normal ）->在Project层40Ktoken预算内注入；
[图片]
这里细分2点：
一个是FTS5检索是怎么做的 ？searchKeyword()在main.js中。 双路搜索 ：先用FTS5MATCH+BM25排名（候选量=maxResults×4=24个）， FTS5失败时fallback到LIKE'%term%'，两边结果去重合并 ，按BM25分数排序，取top-6，最低分0.1。全文片段截700字符。总结起来就是， FTS5双路搜索（MATCH+BM25/LIKE回退）→去重合并→top-6排序→片段提取→格式化注入 。
一个是重要性的说法，重要性分成三级：
[图片]
critical（规则、强偏好）→normal（日常信息）→low（临时、一次性结果） 。驱逐也就是删除）从low开始逐级往上，critical只在极端情况（占用≥99%）才会动，这是个很好的设计。
[图片]
4、反思进化
这是最独特的一层，为了及时生效。修改前把MEMORY.md变成.MEMORY.md.reflection-bak，如下：
[图片]
这个§分隔符说明： Agent在反思时读取了USER.md，发现之前的表述需要修正 ，于是追加了一段更新，旧版被备份到reflection-bak。
[图片]
反思的完整循环就变成： 每日日志累积→24h后蒸馏到MEMORY.md→Agent定期反思MEMORY.md和USER.md→备份旧版→更新→hash变化触发重索引→下次会话生效 。
但是问题来了，如何触发，触发这块存在逻辑如下，几个条件：
[图片]
但是，为了防止反射崩溃，还是追加了一些设置，例如： 修改前自动备份.reflection-bak、回滚前做并发冲突检测 （当前文件有新条目不在备份中→放弃回滚）； token保留率验证 （低于65%说明反射模型大规模删除了内容→放弃）； 被驱逐条目不直接删除 ，写入.memory_evicted.log永久留存； maintenancemode="manual"时整个反射引擎静默。
最后，可以看下 QoderWork记忆系统中 的常数与配置，如下：
[图片]
事实上，对比来看，这个 意识系统与WorkBuddy的memory系统在设计理念上高度一致 。两者都采用 注入文件+哈希追踪+分层记忆 的模式。
但是WorkBuddy目前的记忆系统是分层存储+大模型直读。CloudMemory（服务端自动注入）、User-levelMEMORY.md、WorkspaceMEMORY.md、Dailylogs。 没有FTS5索引层，也没有自动反射蒸馏。质量依赖Agent在每个session里的自主判断 。QoderWork的.index.sqlite和.memory_meta.json提供了更精细的记忆条目管理。
二、QoderWork架构上的几个有意思的点
来看下几个分析发现，关于 会话管理、Skill、输入输出的分离管理、Shell快照 等。
1、会话管理
QoderWork对会话状态的存储采用了 三重冗余策略：加密+压缩+流式的三层存储 。会话状态同时存三份：JSONL流式追加（防崩溃）、compression-v2压缩快照（快速恢复）、AES-GCM加密（防泄漏），每一层解决不同的问题。
[图片]
JSONL保证即使崩溃也能从最后一行恢复；压缩层提供快速加载的性能优化；加密层确保即使云同步或磁盘被盗，数据不可读 。
项目的目录名编码了两个关键信息：用户home路径和workspace路径。例如-Users-liuhuanyong--qoderworkcn-workspace-mrahhyknmz2w5xtk表示h ome=/Users/liuhuanyong，workspace=mrahhyknmz2w5xtk 。这种编码方式意味着同一个用户在同一个workspace下的所有会话共享同一个项目目录，实现了路径驱动的会话隔离。
projects/{home}--{workspace}/  的目录命名不是简单的base64，而是结构化的路径编码。它 使得同一用户在同一workspace下的所有会话自动聚合，不同用户的会话天然隔离。如果有团队版，只需要在路径中插入team_id即可实现多租户 。
2、Skill技能系统
每个技能不只是SKILL.md， 还包含.skill-metadata.yaml文件，预定义了多个示例任务 。每个示例包含中英文双语标题、描述和完整prompt模板。
以docx技能为例，它定义了5个示例任务：
md-to-docx ：Markdown转Word，自动CJK排版、 fill-template ：用结构化数据填充{{token}}模板、 extract-content ：从docx提取结构化内容（文本/标题/表格/图片）、 ooxml-patch ：底层OOXMLXML修补（修订标记、批注）、 convert-to-pdf ：通过LibreOfficeheadless转PDF，每个示例任务的prompt使用{{变量名}}占位符，Agent执行时填充实际值。这本质上是 一个Prompt模板引擎。用户不需要写任何prompt，选择示例+填入参数即可 。
此外，10个内置技能：c reate-skill,docx,find-skills,install-skill-dependency,pdf,plugin-creator,pptx,qoderwork-guidance,vm-error-recovery,xlsx
这种 **.skill-metadata.yaml的示例任务设计是QoderWork技能系统区别于ClaudeCode的关键创新 **，ClaudeCode的SKILL.md只是指令文本，而QoderWork增加了参数化示例。
3、输入输出的分离管理
QoderWork对文件做了清晰的职责分区：
[图片]
特别值得注意的是tool-outputs/的session级别隔离。 它确保不同会话的工具调用不会互相污染，同时也让Agent可以在同一次会话的不同toolcall之间共享中间结果 。
4、Shell快照
Shell快照是 Agent-Shell一致性的根基 。绝大多数AICoding工具在Shell命令执行时面临 Agent环境与用户环境不一致 的问题（PATH不同、alias不生效、conda环境不对）。Q oderWork通过在每次会话启动时抓取完整zsh环境快照，从根源上解决了这个问题 。
具体的，shell-snapshots/里存的不是简单env，是完整的zsh函数定义+alias+conda环境，例如：s hell-snapshots/snapshot-zsh-{timestamp}-{random}.sh捕获了Agent启动时刻的完整zsh环境，包括所有alias、function定义、环境变量（包括conda配置 ）。这里的设计目的是Agent在执行Shell命令时需要精确知道用户的环境（PATH、alias、conda环境等）。 快照机制确保Agent的Shell行为与用户在终端的行为一致，避免Agent找不到命令，Agent的python路径不对等常见问题 。
