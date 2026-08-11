# イベントドロッパー側の連携（Phase 5・実装済み）

**実装先は別リポジトリ `moviepingpong-art/dropper-app`。** このリポジトリには連携モジュールの原本
[`dropper/attendance-hook.js`](../dropper/attendance-hook.js) と、この記録を置いてある。
`dropper-app` 側の変更はブランチ `claude/generic-attendance-system-r33wsi` に入っている。

---

## dropper-app に入れたもの

```
dropper-app/
  attend/                        ← このリポジトリの attend/ をそのままコピー
  calendar/attendance-hook.js    ← dropper/attendance-hook.js をコピー（3言語ぶん）
  calendar/app.js                ← 出欠連携を追加、旧クラブモードを撤去
  calendar/i18n.js               ← attend* / annAttend キーを ja/en/in に追加
  calendar/index.html            ← 設定モーダル＋CSS＋script タグ
  （calendar-en / calendar-in も同じ。app.js と i18n.js はバイト単位で同一）
```

`attendance-hook.js` 冒頭の `ATTEND_BASE` が公開URL（`https://app.dropper-tools.com/attend/`）。
`attend/` の置き場所を変えたらここも変える。

---

## 画面の流れ

カードの「AIで検算」と「案内文を作る」のあいだに1行足してある。

| 状態 | 表示 | 押すと |
|---|---|---|
| 未設定 | `🙋 出欠の回答フォームを付ける` | 設定モーダルが開く |
| 設定ずみ | `🙋 出欠を作る` ＋ ⚙ | 出欠イベントを1件作る |
| 作成ずみ | `✓ 出欠を作りました`（押せない） | — |

設定モーダル（`#attend-modal`）は APIキー入力モーダルと同じ作り。
`…/exec` のURLと書き込みキーを入れて「保存して確認」を押すと、**`checkKey` で両方を確かめてから**
localStorage に保存する。確認が通らないものは保存しない。
「まだ用意していない方へ」から `attend/setup.html` に飛べる。

作成に失敗したときは**ボタンを押せる状態に戻す**。要項を入れ直させない（再ドロップはカレンダー予定が重複する）。

---

## 案内文への同梱

`buildAnnouncementBody_` の3チャネルすべてに入る。位置は**カレンダー追加リンクの上**
（回答には締切があり、先に見てほしいのはこちら）。

```
LINE ： 🙋 出欠を回答する ▶ https://app.dropper-tools.com/attend/?s=…&e=…
X　　： 同上（ただしカレンダー追加リンクを落とす）
汎用 ： ▼ 出欠を回答する
        https://app.dropper-tools.com/attend/?s=…&e=…
```

- 行の形は**ドロッパー既存のリンク行（地図・カレンダー）に合わせた**。引き継ぎ資料の指定は
  「🙋 出欠を回答する」＋改行＋URLの2行だったが、同じ案内文の中で書式が割れるのを避けた。
  2行にしたい場合は `app.js` の `'🙋 ' + I18N.t('annAttend') + ' ▶ ' + attend` を
  `'🙋 ' + I18N.t('annAttend') + '\n' + attend` に変えるだけ。
- **X タブは出欠リンクを優先し、カレンダー追加リンクを落とす。** URLを2本入れると本文が押し出されるため。
- **`add/` の中継（`annRedirect_`）は通していない。** 出欠URLに `%` が無いので、通すと
  二重エンコードの元を増やすだけになる。
- 画像書き出し（`annStripUrls_`）はURL行を落とすので、出欠リンクも画像には入らない。
  画像内のURLはタップできないため、これが正しい挙動。

---

## 撤去したもの（旧クラブモード）

`?club=hakusan` の CLUB_MODE と、それに紐づく大会マスタ・シート書き出しを**全部消した**。

- `CLUB_MODE` / `MASTER_SHEET_TITLE` / `CLUB_EXTRA_SCOPES`（`spreadsheets`）
- `ensureMasterSheet_` / `appendMasterRow_` / `masterRowFromFields_` / `MASTER_HEADERS`
- カードの「出欠フォームに載せる（大会マスタへ書き出し）」チェックと `masterOptIn`
- `doRegister` のマスタ追記・再試行まわり、種目空チェック（②-2）
- i18n の `msgEventEmptyA` / `msgEventEmptyB`

**OAuthスコープは減った（`spreadsheets` が消えた）だけで、増えていない。** 承認済みの3スコープはそのまま。
出欠システムとの通信は主催者のGASが相手で、Googleの権限を使わない。

**残して流用したもの**：種目・締切・開催日の整形（`attendEvents_` ← `masterEvents_`、
`attendDeadline_`、`attendEventDate_`）。実チラシで詰めた判定なので作り直していない。
`NON_EVENT_RE` が「予選リーグ」「決勝トーナメント」等の競技方法を種目候補から弾く。

> ⚠ **旧システムはこの変更が公開された時点で新しい大会を受け取れなくなる。**
> 白山クラブの移行（[migration-hakusan.md](migration-hakusan.md)）は、この変更の公開と同時か、先に行うこと。

---

## 3言語同期

`dropper-app` の鉄則どおり、`app.js` と `i18n.js` は3フォルダで**バイト単位で同一**。
`index.html` の追加部分も3言語で完全同一（差分はもともとあるSEOヘッダと `window.LANG` だけ）。

出欠UIは **`ATTEND_AVAILABLE`（`window.LANG` が ja のときだけ true）で日本語版にしか出していない**。
`attend/` が日本語のため。i18n キーは en / in も揃えてあるので、`attend/` を訳したら
`ATTEND_AVAILABLE` を外すだけで3言語に出せる。

---

## 実機で確かめること

自動テストでは、要項カード →「出欠を作る」→ 案内文 → その出欠リンクを開いて回答、までを
ブラウザで通してある（GASは本物の `.gs` をNodeで実行して応答）。残るのは実機確認だけ。

- [ ] **LINEに貼って、出欠リンクが青下線・タップ可になること**（110字。実測128字は可なので収まるはず）
- [ ] LINE直行ボタン（`line.me/R/msg/text/?`）経由でも出欠リンクが壊れないこと
- [ ] スマホのブラウザで `attend/` が開き、名前選択→回答まで通ること
