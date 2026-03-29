-- CreateTable
CREATE TABLE "interactive_terminal_states" (
    "session_id" TEXT NOT NULL PRIMARY KEY,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "snapshot_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "interactive_terminal_states_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
