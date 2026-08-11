/**
 * 出欠ドロッパー — tally.gs  v1.0
 * 「集計」シートを書き出す。主催者だけが見るシートなので、ここにだけ未回答者の名前を出す。
 *
 * ※ グローバル定数（SH / DEFAULT_TZ など）は attendance-api.gs でのみ宣言しています。
 *   このファイルで再宣言すると SyntaxError になります。絶対に書かないこと。
 *
 * 使い方：スプレッドシートのメニュー「出欠システム → 集計を更新」
 *        または、この shukei を時間主導型トリガーで回す。
 */

function shukei() {
  var sh = ss_().getSheetByName(SH.TALLY) || ss_().insertSheet(SH.TALLY);
  sh.clear();

  var header = [
    'イベント名', '開催日', '申込締切', '状態', '種目',
    '〇男', '〇女', '△男', '△女', '×男', '×女',
    '回答者数', '未回答者'
  ];

  var latest = latestByEvent_();
  var genders = genderMap_();
  var events = eventRows_().sort(function (a, b) { return b.sortKey - a.sortKey; });

  var out = [header];
  var blocks = [];   // 罫線を引くためのイベントごとの行範囲

  events.forEach(function (ev) {
    var byName = latest[ev.id] || {};
    var sum = summaryOf_(ev, byName, genders);
    var pending = pendingNames_(byName);
    var start = out.length + 1;

    if (!sum.items.length) {
      out.push([ev.name, ev.date, ev.deadline, ev.closed ? '締切後' : '受付中', '（種目なし）',
                '', '', '', '', '', '', sum.respCount, pending.join('、')]);
    } else {
      sum.items.forEach(function (it, i) {
        out.push([
          i === 0 ? ev.name : '',
          i === 0 ? ev.date : '',
          i === 0 ? ev.deadline : '',
          i === 0 ? (ev.closed ? '締切後' : '受付中') : '',
          it.name,
          it.maru.m, it.maru.f,
          it.sankaku.m, it.sankaku.f,
          it.batsu.m, it.batsu.f,
          i === 0 ? sum.respCount : '',
          i === 0 ? pending.join('、') : ''
        ]);
      });
    }
    blocks.push({ start: start, end: out.length });
  });

  if (out.length === 1) out.push(['（イベントがまだありません）', '', '', '', '', '', '', '', '', '', '', '', '']);

  sh.getRange(1, 1, out.length, header.length).setValues(out);

  // 見た目
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef3f7');
  sh.setFrozenRows(1);
  sh.getRange(1, 6, out.length, 2).setBackground('#f2faf5');   // 〇
  sh.getRange(1, 8, out.length, 2).setBackground('#fdf8ec');   // △
  sh.getRange(1, 10, out.length, 2).setBackground('#fdf0ee');  // ×
  sh.getRange(1, 1, 1, header.length).setBackground('#eef3f7');
  blocks.forEach(function (b) {
    sh.getRange(b.start, 1, 1, header.length).setBorder(true, null, null, null, null, null, '#9db4c7', SpreadsheetApp.BorderStyle.SOLID);
  });

  [220, 110, 110, 70, 180, 55, 55, 55, 55, 55, 55, 80, 320].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });
  sh.getRange(2, 13, Math.max(out.length - 1, 1), 1).setWrap(true);

  var tz = cfg_().tz;
  sh.getRange(out.length + 2, 1).setValue(
    '更新：' + Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd HH:mm') +
    '　※未回答者は名簿にいて1件も回答していない人（退会者を除く）'
  ).setFontColor('#5a6b7b');
}
