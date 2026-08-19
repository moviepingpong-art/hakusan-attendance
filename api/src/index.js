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
 * ★ いまの範囲：土台・団体作成・名簿・削除（段階1）＋参加者の一連（段階2）。
 *   行事（貼り付け取り込み・出欠を作る）は段階3。
 */

const API_VERSION = 'w1.0';

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
      return json({ ok: false, error: '対応していない呼び出しです。' }, 405, origin);

    } catch (err) {
      // 中身は伏せる。主催者にも参加者にも意味が無く、手がかりを与えるだけなので
      console.error(err && err.stack || err);
      return json({ ok: false, error: 'サーバーでエラーが起きました。時間をおいてお試しください。' }, 500, origin);
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
      return { ok: false, error: '対応していない呼び出しです（' + action + '）。' };
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
    case 'deleteOrg':   return await deleteOrg(env, b);
    default:
      return { ok: false, error: '対応していない呼び出しです（' + action + '）。' };
  }
}


/* ============================================================
 *  参加者向け（合鍵は要らない）
 * ========================================================== */

async function ping(env, orgId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  return { ok: true, org: org.name, version: API_VERSION };
}

async function publicMembers(env, orgId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);
  return { ok: true, org: org.name, members: await membersOf(env, org.id, false) };
}

/** 受付中の一覧。締切をすぎたものは出さない（GAS版と同じ） */
async function listEvents(env, orgId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  const me = await linkOf(env, org.id, deviceId);
  const mine = me ? await latestOfName(env, org.id, me.name) : {};
  const events = (await eventsOf(env, org.id))
    .filter(ev => !ev.closed)
    .map(ev => publicEvent(ev, mine[ev.id] || null));

  return { ok: true, org: org.name, member: me, events };
}

/** イベント1件。**締切後でも返す**（フォーム側で締切表示にするため） */
async function getEvent(env, orgId, eventId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  const ev = await findEvent(env, org.id, eventId);
  if (!ev) return notFoundEvent();

  const me = await linkOf(env, org.id, deviceId);
  const mine = me ? ((await latestOfName(env, org.id, me.name))[ev.id] || null) : null;

  return { ok: true, org: org.name, member: me, event: publicEvent(ev, mine) };
}

/** 端末IDから登録ずみの本人を返す */
async function whoami(env, orgId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();

  const me = await linkOf(env, org.id, deviceId);
  return { ok: true, org: org.name, registered: !!me, member: me };
}

/** e があればその1件、なければ全イベントの集計。**人数のみで個人名は出さない**
 *  （未回答者の名前を出してよいのは主催者向けの画面だけ） */
async function summaryAction(env, orgId, eventId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  let evs;
  if (String(eventId == null ? '' : eventId).trim()) {
    const ev = await findEvent(env, org.id, eventId);
    if (!ev) return notFoundEvent();
    evs = [ev];
  } else {
    evs = (await eventsOf(env, org.id)).slice().reverse().slice(0, 50);
  }

  const genders = await genderMap(env, org.id);
  const summaries = [];
  for (const ev of evs) {
    summaries.push(summaryOf(ev, await latestOfEvent(env, org.id, ev.id), genders));
  }

  return { ok: true, org: org.name, summaries, summary: summaries[0] || null };
}

/** 締切前の各イベントについて、その端末の最新回答 */
async function myAnswers(env, orgId, deviceId) {
  const org = await findOrg(env, orgId);
  if (!org) return notFoundOrg();
  await touch(env, org.id);

  const me = await linkOf(env, org.id, deviceId);
  const mine = me ? await latestOfName(env, org.id, me.name) : {};

  const list = (await eventsOf(env, org.id)).filter(ev => !ev.closed).map(ev => {
    const ans = mine[ev.id] || null;
    const items = ev.items.map(it => ({ name: it, answer: (ans && ans[it]) || '' }));
    const done = items.filter(x => !!x.answer).length;
    return {
      id: ev.id, name: ev.name, date: ev.date, deadline: ev.deadline, youkou: ev.youkou,
      items, answered: done > 0, allAnswered: done > 0 && done === items.length
    };
  });

  return { ok: true, org: org.name, member: me, registered: !!me, myanswers: list };
}

