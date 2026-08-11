# hakusan-attendance CLAUDE.md

## リポジトリの構成（2世代が同居）
- `attend/` `gas/` `dropper/` `docs/` … **汎用版（出欠ドロッパー）v1**。どの団体でも使える。LINE・LIFF非依存
- ルートの `index.html` / `myanswers.html` / `status.html` … 旧・白山専用版（LIFF）。移行完了まで残す
- 汎用版の詳細は `docs/setup-guide.md`、白山の移行は `docs/migration-hakusan.md`

## 汎用版の要点
- **リンク方式**：案内文に `attend/?s={デプロイID}&e={イベントID}`（約110字）を1本足すだけ
- **BYOB**：データは主催者自身のスプレッドシート。開発者は他団体の個人情報を預からない
- **識別**：名簿から名前を選ぶ＋端末記憶（localStorageのUUID）。whoamiによる自動識別は捨てた
- `s` はデプロイIDのみ載せる（URL全体だとLINEがリンク化できない長さになる）
- `createEvent` だけ書き込みキー必須。キーは主催者のブラウザのlocalStorageにのみ置く
- GASへのPOSTは `Content-Type: text/plain`（`application/json` はプリフライトでこける）
- 汎用版GASも定数はすべて `attendance-api.gs` でのみ宣言（`tally.gs` で再宣言しない→SyntaxError）

## 基本情報
- リポジトリ：moviepingpong-art/hakusan-attendance
- フォームURL：https://moviepingpong-art.github.io/hakusan-attendance/
- 閲覧ページ：status.html
- LIFFアプリID：2010475547-nDT2DLT8

## GAS構成
- 「大会出欠フォーム.gs」v7 — API本体（members/whoami/大会取得/summary/register）
- 「集計.gs」v2 — 種目ごと〇△×の男女別集計
- `SS_ID` / `ANSWER_SHEET` / `LINK_SHEET` / `TIME_ZONE` / `normKey_()` は「大会出欠フォーム.gs」でのみ宣言（集計.gsでは再宣言しない→SyntaxError）

## 重要な注意事項
- 再デプロイは「デプロイを管理→既存を鉛筆編集→バージョン新しいバージョン→デプロイ」（URL不変）
- 「新しいデプロイ」を連発すると「アクティブなデプロイ無し」になるので注意
- 障害復旧時：マスタ追記失敗なら「登録」ボタン再押しのみ（要項を再ドロップしない→カレンダー予定が重複する）

## 主要ID
- マスタシートID：1vhj6aHO_bAq5ujUhKtWOWC354ilDKQil-Z5xXI5apco
- LINEボットID：OZovWo / @015duxnb
- MASTER_SS_ID：（大会出欠フォーム.gs内の定数）

## カレンダードロッパーとの連携
- 【旧】dropper-app の `?club=hakusan` モードがマスタシートに書き込む
- 【旧】クラブ運用URLは必ず `?club=hakusan` を正確に末尾に付ける
- 【新】`dropper/attendance-hook.js` を dropper-app の `calendar/` にコピーして使う（手順は `docs/dropper-integration.md`）
- 【新】`?club=hakusan` の CLUB_MODE 分岐は移行完了後に撤去可否を判断する
