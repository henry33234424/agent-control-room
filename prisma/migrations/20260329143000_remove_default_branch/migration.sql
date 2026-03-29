PRAGMA foreign_keys=OFF;

CREATE TABLE "new_rooms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "repo_path" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

INSERT INTO "new_rooms" (
    "id",
    "name",
    "repo_path",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "name",
    "repo_path",
    "created_at",
    "updated_at"
FROM "rooms";

DROP TABLE "rooms";
ALTER TABLE "new_rooms" RENAME TO "rooms";

PRAGMA foreign_keys=ON;
