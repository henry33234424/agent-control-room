# Control Room 多 Agent 协作台 - 产品与技术实现文档

- 版本：v1.0
- 日期：2026-03-24
- 适用对象：前端、后端、集成工程师、测试工程师

## 文档目标

本文档用于交付程序员直接实施一个本地优先的“多 Agent 协作控制室（Control Room）”网页系统。系统核心目标是：让用户在一个页面中同时调度 Claude 与 Codex，查看各自运行过程，手动选择上下文转交给另一方，并在后续阶段支持自动 review 与 MCP 扩展。

本文档不是概念介绍，而是工程规格说明。默认读者为前端、后端、集成工程师与测试工程师。除非文中另有说明，以下内容均按“应实现”为准。

## 项目背景与最终目标

当前用户在 vibe coding 时，会同时使用 Claude 与 Codex。典型工作流包括：讨论方案、定位 bug、实现功能、互相 review。现状问题是需要在两个终端之间手动复制粘贴内容，导致上下文切换成本高、信息容易丢失、协作节奏断裂。

本项目的最终目标不是“让两个模型共享同一份原始 token 上下文”，而是提供一个统一控制室，让用户在同一界面中：

- 在聊天区 @Claude 或 @Codex 发起任务。
- 在运行区实时观察 agent 的执行过程、命令输出、工具调用、测试结果与等待审批状态。
- 在聊天区勾选若干消息，将其作为上下文转交给另一 agent。
- 把用户拍板后的结论固定为共享事实（Pinned Brief），供后续交接与自动化使用。
- 在后续版本中支持“Claude 写完后自动触发 Codex review”等自动化工作流。

系统的定位是“agent orchestration console（代理编排控制台）”，而不是普通 IM 聊天室。

## 核心产品决策（本项目必须遵守）

- MVP 不以 MCP 为前置依赖。MVP 先采用“Claude Agent SDK + Codex app-server + 自研 room backend”的直接接入模式。
- Claude 与 Codex 不共享原始会话，而是各自维持独立 session / thread / worktree。
- 用户在聊天区勾选消息后，后端必须生成 handoff bundle（交接包），而不是原样把全部 transcript 生硬转发给另一 agent。
- 运行区 [b] 实现为“终端风格的运行面板（runtime console）”，不是硬要求复刻官方 CLI/TUI 的真实 PTY 画面。只要能连续展示命令、工具、stdout/stderr、状态与审批事件即可。
- Claude 与 Codex 默认运行在不同 worktree，禁止两个 agent 同时直接写同一个工作目录。
- 自动化触发优先由 hooks 或 room backend 实现；MCP 主要在第二阶段承担“共享工具层 / 自动化能力封装”的角色。
- 页面是唯一主控台；用户拥有最终拍板权、审批权与是否合并代码的决定权。

## 范围定义

本期（V1）包含以下范围：

- 单用户、本地优先、单项目（单 repo）控制室。
- Claude 与 Codex 各自独立 session/thread 管理。
- 三栏式界面：[a] Agent/Session 树；[b] Runtime Console；[c] Chat & Handoff。
- 聊天消息勾选、@agent 发送、Pinned Brief、Handoff Bundle、手动切换会话、审批面板。
- Codex detached review 与 Claude 后续 review 流程的手动触发。
- 基础日志、失败重试、会话恢复。

本期不包含：

- 真正把两个供应商的底层 transcript 合并为一个“共享原生上下文池”。
- 远程手机控制、Telegram/Discord 桥接。
- 多人协作、权限管理、团队审计后台。
- 云端多租户 SaaS。
- 复杂 CI/CD 编排与 GitHub PR 自动回写（可在后续阶段扩展）。

## 推荐技术选型

为降低集成复杂度，推荐采用全 TypeScript 技术栈：

- 前端：Next.js + React + TypeScript + Tailwind CSS + Zustand（或 Jotai） + React Query。
- 运行面板：[b] 使用 xterm.js，渲染为终端风格；实际数据源来自统一的 runtime events 流。
- 后端：Node.js + TypeScript + Fastify（或 NestJS） + WebSocket。
- 数据库：V1 默认 SQLite（单用户本地部署）；数据访问层使用 Prisma，保留切换到 Postgres 的能力。
- Claude 接入：Claude Agent SDK（TypeScript 版本）。
- Codex 接入：Codex app-server（先走 stdio；WebSocket 作为可选增强）。
- 队列：V1 可以先用进程内 job queue；若自动 review / 长任务较多，再切 BullMQ。
- Git 隔离：git worktree + 简单命名规范。

