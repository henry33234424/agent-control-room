-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "repo_path" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "vendor_session_id" TEXT,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'readWrite',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "worktree_id" TEXT,
    "metadata_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "agent_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_sessions_worktree_id_fkey" FOREIGN KEY ("worktree_id") REFERENCES "worktrees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "agent_session_id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL DEFAULT 'user',
    "parent_run_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "prompt_snapshot" TEXT,
    "result_summary" TEXT,
    "total_cost_usd" REAL,
    "started_at" DATETIME,
    "ended_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "runs_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "runs_agent_session_id_fkey" FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "runs_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "worktrees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'readWrite',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "worktrees_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "session_id" TEXT,
    "agent" TEXT,
    "role" TEXT NOT NULL,
    "mention_target" TEXT,
    "reply_to_message_id" TEXT,
    "content" TEXT NOT NULL,
    "content_format" TEXT NOT NULL DEFAULT 'markdown',
    "selectable" BOOLEAN NOT NULL DEFAULT true,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "runtime_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "worktree_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT,
    "payload_json" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runtime_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "handoff_bundles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "source_agent" TEXT,
    "target_agent" TEXT NOT NULL,
    "raw_excerpt" TEXT NOT NULL,
    "structured_summary_json" TEXT NOT NULL,
    "pinned_brief_snapshot" TEXT NOT NULL,
    "repo_snapshot_json" TEXT NOT NULL,
    "user_instruction" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "handoff_bundles_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "handoff_bundle_message_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundle_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "handoff_bundle_message_links_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "handoff_bundles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "handoff_bundle_message_links_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pinned_brief_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "pinned_brief_items_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "approval_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "approvals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT,
    "content" TEXT,
    "metadata_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "worktrees_room_id_path_key" ON "worktrees"("room_id", "path");

-- CreateIndex
CREATE INDEX "runtime_events_run_id_idx" ON "runtime_events"("run_id");

-- CreateIndex
CREATE INDEX "runtime_events_session_id_idx" ON "runtime_events"("session_id");

-- CreateIndex
CREATE INDEX "runtime_events_room_id_ts_idx" ON "runtime_events"("room_id", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "handoff_bundle_message_links_bundle_id_message_id_key" ON "handoff_bundle_message_links"("bundle_id", "message_id");

-- CreateIndex
CREATE INDEX "artifacts_run_id_idx" ON "artifacts"("run_id");
