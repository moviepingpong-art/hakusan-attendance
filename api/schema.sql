-- 出欠ドロッパー — D1 スキーマ
--
-- 元はGASの表（設定・名簿・行事・イベント・回答・紐付け）。並びをそのまま持ち込んでいる。
-- ★ 回答と紐付けは「上書きせず追記、いちばん新しい行を採用」。GAS版と同じ約束。
--    履歴が残るので、間違えて消しても遡れる。UPDATE を書きたくなったら立ち止まること。
--
-- 日付は 'YYYY-MM-DD' の文字列で持つ。SQLiteに日付型は無く、この形なら
-- 文字列のまま並べ替えても日付順になる（GAS版のDate型まわりの面倒が消える）。

-- 団体 ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,               -- 参加者に配るID（?s= に載る）
  admin_hash  TEXT NOT NULL UNIQUE,           -- 管理リンクの合鍵のSHA-256。生の鍵は保存しない
  name        TEXT NOT NULL DEFAULT '出欠',
  tz          TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL                -- 最終アクセス。放置ぶんの自動削除に使う
);
CREATE INDEX IF NOT EXISTS idx_orgs_seen ON orgs (seen_at);

-- 名簿 ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id  TEXT NOT NULL,
  name    TEXT NOT NULL,
  gender  TEXT NOT NULL DEFAULT '',           -- 男 / 女 / 空
  note    TEXT NOT NULL DEFAULT '',           -- 「退会」等が入ると名簿から外れる
  ord     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_members_org ON members (org_id, ord, id);

-- 行事（読み取った要項の置き場。出欠を受け付けるかはあとから決める） ----
CREATE TABLE IF NOT EXISTS taikai (
  org_id     TEXT NOT NULL,
  id         TEXT NOT NULL,                   -- tk から始まるID
  name       TEXT NOT NULL,
  date       TEXT NOT NULL DEFAULT '',
  deadline   TEXT NOT NULL DEFAULT '',
  place      TEXT NOT NULL DEFAULT '',
  items      TEXT NOT NULL DEFAULT '',        -- 種目。読点区切り
  youkou     TEXT NOT NULL DEFAULT '',        -- 要項へのリンク
  detail     TEXT NOT NULL DEFAULT '',        -- 読み取り結果（JSON）。OCRの生文は入れない
  event_id   TEXT NOT NULL DEFAULT '',        -- 空＝未使用。入っていれば出欠を作成ずみ
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS idx_taikai_org ON taikai (org_id, created_at DESC);

-- イベント（出欠を受け付けている行事） --------------------------------
CREATE TABLE IF NOT EXISTS events (
  org_id     TEXT NOT NULL,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  date       TEXT NOT NULL DEFAULT '',
  deadline   TEXT NOT NULL DEFAULT '',
  items      TEXT NOT NULL DEFAULT '',
  youkou     TEXT NOT NULL DEFAULT '',        -- 要項へのリンク
  place      TEXT NOT NULL DEFAULT '',        -- 会場名。回答画面の地図ボタンに使う
  address    TEXT NOT NULL DEFAULT '',        -- 会場の住所。あればこちらで地図を引く
  closed     INTEGER NOT NULL DEFAULT 0,      -- 手じまい。締切の判定とは別
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS idx_events_org ON events (org_id, date);

-- 紐付け（端末ID → 名簿の名前）。追記式、最新行を採用 ------------------
CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  gender     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_dev ON links (org_id, device_id, id DESC);

-- 回答。追記式、最新行を採用 -----------------------------------------
CREATE TABLE IF NOT EXISTS answers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  name       TEXT NOT NULL,                   -- 名簿の氏名。端末が変わっても追える
  item       TEXT NOT NULL,                   -- 種目。種目なしの行事は '' の1件
  mark       TEXT NOT NULL,                   -- 〇 / △ / ×
  device_id  TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_ev ON answers (org_id, event_id, name, item, id DESC);