若团队已有 Python 基础设施，也可将 Claude adapter 独立成 Python sidecar，但不建议在 MVP 阶段采用多语言微服务，以免显著增加复杂度。

## 系统总览

系统由四层组成：UI 层、Room Orchestrator 层、Agent Adapter 层、持久化与工作区层。

1）UI 层：提供三栏式界面与 WebSocket 实时事件订阅。

2）Room Orchestrator：负责消息路由、handoff bundle 生成、会话映射、审批状态机、Pinned Brief、自动化规则触发。

3）Agent Adapter：分别封装 Claude 与 Codex 的底层能力，把供应商差异统一抽象为同一种事件与消息协议。

4）持久化与工作区：保存 room、messages、sessions、bundles、runtime events、approvals、artifacts、worktrees 等数据，并通过 git worktree 管理代码隔离。

## 界面与交互规格

页面采用三栏布局：

- 左侧边栏 [a]：Agent / Session Tree。
- 中间主体栏 [b]：Runtime Console。
- 右侧主体栏 [c]：Chat / Handoff / Shared Brief。

左侧边栏 [a] 不是只有两个大按钮，而是树形结构：

- Claude
-   ├─ auth-bug-plan
-   ├─ auth-bug-review
-   └─ ui-refactor
- Codex
-   ├─ auth-bug-impl
-   ├─ auth-bug-review
-   └─ perf-check

每个 session 节点需显示：名称、状态（idle/running/waiting approval/failed/completed）、关联分支/工作树、最近更新时间。

中间 [b] Runtime Console 要点：

- 按当前选中的 session 展示运行流。
- 内容包括：状态行、工具调用、命令输出、stdout/stderr、结构化事件、审批请求、测试结果、diff ready 通知。
- 支持滚动、关键字搜索、仅看错误、仅看命令、仅看审批等过滤器。
- 支持切换到“原始事件视图”用于调试。

右侧 [c] Chat 要点：

- 支持 @Claude / @Codex / @both。
- 每条消息左侧有复选框，可选中后作为 handoff source。
- 支持“发送给另一个 agent”“设为共享事实”“复制为摘要”“附带当前 diff/文件”操作。
- 消息类型分为：user、claude、codex、system、review、approval、handoff-summary。
- 支持 pinned 区块，展示当前项目的目标、约束、已拍板决策、未决问题。

## 用户核心流程

流程 A：手动向 Claude 发起任务

- 用户在 [c] 输入：@Claude 看一下 auth 登录偶发 401，先定位原因，不要改代码。
- Room Backend 根据当前 room 与 Claude session，决定 start / resume。
- Claude adapter 启动执行，事件流进入 [b]。
- Claude 的阶段性结论转为聊天消息回到 [c]。

流程 B：把与 Claude 的交流交给 Codex 落地

- 用户在 [c] 勾选若干消息。
- 点击“发送给 Codex”，并填写附加说明：请直接给 patch + tests。
- 后端生成 handoff bundle：原始选中消息 + 自动摘要 + pinned brief 快照 + repo 快照 + 用户附加任务。
- Codex adapter 在独立 thread/worktree 中执行。
- 运行过程展示在 [b]，总结消息返回 [c]。

流程 C：Codex 完成后交给 Claude review

- 用户勾选 Codex 的结果消息与 review 请求。
- 发送给 Claude：请 review 这个 patch，关注副作用与边界条件。
- Claude 在自己的 session 中分析，必要时再提出下一轮修改建议。

流程 D：自动 review（后续阶段）

- 当 Claude 完成写代码并满足自动化规则时，系统自动创建 Codex review 任务。
- Codex 在 detached review thread 中输出审查意见。
- 审查结果自动回流为聊天消息，并可附到同一工作流下。

## MVP 架构选择与理由

本项目的 MVP 架构固定如下：

