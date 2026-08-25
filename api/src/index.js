/**
 * 出欠ドロッパー — API（Cloudflare Worker）
 *
 * GAS版（gas/attendance-api.gs）の置き換え。**同じ action 名・同じ応答の形**をわざと守っている。
 * 参加者側の attend/*.html はURLの組み立てだけ差し替えれば動く。
 *
 * ★ 主催者の認証は「管理リンク」1本。
 *   団体を作るときに合鍵（adminKey）を1回だけ返し、こちらは SHA-256 しか保存しない。
 *   合鍵は**必ずPOSTの本文で受け取る**こと。クエリに載せるとアクセスログや Referer に残る。
 *
 * ★ いまの範囲：土台・団体作成・名簿・削除（段階1）、参加者の一連（段階2）、
 *   行事の取り込みと出欠の作成、主催者向けの集計（段階3）。
 */

const API_VERSION = 'w1.3';

/** 画面を置いてある出どころ。ここ以外からのブラウザ呼び出しは通さない。
 *  ※ オリジンを混ぜると端末の記憶が別物になる（CLAUDE.md の警告）。増やすときは慎重に。 */
const ALLOW_ORIGINS = [
  'https://app.dropper-tools.com',
  'https://moviepingpong-art.github.io',
  'http://127.0.0.1:8130',
  'http://localhost:8130'
];

/** 名簿の上限。ひとつの団体が際限なく太らないように */
const MEMBERS_MAX = 500;

/** 行事の一覧に出す件数。これより古いものは画面に出さない（GAS版と同じ） */
const TAIKAI_LIST_MAX = 30;


/* ============================================================
 *  入口
 * ========================================================== */

export default {
  async fetch(request, env) {
    const origin = originOf(request);

    if (request.method === 'OPTIONS') return preflight(origin);

    try {
      const url = new URL(request.url);

      if (request.method === 'GET') {
        return json(await handleGet(url, env), 200, origin);
      }
      if (request.method === 'POST') {
        return json(await handlePost(await readBody(request), env), 200, origin);
      }
      return json(bad('badMethod', '対応していない呼び出しです。'), 405, origin);

    } catch (err) {
      // 中身は伏せる。主催者にも参加者にも意味が無く、手がかりを与えるだけなので
      console.error(err && err.stack || err);
      return json(bad('serverError', 'サーバーでエラーが起きました。時間をおいてお試しください。'), 500, origin);
    }
  }
};

async function handleGet(url, env) {
  const p = Object.fromEntries(url.searchParams);
  const action = String(p.action || '').trim();

  switch (action) {
    case '':
    case 'events':    return await listEvents(env, p.s, p.d);
    case 'event':     return await getEvent(env, p.s, p.e, p.d);
    case 'members':   return await publicMembers(env, p.s);
    case 'whoami':    return await whoami(env, p.s, p.d);
    case 'summary':   return await summaryAction(env, p.s, p.e);
    case 'myanswers': return await myAnswers(env, p.s, p.d);
    case 'ping':      return await ping(env, p.s);
    default:
      return bad('badAction', '対応していない呼び出しです（' + action + '）。', { a: action });
  }
}

async function handlePost(b, env) {
  const action = String(b.action || '').trim();

  switch (action) {
    case 'register':    return await register(env, b);
    case 'answer':      return await answer(env, b);
    case 'createOrg':   return await createOrg(env, b);
    case 'org':         return await orgHome(env, b);
    case 'saveOrg':     return await saveOrg(env, b);
    case 'saveMembers': return await saveMembers(env, b);
    case 'listTaikai':  return await listTaikai(env, b);
    case 'importTaikai':      return await importTaikai(env, b);
    case 'addTaikaiManually': return await addTaikaiManually(env, b);
    case 'createEventFromTaikai': return await createEventFromTaikai(env, b);
    case 'deleteTaikai': return await deleteTaikai(env, b);
    case 'adminEvents': return await adminEvents(env, b);
    case 'deleteEvent': return await deleteEvent(env, b);
    case 'tally':       return await tally(env, b);
    case 'closeEvent':  return await closeEvent(env, b);
    case 'deleteOrg':   return await deleteOrg(env, b);
    default:
      return bad('badAction', '対応していない呼び出しです（' + action + '）。', { a: action });
  }
}


/* ============================================================
 *  参加者向け（合鍵は要らない）
 *
 *  ★ 参加者に見えるエラーには `code` を付ける。
 *  文言の訳は画面側（attend.js の DICT）に集めてあり、**サーバーは訳さない**。
 *  団体の言語はサーバーも知っているが、ここで訳すと辞書が2か所に散る。
 *  `error` の日本語は、code を知らない古い画面のための保険。
 * ========================================================== */

async function ping(env, orgId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  return { ok: true, org: org.name, lang: normLang(org.lang), version: API_VERSION };
}

async function publicMembers(env, orgId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);
  return { ok: true, org: org.name, lang: normLang(org.lang), members: await membersOf(env, org.id, false) };
}

/** 受付中の一覧。締切をすぎたものは出さない（GAS版と同じ） */
async function listEvents(env, orgId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  const me = await linkOf(env, org.id, deviceId);
  const mine = me ? await latestOfName(env, org.id, me.name) : {};
  const myNotes = me ? await notesOfName(env, org.id, me.name) : {};
  const events = (await eventsOf(env, org.id, org.lang))
    .filter(ev => !ev.closed)
    .map(ev => publicEvent(ev, mine[ev.id] || null, myNotes[ev.id]));

  return { ok: true, org: org.name, lang: normLang(org.lang), member: me, events };
}

