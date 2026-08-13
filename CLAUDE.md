# hakusan-attendance CLAUDE.md

## これは何か
**出欠ドロッパー**（汎用の出欠システム）v1 のソース。どの団体でも使える。LINE・LIFF非依存。
- `attend/` 参加者・主催者向けの静的ページ ／ `gas/` 主催者のシートに入れるGAS
- セットアップの本体は `gas/setup-ui.html`（**表の中**で動く画面）。主催者にセルを直接さわらせない。
  `attend/setup.html` は「表をコピー」と「ドロッパーへ登録」だけを受け持つ
- `dropper/attendance-hook.js` イベントドロッパーへ貼る連携モジュールの**原本**
- 公開先は **app.dropper-tools.com/attend/**（dropper-app リポジトリから配信）。
  このリポジトリの GitHub Pages はソース置き場で、ルートは案内だけの `index.html`

## 要点
- **リンク方式**：案内文に `attend/?s={デプロイID}&e={イベントID}`（約110字）を1本足すだけ
- **BYOB**：データは主催者自身のスプレッドシート。開発者は他団体の個人情報を預からない
- **識別**：名簿から名前を選ぶ＋端末記憶（localStorageのUUID）。whoamiによる自動識別は捨てた
- `s` はデプロイIDのみ載せる（URL全体だとLINEがリンク化できない長さになる）
- `createEvent` だけ書き込みキー必須。キーは主催者のブラウザのlocalStorageにのみ置く
- GASへのPOSTは `Content-Type: text/plain`（`application/json` はプリフライトでこける）
- 定数はすべて `attendance-api.gs` でのみ宣言（`tally.gs` で再宣言しない→SyntaxError）
- 回答は上書きせず追記し、集計は latest-row-wins

## ⚠ オリジンを混ぜない
端末IDの記憶は**アドレスの出どころごとに別物**。`app.dropper-tools.com` と
`moviepingpong-art.github.io` の両方に同じ `attend/` があるので、配るURLは
**app.dropper-tools.com に統一する**。混ぜると回答者が名前を選び直すことになる。

## 重要な注意事項
- 再デプロイは「デプロイを管理→既存を鉛筆編集→バージョン新しいバージョン→デプロイ」（URL不変）
- 「新しいデプロイ」を連発すると「アクティブなデプロイ無し」になるので注意
- 出欠作成に失敗したら**ボタン再押しのみ**（要項を再ドロップしない→カレンダー予定が重複する）
- 未回答者の名前を出すのは「集計」シートだけ。参加者に見える画面は人数のみ・男女別
- `onOpen` は承認なしで走る簡易トリガー。**showSidebar / showModalDialog は呼べない**
  （コピー直後の初回に必ず失敗する）。代わりに「はじめに」シートへ誘導を書いてある
- セットアップ画面は保存前に、匿名で `?action=ping` を叩いて「アクセス：全員」を確認する。
  `/dev` で終わるURLは採用しない（本人しか開けないため）
- `gas/appsscript.json` の `webapp` でデプロイ画面の初期値を「実行：自分／アクセス：全員」にしてある。
  `oauthScopes` は**書かない**（Apps Scriptの自動判定に任せる。手で並べると書き漏らしが実行時に落ちる）
- テンプレをコピーした表は、初回に `resetIfCopied_` が**書き込みキーを作り直しデプロイIDを捨てる**
  （設定B5のファイルIDと実物を突き合わせて判定）。キーの使い回しと、コピー元のURLを配る事故を防ぐ
- **Apps Script API でデプロイを自動化しない。** 利用者ごとに開発者向け設定でAPIアクセスを
  許可させる必要があり手間が増えるうえ、`script.deployments` の追加は承認済みスコープの再審査を招く

## イベントドロッパーとの連携
- `dropper/attendance-hook.js` が原本。dropper-app の `calendar*/attendance-hook.js` にコピーして使う
- dropper-app 側はカードの「🙋 出欠を作る」ボタン＋設定モーダルで実装ずみ（`docs/dropper-integration.md`）
- 設定は localStorage の `dropper.attend.deployId` / `dropper.attend.writeKey`（`attend/setup.html` と同名キー）
- 旧 `?club=hakusan`（CLUB_MODE・大会マスタ書き出し）は dropper-app から**撤去ずみ**

## 白山クラブ
- **旧LIFFシステムは一度も運用しないまま廃止**した（2026-08-12）。移行データなし
- 立ち上げ手順は `docs/hakusan-setup.md`
- LINEボットID：OZovWo / @015duxnb（リッチメニューの差し替え先は上記ドキュメント）
- 旧LIFF（2010475547-nDT2DLT8 / -YIPFjUme）と旧GASプロジェクト「大会出欠フォーム」は使わない