- Claude：使用 Claude Agent SDK，而不是直接桥接正在运行的 Claude Code CLI。
- Codex：使用 Codex app-server，而不是直接驱动 Codex CLI TUI。
- MCP：本期不作为必需接入层。

理由：

- Claude Agent SDK 直接提供 tools、agent loop、sessions、hooks、permissions，便于程序化集成。
- Codex app-server 原生支持 thread/start、thread/resume、thread/list、approvals、review/start、streamed events，适合深度嵌入自家客户端。
- MCP 更适合在第二阶段统一共享工具层（例如 shared brief、任务板、文档检索、review tool 封装）。

结论：程序员在 MVP 阶段无需先搭 MCP，也无需桥接官方 CLI 的终端 UI；先把 room backend 跑通最重要。

## 目录结构建议

建议 monorepo：

```text
apps/
  web/                    # Next.js 前端
  server/                 # Room backend + adapters
packages/
  shared-types/           # 前后端共享 DTO / event types
  ui-components/          # 可复用 UI 组件
  git-worktree/           # worktree 管理库
  handoff/                # handoff bundle 生成逻辑
  runtime-events/         # 事件归一化与 schema
prisma/
  schema.prisma
data/
  room.db                 # SQLite 默认路径
worktrees/
  claude/
  codex/
```

若团队更偏好分仓，也至少要保证 shared types 与 runtime event schema 有单一事实源。

## 核心模块设计

1. Web Frontend

- 三栏布局、消息输入、勾选上下文、Pinned Brief、会话切换、审批弹窗、runtime console、失败重试。

2. Room API / Orchestrator

- 管理 room 生命周期。
- 负责 REST / WebSocket API。
- 协调人类消息、agent 消息、runtime events、approvals。
- 维护 session/thread/worktree 映射。
- 生成 handoff bundle。
- 触发自动 review 规则。

3. Claude Adapter

- 封装 Claude Agent SDK。
- 维护 Claude sessionId。
- 把 hooks、permissions、tool events 转成统一 runtime events。
- 处理 canUseTool 与审批。

4. Codex Adapter

- 启动并维护 codex app-server 子进程。
- 实现 initialize、thread/start、thread/resume、thread/list、turn/start、review/start 等调用。
- 消费 JSON-RPC 通知并映射成统一 runtime events。
- 处理 app-server server-initiated approval requests。

5. Worktree Manager

- 为每个 agent session 分配独立 worktree。
- 负责 create / attach / cleanup / branch 命名。
- 限制多个写会话不能共享同一个 worktree。

6. Handoff Service

- 把用户勾选的消息整理为结构化交接包。
- 补充 pinned brief、repo 快照、文件引用、diff 摘要。
- 执行大小裁剪与摘要。

7. Review Automation Service

- 监听 Claude/Codex 完成事件。
- 根据规则自动触发 Codex detached review 或 Claude 再审查。

8. Persistence Layer

- Prisma + SQLite。
- 保存 room、message、event、bundle、approval、artifact、session。

## 统一事件模型（前后端必须共用）

供应商事件必须先归一化，再推给前端。前端绝不直接渲染 Claude SDK 原始对象或 Codex app-server 原始 JSON-RPC 结构。

推荐事件类型：

```text
type RuntimeEventKind =
  | 'run.status'
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'command.stdout'
  | 'command.stderr'
  | 'message.delta'
  | 'message.final'
  | 'approval.requested'
  | 'approval.resolved'
  | 'review.started'
  | 'review.completed'
  | 'diff.ready'
  | 'artifact.created'
  | 'system.log'
```

统一事件对象：

```text
interface RuntimeEvent {
  id: string;
  roomId: string;
  agent: 'claude' | 'codex';
  sessionId: string;
  runId: string;
  worktreeId?: string;
  kind: RuntimeEventKind;
  title?: string;
  text?: string;
  payload?: Record<string, unknown>;
  level?: 'debug' | 'info' | 'warn' | 'error';
  ts: string;
}
```

说明：

- runId 表示一次用户触发或自动化触发的运行实例。
- sessionId 表示 agent 的长期会话。
- 一个 session 内可以有多次 run。
- 前端 [b] 默认按 runId 聚合展示。

