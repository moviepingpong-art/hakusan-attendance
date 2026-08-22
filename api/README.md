# 出欠ドロッパー API（Cloudflare Worker）

GAS版の置き換え。計画の全体像は [`../docs/backend-plan.md`](../docs/backend-plan.md)。

**いまは段階3まで。** 主催者の管理画面（`attend/admin.html`）から、
団体づくり・名簿・行事の取り込み・出欠の作成・集計・削除まで通しで動く。
残っているのは白山クラブの作り直しと、GAS版の後始末（段階4・5）。

---

## 中身

| ファイル | 何か |
|---|---|
| `src/index.js` | API本体。これ1本 |
| `schema.sql` | D1のテーブル定義 |
| `wrangler.toml` | Workerの設定。`database_id` だけ手で埋める |

依存パッケージは無い。`npm install` は要らない。

---

## 初回の手順

Cloudflareにログインした状態で、`api/` の中で実行する。
**カード登録は要らない**（Workers・D1とも無料枠のまま始められる）。

```bash
cd api

# 1. Cloudflareにログイン（ブラウザが開く）
npx wrangler login

# 2. データベースを作る
npx wrangler d1 create dropper-attendance
```

2の出力に `database_id = "…"` が出るので、**その値を `wrangler.toml` に貼る**。
ここを間違えると、あとで「テーブルが無い」と言われる。

```bash
# 3. テーブルを作る（本番側）
npx wrangler d1 execute dropper-attendance --remote --file=./schema.sql

# 4. 公開する
npx wrangler deploy
```

4で `api.dropper-tools.com` が生える。DNSはCloudflare管理なので、こちらの操作は要らない。

### 動いているか確かめる

```bash
curl "https://api.dropper-tools.com/?action=ping&s=でたらめ"
```

`{"ok":false,"notFound":true,…}` が返れば動いている。
**繋がらないときにブラウザが「CORSでブロック」と言うことがあるが、たいていは別の失敗である。**
まず `curl` で素の応答を見ること（GAS版の404で実際にはまった。`../CLAUDE.md` 参照）。

---

## 直したあと

```bash
npx wrangler deploy
```

GASのような「デプロイを管理→鉛筆→新しいバージョン」の作法は無い。URLも変わらない。

### ★ 順番を守ること

**`git pull` → マイグレーション → `deploy`。** この順を崩すと本番が止まる。

`schema.sql` は `CREATE TABLE IF NOT EXISTS` なので、**すでにあるテーブルには列が増えない。**
列を足したときは `migrations/` に1本置き、`--remote` で流す。

```bash
npx wrangler d1 execute dropper-attendance --remote --file=./migrations/0001-events-place.sql
```

`pull` を忘れるとマイグレーションのファイルがそもそも手元に無く、
それに気づかず `deploy` だけ通すと、**新しいコードが存在しない列を読んで出欠ページが落ちる**
（実際にやった）。落ちたときは、pull してマイグレーションを流せば復旧する。deploy のやり直しは要らない。

二度流しても `duplicate column name` で止まるだけで、害はない。

---

## 手元で試す

本物のCloudflareを使わずに動かせる。D1のかわりに `node:sqlite` を使う。

```bash
node /path/to/scratchpad/apitest.js
```

`api/src/index.js` は一切いじらずに、そのまま読み込んで叩いている。

---

## 設計のきまりごと

**主催者の認証は「管理リンク」1本。**
団体をつくるときに合鍵（`adminKey`）を1回だけ返し、こちらは SHA-256 しか保存しない。
なくすと復旧できないので、画面で強く念を押すこと。

- 合鍵は**必ずPOSTの本文で受け取る**。クエリに載せるとアクセスログや Referer に残る
- 管理リンクは `admin.html?s=…#k=<合鍵>` の形。**`#` のうしろはサーバーに送られない**
- ログインが要らないので、**LINEの内蔵ブラウザでも動く**（Googleログインだと弾かれる）

**回答と紐付けは追記式、集計は最新行を採用。** GAS版と同じ。`UPDATE` を書きたくなったら立ち止まる。

**action名と応答の形はGAS版に合わせてある。** 参加者側の `attend/*.html` は
URLの組み立てだけ差し替えれば動く。ここを崩すと段階2の手間が増える。

**エラーでもCORSヘッダーを必ず付ける。** 付け忘れると、ブラウザは中身ではなく
「CORSでブロック」と報告して原因が見えなくなる。

**`ALLOW_ORIGINS` を増やすときは慎重に。** 端末の記憶は出どころごとに別物なので、
参加者が名前を選び直すことになる。配るURLは `app.dropper-tools.com` に統一する。

---

## まだ無いもの

- 放置された団体の自動削除（Cron Triggers）
- 荒らし対策のレート制限
- 主催者が自分のスプレッドシートへ書き出す機能（計画では「後から足す」としてある）

## 主催者の管理画面

`attend/admin.html`。合鍵つきのリンクで開く。

- 合鍵なしで開くと「団体をつくる」から始まる
- つくった直後に**管理リンクを1回だけ見せる**。ここで保存させないと戻せない
- `?k=` で来た場合は `#k=` に移し替えてから読む（クエリに残さないため）

### 消すときの順番

**行事 → 出欠 の親子関係を守る。**

- 出欠を消すと、その回答も消え、元の行事は「未使用」に戻る（作り直せる）
- 行事は「未使用」のときだけ消せる。出欠を作ってあるなら先に出欠のほうを消す

逆を許すと、出欠だけが親なしで残って画面から辿れなくなる。
