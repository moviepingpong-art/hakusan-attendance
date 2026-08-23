-- 団体ごとの言語。参加者に配る画面をこの言語で出す。
--
-- schema.sql は CREATE TABLE IF NOT EXISTS なので、**すでにある orgs には列が増えない**。
-- 本番に流すのはこちら。`git pull` → これを流す → `wrangler deploy` の順を守ること。
--
--   npx wrangler d1 execute dropper-attendance --remote --file=./migrations/0002-orgs-lang.sql
--
-- 二度流しても duplicate column name で止まるだけで、害はない。
ALTER TABLE orgs ADD COLUMN lang TEXT NOT NULL DEFAULT 'ja';
