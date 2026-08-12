# hakusan-attendance

**出欠ドロッパー** — 案内文にリンクを1本足すだけの出欠システム。どの団体でも使えます。
LINE・LIFF には依存しません。

公開先：[app.dropper-tools.com/attend/](https://app.dropper-tools.com/attend/)
（このリポジトリはソース。実際に配るURLは上記のものを使ってください）

---

## 考え方

**リンク方式。** [イベントドロッパー](https://app.dropper-tools.com/calendar/)の案内文に
「🙋 出欠を回答する」リンクを1本足すだけ。配信は各団体がすでに持っている
LINEグループ・LINE公式アカウント・メール等に任せます。
このツール自体は **LIFF も LINEログイン も Messaging API も使いません**。

**BYOB（Bring Your Own Backend）。** データは主催者自身のGoogleスプレッドシートにだけ保存されます。
ランニングコストはゼロで、開発者が他団体の個人情報を預かりません。

参加者の識別は **名簿から名前を選ぶ＋端末記憶**（localStorage の UUID）。最初の1回だけ選べば済みます。

```
[主催者] 要項PDF
   ↓ ドロップ
[イベントドロッパー]（別リポジトリ dropper-app）
   ├→ Googleカレンダーに登録
   ├→「出欠を作る」→ 主催者のGAS → イベント行を追加 → eventId
   └→ 案内文に「🙋 出欠を回答する」リンクを同梱
             ↓ 主催者がLINEグループ等に配信
[参加者] attend/?s={デプロイID}&e={イベントID}
             ↓ fetch
[主催者のGASウェブアプリ] → [主催者のスプレッドシート]
```

## ファイル

| ファイル | 役割 | 対象 |
|---|---|---|
| `attend/index.html` | 出欠回答（`e` ありでイベント個別／なしで一覧） | 参加者 |
| `attend/my.html` | わたしの回答 | 参加者 |
| `attend/status.html` | 集計閲覧（人数のみ・個人名なし） | だれでも |
| `attend/setup.html` | テンプレのコピーと、イベントドロッパーへの登録 | 主催者 |
| `attend/attend.js` `attend/attend.css` | 共通ロジック・共通スタイル | — |
| `gas/attendance-api.gs` | GAS本体（doGet / doPost 全action、初期設定メニュー） | 主催者のシートに同梱 |
| `gas/tally.gs` | `shukei()`。男女別6列＋未回答者名 | 同上 |
| `gas/setup-ui.html` | 表の中で動くセットアップ画面（団体名・人数分の名簿入力・デプロイ案内・URL発行） | 同上 |
| `dropper/attendance-hook.js` | イベントドロッパーに貼り込む連携モジュールの原本 | dropper-app へコピー |
| `index.html` | 案内だけの入口ページ | — |

## URL

```
イベント個別： https://app.dropper-tools.com/attend/?s={デプロイID}&e={イベントID}   ← 全体で約110字
一覧　　　　： https://app.dropper-tools.com/attend/?s={デプロイID}
わたしの回答： https://app.dropper-tools.com/attend/my.html?s={デプロイID}
集計　　　　： https://app.dropper-tools.com/attend/status.html?s={デプロイID}
```

`s` は **GASのデプロイIDだけ**（`…/macros/s/【ここ】/exec`）。URL全体を載せると
LINEがリンク化できない長さ（実測：237字は可・453字は不可）に入ってしまうためです。
`s` が露出しても、書き込みキーがなければイベントは作れません。

> ⚠ **配るURLの出どころ（オリジン）を混ぜないこと。**
> 端末の記憶はオリジンごとに別物なので、`app.dropper-tools.com` と `github.io` を混ぜると
> 回答する人が名前を選び直すことになります。**すべて app.dropper-tools.com に統一してください。**

## ドキュメント

- [セットアップ手順・データ構造・API仕様](docs/setup-guide.md)
- [イベントドロッパー側の連携](docs/dropper-integration.md)
- [白山クラブの立ち上げ手順](docs/hakusan-setup.md)

## 使う前に設定するところ

| 場所 | 何を |
|---|---|
| `attend/attend.js` の `TEMPLATE_COPY_URL` | 配布用テンプレのコピーURL（空だと `setup.html` が手動手順の案内になる） |
| `dropper/attendance-hook.js` の `ATTEND_BASE` | `attend/` を公開したURL（dropper-app 側は設定ずみ） |

## v1 でやらないこと

ライセンス／課金ゲート、en・in 版への同期、要項PDFのフォーム内表示、プッシュ通知・自動リマインド、
凝った管理画面（**名簿は表の中のセットアップ画面から、イベントはシートを直接編集する。これは仕様**）。

## 旧・白山クラブ専用版について

LIFF を使った旧システム（`index.html` / `myanswers.html` / `status.html`）がありましたが、
**一度も運用しないまま役目を終えた**ため削除しました。履歴は git に残っています。

## ライセンス

無断利用禁止（All Rights Reserved）。詳細は [LICENSE](LICENSE) を参照。
