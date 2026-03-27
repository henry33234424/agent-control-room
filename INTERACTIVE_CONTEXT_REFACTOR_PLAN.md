# Interactive Context Refactor Plan

## 目标

把当前项目从“右侧 chat 试图镜像交互式终端输出”的不稳定模型，收缩成一套更稳的模型：

- 中间 terminal 是 agent 的真实工作现场
- 左侧 session tree 是项目内的交互式 agent 列表
- 右侧 chat 是“上下文仓库 + 派发面板”，不是 Claude/Codex TUI 的逐帧镜像

结论先写清楚：

- 当前最不稳定的部分，不是 UI，而是“交互式 TUI 输出 -> 自动转录成 chat message”这条链
- 继续修补这条链，只会不断引入新的边界问题
- 应该把右侧改成“可确认、可复用、可 handoff 的上下文池”，而不是自动镜像全部终端输出

---

## 当前真实状态流转链路

以下梳理基于当前代码，不是基于最初 spec。

### 1. 项目 / Room 链路

当前 `room` 已经更接近“项目容器”。

- 创建项目：`POST /api/rooms`
- 进入项目：前端进入 `/rooms/[roomId]`
- 房间快照：HTTP `GET /api/rooms/:roomId`
- 增量同步：WS `room.subscribe` -> `room.snapshot` / `session.updated` / `message.created` / `message.updated`

关键文件：

- `apps/web/app/page.tsx`
- `apps/web/app/rooms/[roomId]/page.tsx`
- `apps/web/components/sidebar/session-tree.tsx`
- `apps/server/src/ws/handler.ts`

### 2. Session 链路

当前 session 是真实的交互式 agent 会话。

- 左侧点击 `+ Claude` / `+ Codex` 分组按钮
- 前端调用 `POST /api/rooms/:roomId/sessions`
- 后端创建 `agent_sessions`
- 前端收到 `session.updated` 后，左侧 tree 增加 session
- 用户点击某个 session，前端把它设为当前 terminal 目标

关键文件：

- `apps/server/src/routes/sessions.ts`
- `apps/server/src/services/session-service.ts`
- `apps/web/components/sidebar/session-tree.tsx`

### 3. Terminal attach / detach 链路

当前中间 terminal 已经是单独的一套交互式模型。

- 前端选中 session
- `TerminalPanel` 为该 session 创建或复用一个 xterm 实例
- 第一次选中：发 `pty.start`
- 再次切回：发 `pty.attach`
- PTY 输出走 `pty.output` 回到 xterm
- 手动输入走 `pty.input`
- 断开 WS 时，后端把 PTY detach，稍后超时清理

关键文件：

- `apps/web/components/console/terminal-panel.tsx`
- `apps/web/lib/ws-client.ts`
- `apps/server/src/ws/handler.ts`
- `apps/server/src/ws/pty-manager.ts`

### 4. 从右侧发消息到 terminal 的链路

当前右侧发送已经不是 run/adapter 模式，而是“派发到交互式 terminal”。

- 右侧输入框调用 `POST /api/rooms/:roomId/messages`
- 后端先创建一条 `user` chat message
- 后端解析 `@claude / @codex / @both`
- `interactiveDispatchService.prepare()` 组装 prompt，并解析勾选的上下文消息
- `interactiveDispatchService.dispatchPrepared()` 确保 PTY 已启动，然后把 prompt 写进 PTY stdin

关键文件：

- `apps/web/components/chat/message-input.tsx`
- `apps/web/components/chat/handoff-bar.tsx`
- `apps/server/src/routes/messages.ts`
- `apps/server/src/services/interactive-dispatch-service.ts`

### 5. 当前右侧 chat 自动同步链路

这是现在最不稳定的一条。

当前并不是靠 PTY 文本抓取，而是：

- `ptyManager.start()` 启动 PTY 时，同时启动 `SessionWatcher`
- `SessionWatcher` 去监听本机 CLI 会话 JSONL 文件
- Claude: `~/.claude/projects/<cwd-encoded>/<session>.jsonl`
- Codex: `~/.codex/sessions/.../*.jsonl`
- watcher 解析新行并调用 `messageService.create()`
- 前端通过 `message.created` / `message.updated` 显示到右侧

关键文件：

- `apps/server/src/ws/pty-manager.ts`
- `apps/server/src/ws/session-watcher.ts`
- `apps/server/src/services/message-service.ts`
- `apps/web/components/chat/message-list.tsx`

### 6. 手动 terminal 输入链路

手动在 terminal 里敲字，并不是先写 chat 再写 PTY，而是反过来：

