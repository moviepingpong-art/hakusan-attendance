/* 出欠ドロッパー 共通ロジック v2.0
   - ?s= は団体ID。呼び先は api.dropper-tools.com の1本
   - 参加者の識別は端末ID（localStorageのUUID）。LINE・LIFFには一切依存しない

   キャッシュ対策：attend.js・attend.css を呼ぶ4本の *.html には ?v=YYYYMMDD を付けてある。
   中身を更新したら、4本とも同じ日付に書き換えること（スマホのブラウザ／LINEアプリ内ブラウザは
   古いJSを長く抱え込むことがあるため）。
*/
var ATTEND = (function () {
  'use strict';

  var DEVICE_KEY = 'attend.deviceId';
  var TIMEOUT_MS = 25000;

  /* 〇△× の記号は**保存される値**なので言語で変えない。ラベルだけ訳す。
     ここを変えると、これまでの回答と突き合わせられなくなる。 */
  var CHOICE_KEYS = [
    { key: '〇', cls: 'sel-maru',    lab: 'choiceYes' },
    { key: '△', cls: 'sel-sankaku', lab: 'choiceMaybe' },
    { key: '×', cls: 'sel-batsu',   lab: 'choiceNo' }
  ];
  function choices() {
    return CHOICE_KEYS.map(function (c) {
      return { key: c.key, cls: c.cls, lab: t(c.lab) };
    });
  }

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


  /* ---------- ことば ----------
     出欠ページは3言語ぶんのフォルダを持たない（配るURLが3倍になるため）。
     **言語は団体ごとに1つ**で、APIの応答に載ってくる lang をそのまま使う。
     参加者は何も選ばない。主催者が団体をつくるときに決める。

     最初の1枚を描くときはまだ応答が来ていないので、**前回この団体で使った言語**を
     端末から思い出して当てる。初めての人には既定（日本語）で出て、応答が来た時点で
     差し替わる。ここを端末の言語で決めないこと（日本の団体に英語の端末で入る人がいる）。 */
  var LANG_KEY = 'attend.lang.';
  var DEFAULT_LANG = 'ja';

  var DICT = {
    ja: {
      /* サーバーから code で返ってくるエラー。**訳はここにだけ置く** */
      err_noDevice: '端末の記憶が読めませんでした。ブラウザを更新してからもう一度お試しください。',
      err_noName: 'お名前が選ばれていません。',
      err_notInRoster: '名簿にないお名前です。主催者にご確認ください。',
      err_needRegister: '先にお名前の登録が必要です。',
      err_eventClosed: 'このイベントは申込締切をすぎています。',
      err_noAnswers: '回答が選ばれていません。',
      err_eventNotFound: 'イベントが見つかりません。主催者からもらったリンクをもう一度お確かめください。',
      err_orgNotFound: 'この出欠は見つかりませんでした。主催者からもらったリンクをもう一度お確かめください。',
      sep: '｜',
      choiceYes: '参加', choiceMaybe: 'どちらでも', choiceNo: '不参加', noAnswer: '未回答',
      loading: '読み込んでいます…', refreshing: '更新しています…',
      errHttp: 'サーバーの応答が異常です（{n}）',
      errNotJson: '出欠システムに接続できませんでした。主催者からもらったリンクをもう一度お確かめください。',
      errTimeout: '通信がタイムアウトしました。電波の良い場所でもう一度お試しください。',
      errBadLink: 'リンクが正しくありません。',
      errServer: 'サーバーでエラーが起きました。',
      needLinkTitle: 'リンクが正しくありません',
      needLinkBody: '主催者から届いた「出欠を回答する」のリンクをそのまま開いてください。アドレスの途中を消すと開けません。',
      metaDate: '📅 開催：', metaDeadline: '⏰ 締切：', metaPlace: '📍 会場：',
      dueToday: '（本日まで）', dueDays: '（あと{n}日）',
      linkYoukou: '📄 要項を見る', linkMap: '🗺️ 地図で見る', linkCal: '📆 カレンダーに追加',
      sumClosed: '締切後 ・ 最終結果', sumLive: '締切前 ・ 途中経過',
      sumResp: '回答した人：{n}人', sumResp1: '回答した人：{n}人',
      sumTotal: '計 ', sumMale: '男 ', sumFemale: '女 ',
      sumUnknown: '※ 性別が名簿にない回答 {n}件を含みます（男女の内訳に未反映）',
      sumNamesNote: '※ 人数のみ表示しています（どなたが回答したかは表示されません）。',
      failTitle: '読み込めませんでした', retry: 'もう一度読み込む',

      /* 回答ページ */
      answerTitle: '出欠を回答する', answerHead: '出欠の回答',
      loadingRoster: '名簿を読み込んでいます…',
      emptyRosterTitle: '名簿がまだ空です',
      emptyRosterBody: '主催者が名簿にお名前を入れると、ここから選べるようになります。',
      firstTitle: 'はじめての方へ',
      firstLead: '名簿からあなたのお名前を選んで、「これで登録」を押してください。登録はこの端末で最初の1回だけです。',
      regBtn: 'これで登録', regBusy: '登録しています…',
      meAs: '{name} さんとして回答します', relink: 'ちがう人です',
      noEventsTitle: 'いま受付中のイベントはありません',
      noEventsBody: '新しいイベントが登録されると、ここに表示されます。',
      pillDone: '回答ずみ', pillPart: '一部だけ回答',
      goAnswer: '回答する ›', footList: '※ 申込締切をすぎたイベントは表示されません。',
      backList: '← ほかの予定を見る',
      closedBadge: '申込締切をすぎました',
      doneEditable: '回答ずみ（変更できます）',
      closedBody: 'このイベントの受付は終わりました。下の結果だけご覧いただけます。',
      showSummary: 'みんなの回答を見る', hideSummary: '結果を閉じる', summarizing: '集計しています…',
      sendNew: 'この出欠を送信する', sendAgain: 'この内容で送りなおす',
      needAll: 'まだ選んでいない種目があります：{list}',
      sending: '送信しています…', sent: '✓ 送信しました。締切前なら何度でも直せます。',

      /* わたしの回答 */
      myTitle: 'わたしの回答', legendNone: 'まだ答えていない', refresh: '最新に更新',
      notRegMe: 'この端末はまだ名前の登録がありません',
      notRegTitle: 'まだ登録されていません',
      notRegBody: '「出欠を回答する」ページを開いて、名簿からお名前を選んでください。登録は最初の1回だけです。',
      goForm: '出欠を回答するページへ',
      meMy: '{name} さんの回答です',
      noOpenTitle: 'いま締切前のイベントはありません',
      unansweredSub: 'このイベントにはまだ回答していません',
      editAnswer: '回答を変更する',

      /* 集まり具合 */
      statusTitle: '出欠の状況',
      footStatus: '※ 人数のみ表示しています（どなたが回答したかは表示されません）。締切前は途中経過のため変わります。',
      noDataTitle: '表示できる出欠データがありません',
      noDataBody: 'イベントが登録されると、ここに集計が出ます。'
    },

    en: {
      /* サーバーから code で返ってくるエラー。**訳はここにだけ置く** */
      err_noDevice: 'This browser would not let us read its stored ID. Please reload and try again.',
      err_noName: 'No name is selected.',
      err_notInRoster: 'That name is not on the roster. Please check with your organiser.',
      err_needRegister: 'Please pick your name from the roster first.',
      err_eventClosed: 'This event is past its deadline.',
      err_noAnswers: 'Nothing is selected yet.',
      err_eventNotFound: 'That event could not be found. Please check the link your organiser sent you.',
      err_orgNotFound: 'This attendance page could not be found. Please check the link your organiser sent you.',
      sep: ' — ',
      choiceYes: 'Going', choiceMaybe: 'Maybe', choiceNo: 'Not going', noAnswer: 'No answer',
      loading: 'Loading…', refreshing: 'Refreshing…',
      errHttp: 'The server returned an unexpected response ({n}).',
      errNotJson: 'Could not reach the attendance system. Please check the link your organiser sent you.',
      errTimeout: 'The connection timed out. Please try again where the signal is better.',
      errBadLink: 'This link is not valid.',
      errServer: 'Something went wrong on the server.',
      needLinkTitle: 'This link is not valid',
      needLinkBody: 'Please open the link your organiser sent you, exactly as it is. Trimming part of the address stops it working.',
      metaDate: '📅 Date: ', metaDeadline: '⏰ Deadline: ', metaPlace: '📍 Venue: ',
      dueToday: ' (today is the last day)', dueDays: ' ({n} days left)',
      linkYoukou: '📄 Details', linkMap: '🗺️ Map', linkCal: '📆 Add to calendar',
      sumClosed: 'Closed · final result', sumLive: 'Open · running total',
      sumResp: '{n} people answered', sumResp1: '{n} person answered',
      sumTotal: 'All ', sumMale: 'M ', sumFemale: 'F ',
      sumUnknown: 'Includes {n} answers from people with no gender on the roster (not counted in M/F).',
      sumNamesNote: 'Counts only — who answered is never shown.',
      failTitle: 'Could not load', retry: 'Try again',

      answerTitle: 'Answer attendance', answerHead: 'Attendance',
      loadingRoster: 'Loading the roster…',
      emptyRosterTitle: 'The roster is still empty',
      emptyRosterBody: 'Once your organiser adds names to the roster, you can pick yours here.',
      firstTitle: 'First time here',
      firstLead: 'Pick your name from the roster and press “That’s me”. You only do this once on this device.',
      regBtn: 'That’s me', regBusy: 'Saving…',
      meAs: 'Answering as {name}', relink: 'Not me',
      noEventsTitle: 'No events are open right now',
      noEventsBody: 'New events will appear here once they are added.',
      pillDone: 'Answered', pillPart: 'Partly answered',
      goAnswer: 'Answer ›', footList: 'Events past their deadline are not listed.',
      backList: '← Back to the list',
      closedBadge: 'Past the deadline',
      doneEditable: 'Answered (you can change it)',
      closedBody: 'This event is closed. You can still see the result below.',
      showSummary: 'See everyone’s answers', hideSummary: 'Hide the result', summarizing: 'Counting…',
      sendNew: 'Send my answer', sendAgain: 'Send this again',
      needAll: 'Some entries are still unanswered: {list}',
      sending: 'Sending…', sent: '✓ Sent. You can change it any time before the deadline.',

      myTitle: 'My answers', legendNone: 'not answered yet', refresh: 'Refresh',
      notRegMe: 'No name is registered on this device yet',
      notRegTitle: 'Not registered yet',
      notRegBody: 'Open the “Answer attendance” page and pick your name from the roster. You only do this once.',
      goForm: 'Go to the attendance page',
      meMy: 'Answers by {name}',
      noOpenTitle: 'No events are open right now',
      unansweredSub: 'You have not answered this event yet',
      editAnswer: 'Change my answer',

      statusTitle: 'Attendance so far',
      footStatus: 'Counts only — who answered is never shown. Before the deadline these numbers still change.',
      noDataTitle: 'Nothing to show yet',
      noDataBody: 'Once events are added, the counts appear here.'
    },

    'in': {
      /* サーバーから code で返ってくるエラー。**訳はここにだけ置く** */
      err_noDevice: 'Browser ki stored ID nahi padh paye. Page reload karke dobara try karein.',
      err_noName: 'Koi naam select nahi hua.',
      err_notInRoster: 'Yeh naam roster mein nahi hai. Organiser se check karein.',
      err_needRegister: 'Pehle roster se apna naam chunein.',
      err_eventClosed: 'Is event ki last date nikal chuki hai.',
      err_noAnswers: 'Abhi kuch select nahi kiya.',
      err_eventNotFound: 'Yeh event nahi mila. Organiser ka bheja link check karein.',
      err_orgNotFound: 'Yeh attendance page nahi mila. Organiser ka bheja link check karein.',
      sep: ' — ',
      choiceYes: 'Aa rahe hain', choiceMaybe: 'Shayad', choiceNo: 'Nahi aa rahe',
      noAnswer: 'Jawab nahi',
      loading: 'Load ho raha hai…', refreshing: 'Refresh ho raha hai…',
      errHttp: 'Server ne galat jawab diya ({n}).',
      errNotJson: 'Attendance system tak nahi pahunche. Organiser ne jo link bheja hai, use check karein.',
      errTimeout: 'Connection timeout ho gaya. Achhe signal mein dobara try karein.',
      errBadLink: 'Yeh link sahi nahi hai.',
      errServer: 'Server par kuch galat ho gaya.',
      needLinkTitle: 'Yeh link sahi nahi hai',
      needLinkBody: 'Organiser ka bheja hua link jaisa hai waisa hi kholein. Address ka koi hissa hataane par nahi chalega.',
      metaDate: '📅 Date: ', metaDeadline: '⏰ Last date: ', metaPlace: '📍 Jagah: ',
      dueToday: ' (aaj aakhri din)', dueDays: ' ({n} din baaki)',
      linkYoukou: '📄 Details', linkMap: '🗺️ Map', linkCal: '📆 Calendar mein add',
      sumClosed: 'Band · final result', sumLive: 'Chalu · abhi tak',
      sumResp: '{n} logon ne jawab diya', sumResp1: '{n} vyakti ne jawab diya',
      sumTotal: 'Total ', sumMale: 'M ', sumFemale: 'F ',
      sumUnknown: 'Isme {n} aise jawab hain jinka gender roster mein nahi hai (M/F mein nahi gine).',
      sumNamesNote: 'Sirf ginti — kisne jawab diya, yeh kabhi nahi dikhta.',
      failTitle: 'Load nahi hua', retry: 'Dobara try karein',

      answerTitle: 'Attendance bhejein', answerHead: 'Attendance',
      loadingRoster: 'Roster load ho raha hai…',
      emptyRosterTitle: 'Roster abhi khali hai',
      emptyRosterBody: 'Organiser roster mein naam daalenge, tab aap yahan se chun sakenge.',
      firstTitle: 'Pehli baar',
      firstLead: 'Roster se apna naam chunein aur “Yeh main hoon” dabayein. Is device par sirf ek baar.',
      regBtn: 'Yeh main hoon', regBusy: 'Save ho raha hai…',
      meAs: '{name} ke roop mein jawab', relink: 'Main nahi hoon',
      noEventsTitle: 'Abhi koi event chalu nahi hai',
      noEventsBody: 'Naye event add hone par yahan dikhenge.',
      pillDone: 'Jawab diya', pillPart: 'Adhoora jawab',
      goAnswer: 'Jawab dein ›', footList: 'Last date nikal chuke event yahan nahi dikhte.',
      backList: '← List par wapas',
      closedBadge: 'Last date nikal gayi',
      doneEditable: 'Jawab diya (badal sakte hain)',
      closedBody: 'Yeh event band ho gaya. Neeche result dekh sakte hain.',
      showSummary: 'Sabke jawab dekhein', hideSummary: 'Result band karein', summarizing: 'Gin rahe hain…',
      sendNew: 'Jawab bhejein', sendAgain: 'Dobara bhejein',
      needAll: 'Kuch entries ka jawab baaki hai: {list}',
      sending: 'Bhej rahe hain…', sent: '✓ Bhej diya. Last date se pehle jitni baar chahe badal sakte hain.',

      myTitle: 'Mere jawab', legendNone: 'abhi jawab nahi diya', refresh: 'Refresh',
      notRegMe: 'Is device par abhi koi naam register nahi hai',
      notRegTitle: 'Abhi register nahi hue',
      notRegBody: '“Attendance bhejein” page kholein aur roster se apna naam chunein. Sirf ek baar karna hai.',
      goForm: 'Attendance page par jayein',
      meMy: '{name} ke jawab',
      noOpenTitle: 'Abhi koi event chalu nahi hai',
      unansweredSub: 'Aapne is event ka jawab nahi diya',
      editAnswer: 'Jawab badlein',

      statusTitle: 'Abhi tak ki attendance',
      footStatus: 'Sirf ginti — kisne jawab diya yeh nahi dikhta. Last date se pehle ginti badalti rahegi.',
      noDataTitle: 'Abhi dikhane ko kuch nahi',
      noDataBody: 'Event add hone par yahan ginti aayegi.'
    }
  };

  var lang = DEFAULT_LANG;

  function t(key, vars) {
    var d = DICT[lang] || DICT[DEFAULT_LANG];
    var v = d[key];
    if (v == null) v = DICT[DEFAULT_LANG][key];
    if (v == null) return key;
    if (!vars) return v;
    return String(v).replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] == null ? m : String(vars[k]);
    });
  }

  /** 画面の固定文言を差し替える。data-i18n の中身、data-i18n-title は <title> */
  function applyDom(root) {
    var box = root || document;
    Array.prototype.forEach.call(box.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    var head = document.querySelector('[data-i18n-title]');
    if (head) document.title = t(head.getAttribute('data-i18n-title'));
    document.documentElement.setAttribute('lang', lang === 'in' ? 'en' : lang);
  }

  /** APIが返してきた団体の言語に合わせる。変わったときだけ描き直す */
  function setLang(l) {
    var next = DICT[l] ? l : DEFAULT_LANG;
    if (orgId) lsSet(LANG_KEY + orgId, next);
    if (next === lang) return false;
    lang = next;
    applyDom();
    return true;
  }

  /** ページの見出しに団体名を足す。言語ごとに区切りが違う */
  function setTitle(key, org) {
    document.title = org ? t(key) + t('sep') + org : t(key);
  }

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

  /* ---------- 団体ID ---------- */
  var API_BASE = 'https://api.dropper-tools.com/';

  function parseOrgId(raw) {
    var s = String(raw == null ? '' : raw).trim();
    return /^[A-Za-z0-9_-]{10,200}$/.test(s) ? s : '';
  }

  function apiUrl(orgId) {
    return parseOrgId(orgId) ? API_BASE : '';
  }

  /* ---------- URLパラメータ ---------- */
  var params = new URLSearchParams(window.location.search);
  var orgId = parseOrgId(params.get('s'));
  var eventId = String(params.get('e') || '').trim();

  // 最初の1枚は、前回この団体で使った言語で描く（応答が来たら setLang で直る）
  (function () {
    var saved = orgId ? lsGet(LANG_KEY + orgId) : '';
    if (saved && DICT[saved]) lang = saved;
  })();

  /* ---------- 通信 ---------- */
  function fetchJson(url, options) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var opt = options || {};
    if (ctrl) opt.signal = ctrl.signal;

    return fetch(url, opt).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error(t('errHttp', { n: res.status }));
      return res.text();
    }).then(function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        // JSONでない＝出欠システムに届いていない
        throw new Error(t('errNotJson'));
      }
      return data;
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error(t('errTimeout'));
      throw err;
    });
  }

  function get(action, extra, id) {
    var use = parseOrgId(id || orgId);
    if (!use) return Promise.reject(new Error(t('errBadLink')));
    var q = ['s=' + encodeURIComponent(use)];
    if (action) q.push('action=' + encodeURIComponent(action));
    var p = extra || {};
    Object.keys(p).forEach(function (k) {
      if (p[k] !== undefined && p[k] !== null && p[k] !== '') q.push(k + '=' + encodeURIComponent(p[k]));
    });
    return fetchJson(API_BASE + '?' + q.join('&')).then(unwrap);
  }

  function post(body, id) {
    var use = parseOrgId(id || orgId);
    if (!use) return Promise.reject(new Error(t('errBadLink')));
    var b = JSON.parse(JSON.stringify(body || {}));
    b.s = use;
    return fetchJson(API_BASE, {
      method: 'POST',
      // text/plain だとブラウザがプリフライトを飛ばすので1往復ぶん速い
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(b)
    }).then(unwrap);
  }

  function unwrap(data) {
    if (!data || data.ok !== true) {
      // サーバーは訳さない。code を見てこちらで訳す（訳が無ければ日本語の保険を出す）
      var code = data && data.code;
      var msg = (code && DICT[lang] && DICT[lang]['err_' + code])
        ? t('err_' + code)
        : ((data && data.error) || t('errServer'));
      var e = new Error(msg);
      if (code) e.code = code;
      throw e;
    }
    // 団体の言語は毎回ついてくる。**受け取ったらすぐ合わせる**
    if (data.lang) setLang(data.lang);
    return data;
  }

  /* ---------- 表示ヘルパー ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function badge(mark) {
    if (mark === '〇') return { cls: 'b-o', txt: '〇 ' + t('choiceYes') };
    if (mark === '△') return { cls: 'b-s', txt: '△ ' + t('choiceMaybe') };
    if (mark === '×') return { cls: 'b-x', txt: '× ' + t('choiceNo') };
    return { cls: 'b-n', txt: t('noAnswer') };
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
    if (days === 0) return t('dueToday');
    if (days > 0 && days <= 3) return t('dueDays', { n: days });
    return '';
  }

  function metaHtml(ev) {
    return (ev.date ? '<div class="meta">' + esc(t('metaDate')) + esc(ev.date) + '</div>' : '')
      + (ev.deadline ? '<div class="meta deadline">' + esc(t('metaDeadline')) + esc(ev.deadline) + esc(dueSuffix(ev.deadline)) + '</div>' : '')
      + (ev.place ? '<div class="meta">' + esc(t('metaPlace')) + esc(ev.place) + '</div>' : '');
  }

  /* ---------- 要項・地図・カレンダー ----------
     案内文にURLを並べると、長いリンク2本で本文が埋もれて出欠が目立たなくなる。
     そこで案内文からは外し、**回答画面に本物のボタンとして置く**。
     参加者はリッチメニュー →（この画面）で、見るものも足すものも揃う。 */

  function mapsUrl(ev) {
    var q = (ev.address || ev.place || '').trim();
    return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
  }

  /** Googleカレンダーの追加画面。日付は終日1日ぶん（YYYYMMDD/翌日）。 */
  function gcalUrl(ev) {
    var m = String(ev.dateRaw || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var start = m[1] + m[2] + m[3];
    // 終日予定の終わりは「翌日」を渡す決まり。月末をまたぐのでDateに計算させる
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    var end = d.getUTCFullYear()
      + ('0' + (d.getUTCMonth() + 1)).slice(-2)
      + ('0' + d.getUTCDate()).slice(-2);

    var p = 'action=TEMPLATE&text=' + encodeURIComponent(ev.name || '')
      + '&dates=' + start + '/' + end
      + (ev.place || ev.address ? '&location=' + encodeURIComponent(ev.address || ev.place) : '');
    return 'https://calendar.google.com/calendar/render?' + p;
  }

  /** 回答画面に並べるボタン。無いものは出さない。 */
  function linksHtml(ev) {
    var b = [];
    if (ev.youkou) b.push([t('linkYoukou'), ev.youkou]);
    var mp = mapsUrl(ev); if (mp) b.push([t('linkMap'), mp]);
    var gc = gcalUrl(ev); if (gc) b.push([t('linkCal'), gc]);
    if (!b.length) return '';

    return '<div class="evlinks">' + b.map(function (x) {
      return '<a class="evlink" href="' + esc(x[1]) + '" target="_blank" rel="noopener">' + esc(x[0]) + '</a>';
    }).join('') + '</div>';
  }

  /** 集計パネル（人数のみ・個人名なし） */
  function summaryHtml(sum) {
    if (!sum) return '';
    var n = Number(sum.respCount || 0);
    var head = '<div class="sum"><div class="sum-head">'
      + (sum.closed ? '<span class="badge closed">' + esc(t('sumClosed')) + '</span>'
                     : '<span class="badge live">' + esc(t('sumLive')) + '</span>')
      + '<span>' + esc(t(n === 1 ? 'sumResp1' : 'sumResp', { n: n })) + '</span></div>';

    var body = (sum.items || []).map(function (it) {
      return '<div class="sum-item"><div class="name">' + esc(it.name) + '</div>'
        + sumRow('maru', '〇 ' + t('choiceYes'), it.maru)
        + sumRow('sankaku', '△ ' + t('choiceMaybe'), it.sankaku)
        + sumRow('batsu', '× ' + t('choiceNo'), it.batsu)
        + unknownNote(it)
        + '</div>';
    }).join('');

    return head + body + '</div>';
  }

  function sumRow(cls, label, o) {
    var v = o || { m: 0, f: 0, u: 0 };
    var total = (v.m || 0) + (v.f || 0) + (v.u || 0);
    return '<div class="sum-row"><span class="lab ' + cls + '">' + esc(label) + '</span><div class="nums">'
      + '<span class="pill"><span class="total">' + esc(t('sumTotal')) + total + '</span></span>'
      + '<span class="pill">' + esc(t('sumMale')) + '<span class="m">' + (v.m || 0) + '</span></span>'
      + '<span class="pill">' + esc(t('sumFemale')) + '<span class="f">' + (v.f || 0) + '</span></span>'
      + '</div></div>';
  }

  function unknownNote(it) {
    var u = ((it.maru && it.maru.u) || 0) + ((it.sankaku && it.sankaku.u) || 0) + ((it.batsu && it.batsu.u) || 0);
    return u > 0 ? '<div class="unknown">' + esc(t('sumUnknown', { n: u })) + '</div>' : '';
  }

  function noteHtml(title, text, isErr) {
    return '<div class="note' + (isErr ? ' err' : '') + '">'
      + (title ? '<div class="big">' + esc(title) + '</div>' : '')
      + esc(text) + '</div>';
  }

  function loadingHtml(text) {
    return '<div class="note"><div class="spinner" aria-hidden="true"></div>' + esc(text || t('loading')) + '</div>';
  }

  /** リンクに ?s= が無いときの案内。true を返したら以降の処理を止める */
  function requireOrgId(el) {
    if (orgId) return false;
    el.innerHTML = noteHtml(t('needLinkTitle'), t('needLinkBody'), true);
    return true;
  }

  applyDom();   // 読み込んだ時点で、覚えている言語に合わせておく

  return {
    choices: choices,
    t: t,
    setLang: setLang,
    setTitle: setTitle,
    applyDom: applyDom,
    lang: function () { return lang; },
    API_BASE: API_BASE,
    orgId: orgId,
    eventId: eventId,
    deviceId: deviceId,
    parseOrgId: parseOrgId,
    apiUrl: apiUrl,
    get: get,
    post: post,
    esc: esc,
    badge: badge,
    dueSuffix: dueSuffix,
    metaHtml: metaHtml,
    linksHtml: linksHtml,
    summaryHtml: summaryHtml,
    noteHtml: noteHtml,
    loadingHtml: loadingHtml,
    requireOrgId: requireOrgId,
    lsGet: lsGet,
    lsSet: lsSet,
    lsDel: lsDel
  };
})();
