/* 出欠ドロッパー連携フック v1.0
   イベントドロッパー（dropper-app の calendar/）に読み込ませて使う小さなモジュール。
   calendar/app.js からは下の5つだけを呼べば足りるようにしてある。

     AttendanceHook.configured()            出欠システムが設定ずみか
     AttendanceHook.saveSettings({...})     設定欄からの保存（疎通とキーの確認つき）
     AttendanceHook.createEvent({...})      「出欠を作る」ボタン
     AttendanceHook.linkFor(eventId)        出欠ページのURL
     AttendanceHook.announcementLine(id)    案内文に足す2行

   組み込み手順は docs/dropper-integration.md を参照。
   parser.js は触らないこと。
*/
var AttendanceHook = (function () {
  'use strict';

  /* ===== 公開先に合わせてここだけ変える ===== */
  var ATTEND_BASE = 'https://app.dropper-tools.com/attend/';
  /* ========================================= */

  // attend/attend.js と同じキーを使う（setup.html で保存した値をそのまま拾う）
  var STORE = {
    deployId: 'dropper.attend.deployId',
    writeKey: 'dropper.attend.writeKey',
    org:      'dropper.attend.org'
  };

  var LABEL = '🙋 出欠を回答する';
  var TIMEOUT_MS = 25000;

  // localStorage が使えない端末（iOS Safariの「サイト超えトラッキングを防ぐ」、
  // プライベートブラウズ、Cookieのブロック等）のための控え。この読み込みのあいだだけ覚える。
  // これがないと、そういう端末では設定が持てず「出欠を作る」が一切押せなくなり、
  // 主催者にブラウザ設定の変更を強いることになる。開き直せば消えるので、その都度貼り直してもらう。
  var mem = {};

  function lsGet(k) {
    try {
      var v = window.localStorage.getItem(k);
      if (v) return v;
    } catch (e) { /* 使えない端末なので控えを見る */ }
    return mem[k] || '';
  }
  // 書いたあと読み直して確かめる。プライベートブラウズやCookieのブロック下では
  // setItem が例外を投げず、黙って捨てられることがあるため（保存できたと誤認させない）。
  // 戻り値は「次に開いても残るか」。false でも控えには入っているので、今回の操作は続けられる。
  function lsSet(k, v) {
    mem[k] = v;
    try {
      window.localStorage.setItem(k, v);
      return window.localStorage.getItem(k) === v;
    } catch (e) { return false; }
  }
  function lsDel(k) {
    delete mem[k];
    try { window.localStorage.removeItem(k); } catch (e) { /* noop */ }
  }

  function parseDeployId(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var m = s.match(/\/macros\/s\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{20,200}$/.test(s) ? s : '';
  }

  function settings() {
    return {
      deployId: lsGet(STORE.deployId),
      writeKey: lsGet(STORE.writeKey),
      org:      lsGet(STORE.org)
    };
  }

  function configured() {
    var s = settings();
    return !!(s.deployId && s.writeKey);
  }

  function clear() {
    lsDel(STORE.deployId); lsDel(STORE.writeKey); lsDel(STORE.org);
  }

  function apiUrl(deployId) {
    var id = parseDeployId(deployId);
    return id ? 'https://script.google.com/macros/s/' + id + '/exec' : '';
  }

  function call(deployId, body) {
    var url = apiUrl(deployId);
    if (!url) return Promise.reject(new Error('出欠システムのURLが正しくありません。'));

    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var opt = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) };
    if (ctrl) opt.signal = ctrl.signal;

    return fetch(url, opt)
      .then(function (res) { return res.text(); })
      .then(function (t) {
        if (timer) clearTimeout(timer);
        var data;
        try { data = JSON.parse(t); }
        catch (e) { throw new Error('出欠システムに接続できませんでした（アクセス権が「全員」か確認してください）。'); }
        if (!data || data.ok !== true) throw new Error((data && data.error) || '出欠システムでエラーが起きました。');
        return data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') throw new Error('出欠システムへの接続がタイムアウトしました。');
        throw err;
      });
  }

  /** 設定欄からの保存。URLとキーの両方をその場で確かめてから保存する */
  function saveSettings(input) {
    var deployId = parseDeployId(input && input.deployId);
    var writeKey = String((input && input.writeKey) || '').trim();
    if (!deployId) return Promise.reject(new Error('出欠システムのURLを、/exec で終わる形のまま貼り付けてください。'));
    if (!writeKey) return Promise.reject(new Error('書き込みキーを入れてください。'));

    return call(deployId, { action: 'checkKey', key: writeKey }).then(function (res) {
      if (!res.keyOk) throw new Error('書き込みキーが違います。スプレッドシートの「設定」シートB2をご確認ください。');
      // 保存できたかは呼び出し側に返す。黙って握りつぶすと「✓ つながりました」と出たのに
      // 次に開くと設定が消えている、という分かりにくい状態になる（2026-08-16の実機で発生）。
      // && で繋ぐと左が false のとき右が呼ばれず、キーが控えにも入らない。必ず両方書く。
      var idStored = lsSet(STORE.deployId, deployId);
      var keyStored = lsSet(STORE.writeKey, writeKey);
      var stored = idStored && keyStored;
      lsSet(STORE.org, res.org || '');
      return { org: res.org || '', deployId: deployId, stored: stored };
    });
  }

  /**
   * 出欠のイベントを作る。
   * @param {{name:string, date?:string|Date, deadline?:string|Date, items?:string|string[], youkou?:string}} ev
   * @returns {Promise<{eventId:string, url:string, existing:boolean, org:string}>}
   *
   * 同じ名前・同じ開催日のイベントがすでにあるときはGAS側が作り足さず、
   * もとのIDを existing:true で返す（要項の二度ドロップでカレンダー予定が重なる事故と同じ轍を踏まないため）。
   */
  function createEvent(ev) {
    var s = settings();
    if (!s.deployId || !s.writeKey) {
      return Promise.reject(new Error('先に設定欄で出欠システムのURLと書き込みキーを登録してください。'));
    }
    var name = String((ev && ev.name) || '').trim();
    if (!name) return Promise.reject(new Error('大会名が読み取れていません。'));

    return call(s.deployId, {
      action: 'createEvent',
      key: s.writeKey,
      name: name,
      date: toPlain(ev.date),
      deadline: toPlain(ev.deadline),
      items: ev.items || '',
      youkou: ev.youkou || ''
    }).then(function (res) {
      if (res.org) lsSet(STORE.org, res.org);
      return { eventId: res.eventId, url: linkFor(res.eventId), existing: !!res.existing, org: res.org || '' };
    });
  }

  function toPlain(v) {
    if (!v) return '';
    if (v instanceof Date) {
      return v.getFullYear() + '/' + (v.getMonth() + 1) + '/' + v.getDate();
    }
    return String(v).trim();
  }

  /** 出欠ページのURL。全体で125字前後に収まるので、LINEでもリンク化される */
  function linkFor(eventId) {
    var s = settings();
    if (!s.deployId || !eventId) return '';
    return ATTEND_BASE + '?s=' + encodeURIComponent(s.deployId) + '&e=' + encodeURIComponent(eventId);
  }

  /** 案内文に足す2行。add/ の中継ページ（annRedirect_）は通さないこと */
  function announcementLine(eventId) {
    var url = linkFor(eventId);
    return url ? LABEL + '\n' + url : '';
  }

  /** X（旧Twitter）用：140字などの枠に収まるかを見て、収まらなければ呼び出し側で他の行を落とす */
  function lineLength(eventId) {
    return announcementLine(eventId).length;
  }

  return {
    ATTEND_BASE: ATTEND_BASE,
    STORE: STORE,
    LABEL: LABEL,
    settings: settings,
    configured: configured,
    clear: clear,
    apiUrlOf: apiUrl,          // 設定欄に「…/exec」の形で戻して見せるため
    saveSettings: saveSettings,
    createEvent: createEvent,
    linkFor: linkFor,
    announcementLine: announcementLine,
    lineLength: lineLength,
    parseDeployId: parseDeployId
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AttendanceHook;
