/* 出欠ドロッパー 共通ロジック v1.0
   - 主催者のGASウェブアプリを ?s=デプロイID で呼び分ける
   - 参加者の識別は端末ID（localStorageのUUID）。LINE・LIFFには一切依存しない

   キャッシュ対策：attend.js・attend.css を呼ぶ4本の *.html には ?v=YYYYMMDD を付けてある。
   中身を更新したら、4本とも同じ日付に書き換えること（スマホのブラウザ／LINEアプリ内ブラウザは
   古いJSを長く抱え込むことがあるため）。
*/
var ATTEND = (function () {
  'use strict';

  /* ===== 配布時にここだけ差し替える =====
     主催者向けテンプレのスプレッドシートのコピーURL（末尾を /copy にしたもの）。
     空のままだと setup.html の1番目のボタンが「準備中」になります。 */
  var TEMPLATE_COPY_URL = '';
  /* ====================================== */

  var DEVICE_KEY = 'attend.deviceId';
  var STORE = {
    deployId: 'dropper.attend.deployId',   // イベントドロッパーと共有する
    writeKey: 'dropper.attend.writeKey',
    org:      'dropper.attend.org'
  };
  var TIMEOUT_MS = 25000;

  var CHOICES = [
    { key: '〇', cls: 'sel-maru',    lab: '参加' },
    { key: '△', cls: 'sel-sankaku', lab: 'どちらでも' },
    { key: '×', cls: 'sel-batsu',   lab: '不参加' }
  ];

  /* ---------- localStorage（プライベートモードでも落ちないように） ---------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  // 書いたあと読み直して確かめる。プライベートブラウズやCookieのブロック下では
  // setItem が例外を投げず、黙って捨てられることがあるため（保存できたと誤認させない）。
  function lsSet(k, v) {
    try {
      window.localStorage.setItem(k, v);
      return window.localStorage.getItem(k) === v;
    } catch (e) { return false; }
  }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* noop */ } }

  /* ---------- 端末ID ---------- */
  var memDevice = null;
  function deviceId() {
    if (memDevice) return memDevice;
    var id = lsGet(DEVICE_KEY);
    if (!id) {
      id = uuid();
      lsSet(DEVICE_KEY, id);
    }
    memDevice = id;
    return id;
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    if (window.crypto && window.crypto.getRandomValues) {
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = [].map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  /* ---------- デプロイID ---------- */
  // 貼り付けられたのが /exec のフルURLでも、IDだけでも受け取れるようにする
  function parseDeployId(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var m = s.match(/\/macros\/s\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{20,200}$/.test(s) ? s : '';
  }

  function apiUrl(deployId) {
    var id = parseDeployId(deployId);
    return id ? 'https://script.google.com/macros/s/' + id + '/exec' : '';
  }

  /* ---------- URLパラメータ ---------- */
  var params = new URLSearchParams(window.location.search);
  var deployId = parseDeployId(params.get('s'));
  var eventId = String(params.get('e') || '').trim();

  /* ---------- 通信 ---------- */
  function fetchJson(url, options) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var opt = options || {};
    if (ctrl) opt.signal = ctrl.signal;

    return fetch(url, opt).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('サーバーの応答が異常です（' + res.status + '）');
      return res.text();
    }).then(function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        // GASが未デプロイ・権限不足のときはログインHTMLが返ってくる
        throw new Error('出欠システムに接続できませんでした。主催者の設定（アクセスできるユーザー＝全員）をご確認ください。');
      }
      return data;
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('通信がタイムアウトしました。電波の良い場所でもう一度お試しください。');
      throw err;
    });
  }

  function get(action, extra, id) {
    var base = apiUrl(id || deployId);
    if (!base) return Promise.reject(new Error('リンクが正しくありません。'));
    var q = [];
    if (action) q.push('action=' + encodeURIComponent(action));
    var p = extra || {};
    Object.keys(p).forEach(function (k) {
      if (p[k] !== undefined && p[k] !== null && p[k] !== '') q.push(k + '=' + encodeURIComponent(p[k]));
    });
    return fetchJson(base + (q.length ? '?' + q.join('&') : '')).then(unwrap);
  }

  function post(body, id) {
    var base = apiUrl(id || deployId);
    if (!base) return Promise.reject(new Error('リンクが正しくありません。'));
    return fetchJson(base, {
      method: 'POST',
      // GASはCORSプリフライトに応えられないので text/plain で送る
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(unwrap);
  }

  function unwrap(data) {
    if (!data || data.ok !== true) throw new Error((data && data.error) || 'サーバーでエラーが起きました。');
    return data;
  }

  /* ---------- 表示ヘルパー ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function badge(mark) {
    if (mark === '〇') return { cls: 'b-o', txt: '〇 参加' };
    if (mark === '△') return { cls: 'b-s', txt: '△ どちらでも' };
    if (mark === '×') return { cls: 'b-x', txt: '× 不参加' };
    return { cls: 'b-n', txt: '未回答' };
  }

  // 締切が3日以内なら「（あと2日）」、当日なら「（本日まで）」を付ける
  function dueSuffix(text) {
    var m = String(text || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) return '';
    var due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    due.setHours(23, 59, 59, 0);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var days = Math.floor((due - today) / 86400000);
    if (days === 0) return '（本日まで）';
    if (days > 0 && days <= 3) return '（あと' + days + '日）';
    return '';
  }

  function metaHtml(ev) {
    return (ev.date ? '<div class="meta">📅 開催：' + esc(ev.date) + '</div>' : '')
      + (ev.deadline ? '<div class="meta deadline">⏰ 締切：' + esc(ev.deadline) + dueSuffix(ev.deadline) + '</div>' : '')
      + (ev.youkou ? '<a class="youkou-link" href="' + esc(ev.youkou) + '" target="_blank" rel="noopener">📄 要項を見る</a>' : '');
  }

  /** 集計パネル（人数のみ・個人名なし） */
  function summaryHtml(sum) {
    if (!sum) return '';
    var head = '<div class="sum"><div class="sum-head">'
      + (sum.closed ? '<span class="badge closed">締切後 ・ 最終結果</span>' : '<span class="badge live">締切前 ・ 途中経過</span>')
      + '<span>回答した人：' + Number(sum.respCount || 0) + '人</span></div>';

    var body = (sum.items || []).map(function (it) {
      return '<div class="sum-item"><div class="name">' + esc(it.name) + '</div>'
        + sumRow('maru', '〇 参加', it.maru)
        + sumRow('sankaku', '△ どちらでも', it.sankaku)
        + sumRow('batsu', '× 不参加', it.batsu)
        + unknownNote(it)
        + '</div>';
    }).join('');

    return head + body + '</div>';
  }

  function sumRow(cls, label, o) {
    var v = o || { m: 0, f: 0, u: 0 };
    var total = (v.m || 0) + (v.f || 0) + (v.u || 0);
    return '<div class="sum-row"><span class="lab ' + cls + '">' + label + '</span><div class="nums">'
      + '<span class="pill"><span class="total">計 ' + total + '</span></span>'
      + '<span class="pill">男 <span class="m">' + (v.m || 0) + '</span></span>'
      + '<span class="pill">女 <span class="f">' + (v.f || 0) + '</span></span>'
      + '</div></div>';
  }

  function unknownNote(it) {
    var u = ((it.maru && it.maru.u) || 0) + ((it.sankaku && it.sankaku.u) || 0) + ((it.batsu && it.batsu.u) || 0);
    return u > 0 ? '<div class="unknown">※ 性別が名簿にない回答 ' + u + '件を含みます（男女の内訳に未反映）</div>' : '';
  }

  function noteHtml(title, text, isErr) {
    return '<div class="note' + (isErr ? ' err' : '') + '">'
      + (title ? '<div class="big">' + esc(title) + '</div>' : '')
      + esc(text) + '</div>';
  }

  function loadingHtml(text) {
    return '<div class="note"><div class="spinner" aria-hidden="true"></div>' + esc(text || '読み込んでいます…') + '</div>';
  }

  /** リンクに ?s= が無いときの案内。true を返したら以降の処理を止める */
  function requireDeployId(el) {
    if (deployId) return false;
    el.innerHTML = noteHtml(
      'リンクが正しくありません',
      '主催者から届いた「出欠を回答する」のリンクをそのまま開いてください。アドレスの途中を消すと開けません。',
      true
    );
    return true;
  }

  /* ---------- 3本のURLを組み立てる（setup.html用） ---------- */
  function pageUrl(page, id) {
    var base = window.location.href.split('?')[0].split('#')[0].replace(/[^/]*$/, '');
    return base + (page || '') + '?s=' + encodeURIComponent(id || deployId);
  }

  return {
    CHOICES: CHOICES,
    TEMPLATE_COPY_URL: TEMPLATE_COPY_URL,
    STORE: STORE,
    deployId: deployId,
    eventId: eventId,
    deviceId: deviceId,
    parseDeployId: parseDeployId,
    apiUrl: apiUrl,
    get: get,
    post: post,
    esc: esc,
    badge: badge,
    dueSuffix: dueSuffix,
    metaHtml: metaHtml,
    summaryHtml: summaryHtml,
    noteHtml: noteHtml,
    loadingHtml: loadingHtml,
    requireDeployId: requireDeployId,
    pageUrl: pageUrl,
    lsGet: lsGet,
    lsSet: lsSet,
    lsDel: lsDel
  };
})();
