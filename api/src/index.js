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
 * ★ 段階1の範囲：土台・団体作成・名簿・削除。
 *   行事とイベントと回答（listEvents / event / answer / summary …）は段階2以降。
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
    case 'ping':    return await ping(env, p.s);
    case 'members': return await publicMembers(env, p.s);
    default:
      return { ok: false, error: '対応していない呼び出しです（' + action + '）。' };
  }
}

async function handlePost(b, env) {
  const action = String(b.action || '').trim();

  switch (action) {
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
