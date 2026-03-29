PRAGMA foreign_keys=OFF;

CREATE TABLE "new_agent_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "vendor_session_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "metadata_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "agent_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_agent_sessions" (
    "id",
    "room_id",
    "agent",
    "vendor_session_id",
    "name",
    "status",
    "metadata_json",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "room_id",
    "agent",
    "vendor_session_id",
    "name",
    "status",
    "metadata_json",
    "created_at",
    "updated_at"
FROM "agent_sessions";

DROP TABLE "agent_sessions";
ALTER TABLE "new_agent_sessions" RENAME TO "agent_sessions";

CREATE TABLE "new_runtime_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT,
    "payload_json" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runtime_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_runtime_events" (
    "id",
    "room_id",
    "agent",
    "session_id",
    "run_id",
    "kind",
    "title",
    "text",
    "payload_json",
    "level",
    "ts"
)
SELECT
    "id",
    "room_id",
    "agent",
    "session_id",
    "run_id",
    "kind",
    "title",
    "text",
    "payload_json",
    "level",
    "ts"
FROM "runtime_events";

DROP TABLE "runtime_events";
ALTER TABLE "new_runtime_events" RENAME TO "runtime_events";

CREATE INDEX "runtime_events_run_id_idx" ON "runtime_events"("run_id");
CREATE INDEX "runtime_events_session_id_idx" ON "runtime_events"("session_id");
CREATE INDEX "runtime_events_room_id_ts_idx" ON "runtime_events"("room_id", "ts");

DROP TABLE IF EXISTS "worktrees";

PRAGMA foreign_keys=ON;
