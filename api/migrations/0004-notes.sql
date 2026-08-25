-- 参加者の一言（コメント）。「30分遅れます」「車を出せます」を書く場所。
--
-- ★ 回答（answers）と同じく**上書きせず追記、いちばん新しい行を採用**する。
--    answers は種目ごとに1行だが、コメントは人につき1つなので別のテーブルにしてある
--    （answers に列を足すと、種目3つの行事で同じ文が3回入る）。
--
-- 空文字も1行として書く。コメントを消したいときに、最新行が空になることで消える。
-- これも「UPDATE を書かない」という約束のうち。
--
-- 新しいテーブルなので schema.sql の CREATE TABLE IF NOT EXISTS でも作られるが、
-- 本番は migrations を流す手順に統一してある。
--
--   npx wrangler d1 execute dropper-attendance --remote --file=./migrations/0004-notes.sql
--
-- 二度流しても IF NOT EXISTS なので害はない。
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  name       TEXT NOT NULL,                   -- 名簿の氏名。端末が変わっても追える
  text       TEXT NOT NULL DEFAULT '',
  device_id  TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_ev ON notes (org_id, event_id, name, id DESC);
