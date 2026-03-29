# Control Room 当前实现说明

## 目标

Control Room 当前版本只做一件事：

- 在同一个项目目录里管理多个 Claude / Codex session
- 让用户在网页里同时看到终端、聊天记录和共享上下文
- 支持把选中的聊天内容定向发给指定 agent 或指定 session

当前实现已经明确移除这些旧方向：

- `worktree` 隔离写入
- Git 前置依赖
- detached run / approval / runtime console 体系
- SDK / RPC 双执行栈

## 当前产品原则

- 本地优先，单用户优先
- agent 直接在 `room.repoPath` 主目录工作
- 项目创建只要求路径存在
- 终端恢复以服务端为准，前端只负责 attach
- 关闭网页、断网、刷新不会自动 kill 后端 PTY
- 如果机器安装了 `tmux`，优先复用 `tmux` session 做更强恢复

## 当前功能范围

### 1. Project / Session 管理

- 创建、重命名、删除项目
- 在每个项目下创建多个 Claude / Codex session
- session 可命名、重命名、删除
- 输入区支持 `@Claude`、`@Codex`、`@both` 和按 session 名精确路由

### 2. Chat / Handoff

- 聊天消息持久化
- 可勾选若干消息做 handoff
- 一个共享补充说明输入框
- 分别选择 Claude session 与 Codex session 发送
- 支持 shared brief / excerpts / pinned brief

### 3. Interactive Terminal

- 每个 session 对应一个可恢复的 PTY
- 前端刷新后重新 attach，而不是依赖本地快照伪恢复
- 服务端维护真实 screen state
- WebSocket 有 heartbeat，能识别假在线并重连
- 后端 PTY 常驻，只有显式 kill / 删除 / 进程退出时才结束

## 当前架构

### 前端

- `apps/web`
- Next.js + React
- Zustand 管理 room、selection、ui 状态
- xterm.js 渲染 terminal

### 后端

- `apps/server`
- Fastify + WebSocket
- Prisma + SQLite
- PTY manager 负责 start / attach / input / resize / kill / restore
- Session watcher 从 transcript 中同步聊天消息

### 共享类型

- `packages/shared-types`

## 当前核心链路

### 1. 发送消息

`POST /api/rooms/:roomId/messages`

服务端流程：

1. 解析 mention 或 session 定向
2. 找到或创建目标 session
3. 如有必要启动 PTY
4. 等待 CLI 就绪
5. 把 prompt 写入 PTY
6. 持久化 chat message

### 2. 终端恢复

前端流程：

1. 页面加载后订阅 room
2. 选择某个 session
3. 发送 `pty.attach`
4. 收到 `pty.restore`
5. 用服务端下发的真实 screen 重建首屏

服务端流程：

1. PTY / tmux 保持真实会话
2. Headless xterm 维护当前 screen state
3. attach 时先发送 restore，再补发 backlog

### 3. 断线恢复

- WebSocket 有 heartbeat
- 假在线会被主动识别并重连
- detach 后不自动 kill PTY
- 服务端重启时，优先尝试恢复 tmux session；否则使用持久化 terminal snapshot

## 已删除的旧设计

- `worktree` 隔离写入
- session `mode`（`readOnly` / `readWrite`）
- Git 必选创建项目
- review / runs / approvals / runtime console
- SDK / RPC 双适配器切换
- `ADAPTER_MODE`

## 后续建议

继续沿“轻量协作台”方向推进时，优先级建议是：

1. 保持 PTY / chat / session 主链稳定
2. 继续压缩遗留兼容层和旧字段
3. 补 README、启动步骤、已知边界和恢复语义