## 聊天消息与交接包模型

聊天消息对象：

```text
interface ChatMessage {
  id: string;
  roomId: string;
  sessionId?: string;
  agent?: 'claude' | 'codex';
  role: 'user' | 'agent' | 'system' | 'review' | 'approval' | 'handoff-summary';
  mentionTarget?: 'claude' | 'codex' | 'both';
  replyToMessageId?: string;
  content: string;
  contentFormat: 'markdown' | 'plain';
  selectable: boolean;
  pinned: boolean;
  createdAt: string;
}
```

交接包对象：

```text
interface HandoffBundle {
  id: string;
  roomId: string;
  sourceAgent?: 'claude' | 'codex';
  targetAgent: 'claude' | 'codex';
  selectedMessageIds: string[];
  rawExcerpt: string;
  structuredSummary: {
    goal: string;
    decisions: string[];
    constraints: string[];
    openQuestions: string[];
    files: string[];
    diffs: string[];
    nextTask: string;
  };
  pinnedBriefSnapshot: string;
  repoSnapshot: {
    repoPath: string;
    branch: string;
    commit: string;
    worktreePath?: string;
    changedFiles: string[];
  };
  userInstruction: string;
  createdAt: string;
}
```

关键规则：

- 交接包必须保留“选中原文摘录 + 自动摘要 + 用户显式任务”。
- 自动摘要不是替代原文，而是压缩入口。
- 交给另一 agent 时，应优先把 structuredSummary 与 pinnedBrief 放到 prompt 前部，把 rawExcerpt 放在后部作为引用。

## 共享事实（Pinned Brief）设计

Pinned Brief 不是聊天历史，而是经过用户确认的共享事实层。它是两个 agent 的共同约束来源。

Pinned Brief 建议分成 5 个分区：

- 项目目标（Goal）
- 硬约束（Constraints）
- 已拍板决策（Decisions）
- 当前未决问题（Open Questions）
- 禁止触碰 / 高风险区域（Do Not Touch）

Pinned Brief 需要版本化，每次修改都保留快照。生成 handoff bundle 时必须带上当前快照。

前端操作：

- 消息操作菜单中提供“设为共享事实”。
- Pinned 面板可手动编辑、删除、调整顺序。
- 每次 run 开始前，后端将最新 pinned brief 注入给目标 agent。

## 会话、线程与工作树策略

基本原则：session / thread 与 worktree 解耦但强关联。

- Claude session 由 Claude Agent SDK 管理。
- Codex thread 由 app-server 管理。
- 系统数据库中统一抽象为 AgentSession。
- 每个“可写” session 默认绑定一个独立 worktree。

命名规范建议：

- room：repo-auth-service
- claude session：claude-auth-bug-plan
- codex session：codex-auth-bug-impl
- worktree path：worktrees/codex/auth-bug-impl
- branch：agent/codex/auth-bug-impl

约束：

- 只读分析会话可共用 repo 根目录或只读 worktree。
- 写操作会话必须独立 worktree。
- 同一时刻不允许两个可写 run 指向同一个 worktree。
- 用户可手动把某个 session 标记为“只读分析”。

## Claude Adapter 设计要求

Claude adapter 使用 Claude Agent SDK（TypeScript）。程序员需实现以下能力：

- 创建/恢复 Claude session。
- 注入 working directory、allowed tools、permission mode、hooks、canUseTool。
- 把 Claude 的文本流与工具事件转为统一 RuntimeEvent。
- 在收到用户新消息时能继续同一 session。
- 在必要时创建新 session。

建议的工具权限策略：

- 默认 permission mode 使用 acceptEdits 或 default，视团队风险接受度决定。
- Read / Glob / Grep 可预批准。
- Write / Edit / Bash 走审批回调或 UI 审批。
- 高风险命令通过 PreToolUse hook 阻断。

建议 hooks：

- UserPromptSubmit：追加 room brief / trace id / run metadata。
- PreToolUse：阻断危险命令、补充审计信息。
- PostToolUse：记录文件改动、测试结果、可选触发自动化。
- Stop：当一次主响应完成时通知 room backend 进行 run 收尾。
- SubagentStop：若后续使用 subagents，可汇总子任务结果。