/** 名簿から名前を選んで端末を紐付ける。上書きせず追記し、いちばん新しい行を採用する */
async function register(env, b) {
  const org = await findOrg(env, b.s);
  if (!org) return notFoundOrg();

  const deviceId = String(b.deviceId == null ? '' : b.deviceId).trim();
  const name = String(b.name == null ? '' : b.name).trim();
  if (!deviceId) return { ok: false, error: '端末IDがありません。ブラウザを更新してからもう一度お試しください。' };
  if (!name) return { ok: false, error: 'お名前が選ばれていません。' };

  const mem = (await membersOf(env, org.id, false)).find(m => normKey(m.name) === normKey(name));
  if (!mem) return { ok: false, error: '名簿にないお名前です。主催者にご確認ください。', notInRoster: true };

  await env.DB.prepare(
    'INSERT INTO links (org_id, device_id, name, gender, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(org.id, deviceId, mem.name, mem.gender, Date.now()).run();
  await touch(env, org.id);

  return { ok: true, member: { name: mem.name, gender: mem.gender } };
}

/** 回答。**上書きせず1件ずつ追記する。** 集計は最新行を採用（GAS版と同じ約束） */
async function answer(env, b) {
  const org = await findOrg(env, b.s);
  if (!org) return notFoundOrg();

  const deviceId = String(b.deviceId == null ? '' : b.deviceId).trim();
  const me = await linkOf(env, org.id, deviceId);
  if (!me) return { ok: false, error: '先にお名前の登録が必要です。', needRegister: true };

  const ev = await findEvent(env, org.id, b.eventId);
  if (!ev) return notFoundEvent();
  if (ev.closed) return { ok: false, error: 'このイベントは申込締切をすぎています。', closed: true };

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
  if (!stmts.length) return { ok: false, error: '回答が選ばれていません。' };

  await env.DB.batch(stmts);
  await touch(env, org.id);

  return {
    ok: true, saved: clean, member: me,
    summary: summaryOf(ev, await latestOfEvent(env, org.id, ev.id), await genderMap(env, org.id))
  };
}


/* ============================================================
 *  主催者向け（合鍵が要る）
 * ========================================================== */

/** 団体をつくる。合鍵を返すのはこの1回だけ。 */
async function createOrg(env, b) {
  const name = String(b.name == null ? '' : b.name).trim();
  if (!name) return { ok: false, error: '団体名を入れてください。' };
  if (name.length > 60) return { ok: false, error: '団体名が長すぎます（60字まで）。' };

  const members = normalizeMembers(b.members);
  if (members.error) return { ok: false, error: members.error };

  const orgId = randomId(16);
  const adminKey = randomId(32);
  const now = Date.now();

  await env.DB.prepare(
    'INSERT INTO orgs (id, admin_hash, name, tz, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(orgId, await sha256(adminKey), name, 'Asia/Tokyo', now, now).run();

  await writeMembers(env, orgId, members.list);

  return { ok: true, orgId, adminKey, org: name, members: members.list, urls: urlsFor(orgId, adminKey) };
}

/** 管理リンクを開いたときの一式。合鍵の確認も兼ねる。 */
async function orgHome(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  return {
    ok: true,
    org: { id: org.row.id, name: org.row.name, tz: org.row.tz },
    members: await membersOf(env, org.row.id, true),
    urls: urlsFor(org.row.id, String(b.adminKey || ''))
  };
}

async function saveOrg(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const name = String(b.name == null ? '' : b.name).trim();
  if (!name) return { ok: false, error: '団体名を入れてください。' };
  if (name.length > 60) return { ok: false, error: '団体名が長すぎます（60字まで）。' };

  await env.DB.prepare('UPDATE orgs SET name = ?, seen_at = ? WHERE id = ?')
    .bind(name, Date.now(), org.row.id).run();

  return { ok: true, org: name };
}

/** 名簿はまるごと入れ替える。回答は氏名で持っているので、名前を直しても過去の回答は消えない。 */
async function saveMembers(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  const members = normalizeMembers(b.members);
  if (members.error) return { ok: false, error: members.error };
  if (!members.list.length) return { ok: false, error: 'お名前がひとつも入っていません。' };

  await writeMembers(env, org.row.id, members.list);
  await touch(env, org.row.id);

  return { ok: true, members: members.list };
}

/** 団体をまるごと消す。削除請求のたびに手作業をしないため、最初から主催者自身が押せるようにしてある。 */
async function deleteOrg(env, b) {
  const org = await authOrg(env, b);
  if (!org.ok) return org;

  // 押し間違いで消えないように、団体名をそのまま打ってもらう
  if (String(b.confirm == null ? '' : b.confirm).trim() !== org.row.name) {
    return { ok: false, error: '確認のため、団体名をそのとおりに入力してください。' };
  }

  const id = org.row.id;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM answers WHERE org_id = ?').bind(id),
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
  return await env.DB.prepare('SELECT id, name, tz FROM orgs WHERE id = ?').bind(id).first();
}

/** 合鍵を照合する。生の鍵は保存していないので、ハッシュで引く。 */
async function authOrg(env, b) {
  const key = String(b && b.adminKey != null ? b.adminKey : '').trim();
  if (!key) return { ok: false, error: '管理リンクが正しくありません。', needKey: true };

  const row = await env.DB.prepare('SELECT id, name, tz FROM orgs WHERE admin_hash = ?')
    .bind(await sha256(key)).first();

  if (!row) {
    return {
      ok: false, needKey: true,
      error: 'この管理リンクは使えません。主催者ご自身が保存したリンクをお確かめください。'
    };
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

/** 受け取った名簿を整える。同姓同名はここで弾く（あとで本人を特定できなくなるため）。 */
function normalizeMembers(raw) {
  if (raw == null) return { list: [] };
  if (!Array.isArray(raw)) return { error: '名簿の形が正しくありません。' };
  if (raw.length > MEMBERS_MAX) return { error: '名簿は' + MEMBERS_MAX + '人までです。' };

  const list = [];
  const seen = new Set();

  for (const m of raw) {
    const name = String((m && m.name) == null ? '' : m.name).trim();
    if (!name) continue;
    if (name.length > 40) return { error: 'お名前が長すぎます（40字まで）：' + name.slice(0, 20) + '…' };

    const key = normKey(name);
    if (seen.has(key)) return { error: '同じお名前が2人います：' + name };
    seen.add(key);

    list.push({
      name,
      gender: normGender(m && m.gender),
      note: String((m && m.note) == null ? '' : m.note).trim().slice(0, 40)
    });
  }
  return { list };
}

/** イベント。日付の早い順。締切ずみかどうかもここで決める。 */
async function eventsOf(env, orgId) {
  const r = await env.DB.prepare(
    'SELECT id, name, date, deadline, items, youkou, closed FROM events WHERE org_id = ?'
  ).bind(orgId).all();

  return (r.results || []).map(e => ({
    id: e.id,
    name: e.name,
    date: e.date || '',
    deadline: e.deadline || '',
    items: splitItems(e.items),
    youkou: e.youkou || '',
    // 手じまい（closed列）と、締切をすぎたかどうか。どちらでも締切扱いにする
    closed: !!e.closed || isPast(e.deadline || e.date),
    sortKey: e.date || e.deadline || ''
  })).sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

async function findEvent(env, orgId, eventId) {
  const id = String(eventId == null ? '' : eventId).trim();
  if (!id) return null;
  return (await eventsOf(env, orgId)).find(ev => ev.id === id) || null;
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

/** 名前キー → 性別。集計を男女別にするのに使う */
async function genderMap(env, orgId) {
  const map = {};
  for (const m of await membersOf(env, orgId, true)) map[normKey(m.name)] = m.gender;
  return map;
}

function publicEvent(ev, mine) {
  return {
    id: ev.id, name: ev.name, date: ev.date, deadline: ev.deadline,
    items: ev.items, youkou: ev.youkou, closed: ev.closed, mine: mine || null
  };
}

/** 人数だけの集計。**個人名は入れない。** 参加者にも見える応答なので、ここに名前を足さないこと。 */
function summaryOf(ev, byName, genders) {
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

  return {
    id: ev.id, name: ev.name, date: ev.date, deadline: ev.deadline,
    youkou: ev.youkou, closed: ev.closed, respCount: keys.length, items
  };
}

function zero() { return { m: 0, f: 0, u: 0 }; }

function notFoundEvent() {
  return {
    ok: false, notFound: true,
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
