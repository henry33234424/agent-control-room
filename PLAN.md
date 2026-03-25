# Control Room 实现计划

## Context

用户需要一个本地优先的"多 Agent 协作控制室"网页系统，让用户在一个页面中同时调度 Claude 与 Codex，查看运行过程，手动选择上下文交接，支持审批与 worktree 隔离。项目目录为空，需从零搭建。

产品文档已详细定义了技术选型、数据模型、接口设计、状态机和里程碑。本计划按 Milestone 1-3 详细展开，Milestone 4-5 高层概述。

---

## Phase 0: 项目脚手架

### 0.1 Monorepo 初始化

使用 pnpm workspaces。

```
control_room/
  package.json                    # root, workspaces 配置
  pnpm-workspace.yaml             # packages: ['apps/*', 'packages/*']
  tsconfig.base.json              # 共享 TS 配置，project references
  .gitignore
  .eslintrc.cjs
  .prettierrc
```

### 0.2 packages/shared-types — 前后端共享类型（单一事实源）

所有跨层 DTO 定义。每个其他包都依赖它。

```
packages/shared-types/src/
  index.ts                        # barrel export
  agent.ts                        # AgentKind = 'claude' | 'codex', SessionStatus, RunStatus, SessionMode
  runtime-event.ts                # RuntimeEventKind 联合类型, RuntimeEvent 接口（完全按 spec）
  chat-message.ts                 # ChatMessage, ChatMessageRole, MentionTarget
  handoff.ts                      # HandoffBundle, StructuredSummary, RepoSnapshot
  pinned-brief.ts                 # PinnedBriefItem, PinnedBriefSection (5 个分区)
  approval.ts                     # Approval, ApprovalType, ApprovalStatus, ApprovalDecision
  room.ts                         # Room, RoomSnapshot
  ws-events.ts                    # WebSocket 事件类型（client→server + server→client 判别联合）
  api.ts                          # REST 请求/响应 DTO
  state-machines.ts               # Run/Session 状态转移表（共享验证逻辑）
```

状态机作为 const 对象，前后端共用验证：

```typescript
export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ['preparing'],
  preparing: ['running', 'failed'],
  running: ['waitingApproval', 'waitingUserInput', 'summarizing', 'failed', 'cancelled'],
  waitingApproval: ['running', 'failed'],
  waitingUserInput: ['running', 'failed'],
  summarizing: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};
```

### 0.3 packages/runtime-events — 事件归一化

```
packages/runtime-events/src/
  normalize-claude.ts             # Claude SDK 消息 → RuntimeEvent
  normalize-codex.ts              # Codex JSON-RPC 通知 → RuntimeEvent
  sanitize.ts                     # 脱敏：token/cookie/Authorization/私钥
  format-terminal.ts              # RuntimeEvent → ANSI 彩色文本（供 xterm.js）
```

### 0.4 其他包（Phase 0 创建骨架，后续 Phase 填充实现）

- `packages/git-worktree/` — worktree 管理（Milestone 3 实现）
- `packages/handoff/` — 交接包生成（Milestone 2 实现）
- `packages/ui-components/` — 可复用 UI 组件

---

## Phase 1: Milestone 1 — 跑通最小链路

> 目标：room CRUD + Claude/Codex session + @agent 发消息 + runtime console 看事件 + 左侧切换 session

### 1.1 Prisma Schema

文件：`prisma/schema.prisma`，数据库：`data/room.db`（SQLite）

核心表（所有表均含 created_at/updated_at）：

