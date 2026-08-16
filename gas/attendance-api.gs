/**
 * 出欠ドロッパー — attendance-api.gs  v1.0
 * 主催者のスプレッドシートに同梱するコンテナバインドスクリプト（API本体）。
 *
 * デプロイ設定：
 *   デプロイ → 新しいデプロイ → 種類：ウェブアプリ
 *   実行するユーザー：自分 ／ アクセスできるユーザー：全員
 *
 * ★再デプロイの鉄則
 *   デプロイ → デプロイを管理 → 鉛筆 → バージョン「新しいバージョン」→ デプロイ
 *   （URLは変わりません。「新しいデプロイ」を連発するとURLが増えて詰まります）
 *
 * ※ このファイルでのみグローバル定数を宣言します。
 *   tally.gs 側で再宣言すると SyntaxError になるので絶対に書かないこと。
 */

var API_VERSION = 'v1.1';

// 参加者に配る出欠ページの置き場所。セットアップ画面が3本のURLを組み立てるのに使う。
var ATTEND_BASE = 'https://app.dropper-tools.com/attend/';

var SH = {
  INTRO:   'はじめに',
  CONFIG:  '設定',
  MEMBERS: '名簿',
  EVENTS:  'イベント',
  ANSWERS: '回答',
  LINKS:   '紐付け',
  TALLY:   '集計'
};

var DEFAULT_TZ = 'Asia/Tokyo';
var WDAY = ['日', '月', '火', '水', '木', '金', '土'];
var MARKS = ['〇', '△', '×'];


