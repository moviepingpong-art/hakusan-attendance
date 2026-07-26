# hakusan-attendance

白山ラージボール卓球クラブ（石川県）の**大会出欠システム**フロントエンドです。
LINE（LIFF）から会員が大会の出欠を回答し、集計を閲覧できます。

## ページ構成

| ファイル | 役割 | 対象 |
|---|---|---|
| `index.html` | 大会出欠フォーム（入力） | 会員（LINEから） |
| `myanswers.html` | 自分のエントリー状況の確認・修正 | 会員（LINEから） |
| `status.html` | 大会ごとの出欠集計（人数）閲覧 | 全員 |

## 主な機能

- **出欠回答**：種目別に 〇参加／△どちらでも／×不参加 をタップで回答。締切前は何度でも修正可。要項PDFをその場で開閉。
- **自分の回答確認**：大会ごとの回答一覧、未回答の警告、締切3日前カウントダウン。
- **出欠状況の閲覧**：〇△×を男女別人数で集計表示。個人名は非表示（人数のみ）。

## 技術構成

- **フロント**：静的HTML（GitHub Pages で公開）
- **バックエンド**：Google Apps Script（GAS）API
- **認証・配信**：LINE LIFF
- **データ保存**：Google スプレッドシート

## 公開URL

https://moviepingpong-art.github.io/hakusan-attendance/

## ライセンス

無断利用禁止（All Rights Reserved）。詳細は [LICENSE](LICENSE) を参照。
