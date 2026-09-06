-- 出欠システム — D1 スキーマ
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
  lang        TEXT NOT NULL DEFAULT 'ja',      -- 参加者に配る画面の言語（ja / en / in）
  -- 回答者の名前を参加者にも見せるか。0=伏せる（男女の数だけ）／1=見せる。
  -- **主催者の管理画面は、この設定に関わらず必ず名前が出る**（メンバー選定に要るため）
  show_names  INTEGER NOT NULL DEFAULT 0,
  -- 役員に見せる「閲覧リンク」の鍵のSHA-256。NULL ＝ まだ発行していない。
  -- 合鍵とは別の鍵で、**見るだけ**。作り直せば前のリンクは使えなくなる
  view_hash   TEXT,
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
  deadline   TEXT NOT NULL DEFAULT '',      -- 出欠入力の締切
  entry_deadline TEXT,                     -- 申込締切。events へ写すまでの中継
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
  -- **出欠入力の締切**。メンバーが答える期限で、isPast() で回答を止めているのはこちら
  deadline   TEXT NOT NULL DEFAULT '',
  -- 申込締切（大会主催者へ申し込む期限）。**主催者が見るためだけで、締めには使わない**。
  -- deadline ＝ entry_deadline − N日。逆算はイベントドロッパー側で済んでいる
  entry_deadline TEXT,
  items      TEXT NOT NULL DEFAULT '',
  youkou     TEXT NOT NULL DEFAULT '',        -- 要項へのリンク
  place      TEXT NOT NULL DEFAULT '',        -- 会場名。回答画面の地図ボタンに使う
  address    TEXT NOT NULL DEFAULT '',        -- 会場の住所。あればこちらで地図を引く
  -- 主催者がその回だけ伝えたいこと。要項に書いていない連絡事項の置き場
  -- （「駐車場は南側」「ゼッケンを忘れずに」）。参加者の一言（notes）の逆方向
  memo       TEXT NOT NULL DEFAULT '',
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

-- 参加者の一言。追記式、最新行を採用 -----------------------------------
-- answers は種目ごとに1行だが、コメントは人につき1つなので別に持つ
-- （answers に列を足すと、種目3つの行事で同じ文が3回入る）。
-- 消したいときは空文字を1行足す（最新行が空＝コメント無し）。
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