| 表 | 关键字段 |
|---|---|
| rooms | id, name, repo_path, default_branch |
| agent_sessions | id, room_id, agent, vendor_session_id, name, mode(readOnly/readWrite), status(idle/running/waitingApproval/failed/archived), worktree_id?, metadata_json |
| runs | id, room_id, agent_session_id, trigger_type(user/handoff/automation/review), parent_run_id?, status(状态机), prompt_snapshot, result_summary, total_cost_usd, started_at, ended_at |
| chat_messages | id, room_id, session_id?, agent?, role, mention_target?, reply_to_message_id?, content, content_format, selectable, pinned |
| runtime_events | id, room_id, agent, session_id, run_id, worktree_id?, kind, title?, text?, payload_json?, level, ts |
| handoff_bundles | id, room_id, source_agent?, target_agent, raw_excerpt, structured_summary_json, pinned_brief_snapshot, repo_snapshot_json, user_instruction |
| handoff_bundle_message_links | id, bundle_id, message_id, sort_order |
| pinned_brief_items | id, room_id, section, content, sort_order, version |
| approvals | id, room_id, run_id, agent, approval_type, title, payload_json, status(pending/approved/denied/cancelled), resolved_at |
| artifacts | id, room_id, run_id, session_id, kind, path?, content?, metadata_json |

### 1.2 Backend Server (apps/server)

框架：Fastify + @fastify/websocket，端口 3001

```
apps/server/src/
  index.ts                        # 入口：Fastify 实例 + 插件注册 + Prisma 初始化
  config.ts                       # 环境配置
  db.ts                           # Prisma client 单例

  routes/
    rooms.ts                      # POST /api/rooms, GET /api/rooms/:roomId
    sessions.ts                   # POST/GET /api/rooms/:roomId/sessions
    messages.ts                   # POST/GET /api/rooms/:roomId/messages
    runs.ts                       # GET /api/rooms/:roomId/runs/:runId/events
    handoffs.ts                   # (M2)
    pins.ts                       # (M2)
    approvals.ts                  # (M3)
    reviews.ts                    # (M4)

  ws/
    handler.ts                    # WebSocket upgrade + room.subscribe/unsubscribe
    room-channel.ts               # Map<roomId, Set<WS>> + broadcast

  orchestrator/
    room-orchestrator.ts          # 核心：消息路由 + session 生命周期 + run 调度
    run-manager.ts                # Run 状态机转换 + AgentSession 状态同步
    prompt-assembler.ts           # 4 层 prompt 组装
    message-router.ts             # 解析 @mention，确定目标 agent

  adapters/
    agent-driver.ts               # AgentDriver 接口定义
    claude/
      claude-adapter.ts           # 实现 AgentDriver：query() 异步迭代 → RuntimeEvent 流
      claude-session.ts           # session create/resume 逻辑
      claude-hooks.ts             # hooks 定义
      claude-event-mapper.ts      # SDK 消息类型映射（委托 runtime-events 包）
    codex/
      codex-adapter.ts            # 实现 AgentDriver：JSON-RPC 交互
      codex-process.ts            # app-server 子进程管理（spawn/restart/健康检查）
      codex-rpc.ts                # JSON-RPC 2.0 客户端（stdin/stdout，请求/响应匹配，通知路由）
      codex-event-mapper.ts       # JSON-RPC 通知映射

  services/
    event-service.ts              # RuntimeEvent 持久化 + WS 广播
    session-service.ts            # AgentSession CRUD + 状态管理
    message-service.ts            # ChatMessage CRUD
```

#### 关键模块设计

**room-orchestrator.ts** — 系统大脑：
```
handleUserMessage(roomId, content, mentionTarget) →
  1. 持久化 ChatMessage
  2. message-router 解析 @mention
  3. 确定/创建 AgentSession
  4. run-manager 创建 Run (status: queued)
  5. prompt-assembler 组装 4 层 prompt
  6. 分发给对应 adapter
  7. adapter 事件流 → event-service → WS 广播
```

**Claude Adapter 集成模式** — 使用 `@anthropic-ai/claude-agent-sdk`：
```typescript
const iterator = query({
  prompt: assembledPrompt,
  options: {
    workingDirectory: worktreePath || room.repoPath,
    permissionMode: 'default',    // M1 默认，M3 改用 canUseTool
    resume: vendorSessionId,      // 续接已有 session
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
  }
});
for await (const message of iterator) {
  // message.type: 'system' | 'assistant' | 'tool_use' | 'tool_result' | 'result'
  const event = normalizeClaude(message, { roomId, sessionId, runId });
  await eventService.emitAndBroadcast(event);
  if (message.type === 'result') {
    // 提取 session_id 存为 vendorSessionId，提取 total_cost_usd
    // 创建 message.final ChatMessage 回到聊天区
  }
}
```