- 用户在 xterm 里输入
- 前端直接发 `pty.input`
- 后端直接写入 PTY stdin
- 然后寄希望于 `SessionWatcher` 在 JSONL 文件里看到对应 user/assistant 消息，再反向同步到 chat

这意味着：

- terminal 是真实输入源
- right chat 是事后同步结果
- 这就是“右侧总是不稳”的根因之一

---

## 当前架构为什么会持续失稳

### 1. 两个真相源同时存在

当前系统同时存在两套“消息真相”：

- 真相 A：terminal / PTY / CLI 会话
- 真相 B：chat_messages / SessionWatcher 反向同步

只要两边不是同一时刻、同一边界、同一粒度更新，就一定会错位。

### 2. 右侧 chat 承担了两种互相冲突的职责

当前右侧既想做：

- 用户可勾选、可 handoff 的上下文仓库

又想做：

- Claude/Codex 交互式终端输出的自动镜像

这两者在交互式 TUI 下天然冲突。

### 3. SessionWatcher 是启发式同步，不是严格协议同步

当前 watcher 的风险点：

- Claude 会话文件路径依赖 `cwd` 编码
- Codex 会话文件通过最近文件 + `cwd` 猜测
- `markSent()` 只按内容 dedup，不按 message id / turn id dedup
- `assistant` 消息是“看到一行 JSONL 就记一条消息”，而不是明确的 turn 完成事件

这意味着 watcher 更像“旁路观察器”，不是强一致的数据源。

### 4. 当前模型仍残留旧系统概念

虽然 UI 已经转向 interactive terminal，但系统内部仍然残留旧设计思路：

- `chat` 还在被当作“完整对话镜像”
- `handoff` 还在从 chat 里选上下文
- `message role` 还只有 `user / agent / system / review / approval / handoff-summary`

现在真正需要的是“上下文条目”，不是所有 agent 输出都硬塞进 `agent`。

---

## 目标模型

### 1. 中间 terminal 是唯一执行现场

中间 terminal 负责：

- Claude/Codex 的真实完整交互
- 输入
- 输出
- 状态
- 现场上下文连续性

这里不再要求右侧逐帧镜像它。

### 2. 右侧 chat 改成 Context Panel

右侧只保留“高价值、可复用、可 handoff”的内容。

右侧应该展示：

- 用户发出的 prompt / dispatch
- handoff summary
- pinned brief
- 手动捕获的 agent 摘录
- system note / error note

右侧不再承诺：

- 自动完整镜像 Claude 交互式 TUI 的所有回答

### 3. 左侧 session tree 保持不变，但语义更清晰

左侧仍然是：

- Project
- Claude sessions
- Codex sessions

但要明确：

- session 是交互式 agent 容器
- terminal 是当前 attach 到某个 session 的工作区
- right panel 只是这些 session 之间的上下文调度器

---

## 目标状态流转链路

### A. 项目流转

目标：

- 项目是仓库级容器
- 一个项目下可以挂多个 Claude / Codex sessions

状态流：

1. 创建 project
2. 进入 project
3. 拉 snapshot
4. 订阅 project WS
5. 选择 session 或创建 session

### B. Session 流转

目标：

- session 只代表一个真实的交互式 agent 会话

状态流：

1. 创建 session
2. 若 readWrite，则绑定 worktree
3. 启动 PTY
4. attach / detach / reattach
5. kill / timeout cleanup

### C. Prompt 派发流转

目标：

- 右侧发送的内容，本质上是“派发到某个 terminal session”

状态流：

1. 用户在右侧输入 `@claude ...`
2. 系统解析目标 agent
3. 找到或创建目标 session
4. 把本次 dispatch 作为一条 `user prompt` 记到右侧
5. 把 prompt 写入目标 terminal

注意：

- 这里的右侧记录是“你发出了什么”
- 不是“Claude 最终回答了什么”

### D. Terminal -> Context Capture 流转

这是未来最关键的新链路。

目标：

- 终端中的有价值内容，由用户明确捕获到右侧

状态流：

1. 用户在 terminal 中选择文本
2. 前端弹出 capture toolbar
3. 用户点击：
   - `Capture to Chat`
   - `Capture to Brief`
   - `Send to Claude`
   - `Send to Codex`
4. 后端将该段内容存为新的 context item
5. 右侧出现一条新卡片，可继续勾选 / handoff

### E. Handoff 流转

目标：

- handoff 基于“被确认过的上下文条目”，而不是基于嘈杂的自动 transcript

状态流：

1. 用户在右侧勾选若干条 context item
2. 用户填写附加指令
3. 选择目标 agent
4. 系统生成 handoff summary
5. 系统将 handoff summary 作为新的 dispatch 写入目标 terminal

