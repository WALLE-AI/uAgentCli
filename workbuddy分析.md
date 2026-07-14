一、workbuddy的六层架构及安全控制
采用分层架构设计，从用户交互到安全治理共六层。每一层解决一个核心矛盾，层层递进。具体的：用户界面→Agent推理→工具执行→扩展系统→记忆系统→安全治理。
[图片]
其中， 安全控制如下 ：Agent越自主越好（用户不用干预），但自主意味着可能执行危险操作（删除文件、发送消息、花钱）。完全自动化=完全失控，完全手动=失去Agent价值。
[图片]
WorkBuddy的做法是： 沙盒隔离（FileProvider+NetworkExtension）+权限审批（mcp-approvals.json）+Hook评估（promptHookEvaluatorAgent）+个人文件安全策略 。不是"要么自动要么手动"，而是分级信任，读操作自动，写操作审批，危险操作人工确认。这个的本质是用沙盒创造"安全沙箱"，在沙箱内完全自主，跨边界时才需要许可。
这些一同支持 其完整生命周期 ：
[图片]
二、workbuddy的Agent构成及subagent通信**
1、Agent整体架构
16种内置Agent，主从式设计 ，系统数据流运转如下：
[图片]
在系统架构上， WorkBuddy不是单一Agent，而是一个由16种内置角色组成的多Agent系统 。
[图片]
注意，具分配不是随意的，而是根据Agent 角色精确裁剪。每个Agent只拿到完成任务所需的最小工具集。主Agent(cli)拥有33个工具，子Agent各有分工： memorySelector用lite模型做低成本记忆筛选，Explore/Plan作为asTool可被主Agent调用，compact/contextSummary处理上下文溢出 。
[图片]
这种设计也符合原则：
最小权限原则 ，compact/contextSummary/memorySelector拿到0个工具。它们只需要"读入对话→输出摘要"，不需要操作文件系统。如果给它们Bash，就是给一把锤子让它们去拧螺丝；
通信能力分级 ，只有asTool类型的Agent拿到SendMessage，因为它们可能被用于团队协作。内部触发的Agent（compact等）不需要通信，它们是被系统调用的函数。
模型成本匹配 ，不是所有 Agent 都用最贵的模型：lite 模型：memorySelector, Explore, promptHookEvaluator；default 模型：general-purpose, Plan, compact；craft 模型：主 Agent（用户直接交互）。其中：Explore和memorySelector用lite模型，因为它们的工作是"搜索和筛选"，不需要深度推理。Plan和general-purpose用default模型，因为需要规划和执行。里就会涉及到使用的内置模型，如下：
[图片]
2、SubAgent的通信模式
两种通信模式，WorkBuddy 的 SubAgent 交互不是单一机制，而是两套截然不同的通信范式，根据任务复杂度动态切换 。这是整个架构的核心分叉点 。
[图片]
这两种模式的本质区别不是"有没有通信通道"，而是上下文耦合度。 模式A是函数调用语义：输入→执行→输出，调用者不需要知道执行过程。模式B是组织协作语义，多个持久实体通过消息和共享状态协调 。
3）Agent间如何传递信息？
在两种模式之上，WorkBuddy 定义了四条正交的通信通道。每条通道解决不同的信息传递需求，它们可以组合使用。
[图片]
有一点可以讲讲，就是 用 TaskList 而不是消息队列做协调 。
传统的多Agent系统通常用消息队列（如 RabbitMQ、Akka Mailbox）做协调。WorkBuddy 选择了共享黑板+任务依赖图的方案。
[图片]
这积水是经典的黑板架构模式（Blackboard Pattern），多个独立Agent通过共享的状态空间协调，而非直接互发消息。 消息队列假设"Agent之间需要互相调用"，黑板假设"Agent之间需要协调工作但不需要互相调用"。  WorkBuddy的场景是后者，Agent们各自独立工作，只需要知道"谁在做什么"和"什么可以做"。黑板模式天然支持这种松耦合。
三、workbuddy的上下文管理
所有Agent系统的设计都在解决同样的根本矛盾 ，也就是LLM的上下文窗口是有限的（200K-1M Token），但用户的知识、历史对话、项目上下文是无限的，不可能把所有信息都塞进上下文。
而进一步的，上下文管理是 Agent 架构的核心难题。WorkBuddy 采用了三种上下文模式，根据 Agent 角色精确控制信息流动。
[图片]
所以，WorkBuddy的解法是： 三层记忆 （云端画像/用户规则/工作区日志）+ memorySelector预过滤+延迟加载工具schema+compact/contextSummary压缩恢复 ，核心是"精准过滤"而非"扩大窗口"，可以和memo0、openclaw 做个对比：
[图片]
在整个任务执行流程中，主Agent的上下文窗口只接收了三类信息： 用户原始输入+memorySelector筛选后的记忆+AgentNotification（被压缩过的结果） 。
1、上下文隔离
注意：SubAgent的完整推理过程、Explore的搜索细节、Workers之间的SendMessage对话，这些都没有进入主Agent上下文，也就是**SubAgent 的纯文本输出"不可见"**，所以，这里就会涉及到上下文隔离的点。
[图片]
如果SubAgent的中间推理过程直接进入主Agent上下文，会导致： 上下文膨胀 ，每个SubAgent的完整推理链都注入，上下文迅速耗尽； 注意力稀释 ，主Agent被大量无关的中间步骤干扰，降低决策质量； 耦合失控 ，SubAgent的推理风格影响主Agent的判断，产生"回声室效应"。所以是 通过强制SendMessage通信，SubAgent必须主动筛选和压缩要传递的信息。这相当于一个"信息收费站"，只有经过Agent有意识选择的摘要才进入主Agent上下文 。
这种收益是上下文精准、注意力集中、信息密度高。但是SubAgent 可能在摘要时丢失关键细节；如果 SubAgent 不知道 team-lead 需要什么信息，可能遗漏重要内容。
这就是WorkBuddy上下文管理的核心： 不是让所有Agent共享一个大窗口，而是让每个Agent有自己的小窗口，只通过结构化的摘要传递信息 。
2、分层记忆
不存离散记忆条目，而是采用三层结构化记忆，具体的： 云端记忆 （服务器生成用户画像，v40版本）→ 用户级本地记忆 （跨项目规则）→ 工作区记忆 （每日日志+长期笔记）。
[图片]
3、过滤、加载及压缩
lite模型做预筛选（memorySelector、prompt Hook Evaluator、Explore）+asTool子Agent隔离+工具延迟加载（deferLoading）。
信息从产生到被主Agent使用，经过三层压缩：  第一层：memorySelector预筛选记忆（5条上限）；第二层：SubAgent只通过SendMessage/Notification返回摘要；第三层：compactAgent对整个对话做结构化压缩 。每一层都是有损压缩，但保留了"骨架"信息。
其中：
1） memorySelectorAgent在每次查询时预过滤相关记忆，避免上下文膨胀 ，具体是使用lite模型的零工具Agent。
每次用户查询时： 接收用户查询+可用记忆文件列表（文件名+描述）->返回最多5个相关记忆文件名的JSON->只有被选中的记忆才注入到主Agent上下文->已使用的工具参考文档不会被选中（避免冗余） ，整体哲学是：不是"记忆越多越好"，而是"记忆越准越好"。 lite模型做一轮粗筛，主模型只处理筛后的少量记忆 。成本降低，上下文质量提升。这是对ContextRot的预防性应对，不是等上下文腐烂了再压缩，而是从一开始就不让无关内容进入。
这里可以说下： memorySelector为什么用 lite 模型 ？
可以看下其中的prompt:
[图片]
Mmemory Selector使用 models:["lite"] ，这是成本与质量的平衡，这是"用AI管理AI"的典型设计：用廉价模型做预筛选，贵模型只处理精选后的上下文。具体依据是：
任务简单度 ：只需读文件名和描述，判断相关，这是分类任务，不需要深度推理； 调用频率高 ：每次用户查询都触发，如果用大模型成本会指数级上升错误成本低：选多了只是浪费上下文窗口（5条上限），选少了大不了主Agent自己查； 负反馈机制 ：明确指令"如果不确定就不要选"，宁可漏选不可误选。
2） 工具延迟加载（deferLoading） 。对于40+工具、40+MCP连接器、10个内置Skill，能力越丰富越好，但每次调用都消耗Token和算力。全部加载会撑爆上下文，全部用大模型则成本不可控，WorkBuddy通过两步模式按需加载支持延迟加载（deferLoading）。
[图片]
通过 ToolSearch→DeferExecuteTool两步模式按需加载工具schema ，精细管理上下文窗口。
3）上下文压缩 。通过多级压缩触发器在窗口溢出前主动压缩。压缩触发阈值的配置位于 product.json 的 tokenUsageThresholds：
[图片]
然后，核心在于何时激活压缩：
[图片]
以及在实际做的时候，具体使用两个不同的agent执行压缩任务，分别是compact Agent、contextSummary Agent，细节如下：
[图片]
但是，注意，压缩不是简单截断，而是结构化重建。压缩后的上下文包含：
Primary Request and Intent — 用户原始意图（压缩后仍保留）、Key Technical Concepts涉及的技术概念、Files and Code Sections关键文件和代码片段、Errors and fixes遇到的错误和修复方式、Problem Solving已解决和待解决的问题、All user messages所有用户消息（仅 contextSummary 模式）、Pending Tasks未完成的任务、Current Work当前正在进行的工作、Optional Next Step可选的下一步 。
3、 能力扩展
使用三级Skills（ 内置10个+用户级+项目级）+Plugins+40+MCPConnectors+Hooks钩子 。
[图片]
其中，skill这个再啰嗦下：Skill结构:SKILL.md（指令注入）+scripts/（可执行脚本）+references/（参考文档）+assets/（资源文件）。 加载Skill时，SKILL.md内容被注入到Agent上下文中，相当于"临时扩展Agent的专业知识"  。