/** イベント1件。**締切後でも返す**（フォーム側で締切表示にするため） */
async function getEvent(env, orgId, eventId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  const ev = await findEvent(env, org.id, eventId, org.lang);
  if (!ev) return notFoundEvent();

  const me = await linkOf(env, org.id, deviceId);
  const mine = me ? ((await latestOfName(env, org.id, me.name))[ev.id] || null) : null;
  const myNote = me ? (await notesOfName(env, org.id, me.name))[ev.id] : '';

  return {
    ok: true, org: org.name, lang: normLang(org.lang), member: me,
    event: publicEvent(ev, mine, myNote)
  };
}

/** 端末IDから登録ずみの本人を返す */
async function whoami(env, orgId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();

  const me = await linkOf(env, org.id, deviceId);
  return { ok: true, org: org.name, lang: normLang(org.lang), registered: !!me, member: me };
}

/** e があればその1件、なければ全イベントの集計。
 *
 *  回答者の名前とコメントは、団体が `show_names = 1` を選んだときだけ出す（既定は伏せる）。
 *  **未回答者の名前は、設定に関わらずここには決して入れない。**
 *  「誰が来るか」を見せるのと「誰がまだ答えていないか」を晒すのは別の話で、
 *  後者を出してよいのは主催者向けの `adminEvents` と `tally` だけ。 */
async function summaryAction(env, orgId, eventId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  let evs;
  if (String(eventId == null ? '' : eventId).trim()) {
    const ev = await findEvent(env, org.id, eventId, org.lang);
    if (!ev) return notFoundEvent();
    evs = [ev];
  } else {
    evs = (await eventsOf(env, org.id, org.lang)).slice().reverse().slice(0, 50);
  }

  const showNames = isOn(org.show_names);
  const genders = await genderMap(env, org.id);
  const summaries = [];
  for (const ev of evs) {
    summaries.push(summaryOf(
      ev,
      await latestOfEvent(env, org.id, ev.id),
      genders,
      showNames,
      showNames ? await notesOf(env, org.id, ev.id) : null
    ));
  }

  return {
    ok: true, org: org.name, lang: normLang(org.lang),
    showNames, summaries, summary: summaries[0] || null
  };
}

/** 締切前の各イベントについて、その端末の最新回答 */
async function myAnswers(env, orgId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  const me = await linkOf(env, org.id, deviceId);
  const mine = me ? await latestOfName(env, org.id, me.name) : {};
  // 自分が書いた一言。書き直せるように、そのまま入力欄へ戻す
  const myNotes = me ? await notesOfName(env, org.id, me.name) : {};

  const list = (await eventsOf(env, org.id, org.lang)).filter(ev => !ev.closed).map(ev => {
    const ans = mine[ev.id] || null;
    const items = ev.items.map(it => ({ name: it, answer: (ans && ans[it]) || '' }));
    const done = items.filter(x => !!x.answer).length;
    return {
      id: ev.id, name: ev.name, date: ev.dateText, deadline: ev.deadlineText, youkou: ev.youkou,
      items, note: myNotes[ev.id] || '',
      answered: done > 0, allAnswered: done > 0 && done === items.length
    };
  });

  return { ok: true, org: org.name, lang: normLang(org.lang), member: me, registered: !!me, myanswers: list };
}

