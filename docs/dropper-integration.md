# カレンダードロッパー側の改修（Phase 5）

改修対象は **別リポジトリ `dropper-app`** です。このリポジトリには、そこへ貼り込むための
モジュール [`dropper/attendance-hook.js`](../dropper/attendance-hook.js) と、この手順書だけを置いてあります。

対象ファイル：`calendar/app.js`（日本語版）／`calendar/index.html`（CSS・DOM）／`i18n.js`（jaキー）
**`parser.js` は変更しない。**

---

## 0. 置き場所

```
dropper-app/
  attend/                    ← このリポジトリの attend/ をそのままコピー
    index.html  my.html  status.html  setup.html  attend.js  attend.css
  calendar/
    attendance-hook.js       ← このリポジトリの dropper/attendance-hook.js をコピー
    app.js  index.html  parser.js  i18n.js
```

`attendance-hook.js` の先頭にある `ATTEND_BASE` を公開URLに合わせる。

```js
var ATTEND_BASE = 'https://app.dropper-tools.com/attend/';
```

`calendar/index.html` の `app.js` より **前** に読み込む。

```html
<script src="attendance-hook.js"></script>
<script src="app.js"></script>
```

`attend/setup.html` と `calendar/` が同じオリジンにあることが前提です（localStorage を共有して
書き込みキーを受け渡すため）。別オリジンに置く場合は、ドロッパーの設定欄にキーを手で貼ってもらう。

---

## 追加① 設定欄

ドロッパーの設定パネルに、1回だけ登録する欄を足す。値は `AttendanceHook` が localStorage に持つ。

```html
<div class="setting-group">
  <label>出欠システムのURL（…/exec）</label>
  <input type="url" id="attendUrl" placeholder="https://script.google.com/macros/s/.../exec">
  <label>書き込みキー</label>
  <input type="password" id="attendKey">
  <button type="button" id="attendSave">保存して確認</button>
  <p id="attendMsg"></p>
  <p class="hint">まだ用意していない方は <a href="../attend/setup.html" target="_blank">セットアップ手順</a> から。</p>
</div>
```

```js
document.getElementById('attendSave').addEventListener('click', function () {
  var msg = document.getElementById('attendMsg');
  msg.textContent = '確認しています…';
  AttendanceHook.saveSettings({
    deployId: document.getElementById('attendUrl').value,
    writeKey: document.getElementById('attendKey').value
  }).then(function (res) {
    msg.textContent = '✓ つながりました：' + res.org;
    refreshAttendUi();          // ↓ 追加②のボタン表示を切り替える
  }).catch(function (e) {
    msg.textContent = String(e.message || e);
  });
});
```

**未設定なら以降の機能は非表示。** `AttendanceHook.configured()` で判定する。

---

## 追加② 「出欠を作る」ボタン

カレンダー登録ボタンの隣に置く。押すと `createEvent` を投げ、返った `eventId` を保持する。

```js
var attendEventId = null;      // ドロップ1件につき1つ。再ドロップでリセットされる

function refreshAttendUi() {
  document.getElementById('attendCreate').hidden = !AttendanceHook.configured();
}

document.getElementById('attendCreate').addEventListener('click', function () {
  var btn = this;
  var msg = document.getElementById('attendCreateMsg');
  btn.disabled = true;
  msg.textContent = '出欠を作っています…';

  AttendanceHook.createEvent({
    name:     extracted.taikaimei,      // 抽出ずみの値をそのまま渡す
    date:     extracted.kaisaibi,
    deadline: extracted.shimekiri,
    items:    extracted.shumoku,        // 配列でも「、」区切りの文字列でもよい
    youkou:   extracted.youkouUrl || ''
  }).then(function (res) {
    attendEventId = res.eventId;
    msg.textContent = res.existing
      ? '✓ すでに作られていた出欠を使います'
      : '✓ 出欠を作りました';
    btn.textContent = '出欠は作成ずみ';
    rebuildAnnouncements();             // 追加③：案内文を作り直す
  }).catch(function (e) {
    msg.textContent = String(e.message || e);
    btn.disabled = false;               // ★同じ画面で押しなおせるようにする
  });
});
```

- **失敗しても要項を再ドロップさせない。** 再ドロップはカレンダー予定が重複する原因になる。
  ボタンを押しなおすだけで復帰できる状態に必ず戻すこと。
- 同じ大会名・同じ開催日の行がすでにあるときは、GAS 側が新しく作らずに元のIDを
  `existing: true` で返す。二重押しでイベントが増えることはない。

---

## 追加③ 案内文への同梱

出欠を作成ずみのときだけ、案内文（LINE／X／汎用の全タブ）に2行足す。

```
🙋 出欠を回答する
https://app.dropper-tools.com/attend/?s=…&e=…
```

`buildAnnouncement_` 系の、カレンダーリンク・地図リンク・クレジット行と並ぶ位置に差し込む。

```js
var attendLine = attendEventId ? AttendanceHook.announcementLine(attendEventId) : '';
// …
if (attendLine) lines.push(attendLine);
```

守ること：

- **既存の `annRedirect_`（`add/` 中継ページ）は通さない。**
  出欠URLに `%` が含まれないので、中継すると二重エンコードの問題を持ち込むだけ。
- **X タブは字数の都合で出欠リンクを優先し、必要なら他の行を落とす。**
  出欠2行分の長さは `AttendanceHook.lineLength(attendEventId)` で取れる。
- 出欠リンクは全体で **約110字**。LINE の実測（地図128字は可／カレンダー453字は不可／237字は可）から見て、
  地図リンクより短く安全圏。`s` にはデプロイIDだけを載せ、GASのURL全体は載せない。

---

## 追加④ i18n（ja のみ）

v1 は日本語版だけ。en / in への同期は後でまとめて行う。

```js
ja: {
  attend_settings_title: '出欠システム',
  attend_settings_url:   '出欠システムのURL（…/exec）',
  attend_settings_key:   '書き込みキー',
  attend_settings_save:  '保存して確認',
  attend_create:         '出欠を作る',
  attend_created:        '出欠は作成ずみ',
  attend_creating:       '出欠を作っています…',
  attend_ann_label:      '🙋 出欠を回答する'
}
```

---

## 完了条件

要項のドロップ →「出欠を作る」→ 案内文コピー、までが一気通貫で通り、
**LINE に貼ったときに出欠リンクが青下線・タップ可になること**（実機で確認）。