**Codex Adapter 集成模式** — JSON-RPC 2.0 over stdio：
```
1. spawn `codex app-server` 子进程
2. send initialize → wait response → send initialized notification
3. thread/start 创建对话线程，存 threadId 为 vendorSessionId
4. turn/start 发送用户消息，开始 agent 执行
5. 消费通知流：
   - item/started → tool.started
   - item/completed → tool.completed
   - item/agentMessage/delta → message.delta
   - turn/completed → run.completed
6. 服务端发起的 approval request → 创建 Approval → 等待用户决定 → 回复
```

**codex-rpc.ts** — JSON-RPC 客户端核心：
- 写 newline-delimited JSON 到 stdin
- 读 newline-delimited JSON 从 stdout
- Map<requestId, {resolve, reject}> 管理请求/响应匹配
- 通知回调路由

#### Milestone 1 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rooms` | 创建 room，验证 repoPath 是 git 仓库 |
| GET | `/api/rooms/:roomId` | 返回 RoomSnapshot（room + sessions + 最近消息） |
| POST | `/api/rooms/:roomId/sessions` | 创建 session 记录 |
| GET | `/api/rooms/:roomId/sessions` | 列出 sessions |
| POST | `/api/rooms/:roomId/messages` | 发送消息，触发 orchestrator |
| GET | `/api/rooms/:roomId/messages` | 游标分页获取消息 |
| GET | `/api/rooms/:roomId/runs/:runId/events` | 获取历史 runtime events |

#### WebSocket 协议

Client → Server: `room.subscribe`, `room.unsubscribe`, `run.interrupt`, `approval.decide`
Server → Client: `room.snapshot`, `message.created`, `message.updated`, `runtime.event`, `run.status`, `approval.requested`, `approval.resolved`

页面加载：先 REST 拉 snapshot → 再 WS 订阅增量事件。

### 1.3 Frontend (apps/web)

框架：Next.js 14 (App Router) + Tailwind + Zustand + React Query

```
apps/web/src/
  app/
    layout.tsx                    # Root layout + providers
    page.tsx                      # 跳转到 /rooms
    rooms/
      page.tsx                    # Room 列表/创建
      [roomId]/
        page.tsx                  # 三栏主界面
        layout.tsx                # Room 级 providers（WS, store hydration）

  components/
    layout/
      three-panel.tsx             # 可调整大小的三栏容器
    sidebar/                      # 面板 [a]
      session-tree.tsx            # Agent > Sessions 树形结构
      session-node.tsx            # 单个 session 节点 + 状态徽标
    console/                      # 面板 [b]
      runtime-console.tsx         # xterm.js 包装器
      console-toolbar.tsx         # 过滤按钮：全部/命令/错误/审批/工具/原始JSON
      run-selector.tsx            # 切换历史 run 的下拉框
    chat/                         # 面板 [c]
      chat-panel.tsx              # 容器：消息列表 + 输入框 + pinned brief
      message-list.tsx            # 可滚动消息列表
      message-card.tsx            # 单条消息：复选框 + 头像 + 内容
      message-input.tsx           # @mention 自动补全输入框

  stores/
    room-store.ts                 # room, sessions, messages + WS 事件处理
    console-store.ts              # 当前 session/run 的 runtime events + 过滤器
    ui-store.ts                   # 选中 session, 选中 run, 面板尺寸

  hooks/
    use-websocket.ts              # WS 连接 + 自动重连（指数退避） + 事件分发到 stores
    use-room.ts                   # React Query: 拉取 room snapshot
    use-messages.ts               # React Query: 拉取消息列表

  lib/
    api-client.ts                 # 类型化的 fetch 封装
    ws-client.ts                  # WS 连接管理器
    terminal-renderer.ts          # RuntimeEvent → xterm.js ANSI 输出
```