注意：Claude 的审批与 AskUserQuestion 均会进入 canUseTool / user-input 流程，因此 UI 必须具备“等待用户输入”的通道。

## Codex Adapter 设计要求

Codex adapter 通过 codex app-server 与 Codex 通信。推荐第一版使用 stdio transport。

Codex adapter 必须实现：

- 启动 app-server 子进程并完成 initialize / initialized 握手。
- 创建 thread、恢复 thread、读取 thread、列出 thread。
- 发起 run（可映射为 turn/start 或等价操作）、接收 streamed notifications。
- 处理 app-server 发起的 approval request。
- 支持 detached review。
- 在进程异常退出时自动重连，并尽量恢复 thread 状态。

前端不直接理解 JSON-RPC，只接收统一事件。

Codex review 设计要求：

- 支持 review target: uncommittedChanges / baseBranch / commit / custom。
- 支持 detached 模式，review 结果作为独立 review run 回流。
- 支持把 review 结果落为聊天消息，并关联到原始 run。

## 运行区 [b] 的渲染规范

[b] 虽然呈现为终端风格，但其本质是结构化事件流视图。程序员需要把不同事件渲染成不同视觉层级：

- 状态类：浅色状态条，例如 RUNNING / WAITING APPROVAL / COMPLETED。
- 命令类：以 `$` 前缀显示，如同 shell。
- stdout：常规浅色文本。
- stderr：错误色文本。
- 工具调用：可折叠块，显示 tool name、输入摘要、耗时。
- 审批请求：高亮卡片，可直接批准/拒绝。
- diff ready：显示 changed files 数与打开 diff 的按钮。

运行区至少提供以下切换：

- 全部事件
- 仅命令
- 仅错误
- 仅审批
- 仅工具
- 原始 JSON（调试）

用户切换左侧 session 时，[b] 需同步切换到对应 session 的最新 run；也允许在 [b] 顶部切换历史 run。

## 前端 API 设计（建议）

HTTP 接口：

```text
POST /api/rooms
POST /api/rooms/:roomId/messages
POST /api/rooms/:roomId/handoffs
POST /api/rooms/:roomId/pins
POST /api/rooms/:roomId/sessions
POST /api/rooms/:roomId/reviews
POST /api/approvals/:approvalId/decide
GET  /api/rooms/:roomId
GET  /api/rooms/:roomId/messages
GET  /api/rooms/:roomId/sessions
GET  /api/rooms/:roomId/runs/:runId/events
```

WebSocket 事件：

client -> server
  room.subscribe
  room.unsubscribe
  run.interrupt
  run.followup
  approval.decide

server -> client
  room.snapshot
  message.created
  message.updated
  runtime.event
  approval.requested
  approval.resolved
  run.status
  pin.updated
  handoff.created


建议前端页面加载后先拉 snapshot，再订阅 websocket 增量事件。

## 后端命令与服务接口（建议）

后端内部服务接口可按下列方式抽象：

```text
interface AgentDriver {
  agent: 'claude' | 'codex';
  startSession(input: StartSessionInput): Promise<AgentSession>;
  resumeSession(input: ResumeSessionInput): Promise<AgentSession>;
  run(input: RunInput): Promise<RunHandle>;
  review?(input: ReviewInput): Promise<RunHandle>;
  interrupt(runId: string): Promise<void>;
}
```

```text
interface HandoffService {
  createBundle(input: {
    roomId: string;
    targetAgent: 'claude' | 'codex';
    selectedMessageIds: string[];
    userInstruction: string;
  }): Promise<HandoffBundle>;
}
```

```text
interface WorktreeManager {
  ensureWorktree(input: {
    roomId: string;
    agent: 'claude' | 'codex';
    sessionKey: string;
    mode: 'readOnly' | 'readWrite';
  }): Promise<WorktreeInfo>;
}
```

后端必须坚持一个原则：vendor-specific 逻辑封装在 adapter 内，room orchestration 层只处理统一抽象。

## 数据库设计（建议表）

建议核心表：

- rooms
- agent_sessions
- runs
- worktrees
- chat_messages
- runtime_events
- handoff_bundles
- handoff_bundle_message_links
- pinned_brief_items
- approvals
- artifacts

