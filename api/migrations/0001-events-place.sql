-- 出欠の回答画面に「地図」ボタンを出すため、会場名と住所をイベントに持たせる。
-- すでに作ってあるデータベース向け。schema.sql は CREATE TABLE IF NOT EXISTS なので、
-- 既存のテーブルには列が増えない。**1回だけ**流すこと。
--
--   npx wrangler d1 execute dropper-attendance --remote --file=./migrations/0001-events-place.sql
--
-- すでに列がある状態で流すと「duplicate column name」で止まるが、それ以上の害はない。

ALTER TABLE events ADD COLUMN place   TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN address TEXT NOT NULL DEFAULT '';