**Runtime Console 渲染规范**（xterm.js 只读模式）：
- `run.status/started/completed` → 青色状态行
- `tool.started/completed` → 黄色，可折叠块
- `command.stdout` → 白色
- `command.stderr` → 红色
- `approval.requested` → 高亮黄色卡片
- `message.delta` → 绿色流式文本
- `message.final` → 亮白色

### 1.4 Milestone 1 实现顺序

1. `packages/shared-types` — 全部类型定义
2. `packages/runtime-events` — 事件归一化函数
3. `prisma/schema.prisma` + 初始迁移
4. `apps/server` 脚手架：Fastify + Prisma + config
5. `apps/server` routes: rooms, sessions, messages（纯 CRUD）
6. `apps/server` WebSocket: handler + room-channel
7. `apps/web` 脚手架：Next.js + Tailwind + stores
8. `apps/web` 三栏布局 + session tree + chat panel（先 mock 数据）
9. `apps/web` WebSocket hook + store 集成
10. `apps/server` Claude adapter（startSession + run + 事件流）
11. `apps/web` runtime console（xterm.js 渲染事件）
12. `apps/server` Codex adapter（进程管理 + thread/start + turn/start）
13. 集成测试：@Claude 发消息 → console 看到事件 → chat 收到回复
14. 集成测试：@Codex 同样流程

---

## Phase 2: Milestone 2 — 聊天勾选与交接

### 2.1 packages/handoff — 交接包生成

```
packages/handoff/src/
  bundle-builder.ts               # 编排整个 bundle 创建流程
  excerpt-compiler.ts             # 选中消息 → rawExcerpt（过滤噪音、截断长块）
  summarizer.ts                   # 调用 Claude SDK 轻量单轮生成 structuredSummary
  repo-snapshot.ts                # git log/branch/diff 捕获
  size-limiter.ts                 # 强制限制：20 条消息、20k 字符摘录、1.2k 摘要、8k diff
  prompt-template.ts              # spec 中的摘要模板
```

**bundle-builder 流程**：
1. 按 ID 获取选中消息，按时间排序
2. excerpt-compiler: 拼接、过滤、截断
3. repo-snapshot: 在目标 worktree/repo 下执行 git 命令
4. 获取当前 pinned brief，序列化为 markdown
5. summarizer: 送 excerpt + brief 给 Claude 生成结构化摘要 JSON
6. 若 summarizer 失败 → 降级为空摘要，不阻断 handoff
7. size-limiter: 裁剪日志和长代码块，不裁用户拍板结论
8. 持久化 HandoffBundle + 关联 links
9. 用 bundle 作为 prompt 向目标 agent 发起 run

### 2.2 Pinned Brief 服务

- CRUD for PinnedBriefItem（5 个分区）
- `getSnapshot(roomId)` → 分组格式化为 markdown
- `fromMessage(roomId, messageId, section)` → 从聊天消息创建
- 版本追踪：每次修改 version++

### 2.3 新增 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rooms/:roomId/handoffs` | 创建 bundle → 启动目标 agent run |
| POST | `/api/rooms/:roomId/pins` | 添加 pinned item |
| PUT | `/api/rooms/:roomId/pins/:pinId` | 更新 |
| DELETE | `/api/rooms/:roomId/pins/:pinId` | 删除 |
| GET | `/api/rooms/:roomId/pins` | 获取全部 |

### 2.4 前端更新

- `message-card.tsx`: 左侧复选框 + 上下文菜单（Pin to brief / Copy as summary）
- 新增 `handoff-bar.tsx`: 选中消息时浮现，显示数量，"Send to Claude/Codex" 按钮 + 附加说明输入
- 新增 `pinned-brief-panel.tsx`: 5 个分区可编辑面板，可折叠
- 新增 `selection-store.ts`: `Set<messageId>` + toggle/clear/selectRange
- `prompt-assembler.ts` 支持 handoff 模式：结构化摘要在前，原文摘录在后

---

## Phase 3: Milestone 3 — 审批与 Worktree 隔离

### 3.1 packages/git-worktree — Worktree 管理