关键字段建议：

```text
rooms
- id
- name
- repo_path
- default_branch
- created_at

agent_sessions
- id
- room_id
- agent
- vendor_session_id        # Claude sessionId 或 Codex threadId
- name
- mode                     # readOnly/readWrite
- status
- worktree_id nullable
- metadata_json
- updated_at

runs
- id
- room_id
- agent_session_id
- trigger_type             # user/handoff/automation/review
- parent_run_id nullable
- status
- prompt_snapshot
- started_at
- ended_at

approvals
- id
- room_id
- run_id
- agent
- approval_type            # tool/fileChange/network/askUserQuestion
- title
- payload_json
- status                   # pending/approved/denied/cancelled
- created_at
- resolved_at
```

runtime_events 表应允许高频写入，必要时单独做清理策略。V1 可保留最近 30 天事件。

## Handoff Bundle 生成算法

程序员必须按“压缩 + 保真”原则实现交接包。建议流程：

- 读取用户选中的消息，按时间顺序拼接。
- 过滤无意义系统噪音（例如连续心跳、重复状态）。
- 截断超长代码块与超长日志，只保留前后文与文件引用。
- 补充 room 当前 pinned brief。
- 补充 repo 快照：当前 branch、commit、changed files、可选 diff 摘要。
- 调用内部 summarizer（可先复用 Claude 或 Codex 中任一轻量调用，后续可替换）生成结构化摘要。
- 生成最终 bundle 并持久化。

建议摘要模板：

```text
请将以下交接材料压缩为结构化摘要，字段必须包含：
1. 当前目标
2. 已确认结论
3. 关键约束
4. 尚未解决的问题
5. 涉及文件
6. 当前最合适的下一步动作
摘要必须站在“交给另一工程代理执行”的角度写。
```

大小限制建议：

- 最多 20 条消息。
- 原文摘录上限 20,000 字符。
- 摘要上限 1,200 字符。
- diff 摘要上限 8,000 字符。
- 超限时优先裁剪日志和长代码块，不裁剪用户最终拍板的结论。

## Prompt 组装策略

向 agent 发起一次 run 时，最终 prompt 由四层组成：

- Layer 1: System/Driver Prompt（固定）
- Layer 2: Room Brief（Pinned Brief 快照）
- Layer 3: 本次任务输入（用户消息或 Handoff Bundle）
- Layer 4: Repo Context（branch、worktree path、文件引用、diff 摘要）

建议顺序：

```text
[System]
你正在 Control Room 中工作。你的输出既要帮助用户，也要便于另一 agent 接手。

[Shared Brief]
- 目标:
- 约束:
- 已拍板结论:
- 未决问题:

[This Task]
- 触发方式: user / handoff / review / automation
- 来源: ...
- 目标动作: ...

[Selected Transcript / Handoff Summary]
...

[Repo Snapshot]
...
```

注意：Pinned Brief 与本次明确任务必须始终排在前面；原始选中 transcript 放后面，避免上下文被历史噪音主导。

## 审批与用户输入流

审批必须统一从 UI 走，不能只在命令行侧等待。

审批类型至少包括：

- Claude tool approval
- Claude AskUserQuestion
- Codex command approval
- Codex file change approval
- Codex network approval
- 后续 MCP tool approval

审批对象应包含：

- 审批标题
- 来源 agent
- 工具/命令名
- 参数摘要
- 风险级别
- 建议操作（允许/拒绝）
- 是否允许‘总是允许此类操作’

设计要求：

- 审批出现时，在 [b] 与 [c] 同时提示。
- 用户可批准、拒绝、取消。
- 批准后将结果回传给对应 adapter。
- 审批超时后 run 可转为 waitingUser 或 failed，不能无限挂起。

## 自动化与 MCP 路线图

V1：不依赖 MCP。用户手动 @agent 与手动 handoff。

V1.1：自动 review。

- Claude 完成 Stop 事件后，若本轮 run 发生写文件且用户已开启“自动 review”，Room Backend 自动触发 Codex detached review。
- Codex review 完成后自动在聊天区写入 review 摘要消息。

V2：引入 room-mcp-server。

