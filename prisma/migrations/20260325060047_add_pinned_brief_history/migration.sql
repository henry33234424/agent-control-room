-- CreateTable
CREATE TABLE "pinned_brief_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "item_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pinned_brief_history_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "pinned_brief_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "pinned_brief_history_item_id_idx" ON "pinned_brief_history"("item_id");
