/* 出欠ドロッパー連携フック v2.1
   イベントドロッパー（dropper-app の calendar/）に読み込ませて使う小さなモジュール。

     AttendanceHook.saveToken(ev)   読み取った内容を、受け渡し用の文字列にする
     AttendanceHook.adminUrl(tk)    その文字列を積んだ、出欠システムの管理画面のURL
     AttendanceHook.available()     使える状態か（この版では常に true）

   ★v2 でやめたこと
   主催者の表への書き込みをやめた。以前は書き込みキーを端末に保存して
   GASへPOSTしていたが、そのために

     ・出欠システムの設定モーダル（URL＋書き込みキー）
     ・端末ごとの設定保存と、iOS Safari の「サイト超えトラッキングを防ぐ」対策
     ・PCとスマホで別々に設定する運用

   が必要だった。読み取った内容を主催者に手渡す形にしたので、これらがまとめて要らなくなった。
   **このファイルは通信も保存も一切しない。**

   ★v2.1 受け渡しを「管理画面を開く」に変えた
   以前はクリップボードに載せ、主催者が管理画面に貼り付けていた。いまは
   adminUrl() の行き先を開くだけで取り込みまで進む。貼り付けは、
   ポップアップを止められたときの逃げ道として残してある。

   取り込む側は api/src/index.js の importTaikai。
   符号化の形を変えるときは必ず両方そろえること。
   parser.js は触らないこと。
*/
var AttendanceHook = (function () {
  'use strict';

  function available() { return true; }

  function b64url_(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function toPlain(v) {
    if (!v) return '';
    if (v instanceof Date) return v.getFullYear() + '/' + (v.getMonth() + 1) + '/' + v.getDate();
    return String(v).trim();
  }

  /**
   * 読み取った内容を、表に貼り付ける文字列にする。
   * @param {{name:string, date?:string|Date, deadline?:string|Date, place?:string,
   *          items?:string|string[], youkou?:string, detail?:Object}} ev
   * @returns {string} 貼り付け用の文字列。名前が無ければ空
   */
  function saveToken(ev) {
    var name = String((ev && ev.name) || '').trim();
    if (!name) return '';

    var items = Array.isArray(ev.items)
      ? ev.items.map(function (s) { return String(s).trim(); }).filter(String)
      : String(ev.items || '').split(/[、,，\n\/／]+/).map(function (s) { return s.trim(); }).filter(String);

    return b64url_(JSON.stringify({
      name: name,
      date: toPlain(ev.date),
      deadline: toPlain(ev.deadline),
      place: String((ev && ev.place) || '').trim(),
      items: items,
      youkou: String((ev && ev.youkou) || '').trim(),
      detail: (ev && ev.detail) || null
    }));
  }

  /**
   * 管理画面のURL。トークンは # のうしろに置く。
   * **サーバーには送られない**ので、要項の中身がアクセスログに残らない。
   * 配るURLと同じく app.dropper-tools.com に固定する（端末の記憶は出どころごとに別物のため）。
   * 試験のときだけ window.ATTEND_ADMIN_URL で行き先を差し替える。
   * @param {string} token saveToken が返した文字列
   * @returns {string} 開くべきURL。トークンが空なら空
   */
  function adminUrl(token) {
    if (!token) return '';
    var base = (typeof window !== 'undefined' && window.ATTEND_ADMIN_URL)
      || 'https://app.dropper-tools.com/attend/admin.html';
    /* ★ ドロッパーのことばを一緒に渡す（`&l=`）。
       出欠システムは1本しか無く、参加者に見せることばは**団体ごと**に持っている。
       これが無いと、英語版のドロッパーから作った団体も日本語の画面になってしまう。
       以前は管理画面で主催者に選ばせていたが、**日本語版で作った出欠は日本語**という
       当たり前を機械が決めればよいので、2026-08-25 に選択欄をやめてこちらに移した。
       受け取るのは attend/admin.html の readHash。知らない値は向こうで捨てられる。 */
    var lang = (typeof window !== 'undefined' && window.LANG) ? String(window.LANG) : '';
    return base + '#t=' + token + (lang ? '&l=' + encodeURIComponent(lang) : '');
  }

  return {
    available: available,
    saveToken: saveToken,
    adminUrl: adminUrl
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AttendanceHook;