- 把 shared brief、task board、review trigger、artifact search、repo facts 等能力封装成统一 MCP tools。
- Claude 与 Codex 以后都只通过这些 room-level tools 访问共享信息。
- 这样可以避免两个供应商直接互相耦合。

V2.1：可选桥接 Claude Channels。

- 仅在确有需要时把外部消息推入现成 Claude Code 会话。
- 由于 channels 仍是 research preview 且依赖 claude.ai 登录，不作为 MVP 路径。

## 安全、权限与隔离要求

1. 本地优先。所有供应商密钥和登录态仅保留在后端或本机环境，不得暴露到前端。

2. Worktree 隔离。可写 agent session 必须独立 worktree。

3. 目录白名单。agent 仅可在 room.repo_path 及其 worktrees 下活动。

4. 最小权限。默认只自动放行低风险读取操作；写文件、执行命令、网络访问走审批。

5. 日志脱敏。Runtime events 中如出现 token、cookie、Authorization header、私钥片段，必须做脱敏。

6. 输出边界。若后续接入外部聊天渠道，必须默认关闭敏感输出，避免把本地代码或凭据发出。

7. 清理策略。支持删除 session、删除 handoff bundle、清理旧 worktree、清理旧日志。

## 状态机

Run 状态机：

```text
queued -> preparing -> running -> waitingApproval -> running
running -> waitingUserInput -> running
running -> summarizing -> completed
running -> failed
running -> cancelled
waitingApproval -> failed (timeout)
```

Session 状态：

- idle
- running
- waitingApproval
- failed
- archived

前端显示原则：

- 左侧 [a] 显示 session 状态。
- 中间 [b] 显示 run 状态。
- 右侧 [c] 显示人类可读消息结果。

## 错误处理与恢复策略

1. 页面刷新后恢复

- 重新拉取 room snapshot。
- 恢复左侧 session tree。
- 前端重新订阅 websocket。
- 若有 running run，自动回放最近 N 条 runtime events。

2. Adapter 崩溃

- Codex app-server 崩溃时，后端尝试重启；若 thread 可恢复，则重新 attach。
- Claude adapter 失联时，标记 run failed，并允许用户点击“重试到新 session”或“继续原 session”。

3. 交接包失败

- 若摘要失败，可退化为“原文摘录 + pinned brief + 用户指令”的简化包。
- 绝不因为摘要失败就阻断 handoff。

4. 审批超时

- 默认 10 分钟超时。
- 超时后 run 标记 waitingUserTimeout 或 failed，并在聊天区生成系统消息。

5. 上下文过大

- 先裁剪日志与长代码块，再缩短原文摘录，最后保留结构化摘要与用户显式任务。

## 实现里程碑

Milestone 1 - 跑通最小链路（必须先完成）

- 创建 room，绑定 repo_path。
- 创建 Claude session 与 Codex session。
- 右侧 @Claude / @Codex 发送消息。
- 中间 runtime console 能看到结构化事件。
- 左侧能切换 session。

Milestone 2 - 聊天勾选与交接

- 聊天消息支持复选框。
- 生成 handoff bundle。
- 把 bundle 交给另一 agent。
- Pinned Brief 可编辑。

Milestone 3 - 审批与工作树隔离

- Claude / Codex 审批回流 UI。
- 独立 worktree 创建与绑定。
- 可写 session 不共享 worktree。

Milestone 4 - review 与可用性增强

- Codex detached review。
- run 历史、错误恢复、日志过滤。
- 支持“发送给另一 agent 并附加当前 diff/变更文件”。

Milestone 5 - 自动化与 MCP（后续）

- Claude 完成后自动触发 Codex review。
- room-mcp-server。
- 更多共享工具与知识层。

## 前端开发任务拆分

- 完成三栏式布局与响应式最小适配。
- 完成左侧 session tree 与状态标签。
- 完成右侧 chat timeline、复选框、多类型消息卡片。
- 完成 @mention 输入体验。
- 完成 pinned brief 面板。
- 完成中间 runtime console（xterm.js）。
- 完成审批弹窗与审批流。
- 完成 run 历史查看与过滤器。
- 完成错误态、空态、加载态。

## 后端开发任务拆分