/** 名簿から名前を選んで端末を紐付ける。上書きせず追記し、いちばん新しい行を採用する */
async function register(env, b) {
  const org = await findOrg(env, b.s);
  if (!org) return notFoundOrg();

  const deviceId = String(b.deviceId == null ? '' : b.deviceId).trim();
  const name = String(b.name == null ? '' : b.name).trim();
  if (!deviceId) return { ok: false, code: 'noDevice', error: '端末IDがありません。ブラウザを更新してからもう一度お試しください。' };
  if (!name) return { ok: false, code: 'noName', error: 'お名前が選ばれていません。' };

  const mem = (await membersOf(env, org.id, false)).find(m => normKey(m.name) === normKey(name));
  if (!mem) return { ok: false, code: 'notInRoster', error: '名簿にないお名前です。主催者にご確認ください。', notInRoster: true };

  /* その名前を、**別の端末がすでに使っているか**。
     団体のURLを知っていれば名簿の誰の名前でも選べるので、名簿の隣の行を押し間違えると
     他人の回答を書き換えてしまう。

     ★ 塞がずに知らせるだけにしてある。理由は3つ。
       - 機種変更・家族での共用があり、名前を選び直せること自体が要る
       - `links` は追記式で、ここで入れても**他の端末の紐付けは消えない**。
         何も奪っていないので、押し間違えた人はそのまま選び直せる
       - 拒否にすると、古い画面（キャッシュ）を使っている人が確認を出せずに詰む。
         知らせるだけなら、古い画面は今までどおり動く（`taken` を無視するだけ） */
  // ★ この端末が前にもその名前を使っていたら、警告しない。
  //   使い慣れた人が選び直すたびに「別の端末が…」と出ると、ただの雑音になる。
  //   知らせたいのは「**自分のものでない名前**を選ぼうとしている」ときだけ。
  const mineAlready = await env.DB.prepare(
    'SELECT 1 AS x FROM links WHERE org_id = ? AND name = ? AND device_id = ? LIMIT 1'
  ).bind(org.id, mem.name, deviceId).first();

  const other = mineAlready ? null : await env.DB.prepare(
    'SELECT device_id FROM links WHERE org_id = ? AND name = ? AND device_id <> ? ORDER BY id DESC LIMIT 1'
  ).bind(org.id, mem.name, deviceId).first();

  await env.DB.prepare(
    'INSERT INTO links (org_id, device_id, name, gender, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(org.id, deviceId, mem.name, mem.gender, Date.now()).run();
  await touch(env, org.id);

  return { ok: true, member: { name: mem.name, gender: mem.gender }, taken: !!other };
}

/** 回答。**上書きせず1件ずつ追記する。** 集計は最新行を採用（GAS版と同じ約束） */
async function answer(env, b) {
  const org = await findOrg(env, b.s);
  if (!org) return notFoundOrg();

  const deviceId = String(b.deviceId == null ? '' : b.deviceId).trim();
  const me = await linkOf(env, org.id, deviceId);
  if (!me) return { ok: false, code: 'needRegister', error: '先にお名前の登録が必要です。', needRegister: true };

  const ev = await findEvent(env, org.id, b.eventId, org.lang);
  if (!ev) return notFoundEvent();
  if (ev.closed) return { ok: false, code: 'eventClosed', error: 'このイベントは申込締切をすぎています。', closed: true };

  const given = b.answers || {};
  const clean = {};
  const stmts = [];
  const ins = env.DB.prepare(
    'INSERT INTO answers (org_id, event_id, name, item, mark, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const now = Date.now();

  for (const it of ev.items) {
    const mark = normMark(given[it]);
    if (!mark) continue;
    clean[it] = mark;
    stmts.push(ins.bind(org.id, ev.id, me.name, it, mark, deviceId, now));
  }
  if (!stmts.length) return { ok: false, code: 'noAnswers', error: '回答が選ばれていません。' };

  /* 一言（コメント）。回答と同じく追記式で、空文字も1行として書く
     （最新行が空＝コメントを消した、という意味になる）。
     ★ `note` が届いていないときは何も書かない。古い画面から回答されたときに、
       すでに書いてあるコメントを消してしまわないため。 */
  const hasNote = Object.prototype.hasOwnProperty.call(b, 'note') && b.note != null;
  if (hasNote) {
    stmts.push(env.DB.prepare(
      'INSERT INTO notes (org_id, event_id, name, text, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(org.id, ev.id, me.name, cleanNote(b.note), deviceId, now));
  }

  await env.DB.batch(stmts);
  await touch(env, org.id);

  // 返す集計は**参加者に見えるぶん**なので、団体の設定に従う（主催者の画面とは別）
  const showNames = isOn(org.show_names);
  return {
    ok: true, saved: clean, member: me, showNames,
    summary: summaryOf(
      ev,
      await latestOfEvent(env, org.id, ev.id),
      await genderMap(env, org.id),
      showNames,
      showNames ? await notesOf(env, org.id, ev.id) : null
    )
  };
}

/** 一言を整える。改行は1つに詰め、長すぎるものは切る。
 *  200字は「30分遅れます」「車を2台出せます」を書くのに十分で、
 *  集計画面に貼られたときに1件で画面を埋めない長さ。 */
function cleanNote(v) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200);
}


/* ============================================================
 *  主催者向け（合鍵が要る）
 *
 *  ★ 主催者に見えるエラーも、参加者と同じく **サーバーでは訳さない**。
 *  `code` を返し、管理画面が `admin-i18n.js` の `err_<code>` で訳す。
 *  管理画面のことばは主催者の端末ごとなので、サーバーには決められない
 *  （日本語の主催者が英語の団体を運営することがある）。
 *  差し込みは `vars`。`error` の日本語は、code を知らない古い画面のための保険。
 * ========================================================== */

/** エラー1件ぶんの形をそろえる。`extra` は needKey / hasEvent などの目印 */
function bad(code, ja, vars, extra) {
  const o = { ok: false, code, error: ja };
  if (vars) o.vars = vars;
  return extra ? Object.assign(o, extra) : o;
}

/** 団体をつくる。合鍵を返すのはこの1回だけ。 */
async function createOrg(env, b) {
  const name = String(b.name == null ? '' : b.name).trim();
  if (!name) return bad('orgNameEmpty', '団体名を入れてください。');
  if (name.length > 60) return bad('orgNameLong', '団体名が長すぎます（60字まで）。');

  const members = normalizeMembers(b.members);
  if (members.code) return members;

  const orgId = randomId(16);
  const adminKey = randomId(32);
  const now = Date.now();

  const lang = normLang(b.lang);

  await env.DB.prepare(
    'INSERT INTO orgs (id, admin_hash, name, tz, lang, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(orgId, await sha256(adminKey), name, 'Asia/Tokyo', lang, now, now).run();

  await writeMembers(env, orgId, members.list);

  return { ok: true, orgId, adminKey, org: name, lang, members: members.list, urls: urlsFor(orgId, adminKey) };
}

/** 管理リンクを開いたときの一式。合鍵の確認も兼ねる。 */
async function orgHome(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  return {
    ok: true,
    org: {
      id: org.row.id, name: org.row.name, tz: org.row.tz, lang: normLang(org.row.lang),
      showNames: isOn(org.row.show_names)
    },
    members: await membersOf(env, org.row.id, true),
    urls: urlsFor(org.row.id, String(b.adminKey || ''))
  };
}

async function saveOrg(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const name = String(b.name == null ? '' : b.name).trim();
  if (!name) return bad('orgNameEmpty', '団体名を入れてください。');
  if (name.length > 60) return bad('orgNameLong', '団体名が長すぎます（60字まで）。');

  const lang = normLang(b.lang == null ? org.row.lang : b.lang);
  // 届いていない項目は今の値のまま（古い画面から保存されても、設定が勝手に戻らない）
  const showNames = isOn(b.showNames == null ? org.row.show_names : b.showNames);
  await env.DB.prepare('UPDATE orgs SET name = ?, lang = ?, show_names = ?, seen_at = ? WHERE id = ?')
    .bind(name, lang, showNames ? 1 : 0, Date.now(), org.row.id).run();

  return { ok: true, org: name, lang, showNames };
}

/** 名簿はまるごと入れ替える。回答は氏名で持っているので、名前を直しても過去の回答は消えない。 */
async function saveMembers(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const members = normalizeMembers(b.members);
  if (members.code) return members;
  if (!members.list.length) return bad('rosterEmpty', 'お名前がひとつも入っていません。');

  await writeMembers(env, org.row.id, members.list);
  await touch(env, org.row.id);

  return { ok: true, members: members.list };
}

/* ---------- 行事（読み取った要項の置き場） ----------
   出欠とは別物。ここに貯めておいて、使いたくなったら出欠を作る。 */

async function listTaikai(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  /* 主催者の画面の日付は、**主催者自身が選んだことば**で書く（団体の設定ではない）。
     サーバーは主催者のことばを知らないので、画面から uiLang をもらう。 */
  const all = await taikaiOf(env, org.row.id, b.uiLang);
  return { ok: true, total: all.length, taikai: all.slice(0, TAIKAI_LIST_MAX) };
}

/** ドロッパーの「出欠システムに保存」でコピーした文字列を取り込む。
 *  符号化は dropper/attendance-hook.js の b64url_ と対。**形を変えるときは両方そろえる。** */
async function importTaikai(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const raw = String(b.token == null ? '' : b.token).trim();
  if (!raw) return bad('pasteEmpty', '貼り付ける内容がありません。');

  let o = null;
  try {
    o = JSON.parse(new TextDecoder().decode(fromB64url(raw)));
  } catch (e) {
    o = null;
  }
  if (!o || !o.name) {
    return bad('pasteBad',
      'うまく読み取れませんでした。イベントドロッパーの「出欠システムに保存」でコピーした内容を、そのまま貼り付けてください。');
  }

  return await addTaikaiRow(env, org.row.id, {
    name: o.name, date: o.date, deadline: o.deadline, place: o.place,
    items: o.items, youkou: o.youkou, detail: o.detail ? JSON.stringify(o.detail) : ''
  });
}

/** ドロッパーを使わない団体むけ。画面から手で足す */
async function addTaikaiManually(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;
  return await addTaikaiRow(env, org.row.id, {
    name: b.name, date: b.date, deadline: b.deadline,
    place: b.place, items: b.items, youkou: b.youkou, detail: ''
  });
}

/** 保存ずみの行事から出欠を作る。作ったら行事側に控えて「出欠あり」にする。 */
async function createEventFromTaikai(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const id = String(b.taikaiId == null ? '' : b.taikaiId).trim();
  const t = (await taikaiOf(env, org.row.id)).find(x => x.id === id);
  if (!t) return bad('taikaiNotFound', 'その行事が見つかりません。一覧を読み込み直してください。');

  const o = b.override || {};
  let items = (o.items != null) ? toItems(o.items) : t.itemsRaw;
  // 種目が読み取れなかったときの1つめ。**保存される値**なので、
  // 主催者の画面のことばではなく、**参加者に見せることば**（団体の設定）で書く
  if (!items.length) items = [DEFAULT_ITEM[normLang(org.row.lang)]];

  const res = await addEventRow(env, org.row.id, {
    name: t.name,
    date: (o.date != null ? toYmd(o.date) : t.date),
    deadline: (o.deadline != null ? toYmd(o.deadline) : t.deadline),
    items,
    youkou: t.youkou,
    place: t.place,
    address: t.address
  });

  await env.DB.prepare('UPDATE taikai SET event_id = ? WHERE org_id = ? AND id = ?')
    .bind(res.eventId, org.row.id, t.id).run();
  await touch(env, org.row.id);

  return { ok: true, eventId: res.eventId, existing: !!res.existing, name: t.name, items };
}


/** 行事を消す。**出欠を作ったあとは消せない**（先に出欠のほうを消してもらう）。
 *  順番を守らせないと、出欠だけが親なしで残って画面から辿れなくなる。 */
async function deleteTaikai(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const id = String(b.taikaiId == null ? '' : b.taikaiId).trim();
  const t = (await taikaiOf(env, org.row.id)).find(x => x.id === id);
  if (!t) return bad('taikaiNotFound', 'その行事が見つかりません。一覧を読み込み直してください。');

  if (t.eventId) {
    return bad('taikaiHasEvent',
      'この行事からは出欠を作ってあります。先に出欠のほうを削除してください。', null, { hasEvent: true });
  }

  await env.DB.prepare('DELETE FROM taikai WHERE org_id = ? AND id = ?').bind(org.row.id, t.id).run();
  await touch(env, org.row.id);
  return { ok: true, deleted: true, name: t.name };
}


/* ---------- 主催者から見た出欠 ---------- */

/** 主催者向けの一覧。**締切ずみも出す**（参加者向けと違うのはここ） */
async function adminEvents(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const genders = await genderMap(env, org.row.id);
  const roster = await membersOf(env, org.row.id, false);
  const list = [];

  // ★ 主催者には**必ず名前を出す**（団体の show_names は参加者向けの設定であって、
  //    主催者の画面には効かない）。名前が分からないと大会のメンバーを選べない。
  for (const ev of (await eventsOf(env, org.row.id, b.uiLang)).reverse()) {
    const byName = await latestOfEvent(env, org.row.id, ev.id);
    list.push(Object.assign(
      summaryOf(ev, byName, genders, true, await notesOf(env, org.row.id, ev.id)),
      {
        manualClosed: ev.manualClosed,
        datePassed: ev.datePassed,
        pending: pendingNames(roster, byName)
      }
    ));
  }
  return { ok: true, events: list, showNames: isOn(org.row.show_names) };
}

/** 1件ぶんの集計。**未回答者の名前が出るのはここだけ。** 参加者向けの応答には決して入れない。 */
async function tally(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const ev = await findEvent(env, org.row.id, b.eventId);
  if (!ev) return notFoundEvent();

  const byName = await latestOfEvent(env, org.row.id, ev.id);
  const roster = await membersOf(env, org.row.id, false);
  const notes = await notesOf(env, org.row.id, ev.id);
  const summary = summaryOf(ev, byName, await genderMap(env, org.row.id), true, notes);

  return {
    ok: true,
    summary,
    pending: pendingNames(roster, byName),
    // summary.answered と同じ中身。古い画面が参照しているので、この形も残す
    answered: summary.answered
  };
}

/** 出欠を消す。**集まった回答も一緒に消える。**
 *  作り直せるように、元の行事は「未使用」に戻す（行事そのものは残す）。 */
async function deleteEvent(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const ev = await findEvent(env, org.row.id, b.eventId);
  if (!ev) return notFoundEvent();

  // 何人ぶん消えるかを返す。画面で「本当に消しますか」を出すのに使う
  const byName = await latestOfEvent(env, org.row.id, ev.id);
  const lost = Object.keys(byName).length;

  await env.DB.batch([
    env.DB.prepare('DELETE FROM answers WHERE org_id = ? AND event_id = ?').bind(org.row.id, ev.id),
    // 一言も一緒に消す。残すと、作り直した同じIDのイベントに古いコメントが付く
    env.DB.prepare('DELETE FROM notes   WHERE org_id = ? AND event_id = ?').bind(org.row.id, ev.id),
    env.DB.prepare('DELETE FROM events  WHERE org_id = ? AND id = ?').bind(org.row.id, ev.id),
    env.DB.prepare("UPDATE taikai SET event_id = '' WHERE org_id = ? AND event_id = ?")
      .bind(org.row.id, ev.id)
  ]);
  await touch(env, org.row.id);

  return { ok: true, deleted: true, name: ev.name, lost };
}

/** 手じまい。締切前でも締め切りたいときと、締切後に開け直したいときの両方に使う */
async function closeEvent(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const ev = await findEvent(env, org.row.id, b.eventId);
  if (!ev) return notFoundEvent();

  await env.DB.prepare('UPDATE events SET closed = ? WHERE org_id = ? AND id = ?')
    .bind(b.closed ? 1 : 0, org.row.id, ev.id).run();
  await touch(env, org.row.id);

  return { ok: true, eventId: ev.id, closed: !!b.closed };
}

/** 団体をまるごと消す。削除請求のたびに手作業をしないため、最初から主催者自身が押せるようにしてある。 */
async function deleteOrg(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  // 押し間違いで消えないように、団体名をそのまま打ってもらう
  if (String(b.confirm == null ? '' : b.confirm).trim() !== org.row.name) {
    return bad('confirmName', '確認のため、団体名をそのとおりに入力してください。');
  }

  const id = org.row.id;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM answers WHERE org_id = ?').bind(id),
    env.DB.prepare('DELETE FROM notes   WHERE org_id = ?').bind(id),
    env.DB.prepare('DELETE FROM links   WHERE org_id = ?').bind(id),
    env.DB.prepare('DELETE FROM events  WHERE org_id = ?').bind(id),
    env.DB.prepare('DELETE FROM taikai  WHERE org_id = ?').bind(id),
    env.DB.prepare('DELETE FROM members WHERE org_id = ?').bind(id),
    env.DB.prepare('DELETE FROM orgs    WHERE id = ?').bind(id)
  ]);

  return { ok: true, deleted: true };
}


/* ============================================================
 *  中身
 * ========================================================== */

async function findOrg(env, orgId) {
  const id = String(orgId == null ? '' : orgId).trim();
  if (!id) return null;
  return await env.DB.prepare('SELECT id, name, tz, lang, show_names FROM orgs WHERE id = ?').bind(id).first();
}

/* 参加者に配る画面の言語。**団体ごとに1つ**。
   配るURLは3本のままで、参加者は何も選ばずに自分の団体の言語で開ける。
   知らない値が入っていても、日本語に落として画面が壊れないようにする。 */
const LANGS = ['ja', 'en', 'in'];
/** 種目が1つも読み取れなかったときの既定。参加者に見えるので団体の言語で入れる */
const DEFAULT_ITEM = { ja: '参加', en: 'Attend', in: 'Attend' };
function normLang(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return LANGS.indexOf(s) >= 0 ? s : 'ja';
}

/** on / off の値を真偽にそろえる。
 *  D1 からは 0/1 の数で返るが、画面からは true/false や '1' で届く。
 *  **既定は false（伏せる）。** 判断がつかない値で名前を晒さないため。 */
function isOn(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

/** 合鍵を照合する。生の鍵は保存していないので、ハッシュで引く。 */
async function authOrg(env, b) {
  const key = String(b && b.adminKey != null ? b.adminKey : '').trim();
  if (!key) return bad('keyMissing', '管理リンクが正しくありません。', null, { needKey: true });

  const row = await env.DB.prepare('SELECT id, name, tz, lang, show_names FROM orgs WHERE admin_hash = ?')
    .bind(await sha256(key)).first();

  if (!row) {
    return bad('keyBad',
      'この管理リンクは使えません。主催者ご自身が保存したリンクをお確かめください。',
      null, { needKey: true });
  }
  return { ok: true, row };
}

async function membersOf(env, orgId, includeRetired) {
  const r = await env.DB.prepare(
    'SELECT name, gender, note FROM members WHERE org_id = ? ORDER BY ord, id'
  ).bind(orgId).all();

  const list = [];
  for (const m of (r.results || [])) {
    const retired = /退会|退部|休会|除外/.test(String(m.note || ''));
    if (!includeRetired && retired) continue;
    list.push({ name: m.name, gender: normGender(m.gender), note: m.note || '', retired });
  }
  return list;
}

/** 名簿を丸ごと書き直す。1回のバッチで消して入れるので、途中で落ちて空になることがない。 */
async function writeMembers(env, orgId, list) {
  const stmts = [env.DB.prepare('DELETE FROM members WHERE org_id = ?').bind(orgId)];
  const ins = env.DB.prepare(
    'INSERT INTO members (org_id, name, gender, note, ord) VALUES (?, ?, ?, ?, ?)'
  );
  list.forEach((m, i) => stmts.push(ins.bind(orgId, m.name, m.gender, m.note, i)));
  await env.DB.batch(stmts);
}

/** 受け取った名簿を整える。同姓同名はここで弾く（あとで本人を特定できなくなるため）。
 *  だめだったときは `bad()` の形（`ok:false` と `code`）でそのまま返す。
 *  呼び出し側は `members.code` を見て、中身を触らずに返す。 */
function normalizeMembers(raw) {
  if (raw == null) return { list: [] };
  if (!Array.isArray(raw)) return bad('rosterShape', '名簿の形が正しくありません。');
  if (raw.length > MEMBERS_MAX) {
    return bad('rosterMax', '名簿は' + MEMBERS_MAX + '人までです。', { n: MEMBERS_MAX });
  }

  const list = [];
  const seen = new Set();

  for (const m of raw) {
    const name = String((m && m.name) == null ? '' : m.name).trim();
    if (!name) continue;
    if (name.length > 40) {
      // 長すぎる名前をそのまま出すと画面がはみ出すので、頭だけ見せる
      const cut = name.slice(0, 20) + '…';
      return bad('nameLong', 'お名前が長すぎます（40字まで）：' + cut, { name: cut });
    }

    const key = normKey(name);
    if (seen.has(key)) return bad('nameDup', '同じお名前が2人います：' + name, { name });
    seen.add(key);

    list.push({
      name,
      gender: normGender(m && m.gender),
      note: String((m && m.note) == null ? '' : m.note).trim().slice(0, 40)
    });
  }
  return { list };
}

/** イベント。日付の早い順。締切ずみかどうかもここで決める。
 *  date/deadline は中では 'YYYY-MM-DD'、外に出すときは GAS版と同じ 'YYYY/MM/DD（曜）'。 */
async function eventsOf(env, orgId, lang) {
  const r = await env.DB.prepare(
    'SELECT id, name, date, deadline, items, youkou, place, address, closed FROM events WHERE org_id = ?'
  ).bind(orgId).all();

  return (r.results || []).map(e => ({
    id: e.id,
    name: e.name,
    date: e.date || '',
    deadline: e.deadline || '',
    dateText: fmtDate(e.date, lang),
    deadlineText: fmtDate(e.deadline, lang),
    items: splitItems(e.items),
    youkou: e.youkou || '',
    place: e.place || '',
    address: e.address || '',
    // 手じまい（closed列）と、締切をすぎたかどうか。どちらでも締切扱いにする。
    // ただし**理由は分けて持つ**。主催者の画面で「手で締めた」のか
    // 「日が過ぎた」のかが分からないと、再開できるのかどうか判断できない
    manualClosed: !!e.closed,
    datePassed: isPast(e.deadline || e.date),
    closed: !!e.closed || isPast(e.deadline || e.date),
    sortKey: e.date || e.deadline || ''
  })).sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

/** 行事。新しい順。 */
async function taikaiOf(env, orgId, lang) {
  const r = await env.DB.prepare(
    'SELECT id, name, date, deadline, place, items, youkou, detail, event_id, created_at'
    + ' FROM taikai WHERE org_id = ? ORDER BY created_at DESC, rowid DESC'
  ).bind(orgId).all();

  return (r.results || []).map(t => ({
    id: t.id,
    name: t.name,
    date: t.date || '',
    deadline: t.deadline || '',
    dateText: fmtDate(t.date, lang),
    deadlineText: fmtDate(t.deadline, lang),
    place: t.place || '',
    address: addressOf(t.detail),
    items: splitItems(t.items),
    itemsRaw: splitItems(t.items),
    youkou: t.youkou || '',
    eventId: t.event_id || ''
  }));
}

/** 行事を1行足す。**同じ行事名・同じ開催日は増やさない**（二重に取り込みがちなので） */
async function addTaikaiRow(env, orgId, a) {
  const name = String(a.name == null ? '' : a.name).trim();
  if (!name) return bad('taikaiNameEmpty', '行事名が読み取れませんでした。');

  const date = toYmd(a.date);
  const dup = (await taikaiOf(env, orgId))
    .find(t => normKey(t.name) === normKey(name) && t.date === date);
  if (dup) return { ok: true, taikaiId: dup.id, name: dup.name, existing: true };

  const id = 'tk' + randomId(8);
  await env.DB.prepare(
    'INSERT INTO taikai (org_id,id,name,date,deadline,place,items,youkou,detail,event_id,created_at)'
    + ' VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    orgId, id, name, date, toYmd(a.deadline),
    String(a.place == null ? '' : a.place).trim(),
    toItems(a.items).join('、'),
    normUrl(a.youkou),
    a.detail ? String(a.detail).slice(0, 20000) : '',
    '', Date.now()
  ).run();
  await touch(env, orgId);

  return { ok: true, taikaiId: id, name, existing: false };
}

/** 出欠イベントを1行足す。こちらも同じ名前・同じ日は増やさない */
async function addEventRow(env, orgId, a) {
  const dup = (await eventsOf(env, orgId))
    .find(ev => normKey(ev.name) === normKey(a.name) && ev.date === a.date);
  if (dup) return { ok: true, eventId: dup.id, existing: true };

  const id = 'ev' + randomId(8);
  await env.DB.prepare(
    'INSERT INTO events (org_id,id,name,date,deadline,items,youkou,place,address,closed,created_at)'
    + ' VALUES (?,?,?,?,?,?,?,?,?,0,?)'
  ).bind(orgId, id, a.name, a.date, a.deadline, a.items.join('、'),
         a.youkou || '', a.place || '', a.address || '', Date.now()).run();

  return { ok: true, eventId: id, existing: false };
}

/** まだ答えていない人の名前。**主催者向けの応答にだけ入れる。** */
function pendingNames(roster, byName) {
  return roster.filter(m => !byName[normKey(m.name)]).map(m => m.name);
}

async function findEvent(env, orgId, eventId, lang) {
  const id = String(eventId == null ? '' : eventId).trim();
  if (!id) return null;
  return (await eventsOf(env, orgId, lang)).find(ev => ev.id === id) || null;
}

/** 端末IDから本人。追記式なので**いちばん新しい行**を採る。
 *  名前と性別は名簿から引き直す（主催者が名簿を直したら、そちらが正） */
async function linkOf(env, orgId, deviceId) {
  const key = String(deviceId == null ? '' : deviceId).trim();
  if (!key) return null;

  const row = await env.DB.prepare(
    'SELECT name, gender FROM links WHERE org_id = ? AND device_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(orgId, key).first();
  if (!row) return null;

  const found = { name: row.name, gender: normGender(row.gender) };
  const m = (await membersOf(env, orgId, true)).find(x => normKey(x.name) === normKey(found.name));
  if (m) { found.name = m.name; found.gender = m.gender; }
  return found;
}

/** その人の最新回答。{ イベントID: { 種目: 〇△× } } */
async function latestOfName(env, orgId, name) {
  const r = await env.DB.prepare(
    'SELECT event_id, item, mark FROM answers WHERE org_id = ? AND name = ? ORDER BY id'
  ).bind(orgId, name).all();

  const out = {};
  // 古い順に上書きしていくので、最後に残るのが最新
  for (const a of (r.results || [])) {
    (out[a.event_id] = out[a.event_id] || {})[a.item] = a.mark;
  }
  return out;
}

/** イベント1件ぶんの最新回答。{ 名前キー: { name, ans: { 種目: 〇△× } } } */
async function latestOfEvent(env, orgId, eventId) {
  const r = await env.DB.prepare(
    'SELECT name, item, mark FROM answers WHERE org_id = ? AND event_id = ? ORDER BY id'
  ).bind(orgId, eventId).all();

  const out = {};
  for (const a of (r.results || [])) {
    const k = normKey(a.name);
    if (!out[k]) out[k] = { name: a.name, ans: {} };
    out[k].ans[a.item] = a.mark;
  }
  return out;
}

/** イベント1件ぶんの最新コメント。{ 名前キー: 一言 }
 *  回答と同じく追記式なので、古い順にたどって**最後に残ったもの**が最新。
 *  空文字が最新なら「コメントを消した」ということなので、空のまま返す。 */
async function notesOf(env, orgId, eventId) {
  const r = await env.DB.prepare(
    'SELECT name, text FROM notes WHERE org_id = ? AND event_id = ? ORDER BY id'
  ).bind(orgId, eventId).all();

  const out = {};
  for (const n of (r.results || [])) out[normKey(n.name)] = n.text || '';
  return out;
}

/** その人の最新コメント。{ イベントID: 一言 }。「わたしの回答」で書き直せるようにするため */
async function notesOfName(env, orgId, name) {
  const r = await env.DB.prepare(
    'SELECT event_id, text FROM notes WHERE org_id = ? AND name = ? ORDER BY id'
  ).bind(orgId, name).all();

  const out = {};
  for (const n of (r.results || [])) out[n.event_id] = n.text || '';
  return out;
}

/** 名前キー → 性別。集計を男女別にするのに使う */
async function genderMap(env, orgId) {
  const map = {};
  for (const m of await membersOf(env, orgId, true)) map[normKey(m.name)] = m.gender;
  return map;
}

function publicEvent(ev, mine, myNote) {
  return {
    id: ev.id, name: ev.name, date: ev.dateText, deadline: ev.deadlineText,
    items: ev.items, youkou: ev.youkou, place: ev.place, address: ev.address,
    // 地図とカレンダーのボタンを画面側で組み立てるため、生の日付も渡す
    dateRaw: ev.date, closed: ev.closed, mine: mine || null,
    // 自分が前に書いた一言。書き直せるよう、そのまま入力欄に戻す
    myNote: myNote || ''
  };
}

/** 集計。人数は必ず出し、**回答者の名前とコメントは `withNames` のときだけ**足す。
 *
 *  ★ 名前を出してよいのは次の2つだけ。
 *    - 主催者向けの応答（`adminEvents` / `tally`）… **常に出す**。
 *      大会のメンバー選定に要るので、団体の設定に関わらず主催者には見える
 *    - 参加者向けの `summary` … 団体が `show_names = 1` を選んだときだけ
 *
 *  ★ ここで出るのは**回答した人の名前だけ**。未回答者の名前は今までどおり
 *    `pendingNames` を通して主催者向けの応答にしか入れないこと。
 */
function summaryOf(ev, byName, genders, withNames, notes) {
  const keys = Object.keys(byName || {});
  const items = ev.items.map(it => {
    const cell = { name: it, maru: zero(), sankaku: zero(), batsu: zero() };
    for (const k of keys) {
      const mark = normMark(byName[k].ans[it]);
      if (!mark) continue;
      const bucket = mark === '〇' ? cell.maru : (mark === '△' ? cell.sankaku : cell.batsu);
      const g = genders[k] || '';
      if (g === '男') bucket.m++;
      else if (g === '女') bucket.f++;
      else bucket.u++;
    }
    return cell;
  });

  const out = {
    id: ev.id, name: ev.name, date: ev.dateText, deadline: ev.deadlineText,
    youkou: ev.youkou, closed: ev.closed, respCount: keys.length, items
  };

  if (withNames) {
    out.answered = keys.map(k => ({
      name: byName[k].name,
      gender: genders[k] || '',
      ans: byName[k].ans,
      note: (notes && notes[k]) || ''
    }));
  }
  return out;
}

function zero() { return { m: 0, f: 0, u: 0 }; }

function notFoundEvent() {
  return {
    ok: false, notFound: true,
    code: 'eventNotFound',
    error: 'イベントが見つかりません。主催者からもらったリンクをもう一度お確かめください。'
  };
}

/** 最終アクセスを控える。放置ぶんの自動削除の判定に使う。 */
async function touch(env, orgId) {
  await env.DB.prepare('UPDATE orgs SET seen_at = ? WHERE id = ?').bind(Date.now(), orgId).run();
}

function urlsFor(orgId, adminKey) {
  const base = 'https://app.dropper-tools.com/attend/';
  const q = '?s=' + encodeURIComponent(orgId);
  return {
    list:   base + q,
    my:     base + 'my.html' + q,
    status: base + 'status.html' + q,
    // 合鍵は # のうしろ。サーバーには送られず、アクセスログにも Referer にも残らない
    admin:  adminKey ? base + 'admin.html' + q + '#k=' + encodeURIComponent(adminKey) : ''
  };
}

function notFoundOrg() {
  return {
    ok: false, notFound: true,
    code: 'orgNotFound',
    error: 'この出欠は見つかりませんでした。主催者からもらったリンクをもう一度お確かめください。'
  };
}


/* ============================================================
 *  小道具（GAS版と同じ規則にそろえてある）
 * ========================================================== */

function normKey(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();
}

function normGender(v) {
  const s = normKey(v);
  if (!s) return '';
  if (/^(男|男性|m|male|おとこ)$/.test(s)) return '男';
  if (/^(女|女性|f|female|おんな)$/.test(s)) return '女';
  return '';
}

function normMark(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^[〇○◯oO０0]$/.test(s)) return '〇';
  if (/^[△▲sS]$/.test(s)) return '△';
  if (/^[×✕✖ｘxX]$/.test(s)) return '×';
  return '';
}

function splitItems(v) {
  return String(v == null ? '' : v).split(/[、,，\n\/／]+/).map(s => s.trim()).filter(Boolean);
}

/** 配列でも読点区切りの文字列でも受ける */
function toItems(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return splitItems(v);
}

/** 読み取り結果（JSON）から会場の住所を拾う。無ければ空。
 *  ドロッパーが detail に入れてくる項目名に合わせてある。 */
function addressOf(detail) {
  if (!detail) return '';
  try {
    const o = JSON.parse(detail);
    return String(o && (o.kaijo_jusho || o.jusho || o.address) || '').trim();
  } catch (e) {
    return '';
  }
}

function normUrl(v) {
  const s = String(v == null ? '' : v).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

/** いろいろな書き方の日付を 'YYYY-MM-DD' に寄せる。読めなければ空 */
function toYmd(v) {
  const m = String(v == null ? '' : v).trim().match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** 画面に出す形。**区切りは必ずスラッシュ。**
 *  参加者ページの「あと2日」表示がスラッシュ区切りを前提に書かれているので、
 *  ここを 'YYYY-MM-DD' のまま返すと締切の注意が出なくなる。
 *
 *  曜日は団体の言語で書く。日本語だけ全角の括弧（GAS版からの見た目をそのまま）。
 *  **lang を渡し忘れると日本語の曜日が英語の画面に出る**ので、呼ぶ側で必ず渡すこと。 */
function fmtDate(ymd, lang) {
  const s = String(ymd == null ? '' : ymd).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  // 曜日はUTCで組み立てて求める。実行環境の時計に左右されないため
  const w = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  const ymdText = m[1] + '/' + m[2] + '/' + m[3];
  const l = normLang(lang);
  return l === 'ja' ? ymdText + '（' + WDAY.ja[w] + '）'
                    : ymdText + ' (' + WDAY.en[w] + ')';
}

const WDAY = {
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
};

/** base64url を戻す。ドロッパーの b64url_ と対。 */
function fromB64url(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** その日が終わったか。**日本時間で判定する**（Workerの時計はUTCなので、そのままだと9時間ずれる）。
 *  締切日は「その日いっぱい」まで受け付ける。 */
function isPast(ymd) {
  const s = String(ymd == null ? '' : ymd).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return Date.now() > Date.parse(s + 'T23:59:59+09:00');
}

/** 推測できない長さのID。合鍵は32バイト（256ビット）なので総当たりは成り立たない。 */
function randomId(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function b64url(bytes) {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}


/* ============================================================
 *  HTTP まわり
 * ========================================================== */

/** 本文は JSON でも text/plain でも受ける。
 *  text/plain だとブラウザがプリフライトを飛ばすので1往復ぶん速い。 */
async function readBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    const o = JSON.parse(text);
    return (o && typeof o === 'object') ? o : {};
  } catch (e) {
    return {};
  }
}

function originOf(request) {
  const o = request.headers.get('Origin') || '';
  return ALLOW_ORIGINS.includes(o) ? o : '';
}

function corsHeaders(origin) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function preflight(origin) {
  return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
}

/** エラーでもCORSヘッダーを必ず付ける。
 *  付け忘れると、ブラウザは中身ではなく「CORSでブロック」と報告して原因が見えなくなる
 *  （GAS版の404で実際にはまった。CLAUDE.md 参照）。 */
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: corsHeaders(origin) });
}
