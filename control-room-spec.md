# Control Room 产品与技术规格

- 版本：当前实现
- 日期：2026-03-29

## 1. 产品定位

Control Room 是一个本地优先的多 Agent 协作台。

它解决的问题很简单：

- 用户在一个网页里同时管理 Claude 和 Codex
- 每个 agent 可以开多个独立 session
- 用户可以选中聊天内容，把上下文定向发给另一个 agent 或某个具体 session
- 用户能看到对应 session 的真实终端，而不是抽象后的运行日志

它不是：

- 多人协作平台
- 云端 SaaS
- Git / worktree 编排系统
- 以 detached run / approval 为核心的执行框架

## 2. 当前核心原则

- 单用户优先，本地优先
- agent 直接在项目主目录工作
- 项目创建只校验路径存在
- 终端由服务端持有真实状态，前端只做 attach
- 关闭网页、断网、刷新不会自动 kill 后端 PTY
- 有 `tmux` 时优先使用 `tmux` 提升恢复能力

## 3. 用户可见能力

### 3.1 项目

- 创建项目
- 重命名项目
- 删除项目

### 3.2 Session

- 每个项目下可创建多个 Claude session
- 每个项目下可创建多个 Codex session
- session 可命名、重命名、删除
- session 名在同一项目内唯一

### 3.3 Chat / Routing

- 输入 `@Claude` / `@Codex` / `@both`
- 也可以按 session 名精确路由
- 聊天记录持久化
- 支持勾选若干消息后进行 handoff

### 3.4 Handoff

- 用户勾选消息
- 在共享输入框里补充说明
- 分别选择 Claude session 与 Codex session
- 可分别发送给两个目标

### 3.5 Terminal

- 每个 session 对应一个交互式终端
- 支持启动、attach、输入、resize、kill
- 页面刷新后可恢复已存活终端
- 关闭网页不会自动 kill 后端终端

## 4. 系统结构

```text
apps/
  web/                    # Next.js 前端
  server/                 # Fastify + WS + PTY 管理
packages/
  shared-types/           # 前后端共享类型
prisma/
  schema.prisma
data/
  room.db                 # SQLite
```

## 5. 前端结构

前端为三栏布局：

- 左侧：项目与 session 树
- 中间：终端
- 右侧：chat / handoff / shared brief

关键前端状态：

- `room-store`：room、sessions、messages、pinned brief
- `selection-store`：被勾选的消息
- `ui-store`：当前选中的 session
- `ws-client`：WebSocket 连接与重连

## 6. 后端结构

### 6.1 路由

- `rooms.ts`
- `sessions.ts`
- `messages.ts`
- `pins.ts`
- `excerpts.ts`

### 6.2 核心服务

- `session-service.ts`
- `message-service.ts`
- `interactive-dispatch-service.ts`
- `interactive-terminal-state-service.ts`

### 6.3 WS / Terminal

- `handler.ts`
- `pty-manager.ts`
- `headless-terminal-state.ts`
- `session-watcher.ts`
- `tmux-session-manager.ts`

## 7. 终端模型

当前终端链路是服务端权威模型。

### 7.1 服务端职责

- 持有 PTY
- 持有真实 terminal screen state
- attach 时发送 `pty.restore`
- 持久化 terminal snapshot
- 如果有 `tmux`，优先使用 `tmux` 做持久层

### 7.2 前端职责

- 发 `pty.start` / `pty.attach` / `pty.input` / `pty.resize` / `pty.kill`
- 接收 `pty.restore` / `pty.output` / `pty.exit`
- 不依赖浏览器本地 snapshot 决定恢复结果

## 8. 断线与恢复

### 8.1 WebSocket

- 有 heartbeat
- 服务端定时 `ws.ping`
- 客户端回 `ws.pong`
- 长时间无消息时主动断开重连，避免假在线

### 8.2 终端

- 页面关闭、刷新、断网时：只 detach，不自动 kill
- 页面恢复后：重新 subscribe room，再 attach 当前 session
- 如果服务端可恢复真实 session，则继续接回
- 如果只能恢复最近一帧 screen，也会先展示最近快照

## 9. 数据模型

当前核心表：

- `rooms`
- `agent_sessions`
- `interactive_terminal_states`
- `chat_messages`
- `pinned_brief_items`
- `pinned_brief_history`

## 10. 消息主链

用户发消息后：

1. 后端解析 mention
2. 决定目标 agent 或目标 session
3. 找到或创建目标 session
4. 必要时启动 PTY
5. 等待 PTY ready
6. 把 prompt 写入终端
7. 同时持久化 chat message

对应核心实现：

- `routes/messages.ts`
- `services/interactive-dispatch-service.ts`

## 11. 当前明确不做的事

- 不要求为每个 session 创建独立工作目录
- 不强制两个 agent 在物理目录上隔离
- 不要求用户先把目录变成 Git 仓库
- 不维护 SDK 与 CLI 双主链
- 不保留 detached run / approval / runtime console 体系

## 12. 已知现实边界

- 多个 agent 直接在同一主目录写代码，冲突控制主要依赖用户调度，而不是目录隔离
- 服务端重启后的恢复能力强依赖 `tmux` 是否可用，以及 terminal snapshot 是否最新

## 13. 后续方向

如果继续向“更轻、更稳”的方向推进，建议顺序：

1. 保持 chat + PTY + session 主链稳定
2. 压缩剩余兼容字段与历史语义
3. 补 README、环境变量说明、启动步骤、已知限制
