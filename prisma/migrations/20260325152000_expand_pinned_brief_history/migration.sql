PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_pinned_brief_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "room_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "change_type" TEXT NOT NULL,
    "changed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pinned_brief_history_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_pinned_brief_history" (
    "id",
    "room_id",
    "item_id",
    "section",
    "content",
    "sort_order",
    "version",
    "change_type",
    "changed_at"
)
SELECT
    "h"."id",
    "i"."room_id",
    "h"."item_id",
    "i"."section",
    "h"."content",
    "i"."sort_order",
    "h"."version",
    'updated',
    "h"."changed_at"
FROM "pinned_brief_history" AS "h"
INNER JOIN "pinned_brief_items" AS "i" ON "i"."id" = "h"."item_id";

DROP TABLE "pinned_brief_history";

ALTER TABLE "new_pinned_brief_history" RENAME TO "pinned_brief_history";

CREATE INDEX "pinned_brief_history_item_id_idx" ON "pinned_brief_history"("item_id");
CREATE INDEX "pinned_brief_history_room_id_changed_at_idx" ON "pinned_brief_history"("room_id", "changed_at");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
