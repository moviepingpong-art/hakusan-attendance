/* ============================================================
 *  参加者の画面のうち「わたしの回答」と「みんなの回答」の中身。
 *
 *  ここが唯一の実体で、呼ぶ側は3つある。
 *    my.html      … リッチメニューの「わたしの回答」
 *    status.html  … リッチメニューの「みんなの回答」
 *    index.html   … Webで配る1本（タブで切り替える）
 *  HTML側には器と呼び出しだけを置き、描き方はこのファイルに集めてある。
 *  片方だけ直すと、LINEから来た人とWebから来た人で画面が食い違う。
 *
 *  attend.js のあとに読み込むこと。
 * ========================================================== */
(function () {
  'use strict';
  if (!window.ATTEND) return;

  var ATTEND = window.ATTEND;
  var esc = ATTEND.esc;
  var T = ATTEND.t;

  /** 回答フォームへの行き先。まとめた1本では、別ページではなくタブを切り替えたいので
      呼ぶ側が差し替えられるようにしてある。 */
  function defaultFormUrl(eventId) {
    var u = 'index.html?s=' + encodeURIComponent(ATTEND.orgId);
    return eventId ? u + '&e=' + encodeURIComponent(eventId) : u;
  }

  /* ---------- わたしの回答 ---------- */

  function createMy(opts) {
    var o = opts || {};
    var $wrap = o.wrap;
    var $me   = o.me  || null;
    var $org  = o.org || null;
    var formUrl = o.formUrl || defaultFormUrl;
    var device = ATTEND.deviceId();
    var ready = false;

    // 回答フォームから戻ってきたら自動で最新化
    if (o.autoRefreshOnVisible) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && ready) load(true);
      });
    }

    function load(isReload) {
      $wrap.innerHTML = ATTEND.loadingHtml(isReload ? T('refreshing') : T('loading'));

      return ATTEND.get('myanswers', { d: device }).then(function (data) {
        ready = true;
        if (data.org) {
          if ($org) $org.textContent = data.org;
          ATTEND.setTitle('myTitle', data.org);
        }

        if (!data.registered) {
          if ($me) $me.innerHTML = '<span>' + esc(T('notRegMe')) + '</span>';
          $wrap.innerHTML = ATTEND.noteHtml(T('notRegTitle'), T('notRegBody'))
            + '<a class="ghost" href="' + esc(formUrl('')) + '" data-goform="list">' + esc(T('goForm')) + '</a>';
          return;
        }

        if ($me) {
          var my = T('meMy', { name: '\u0000' }).split('\u0000');
          $me.innerHTML = '<span>' + esc(my[0]) + '<b>' + esc(data.member.name) + '</b>' + esc(my[1] || '') + '</span>';
        }
        render(data.myanswers || []);
      }).catch(function (err) {
        $wrap.innerHTML = ATTEND.noteHtml(T('failTitle'), String(err && err.message || err), true);
      });
    }

    function render(items) {
      if (!items.length) {
        $wrap.innerHTML = ATTEND.noteHtml(T('noOpenTitle'), T('noEventsBody'));
        return;
      }
      $wrap.innerHTML = items.map(cardHtml).join('');
    }

    function cardHtml(ev) {
      var pill = ev.allAnswered
        ? '<span class="status st-done">' + esc(T('pillDone')) + '</span>'
        : '<span class="status st-part">' + esc(T('pillPart')) + '</span>';

      var head = '<div class="card-head' + (ev.answered ? '' : ' no-border') + '">'
        + '<h2>' + esc(ev.name) + '</h2>'
        + ATTEND.metaHtml(ev)
        + (ev.answered ? '<div>' + pill + '</div>' : '')
        + '</div>';

      // 未回答は「未回答」とだけ大きく出す（フォームへ強制誘導しない）
      if (!ev.answered) {
        return '<div class="card">' + head
          + '<div class="unanswered">'
          +   '<div class="word">' + esc(T('noAnswer')) + '</div>'
          +   '<div class="sub">' + esc(T('unansweredSub')) + '</div>'
          + '</div>'
          + '</div>';
      }

      var rows = (ev.items || []).map(function (it) {
        var b = ATTEND.badge(it.answer);
        return '<div class="row"><div class="name">' + esc(it.name) + '</div>'
          + '<div class="ansbadge ' + b.cls + '">' + b.txt + '</div></div>';
      }).join('');

      return '<div class="card">' + head + rows
        + '<a class="ghost" href="' + esc(formUrl(ev.id)) + '" data-goform="event">'
        + esc(T('editAnswer')) + '</a>'
        + '</div>';
    }

    return { load: load, isReady: function () { return ready; } };
  }

  /* ---------- みんなの回答（名前の選択は要らない） ---------- */

  function createStatus(opts) {
    var o = opts || {};
    var $wrap = o.wrap;
    var $org  = o.org || null;
    // ?e= があればそのイベントだけ、なければ全イベント（締切後も含む）
    var eventId = ('eventId' in o) ? o.eventId : ATTEND.eventId;

    function load(isReload) {
      $wrap.innerHTML = ATTEND.loadingHtml(isReload ? T('refreshing') : T('loading'));

      return ATTEND.get('summary', eventId ? { e: eventId } : null).then(function (data) {
        if (data.org) {
          if ($org) $org.textContent = data.org;
          ATTEND.setTitle('statusTitle', data.org);
        }
        /* ★ 脚注は「人数のみ表示しています」と書いてある。
           名前を見せる団体ではこれが**嘘になる**ので、団体の設定に合わせて言い換える。
           HTMLに直書きの文は伏せる団体（既定）ぶんの値。 */
        var foot = o.foot || null;
        if (foot) {
          var key = data.showNames ? 'footStatusNames' : 'footStatus';
          foot.setAttribute('data-i18n', key);   // あとで applyDom に戻されないように
          foot.textContent = T(key);
        }
        render(data.summaries || []);
      }).catch(function (err) {
        $wrap.innerHTML = ATTEND.noteHtml(T('failTitle'), String(err && err.message || err), true);
      });
    }

    function render(list) {
      if (!list.length) {
        $wrap.innerHTML = ATTEND.noteHtml(T('noDataTitle'), T('noDataBody'));
        return;
      }
      $wrap.innerHTML = list.map(function (sum) {
        return '<div class="card"><div class="card-head no-border">'
          + '<h2>' + esc(sum.name) + '</h2>'
          + ATTEND.metaHtml(sum)
          // 主催者からの連絡事項。回答したあとに見に来る人がいるので、ここにも出す
          + ATTEND.memoHtml(sum)
          + '</div>'
          + ATTEND.summaryHtml(sum)
          + '</div>';
      }).join('');
    }

    return { load: load };
  }

  ATTEND.views = {
    my:     { create: createMy },
    status: { create: createStatus }
  };
})();