- 完成 Prisma schema、迁移与 SQLite 初始化。
- 完成 room CRUD、message CRUD、session CRUD。
- 完成 WebSocket 实时事件通道。
- 完成 Claude adapter。
- 完成 Codex adapter。
- 完成 worktree manager。
- 完成 handoff service。
- 完成 approval service。
- 完成 review service。
- 完成日志与恢复策略。

## 测试与验收标准

必须通过以下验收场景：

- 场景 1：用户 @Claude 提问，Claude 的运行过程出现在 [b]，总结出现在 [c]。
- 场景 2：用户勾选 3-5 条消息交给 Codex，Codex 在独立 session/worktree 中工作并返回结果。
- 场景 3：Codex 结果再交给 Claude review，Claude 能看到 handoff 结构化摘要与必要原文。
- 场景 4：写文件或 Bash 操作触发审批，UI 可批准/拒绝，run 状态正确流转。
- 场景 5：页面刷新后，会话列表、聊天记录、最近 run 恢复成功。
- 场景 6：同一 room 下同时启动 Claude 只读分析 + Codex 写代码，互不冲突。
- 场景 7：Codex detached review 结果能作为 review 类型消息回流。
- 场景 8：Claude / Codex 任一适配器异常退出后，系统不会整体崩溃，且可手动恢复。

质量门槛：

- 前端关键操作无明显阻塞。
- 运行事件乱序率可接受，必要时以前端按 ts 排序。
- 同一 run 的 message.final 不能重复写入多次。
- 不存在两个写会话同时写同一路径的默认流程。

## 非功能要求

- 单机本地运行可用。
- 默认支持至少 1 个 room、2 个 agent session、10,000 条消息、100,000 条 runtime events。
- 前端事件刷新目标：100-300ms 级别。
- 后端必须具备可观测日志，并带 roomId / sessionId / runId / agent。
- 所有核心表有 created_at / updated_at。
- 所有跨层 DTO 都有严格 TypeScript 类型定义。

## 可选增强项（不阻塞 MVP）

- 消息标签：plan / code / review / decision / bug / test。
- diff 预览面板。
- 文件树与 changed files 面板。
- 一键从聊天消息创建 TODO / 任务卡。
- 自动把已拍板结论写入 DECISIONS.md。
- 自动生成 handoff 摘要的可编辑预览。
- 批量清理旧 worktree。
- 多 room 支持。

## 给程序员的最终落地原则

1. 不要从“两个供应商怎么共享 transcript”开始做；先从“Room Backend 如何编排两个独立 agent”开始做。

2. 不要执着于真实终端 PTY；[b] 先实现成统一事件控制台即可。

3. Handoff Bundle 是核心，不是附属功能。没有它，这个产品就会退化回手动复制粘贴。

4. 独立 worktree 是安全底线。没有它，多 agent 会频繁互踩。

5. MVP 不需要 MCP；把自动化、共享工具层留到第二阶段。

6. 用户始终是 orchestrator。任何自动化都必须可见、可控、可关闭。

## 参考资料（官方）

检索时间：2026-03-24。程序实现前请再次以官方文档为准，尤其是版本、参数名与实验性能力。

1. OpenAI Developers - Codex App Server - https://developers.openai.com/codex/app-server

2. OpenAI Developers - Codex MCP - https://developers.openai.com/codex/mcp

3. OpenAI Developers - Use Codex with the Agents SDK - https://developers.openai.com/codex/guides/agents-sdk/

4. Anthropic Docs - Agent SDK Overview - https://platform.claude.com/docs/en/agent-sdk/overview

5. Anthropic Docs - Work with sessions - https://platform.claude.com/docs/en/agent-sdk/sessions

6. Anthropic Docs - Configure permissions - https://platform.claude.com/docs/en/agent-sdk/permissions

7. Anthropic Docs - Handle approvals and user input - https://platform.claude.com/docs/en/agent-sdk/user-input

8. Anthropic Docs - Hooks - https://platform.claude.com/docs/en/agent-sdk/hooks

9. Claude Code Docs - Hooks reference - https://code.claude.com/docs/en/hooks

10. Claude Code Docs - Channels reference - https://code.claude.com/docs/en/channels-reference
