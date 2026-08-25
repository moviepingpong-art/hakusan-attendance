# hakusan-attendance

**出欠ドロッパー** — 案内文にリンクを1本足すだけの出欠システム。どの団体でも使えます。
LINE・LIFF には依存しません。

公開先：[app.dropper-tools.com/attend/](https://app.dropper-tools.com/attend/)
（このリポジトリはソース。実際に配るURLは上記のものを使ってください）

---

## 考え方

**主催者の手間をゼロに近づける。** 団体名とメンバーのお名前を入れるだけ。
表の用意も、アプリの登録も、承認の画面も要りません。**スマホだけで数分**で終わります。

**メニュー方式。** 主催者は3本のURLを1回だけ配れば、あとは増やしません。
LINE公式アカウントのリッチメニューに貼っておけば、行事が増えても貼り直しは不要です。

**参加者はログイン不要。** 名簿から名前を選ぶ＋端末記憶（localStorage の UUID）。
最初の1回だけ選べば済みます。

```
[主催者] 要項PDF
   ↓ ドロップ
[イベントドロッパー]（別リポジトリ dropper-app）
   ├→ Googleカレンダーに登録
   ├→「🙋 出欠システムに保存」→ 管理画面を開く
   └→ 案内文（URLなし。末尾に「メニューの出欠入力から」の1行）
   ↓
[管理画面 attend/admin.html] → 取り込みは自動 → 「この内容で出欠を受け付ける」
   ↓
[参加者] attend/?s={団体ID}
   ↓ fetch
[api.dropper-tools.com]（Cloudflare Worker）→ [D1]
```

## ファイル

| ファイル | 役割 | 対象 |
|---|---|---|
| `attend/index.html` | 参加者の3画面をタブで束ねた1本（`e` ありでイベント個別／なしで一覧） | 参加者 |
| `attend/my.html` `attend/status.html` | **転送だけ**。古いリンクを `index.html` の該当タブへ送る | — |
| `attend/attend-views.js` | 「わたしの回答」「出欠確認」の中身。`index.html` のタブが使う | — |
| `attend/admin.html` | 主催者の管理画面。団体づくり・名簿・行事・出欠・集計・削除 | 主催者 |
| `attend/setup.html` | `admin.html` への転送だけ（外から張られた古いリンク用） | — |
| `attend/attend.js` `attend/attend.css` | 共通ロジック・共通スタイル | — |
| `api/src/index.js` | API本体（Cloudflare Worker） | — |
| `api/schema.sql` `api/migrations/` | D1のテーブル定義と、あとから列を足す指示 | — |
| `dropper/attendance-hook.js` | イベントドロッパーに貼り込む連携モジュールの原本 | dropper-app へコピー |
| `index.html` | 案内だけの入口ページ | — |

## URL

```
配るのはこれ： https://app.dropper-tools.com/attend/?s={団体ID}
イベント個別　： https://app.dropper-tools.com/attend/?s={団体ID}&e={イベントID}
管理　　　　　： https://app.dropper-tools.com/attend/admin.html?s={団体ID}#k={合鍵}
```

**配るのは1本目だけ。管理リンクは配ってはいけません。**

下のタブで「出欠入力／わたしの回答／出欠確認」を行き来できます
（`#my` `#status` を付ければ、その画面を開いた状態で始まります）。
`my.html` / `status.html` は 2026-08-25 に**転送ページ**になりました。古いリンクを踏んでも
同じ1本の該当タブに着きます（同じオリジンなので端末の記憶も引き継がれます）。
団体IDを知っていれば名簿の氏名は見えます（推測できない長さにしてあります）。
合鍵は `#` のうしろに置いてあり、サーバーには送られません。

> ⚠ **配るURLの出どころ（オリジン）を混ぜないこと。**
> 端末の記憶はオリジンごとに別物なので、`app.dropper-tools.com` と `github.io` を混ぜると
> 回答する人が名前を選び直すことになります。**すべて app.dropper-tools.com に統一してください。**

## データの置き場

**出欠のデータは開発者のCloudflare（D1）に保存されます。**
以前は主催者自身のGoogleスプレッドシートに置く方式（BYOB）でしたが、
主催者のセットアップが重すぎたため載せ替えました。経緯は [`docs/backend-plan.md`](docs/backend-plan.md)。

主催者は管理画面の「この団体を削除する」で、いつでも全部消せます。

> シリーズの他の3本（イベント・予定表・決めごと）は**今までどおりブラウザ完結**で、
> データを預かりません。サーバーを持つのは出欠だけです。

## ドキュメント

- [API と Worker の手順](api/README.md)
- [自前バックエンドへの載せ替え計画](docs/backend-plan.md)
- [イベントドロッパー側の連携](docs/dropper-integration.md)
- [白山クラブの立ち上げ手順](docs/hakusan-setup.md)

## 旧GAS版について

主催者ごとにスプレッドシートをコピーし、Apps Script をデプロイして使う方式でした。
**2026-08-22 に削除しました。** 使っている団体が無いことを確かめたうえでの撤去です。
コードは git 履歴に残っています（`gas/` と、`attend.js` の `AKfycb…` 振り分け）。

## 旧・白山クラブ専用版について

LIFF を使った旧システム（`index.html` / `myanswers.html` / `status.html`）がありましたが、
**一度も運用しないまま役目を終えた**ため削除しました。履歴は git に残っています。

## ライセンス

無断利用禁止（All Rights Reserved）。詳細は [LICENSE](LICENSE) を参照。