/* ============================================================
 *  Web API
 * ========================================================== */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = String(p.action || '').trim();

    switch (action) {
      case '':
      case 'events':    return json_(listEvents_(p.d));
      case 'event':     return json_(getEvent_(p.e, p.d));
      case 'members':   return json_({ ok: true, org: cfg_().org, members: members_(false) });
      case 'whoami':    return json_(whoami_(p.d));
      case 'summary':   return json_(summaryAction_(p.e));
      case 'myanswers': return json_(myAnswers_(p.d));
      case 'ping':      return json_({ ok: true, org: cfg_().org, version: API_VERSION });
      default:          return json_({ ok: false, error: '不明な action です：' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  }
}

function doPost(e) {
  try {
    var b = body_(e);
    var action = String(b.action || (e && e.parameter && e.parameter.action) || '').trim();

    switch (action) {
      case 'register':    return json_(register_(b));
      case 'answer':      return json_(answer_(b));
      case 'createEvent': return json_(createEvent_(b));
      case 'checkKey':    return json_(checkKey_(b));
      default:            return json_({ ok: false, error: '不明な action です：' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  }
}


/* ============================================================
 *  読み取り系
 * ========================================================== */

/** 締切前のイベント一覧（開催日の早い順）。d=端末IDがあれば自分の回答も添える */
function listEvents_(deviceId) {
  var c = cfg_();
  var me = linkOf_(deviceId);
  var mine = me ? latestAnswersOf_(me.name) : {};
  var list = eventRows_()
    .filter(function (ev) { return !ev.closed; })
    .sort(function (a, b) { return a.sortKey - b.sortKey; })
    .map(function (ev) { return publicEvent_(ev, mine[ev.id] || null); });

  return { ok: true, org: c.org, member: me, events: list };
}

/** イベント1件の詳細。締切後でも返す（フォーム側で締切表示にする） */
function getEvent_(eventId, deviceId) {
  var c = cfg_();
  var ev = findEvent_(eventId);
  if (!ev) return { ok: false, error: 'イベントが見つかりません。主催者からもらったリンクをもう一度お確かめください。', notFound: true };

  var me = linkOf_(deviceId);
  var mine = me ? (latestAnswersOf_(me.name)[ev.id] || null) : null;
  return { ok: true, org: c.org, member: me, event: publicEvent_(ev, mine) };
}

/** 端末IDから登録済みの本人を返す */
function whoami_(deviceId) {
  var me = linkOf_(deviceId);
  return { ok: true, org: cfg_().org, registered: !!me, member: me };
}

/** e があればそのイベント1件、なければ全イベントの集計（人数のみ・個人名なし） */
function summaryAction_(eventId) {
  var c = cfg_();
  var evs;

  if (String(eventId || '').trim()) {
    var ev = findEvent_(eventId);
    if (!ev) return { ok: false, error: 'イベントが見つかりません。', notFound: true };
    evs = [ev];
  } else {
    evs = eventRows_().sort(function (a, b) { return b.sortKey - a.sortKey; }).slice(0, 50);
  }

  var latest = latestByEvent_();
  var genders = genderMap_();
  var list = evs.map(function (ev) { return summaryOf_(ev, latest[ev.id] || {}, genders); });

  return { ok: true, org: c.org, summaries: list, summary: list[0] || null };
}

/** 締切前の各イベントについて、その端末の最新回答 */
function myAnswers_(deviceId) {
  var c = cfg_();
  var me = linkOf_(deviceId);
  var mine = me ? latestAnswersOf_(me.name) : {};

  var list = eventRows_()
    .filter(function (ev) { return !ev.closed; })
    .sort(function (a, b) { return a.sortKey - b.sortKey; })
    .map(function (ev) {
      var ans = mine[ev.id] || null;
      var items = ev.items.map(function (it) {
        return { name: it, answer: (ans && ans[it]) || '' };
      });
      var done = items.filter(function (x) { return !!x.answer; }).length;
      return {
        id: ev.id,
        name: ev.name,
        date: ev.date,
        deadline: ev.deadline,
        youkou: ev.youkou,
        items: items,
        answered: done > 0,
        allAnswered: done > 0 && done === items.length
      };
    });

  return { ok: true, org: c.org, member: me, registered: !!me, myanswers: list };
}


/* ============================================================
 *  書き込み系
 * ========================================================== */

/** 名簿の名前を選んで端末を紐付ける */
function register_(b) {
  var deviceId = String(b.deviceId || '').trim();
  var name = String(b.name || '').trim();

  if (!deviceId) return { ok: false, error: '端末IDがありません。ブラウザを更新してからもう一度お試しください。' };
  if (!name)     return { ok: false, error: 'お名前が選ばれていません。' };

  var mem = null;
  members_(false).forEach(function (m) {
    if (normKey_(m.name) === normKey_(name)) mem = m;
  });
  if (!mem) return { ok: false, error: '名簿にないお名前です。主催者にご確認ください。', notInRoster: true };

  withLock_(function () {
    sheet_(SH.LINKS).appendRow([deviceId, mem.name, mem.gender, new Date()]);
  });

  return { ok: true, member: { name: mem.name, gender: mem.gender } };
}

/** 回答を1行追記する（上書きせず追記。集計は最新行を採用） */
function answer_(b) {
  var deviceId = String(b.deviceId || '').trim();
  var eventId = String(b.eventId || '').trim();
  var answers = b.answers || {};

  var me = linkOf_(deviceId);
  if (!me) return { ok: false, error: '先にお名前の登録が必要です。', needRegister: true };

  var ev = findEvent_(eventId);
  if (!ev) return { ok: false, error: 'イベントが見つかりません。', notFound: true };
  if (ev.closed) return { ok: false, error: 'このイベントは申込締切をすぎています。', closed: true };

  var clean = {};
  var n = 0;
  ev.items.forEach(function (it) {
    var m = normMark_(answers[it]);
    if (m) { clean[it] = m; n++; }
  });
  if (!n) return { ok: false, error: '回答が選ばれていません。' };

  withLock_(function () {
    sheet_(SH.ANSWERS).appendRow([new Date(), deviceId, me.name, ev.id, JSON.stringify(clean)]);
  });

  var latest = latestByEvent_();
  return {
    ok: true,
    saved: clean,
    member: me,
    summary: summaryOf_(ev, latest[ev.id] || {}, genderMap_())
  };
}

/** カレンダードロッパーからイベントを作る。書き込みキー必須 */
function createEvent_(b) {
  var c = cfg_();
  if (!c.key) return { ok: false, error: '書き込みキーが未設定です（設定シートのB2）。', badKey: true };
  if (String(b.key || '').trim() !== c.key) return { ok: false, error: '書き込みキーが違います。', badKey: true };

  var name = String(b.name || '').trim();
  if (!name) return { ok: false, error: 'イベント名がありません。' };

  var items = Array.isArray(b.items)
    ? b.items.map(function (s) { return String(s).trim(); }).filter(String)
    : splitItems_(b.items);
  if (!items.length) items = ['参加'];

  var dateV = toDate_(b.date);
  var deadV = toDate_(b.deadline);
  var youkou = normUrl_(b.youkou);

  var out = null;
  withLock_(function () {
    // 二重ドロップ対策：同じ名前・同じ開催日の行があれば作り直さない
    var dup = null;
    eventRows_().forEach(function (ev) {
      if (normKey_(ev.name) === normKey_(name) && sameDay_(ev.dateRaw, dateV)) dup = ev;
    });
    if (dup) { out = { ok: true, eventId: dup.id, org: c.org, existing: true }; return; }

    var id = newEventId_();
    sheet_(SH.EVENTS).appendRow([
      id, name,
      dateV || String(b.date || '').trim(),
      deadV || String(b.deadline || '').trim(),
      items.join('、'), youkou, new Date()
    ]);
    out = { ok: true, eventId: id, org: c.org, existing: false };
  });

  return out;
}

/** セットアップウィザードの書き込みキー確認 */
function checkKey_(b) {
  var c = cfg_();
  return { ok: true, org: c.org, version: API_VERSION, keyOk: !!c.key && String(b.key || '').trim() === c.key };
}


/* ============================================================
 *  集計ロジック（tally.gs からも使う）
 * ========================================================== */

/** 回答シートを1回だけ走査して {イベントID: {名前キー: {name, ans}}} を作る（latest-row-wins） */
function latestByEvent_() {
  var out = {};
  rows_(SH.ANSWERS).forEach(function (r) {
    var evId = String(r[3] || '').trim();
    var name = String(r[2] || '').trim();
    if (!evId || !name) return;
    if (!out[evId]) out[evId] = {};
    out[evId][normKey_(name)] = { name: name, ans: parseAnswers_(r[4]) };
  });
  return out;
}

/** ある人の全イベントの最新回答 {イベントID: {種目: 〇}} */
function latestAnswersOf_(name) {
  var key = normKey_(name);
  var out = {};
  rows_(SH.ANSWERS).forEach(function (r) {
    if (normKey_(r[2]) !== key) return;
    var evId = String(r[3] || '').trim();
    if (!evId) return;
    out[evId] = parseAnswers_(r[4]);
  });
  return out;
}

/** 名前キー → 性別 */
function genderMap_() {
  var map = {};
  members_(true).forEach(function (m) { map[normKey_(m.name)] = m.gender; });
  rows_(SH.LINKS).forEach(function (r) {
    var k = normKey_(r[1]);
    if (k && !map[k]) map[k] = normGender_(r[2]);
  });
  return map;
}

/**
 * イベント1件の集計。人数のみ・個人名は含めない。
 * items[].maru / sankaku / batsu = {m:男, f:女, u:性別未登録}
 */
function summaryOf_(ev, answersByName, genders) {
  var names = Object.keys(answersByName || {});
  var items = ev.items.map(function (it) {
    var cell = { name: it, maru: zero_(), sankaku: zero_(), batsu: zero_() };
    names.forEach(function (k) {
      var mark = normMark_(answersByName[k].ans[it]);
      if (!mark) return;
      var bucket = mark === '〇' ? cell.maru : (mark === '△' ? cell.sankaku : cell.batsu);
      var g = genders[k] || '';
      if (g === '男') bucket.m++;
      else if (g === '女') bucket.f++;
      else bucket.u++;
    });
    return cell;
  });

  return {
    id: ev.id,
    name: ev.name,
    date: ev.date,
    deadline: ev.deadline,
    youkou: ev.youkou,
    closed: ev.closed,
    respCount: names.length,
    items: items
  };
}

/** 未回答者の名前（主催者向け。集計シートにだけ書く） */
function pendingNames_(answersByName) {
  var answered = answersByName || {};
  return members_(false)
    .filter(function (m) { return !answered[normKey_(m.name)]; })
    .map(function (m) { return m.name; });
}

function zero_() { return { m: 0, f: 0, u: 0 }; }


/* ============================================================
 *  シート読み取りの下ごしらえ
 * ========================================================== */

function ss_() { return SpreadsheetApp.getActive(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません。メニュー「出欠システム → 初期設定」を実行してください。');
  return sh;
}

/** ヘッダ行を除いた値の2次元配列 */
function rows_(name) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

function cfg_() {
  var v = sheet_(SH.CONFIG).getRange(1, 2, 3, 1).getValues();
  return {
    org: String(v[0][0] || '').trim() || '出欠',
    key: String(v[1][0] || '').trim(),
    tz:  String(v[2][0] || '').trim() || DEFAULT_TZ
  };
}

/** 名簿。includeRetired が false なら備考に「退会」等がある人を除く */
function members_(includeRetired) {
  var list = [];
  rows_(SH.MEMBERS).forEach(function (r) {
    var name = String(r[0] || '').trim();
    if (!name) return;
    var note = String(r[2] || '').trim();
    var retired = /退会|退部|休会|除外/.test(note);
    if (!includeRetired && retired) return;
    list.push({ name: name, gender: normGender_(r[1]), retired: retired });
  });
  return list;
}

function eventRows_() {
  var tz = cfg_().tz;
  var list = [];
  rows_(SH.EVENTS).forEach(function (r, i) {
    var id = String(r[0] || '').trim();
    if (!id) return;
    list.push({
      row: i + 2,
      id: id,
      name: String(r[1] || '').trim(),
      dateRaw: r[2],
      date: fmtDate_(r[2], tz),
      deadlineRaw: r[3],
      deadline: fmtDate_(r[3], tz),
      items: splitItems_(r[4]),
      youkou: normUrl_(r[5]),
      closed: isClosed_(r[3], r[2]),
      sortKey: (toDate_(r[2]) || toDate_(r[3]) || new Date(0)).getTime()
    });
  });
  return list;
}

function findEvent_(eventId) {
  var key = String(eventId || '').trim();
  if (!key) return null;
  var found = null;
  eventRows_().forEach(function (ev) { if (ev.id === key) found = ev; });
  return found;
}

function publicEvent_(ev, mine) {
  return {
    id: ev.id, name: ev.name, date: ev.date, deadline: ev.deadline,
    items: ev.items, youkou: ev.youkou, closed: ev.closed, mine: mine || null
  };
}

/** 紐付けシートの最新行を採用。性別は名簿から引き直す */
function linkOf_(deviceId) {
  var key = normKey_(deviceId);
  if (!key) return null;

  var found = null;
  rows_(SH.LINKS).forEach(function (r) {
    if (normKey_(r[0]) !== key) return;
    var name = String(r[1] || '').trim();
    if (name) found = { name: name, gender: normGender_(r[2]) };
  });
  if (!found) return null;

  members_(true).forEach(function (m) {
    if (normKey_(m.name) === normKey_(found.name)) {
      found.name = m.name;
      found.gender = m.gender;
    }
  });
  return found;
}

function newEventId_() {
  var used = {};
  eventRows_().forEach(function (ev) { used[ev.id] = true; });
  for (var i = 0; i < 50; i++) {
    var id = 'ev' + (Date.now() + i).toString(36);
    if (!used[id]) return id;
  }
  return 'ev' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}


/* ============================================================
 *  小物
 * ========================================================== */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** POST本体。CORSプリフライト回避のため text/plain のJSON文字列で受ける */
function body_(e) {
  if (e && e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch (err) { /* fall through */ }
  }
  return (e && e.parameter) || {};
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** 全角半角・空白・大小文字を吸収した突き合わせ用キー */
function normKey_(s) {
  var t = String(s == null ? '' : s);
  if (t.normalize) t = t.normalize('NFKC');
  return t.replace(/[\s　]+/g, '').toLowerCase();
}

function normGender_(v) {
  var s = normKey_(v);
  if (!s) return '';
  if (/^(男|男性|m|male|おとこ)$/.test(s)) return '男';
  if (/^(女|女性|f|female|おんな)$/.test(s)) return '女';
  return '';
}

function normMark_(v) {
  var s = String(v == null ? '' : v).trim();
  if (/^[〇○◯oO０0]$/.test(s)) return '〇';
  if (/^[△▲sS]$/.test(s)) return '△';
  if (/^[×✕✖ｘxX]$/.test(s)) return '×';
  return '';
}

function parseAnswers_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return {};
  try {
    var o = JSON.parse(s);
    return (o && typeof o === 'object') ? o : {};
  } catch (err) {
    return {};
  }
}

function splitItems_(v) {
  return String(v == null ? '' : v)
    .split(/[、,，\n\/／]+/)
    .map(function (s) { return s.trim(); })
    .filter(String);
}

function normUrl_(v) {
  var s = String(v == null ? '' : v).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function toDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var m = s.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate_(v, tz) {
  var d = toDate_(v);
  if (!d) return String(v == null ? '' : v).trim();
  var zone = tz || DEFAULT_TZ;
  var u = Number(Utilities.formatDate(d, zone, 'u')) % 7;   // 1=月 … 7=日 → 0=日
  return Utilities.formatDate(d, zone, 'yyyy/MM/dd') + '（' + WDAY[u] + '）';
}

function sameDay_(a, b) {
  var x = toDate_(a), y = toDate_(b);
  if (!x || !y) return !x && !y;
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** 申込締切（なければ開催日）の当日23:59:59をすぎたら締切後 */
function isClosed_(deadline, eventDate) {
  var d = toDate_(deadline) || toDate_(eventDate);
  if (!d) return false;
  var end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  return Date.now() > end.getTime();
}

function errMsg_(err) {
  return String((err && err.message) ? err.message : err);
}


/* ============================================================
 *  初期設定（スプレッドシートのメニューから実行）
 * ========================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('出欠システム')
    .addItem('セットアップを開く', 'セットアップを開く')
    .addItem('集計を更新', 'shukei')
    .addSeparator()
    .addItem('初期設定（シートを作り直す）', '初期設定')
    .addItem('書き込みキーを表示', '書き込みキーを表示')
    .addItem('書き込みキーを作り直す', '書き込みキーを作り直す')
    .addToUi();
  // ここで showSidebar / showModalDialog は呼べない。onOpen は承認なしで走る簡易トリガーで、
  // 画面を出す操作には承認が要るため、コピー直後の初回に必ず失敗する。
  // 代わりに「はじめに」シートへメニューの押し方を書いてある。
}

/** 足りないシートを作り、見出しと書き込みキーを用意する。何度実行しても安全 */
function 初期設定() {
  var ss = ss_();
  var made = [];

  function ensure(name, headers, widths) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); made.push(name); }
    if (headers && headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#eef3f7');
      sh.setFrozenRows(1);
      if (widths) widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    }
    return sh;
  }

  // 設定シートだけは見出しが縦なので別あつかい
  var conf = ss.getSheetByName(SH.CONFIG);
  if (!conf) { conf = ss.insertSheet(SH.CONFIG, 0); made.push(SH.CONFIG); }
  var labels = [['団体名'], ['書き込みキー'], ['タイムゾーン'], ['デプロイID'], ['ファイルID']];
  conf.getRange(1, 1, 5, 1).setValues(labels).setFontWeight('bold');
  conf.setColumnWidth(1, 140);
  conf.setColumnWidth(2, 380);
  if (!String(conf.getRange('B2').getValue() || '').trim()) conf.getRange('B2').setValue(newWriteKey_());
  if (!String(conf.getRange('B3').getValue() || '').trim()) conf.getRange('B3').setValue(DEFAULT_TZ);
  conf.getRange(1, 3, 5, 1).setValues([
    ['出欠ページのヘッダに表示されます'],
    ['イベントドロッパーに登録するキー。人には見せないでください'],
    ['ふつうは Asia/Tokyo のままで大丈夫です'],
    ['セットアップ画面が自動で入れます。手で書き換えないでください'],
    ['コピーされたことを見分けるための控えです。手で書き換えないでください']
  ]).setFontColor('#5a6b7b');
  conf.getRange('B5').setValue(ss.getId());

  // 「はじめに」シート。コピー直後は承認前でサイドバーを自動で開けないので、
  // メニューの押し方をシートそのものに書いておく。
  var intro = ss.getSheetByName(SH.INTRO);
  if (!intro) { intro = ss.insertSheet(SH.INTRO, 0); made.push(SH.INTRO); }
  intro.clear();
  intro.setColumnWidth(1, 720);
  intro.getRange('A1').setValue('出欠ドロッパー')
    .setFontSize(24).setFontWeight('bold').setFontColor('#1769b0');
  intro.getRange('A2').setValue('上のメニュー「出欠システム」→「セットアップを開く」を押してください。')
    .setFontSize(16).setFontWeight('bold');
  intro.getRange('A3').setValue(
    '\n団体名とメンバーのお名前を入れるところから、みなさんに配るURLができあがるまで、'
    + '画面が順番にご案内します。\n\n'
    + '※ はじめて開いたときは「承認が必要です」と出ます。ご自身で作った表なので、'
    + 'ご自身のアカウントを選んで許可してください。\n'
    + '※ このシートは消してかまいません。');
  intro.getRange('A3').setWrap(true).setFontSize(13).setFontColor('#5a6b7b');
  intro.setRowHeight(3, 130);
  ss.setActiveSheet(intro);

  ensure(SH.MEMBERS, ['名前', '性別（男／女）', '備考'], [160, 130, 240]);
  ensure(SH.EVENTS,  ['イベントID', 'イベント名', '開催日', '申込締切', '種目（、区切り）', '要項リンク', '登録日時'],
                     [110, 280, 120, 120, 240, 260, 160]);
  ensure(SH.ANSWERS, ['タイムスタンプ', '端末ID', '名前', 'イベントID', '回答JSON'],
                     [160, 300, 140, 110, 320]);
  ensure(SH.LINKS,   ['端末ID', '名前', '性別', '登録日時'], [300, 140, 80, 160]);
  ensure(SH.TALLY,   [], []);

  SpreadsheetApp.getUi().alert(
    '準備ができました。\n\n' +
    (made.length ? '作ったシート：' + made.join('、') + '\n\n' : '') +
    'つづけて、メニュー「出欠システム → セットアップを開く」を押してください。'
  );
}

/**
 * 配布用テンプレートを作るための後始末。**Apps Script のエディタから手で実行する。**
 *
 * メニューには出さない。運用中の表で誤って押されると、名簿も回答も消えてしまうため
 * （主催者の目に触れる場所に置かない、というのがここでの安全策）。
 *
 * 団体名・名簿・イベント・回答・紐付け・集計を空にし、書き込みキーを作り直す。
 * 済んだら「共有 → リンクを知っている全員／閲覧者」にして、URLの末尾を /copy に
 * 変えたものを attend/attend.js の TEMPLATE_COPY_URL に入れる。
 */
function 配布用に空にする() {
  var ui = SpreadsheetApp.getUi();
  var ss = ss_();
  var targets = [SH.MEMBERS, SH.EVENTS, SH.ANSWERS, SH.LINKS];

  var counts = targets.map(function (n) { return '・' + n + '　' + rows_(n).length + '行'; }).join('\n');
  var org = String(sheet_(SH.CONFIG).getRange('B1').getValue() || '（未設定）');

  var ans = ui.alert('配布用テンプレートにします',
    '団体名「' + org + '」のデータを、この表からすべて消します。\n'
    + '運用中の表では絶対に実行しないでください。\n\n'
    + counts + '\n・集計シート\n・団体名／デプロイID\n\n'
    + '書き込みキーも作り直します。消してよろしいですか？',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;

  // 見出し行と書式は残したいので、clear() ではなく2行目以降を削る
  targets.forEach(function (name) {
    var sh = sheet_(name);
    var last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
  });
  sheet_(SH.TALLY).clear();   // 集計は見出しを持たないので丸ごと

  var conf = sheet_(SH.CONFIG);
  conf.getRange('B1').setValue('');               // 団体名
  conf.getRange('B2').setValue(newWriteKey_());   // 配布元のキーを持ち出させない
  conf.getRange('B4').setValue('');               // デプロイID
  conf.getRange('B5').setValue(ss.getId());

  var intro = ss.getSheetByName(SH.INTRO);
  if (intro) ss.setActiveSheet(intro);            // コピーした人が最初に見る場所へ戻す

  ui.alert('空にしました。\n\n'
    + 'このあと「共有」→「リンクを知っている全員」→「閲覧者」にして、\n'
    + 'URLの末尾（/edit… の部分）を /copy に変えたものを配布用にお使いください。');
}

function 書き込みキーを表示() {
  var key = cfg_().key || '（未設定です。初期設定を実行してください）';
  SpreadsheetApp.getUi().alert('書き込みキー\n\n' + key + '\n\nカレンダードロッパーの設定欄に貼り付けてください。人には見せないでください。');
}

function 書き込みキーを作り直す() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('書き込みキーを作り直しますか？', '作り直すと、いま登録してあるカレンダードロッパーからイベントを作れなくなります。新しいキーを登録しなおしてください。', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  var key = newWriteKey_();
  sheet_(SH.CONFIG).getRange('B2').setValue(key);
  ui.alert('新しい書き込みキー\n\n' + key);
}

function newWriteKey_() {
  var chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var raw = Utilities.getUuid() + Utilities.getUuid();
  var out = '';
  for (var i = 0; i < 32; i++) {
    out += chars.charAt(raw.charCodeAt(i * 2) % chars.length);
  }
  return out;
}


/* ============================================================
 *  セットアップ画面（シートの中で完結させる）
 *  想定利用者は団体の役員。スプレッドシートの列やセルを直接さわらせないこと。
 *  画面側は setup-ui.html。呼び出しは google.script.run 経由。
 * ========================================================== */

function セットアップを開く() {
  ensureSheets_();
  var html = HtmlService.createHtmlOutputFromFile('setup-ui')
    .setWidth(680).setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, '出欠システムのセットアップ');
}

/** シートが無ければ黙って作る（セットアップ画面から先に入った人のため） */
function ensureSheets_() {
  if (!ss_().getSheetByName(SH.CONFIG) || !ss_().getSheetByName(SH.MEMBERS)) 初期設定();
  resetIfCopied_();
}

/**
 * この表がコピーされたものなら、前の持ち主から引き継いではいけない値を捨てる。
 *
 * 「設定」B5 に自分のファイルIDを控えてあり、コピーすると中身だけが引き継がれて
 * ファイルIDは変わる。食い違っていたら＝コピー直後、と判断できる。
 *
 *  - 書き込みキー … 引き継ぐと全団体で同じキーになる。他団体のキーを知っている人が
 *                   別団体のイベントを作れてしまうので、必ず作り直す
 *  - デプロイID   … 引き継ぐとセットアップ画面が「完成」から始まり、
 *                   コピー元のデプロイを指したURLを配ってしまう。必ず捨てる
 *
 * 団体名と名簿はそのままにする（自分の表を複製して別の団体を作る使い方を壊さないため）。
 */
function resetIfCopied_() {
  var sh = sheet_(SH.CONFIG);
  var mine = ss_().getId();
  var stamped = String(sh.getRange('B5').getValue() || '').trim();
  if (stamped === mine) return false;

  sh.getRange('B2').setValue(newWriteKey_());
  sh.getRange('B4').setValue('');
  sh.getRange('B5').setValue(mine);
  return true;
}

/** 画面を開いたときの状態を全部まとめて返す */
function setupState() {
  ensureSheets_();
  var c = cfg_();
  var id = deployId_();
  return {
    org: c.org,
    writeKey: c.key,
    deployId: id,
    links: id ? attendLinks_(id) : null,
    members: members_(true).map(function (m) {
      return { name: m.name, gender: m.gender, retired: m.retired };
    })
  };
}

function setupSaveOrg(org) {
  var name = String(org || '').trim();
  if (!name) throw new Error('団体名を入れてください。');
  if (name.length > 40) throw new Error('団体名が長すぎます（40文字まで）。');
  sheet_(SH.CONFIG).getRange('B1').setValue(name);
  return { ok: true, org: name };
}

/**
 * 名簿をまるごと書き直す。備考は名前で引き継ぐ（退会の印を消さないため）。
 * 同じ名前が2人いると本人を見分けられなくなるので、ここで弾く。
 */
function setupSaveMembers(list) {
  var rows = (list || []).map(function (m) {
    return { name: String((m && m.name) || '').trim(), gender: normGender_(m && m.gender) };
  }).filter(function (m) { return m.name; });

  if (!rows.length) throw new Error('お名前がひとつも入っていません。');
  if (rows.length > 500) throw new Error('人数が多すぎます（500人まで）。');

  var seen = {};
  var dup = [];
  rows.forEach(function (m) {
    var k = normKey_(m.name);
    if (seen[k]) { if (dup.indexOf(m.name) === -1) dup.push(m.name); }
    seen[k] = true;
  });
  if (dup.length) {
    throw new Error('同じお名前が2人以上います：' + dup.join('、')
      + '\n出欠は名前で見分けるので、「山田太郎（父）」のように区別できる書き方にしてください。');
  }

  var notes = {};
  members_(true).forEach(function (m) { notes[normKey_(m.name)] = m.retired ? '退会' : ''; });

  var sh = sheet_(SH.MEMBERS);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  sh.getRange(2, 1, rows.length, 3).setValues(rows.map(function (m) {
    return [m.name, m.gender, notes[normKey_(m.name)] || ''];
  }));
  return { ok: true, count: rows.length };
}

/**
 * デプロイ済みのウェブアプリURLを保存する。
 * 保存の前に、ログインしていない人として実際に叩いて確かめる。
 * ここを省くと「アクセスできるユーザー：自分のみ」のまま配ってしまい、
 * 参加者の画面がエラーになる（いちばん多い事故）。
 */
function setupSaveDeploy(url) {
  var id = parseDeployId_(url);
  if (!id) throw new Error('URLを読み取れませんでした。「https://script.google.com/macros/s/…/exec」の形のまま貼り付けてください。');

  var res;
  try {
    res = UrlFetchApp.fetch('https://script.google.com/macros/s/' + id + '/exec?action=ping', {
      muteHttpExceptions: true, followRedirects: true
    });
  } catch (e) {
    throw new Error('URLにつながりませんでした。デプロイが終わっているかご確認ください。');
  }

  var body = String(res.getContentText() || '');
  var data = null;
  try { data = JSON.parse(body); } catch (e) { /* HTMLが返ってきた＝公開できていない */ }

  if (!data || data.ok !== true) {
    if (/ServiceLogin|accounts\.google\.com|ログイン/.test(body)) {
      throw new Error('だれでも開ける状態になっていません。デプロイをやりなおして、'
        + '「アクセスできるユーザー」を【全員】にしてください。');
    }
    throw new Error('出欠システムとして応答しませんでした。貼り付けたURLがこの表のものか、もう一度ご確認ください。');
  }

  sheet_(SH.CONFIG).getRange('B4').setValue(id);
  return { ok: true, org: data.org || cfg_().org, deployId: id, links: attendLinks_(id) };
}

function setupNewWriteKey() {
  var key = newWriteKey_();
  sheet_(SH.CONFIG).getRange('B2').setValue(key);
  return { ok: true, writeKey: key };
}

/** 名簿シートを開いて画面を閉じたいとき用 */
function setupOpenSheet(which) {
  var name = (which === 'members') ? SH.MEMBERS : (which === 'tally') ? SH.TALLY : SH.CONFIG;
  var sh = ss_().getSheetByName(name);
  if (sh) ss_().setActiveSheet(sh);
  return { ok: true };
}

function attendLinks_(id) {
  var q = '?s=' + encodeURIComponent(id);
  return {
    list:   ATTEND_BASE + q,
    my:     ATTEND_BASE + 'my.html' + q,
    status: ATTEND_BASE + 'status.html' + q
  };
}

function deployId_() {
  return String(sheet_(SH.CONFIG).getRange('B4').getValue() || '').trim();
}

/** 貼り付けられたのが /exec のフルURLでも、IDだけでも受け取る */
function parseDeployId_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var m = s.match(/\/macros\/s\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,200}$/.test(s) ? s : '';
}
