# hakusan-attendance

出欠システムのフロントエンドです。いま2世代が同居しています。

- **`attend/` … 汎用版（出欠ドロッパー）v1** — どの団体でも使える。LINE・LIFFに依存しない
- **ルートの3ファイル … 旧・白山クラブ専用版** — 移行が済むまで残す

白山クラブ自身も汎用版へ移行します（[移行手順](docs/migration-hakusan.md)）。

---

## 汎用版（`attend/`）

### 考え方

**リンク方式。** カレンダードロッパーの案内文に「🙋 出欠を回答する」リンクを1本足すだけ。
配信は各団体がすでに持っている LINEグループ・LINE公式アカウント・メール等に任せる。
このツール自体は **LIFF も LINEログイン も Messaging API も使わない**。

**BYOB（Bring Your Own Backend）。** データは主催者自身のGoogleスプレッドシートにだけ保存される。
ランニングコストはゼロで、開発者が他団体の個人情報を預からない。

参加者の識別は **名簿から名前を選ぶ＋端末記憶**（localStorage の UUID）。最初の1回だけ選べばよい。

```
[主催者] 要項PDF
   ↓ ドロップ
[カレンダードロッパー]（別リポジトリ dropper-app）
   ├→ Googleカレンダーに登録
   ├→「出欠を作る」→ 主催者のGAS → イベント行を追加 → eventId
   └→ 案内文に「🙋 出欠を回答する」リンクを同梱
             ↓ 主催者がLINEグループ等に配信
[参加者] attend/?s={デプロイID}&e={イベントID}
             ↓ fetch
[主催者のGASウェブアプリ] → [主催者のスプレッドシート]
```

### ファイル

| ファイル | 役割 | 対象 |
|---|---|---|
| `attend/index.html` | 出欠回答（`e` ありでイベント個別／なしで一覧） | 参加者 |
| `attend/my.html` | わたしの回答 | 参加者 |
| `attend/status.html` | 集計閲覧（人数のみ・個人名なし） | だれでも |
| `attend/setup.html` | セットアップウィザード（1ステップ1画面） | 主催者 |
| `attend/attend.js` `attend/attend.css` | 共通ロジック・共通スタイル | — |
| `gas/attendance-api.gs` | GAS本体（doGet / doPost 全action、初期設定メニュー） | 主催者のシートに同梱 |
| `gas/tally.gs` | `shukei()`。男女別6列＋未回答者名 | 同上 |
| `dropper/attendance-hook.js` | カレンダードロッパーに貼り込む連携モジュール | dropper-app へコピー |

### URL

```
イベント個別： https://{公開先}/attend/?s={デプロイID}&e={イベントID}     ← 全体で約110字
一覧　　　　： https://{公開先}/attend/?s={デプロイID}
わたしの回答： https://{公開先}/attend/my.html?s={デプロイID}
集計　　　　： https://{公開先}/attend/status.html?s={デプロイID}
```

`s` は **GASのデプロイIDだけ**（`…/macros/s/【ここ】/exec`）。URL全体を載せると
LINEがリンク化できない長さ（実測：237字は可・453字は不可）に入ってしまうため。
`s` が露出しても、書き込みキーがなければイベントは作れない。

### ドキュメント

- [セットアップ手順・データ構造・API仕様](docs/setup-guide.md)
- [カレンダードロッパー側の改修](docs/dropper-integration.md)
- [白山クラブの移行手順](docs/migration-hakusan.md)

### 使う前に設定するところ

| 場所 | 何を |
|---|---|
| `attend/attend.js` の `TEMPLATE_COPY_URL` | 配布用テンプレのコピーURL（空だと `setup.html` が手動手順の案内になる） |
| `dropper/attendance-hook.js` の `ATTEND_BASE` | `attend/` を公開したURL |

### v1 でやらないこと

ライセンス／課金ゲート、en・in 版への同期、要項PDFのフォーム内表示、プッシュ通知・自動リマインド、
主催者向けの管理画面（**名簿もイベントもスプレッドシートを直接編集する。これは仕様**）。

---

## 旧・白山クラブ専用版（ルート）

| ファイル | 役割 |
|---|---|
| `index.html` | 大会出欠フォーム（LIFF） |
| `myanswers.html` | 自分のエントリー状況（LIFF） |
| `status.html` | 出欠集計の閲覧 |

公開URL：https://moviepingpong-art.github.io/hakusan-attendance/
汎用版へ移行して2週間ほど様子を見たあと停止します。

## ライセンス

無断利用禁止（All Rights Reserved）。詳細は [LICENSE](LICENSE) を参照。
