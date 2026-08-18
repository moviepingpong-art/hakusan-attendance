/* 出欠ドロッパー連携フック v2.0
   イベントドロッパー（dropper-app の calendar/）に読み込ませて使う小さなモジュール。

     AttendanceHook.saveToken(ev)   読み取った内容を、貼り付け用の文字列にする
     AttendanceHook.available()     使える状態か（この版では常に true）

   ★v2 でやめたこと
   主催者の表への書き込みをやめた。以前は書き込みキーを端末に保存して
   GASへPOSTしていたが、そのために

     ・出欠システムの設定モーダル（URL＋書き込みキー）
     ・端末ごとの設定保存と、iOS Safari の「サイト超えトラッキングを防ぐ」対策
     ・PCとスマホで別々に設定する運用

   が必要だった。読み取った内容をクリップボードに載せて主催者に渡し、
   表のサイドバーで取り込む形にしたので、これらがまとめて要らなくなった。
   **このファイルは通信も保存も一切しない。**

   取り込む側は gas/attendance-api.gs の importTaikai。
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

  return {
    available: available,
    saveToken: saveToken
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AttendanceHook;
