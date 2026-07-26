# hakusan-attendance CLAUDE.md

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
- dropper-app の `?club=hakusan` モードがマスタシートに書き込む
- クラブ運用URLは必ず `?club=hakusan` を正確に末尾に付ける