---

## 需要调整的数据模型

### 1. ChatMessageRole 需要扩展

当前只有：

- `user`
- `agent`
- `system`
- `review`
- `approval`
- `handoff-summary`

建议新增至少这些角色：

- `prompt`
- `excerpt`
- `note`

或者更直接：

- `user-prompt`
- `agent-excerpt`
- `system-note`

关键是要把“右侧上下文条目”从“自动镜像的 agent reply”里拆出来。

### 2. Context item 需要 metadata

建议为 excerpt / note 类消息增加 metadata，至少包含：

- sourceSessionId
- sourceAgent
- sourceKind
- capturedFrom
- capturedAt

这样以后 handoff 才知道内容来自哪里。

### 3. SessionWatcher 应降级，不再作为核心真相源

建议：

- Claude/Codex JSONL watcher 只保留为“辅助恢复 / 调试能力”
- 不再直接承担右侧主要消息同步职责

---

## 分阶段实施计划

## Phase 0: 冻结不稳定目标

先明确边界，不再继续修“右侧完整镜像 Claude TUI”。

动作：

- 停止新增任何自动 transcript 功能
- 保留 terminal 作为唯一真实工作现场
- 右侧继续保留已有 prompt/handoff/pinned brief

验收：

- 不再以“右侧必须完整显示 AI 回答”为目标

## Phase 1: 明确右侧是 Context Panel

动作：

- UI 文案把 `Chat` 改成 `Context` 或 `Context Panel`
- 把右侧中自动镜像 agent reply 的心智从产品文案中移除
- 保留当前用户 prompt 和 handoff-summary

验收：

- 用户能理解：右侧是“可选上下文池”，不是 terminal 镜像

## Phase 2: 增加 Capture Selection

这是最重要的一步。

动作：

- 在中间 terminal 支持读取当前选区文本
- 选区出现浮层按钮：
  - `Capture to Context`
  - `Capture to Brief`
  - `Send to Claude`
  - `Send to Codex`
- 新增 API：
  - `POST /api/rooms/:roomId/excerpts`
- 存储为 `excerpt` 类型消息

验收：

- 用户可以从 terminal 人工摘录高价值内容到右侧
- 新摘录的上下文可以被继续勾选和 handoff

## Phase 3: 重做 handoff 入口

动作：

- handoff 只允许基于：
  - user prompt
  - handoff summary
  - excerpt
  - pinned brief 引用
- 不再依赖自动同步来的整段 agent transcript

验收：

- `@claude` 和 `@codex` 的上下文转发只使用被确认过的条目

## Phase 4: 降级 SessionWatcher

动作：

- SessionWatcher 不再直接创建右侧主要消息
- 可保留为：
  - 调试用途
  - 恢复用途
  - 可选的 transcript archive

验收：

- 右侧的核心上下文不再依赖 watcher 的文件发现和 JSONL 解析

## Phase 5: 清理遗留链路

动作：

- 删除或边缘化旧的 `run/events/review` 非交互残留
- 删除已废弃的 transcript 清洗逻辑
- 去掉调试日志与临时探针

验收：

- 项目主链路只有：
  - project
  - session
  - terminal
  - context capture
  - handoff dispatch

## Phase 6: 增加回归测试

必须补的测试：

- 创建 project / session
- terminal attach / detach / reattach
- 右侧 prompt 派发到目标 session
- capture selection -> context item
- 勾选 excerpt -> handoff -> 写入另一 agent session

---

## 具体改造建议

### 先做

1. 把右侧文案从 `Chat` 改成 `Context`
2. 定义 `excerpt` 消息角色
3. 增加 `Capture to Context`
4. handoff 只从 excerpt / prompt 中取上下文

### 暂缓

1. 自动完整转录 Claude TUI 到右侧
2. 继续修复杂的 TUI transcript 清洗
3. 让右侧变成完整对话镜像

### 直接删除或降级

1. 以 `SessionWatcher` 作为右侧主消息来源的思路
2. 以“自动镜像 agent 回答”为中心的产品心智

---

## 验收标准

达到以下状态时，系统会稳定很多：

- 中间 terminal 是唯一真实执行界面
- 右侧只展示有明确语义的上下文条目
- 用户可以明确地从 terminal 摘录到右侧
- handoff 只基于已确认的上下文条目
- Claude/Codex TUI 不再直接决定右侧显示质量

---

## 一句话方案

不要再把右侧当作“交互式终端的自动镜像”。

应该把它收缩成：

**上下文仓库 + 派发面板 + 手动摘录入口**

而把中间 terminal 明确成：

**唯一真实工作现场**