```
packages/git-worktree/src/
  worktree-manager.ts             # ensureWorktree, removeWorktree, listWorktrees, validateNoConflict
  git-commands.ts                 # git CLI 薄封装（child_process.exec）
  naming.ts                       # path: worktrees/{agent}/{sessionKey}, branch: agent/{agent}/{sessionKey}
```

约束执行：
- readWrite session 必须独立 worktree
- 同一时刻不允许两个 running readWrite session 指向同一 worktree
- readOnly session 可共用 repo 根目录

### 3.2 审批服务

```typescript
// apps/server/src/services/approval-service.ts
class ApprovalService {
  pendingResolvers: Map<approvalId, (decision) => void>;

  createApproval(input) → 持久化 + 发 approval.requested 事件 + WS 广播
  waitForDecision(approvalId, timeout=10min) → Promise，超时则 mark failed
  decide(approvalId, decision) → 更新记录 + 发 approval.resolved + resolve Promise
}
```

### 3.3 Claude Adapter 审批集成

使用 `canUseTool` 回调：
- Read/Glob/Grep → 自动 allow
- Write/Edit/Bash → 创建 Approval → waitForDecision → 返回 allow/deny
- 危险命令（rm -rf 等）→ PreToolUse hook 直接 deny

### 3.4 Codex Adapter 审批集成

监听 app-server 发起的 approval request 通知：
- 创建 Approval → waitForDecision → 回复 JSON-RPC

### 3.5 Worktree 集成

room-orchestrator 在启动 run 前：
- 若 session.mode === 'readWrite' → ensureWorktree → validateNoConflict → 传 worktree.path 给 adapter
- 若 session.mode === 'readOnly' → 使用 room.repoPath

### 3.6 前端审批 UI

- `approval-card.tsx`: 在 runtime console 中内联渲染，Approve/Deny 按钮
- chat panel 同步显示审批系统消息作为辅助通知
- `room-store` 新增 `pendingApprovals` 追踪

---

## Phase 4-5: 高层概述

### Milestone 4: Review 与可用性增强
- Codex detached review: `review/start` JSON-RPC，结果作为 review 类型消息回流
- Run 历史：session 下的 run 列表，点击加载历史事件
- 日志过滤增强：关键字搜索 + 原始 JSON 调试视图
- 错误恢复："重试" 按钮 + "继续 session" 按钮 + Codex 进程自动重启

### Milestone 5: 自动化与 MCP
- Claude 完成写文件后自动触发 Codex review
- room-mcp-server: 封装 shared brief / task board / artifact search / review trigger 为 MCP tools

---

## 错误处理策略

| 场景 | 处理 |
|------|------|
| Claude SDK 抛异常 | run → failed，发 run.failed 事件，聊天区系统消息 |
| Codex 进程意外退出 | 尝试重启（最多 3 次），thread/list 恢复线程，不可恢复则 run → failed |
| 交接摘要失败 | 降级为 rawExcerpt + pinned brief + 用户指令，不阻断 |
| 审批超时 (10 min) | approval → cancelled, run → failed, 聊天通知 |
| WS 断连 | 前端自动重连（指数退避 1s→30s），重订阅 + 请求 snapshot |
| 页面刷新 | REST 拉 snapshot → WS 重订阅 → 回放活跃 run 的最近事件 |
| 两个写 session 冲突 | validateNoConflict 抛错，run 创建失败，清晰错误消息 |

---

## 验证方案

按 spec 的 8 个验收场景逐一测试：

1. @Claude 提问 → [b] 显示运行过程 → [c] 显示总结
2. 勾选 3-5 条消息交给 Codex → 独立 session/worktree 工作 → 返回结果
3. Codex 结果交给 Claude review → Claude 看到结构化摘要
4. 写文件触发审批 → UI 批准/拒绝 → run 状态正确流转
5. 页面刷新 → 会话列表、聊天记录、最近 run 恢复
6. 同一 room 同时 Claude 只读 + Codex 写代码 → 互不冲突
7. Codex detached review → review 消息回流
8. 适配器异常退出 → 系统不崩溃 → 可手动恢复
