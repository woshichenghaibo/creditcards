/**
 * Cloudflare Worker single-file credit-card manager
 * - Admin auth: HTTP Basic (client stores Basic header in localStorage.basicAuth)
 * - D1 binding name: CARDS_DB (must be set in Worker settings)
 * - Env variables: ADMIN_USER, ADMIN_PASS
 *
 * Changes in this update:
 * - Restored and fixed the "账单日/还款日" sorting button behavior (now a proper button).
 * - Removed the small bank icon from each list row to free horizontal space.
 * - Kept calendar marking, admin auth, and mobile-friendly compact layout.
 *
 * Paste into Worker editor, bind D1 to CARDS_DB and set ADMIN_USER/ADMIN_PASS in Worker env.
 */

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json;charset=UTF-8" }
});
const html = (body) => new Response(body, {
  headers: { "Content-Type": "text/html;charset=UTF-8" }
});

/* Basic Auth helper */
function isValidBasicAuth(authHeader, ADMIN_USER, ADMIN_PASS) {
  if (!authHeader || typeof authHeader !== 'string') return false;
  if (!authHeader.startsWith('Basic ')) return false;
  try {
    const b64 = authHeader.slice(6).trim();
    const creds = atob(b64);
    const idx = creds.indexOf(':');
    if (idx === -1) return false;
    const user = creds.slice(0, idx);
    const pass = creds.slice(idx + 1);
    return user === ADMIN_USER && pass === ADMIN_PASS;
  } catch (e) {
    return false;
  }
}

/* D1 schema init & seed */
async function ensureSchemaAndSeed(env) {
  await env.CARDS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank TEXT NOT NULL,
      last4 TEXT NOT NULL,
      credit_limit INTEGER DEFAULT 0,
      billing_day INTEGER NOT NULL,
      repayment_mode TEXT NOT NULL,
      repayment_offset INTEGER NOT NULL,
      grace_period INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
    );
  `).run();

  const r = await env.CARDS_DB.prepare(`SELECT COUNT(*) AS c FROM cards`).all();
  const count = (r && r.results && r.results[0] && r.results[0].c) ? r.results[0].c : 0;
  if (count === 0) {
    await env.CARDS_DB.prepare(`
      INSERT INTO cards (bank, last4, credit_limit, billing_day, repayment_mode, repayment_offset, grace_period, notes)
      VALUES
      ('招商银行', '8888', 50000, 1, 'fixed', 20, 49, '示例卡 - 招商'),
      ('工商银行', '1234', 80000, 5, 'after', 25, 55, '示例卡 - 工行');
    `).run();
  }
}

/* Date helpers */
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function clampDay(year, month, day) { const dim = daysInMonth(year, month); return Math.max(1, Math.min(dim, day)); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function nextBillingDateFrom(billing_day, fromDate) {
  const y = fromDate.getFullYear(), m = fromDate.getMonth() + 1;
  const thisMonthDay = clampDay(y, m, billing_day);
  let billDate = new Date(y, m - 1, thisMonthDay);
  if (billDate < startOfDay(fromDate)) {
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    billDate = new Date(nextYear, nextMonth - 1, clampDay(nextYear, nextMonth, billing_day));
  }
  return billDate;
}
function nextRepaymentDate(card, fromDate) {
  if (card.repayment_mode === 'fixed') {
    const day = clampDay(fromDate.getFullYear(), fromDate.getMonth() + 1, card.repayment_offset);
    let repay = new Date(fromDate.getFullYear(), fromDate.getMonth(), day);
    if (repay < startOfDay(fromDate)) {
      const nextMonthIndex = fromDate.getMonth() === 11 ? 0 : fromDate.getMonth() + 1;
      const year = fromDate.getMonth() === 11 ? fromDate.getFullYear() + 1 : fromDate.getFullYear();
      repay = new Date(year, nextMonthIndex, clampDay(year, nextMonthIndex + 1, card.repayment_offset));
    }
    return repay;
  } else {
    const billing = nextBillingDateFrom(card.billing_day, fromDate);
    const repay = addDays(billing, card.repayment_offset);
    if (repay < startOfDay(fromDate)) {
      const nextBilling = nextBillingDateFrom(card.billing_day, addDays(fromDate, 31));
      return addDays(nextBilling, card.repayment_offset);
    }
    return repay;
  }
}
function daysUntil(a, b) { const A = startOfDay(a), B = startOfDay(b); return Math.ceil((B - A) / (24*3600*1000)); }

/* Validate payload */
function validateCardPayload(body) {
  const errors = [];
  const bank = body.bank || '';
  const last4 = String(body.last4 || '');
  const credit_limit = Number(body.credit_limit || 0);
  const billing_day = Number(body.billing_day);
  const repayment_mode = body.repayment_mode;
  const repayment_offset = Number(body.repayment_offset);
  const grace_period = Number(body.grace_period || 0);

  if (!bank || typeof bank !== 'string' || Array.from(bank).length === 0 || Array.from(bank).length > 10) errors.push('bank invalid (required, max 10 chars)');
  if (!/^\d{4}$/.test(last4)) errors.push('last4 must be exactly 4 digits');
  if (!Number.isFinite(credit_limit) || credit_limit < 0 || credit_limit > 1000000) errors.push('credit_limit invalid: 0..1000000');
  if (!Number.isInteger(billing_day) || billing_day < 1 || billing_day > 31) errors.push('billing_day must be 1-31');
  if (!['fixed','after'].includes(repayment_mode)) errors.push('repayment_mode must be "fixed" or "after"');
  if (!Number.isInteger(repayment_offset) || repayment_offset < 1 || repayment_offset > 31) errors.push('repayment_offset must be 1-31');
  if (!Number.isInteger(grace_period) || grace_period < 0 || grace_period > 365) errors.push('grace_period invalid');

  return { ok: errors.length === 0, errors };
}

/* API */
async function handleApiRequest(req, env) {
  const u = new URL(req.url);
  const p = u.pathname;

  await ensureSchemaAndSeed(env);

  // GET list
  if (p === '/api/cards' && req.method === 'GET') {
    const q = u.searchParams.get('q') || '';
    const sortBy = u.searchParams.get('sortBy') || 'repayment';

    const rows = await env.CARDS_DB.prepare(`SELECT * FROM cards`).all();
    const cards = (rows && rows.results) ? rows.results.map(r => ({
      id: r.id,
      bank: r.bank,
      last4: r.last4,
      credit_limit: r.credit_limit,
      billing_day: r.billing_day,
      repayment_mode: r.repayment_mode,
      repayment_offset: r.repayment_offset,
      grace_period: r.grace_period,
      notes: r.notes,
      created_at: r.created_at
    })) : [];

    const now = new Date();
    const enriched = cards.map(c => {
      const nextBilling = nextBillingDateFrom(c.billing_day, now);
      const nextRepay = nextRepaymentDate(c, now);
      const daysToRepay = daysUntil(now, nextRepay);
      return { ...c, nextBilling: nextBilling.toISOString(), nextRepay: nextRepay.toISOString(), daysToRepay };
    });

    const tokens = q.trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
    let filtered = enriched;
    if (tokens.length) {
      filtered = enriched.filter(c => {
        const hay = (c.bank + ' ' + c.last4).toLowerCase();
        return tokens.every(t => hay.includes(t));
      });
    }

    const longest = filtered.reduce((acc, c) => Math.max(acc, c.daysToRepay), 0);
    const dueIn7 = filtered.filter(c => c.daysToRepay > 0 && c.daysToRepay <= 7).length;

    if (sortBy === 'billing') {
      // Sort by billing_day ascending (日期越小越靠前)
      filtered.sort((a, b) => a.billing_day - b.billing_day);
    } else {
      // repayment sort by nextRepay date ascending
      filtered.sort((a, b) => new Date(a.nextRepay) - new Date(b.nextRepay));
    }

    return json({ cards: filtered, longestRemaining: longest, dueIn7 });
  }

  // POST create (admin)
  if (p === '/api/cards' && req.method === 'POST') {
    const authHeader = req.headers.get('Authorization') || '';
    if (!isValidBasicAuth(authHeader, env.ADMIN_USER, env.ADMIN_PASS)) {
      return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"' } });
    }
    const body = await req.json();
    const valid = validateCardPayload(body);
    if (!valid.ok) return json({ error: 'validation', details: valid.errors }, 400);
    const stmt = `INSERT INTO cards (bank,last4,credit_limit,billing_day,repayment_mode,repayment_offset,grace_period,notes) VALUES (?,?,?,?,?,?,?,?)`;
    const res = await env.CARDS_DB.prepare(stmt).bind(body.bank, body.last4, body.credit_limit || 0, body.billing_day, body.repayment_mode, body.repayment_offset, body.grace_period || 0, body.notes || '').run();
    return json({ ok: true, lastInsertId: res && res.lastInsertRowId ? res.lastInsertRowId : null });
  }

  // GET / PUT / DELETE by id
  if (p.startsWith('/api/cards/') && ['GET','PUT','DELETE'].includes(req.method)) {
    const id = Number(p.split('/').pop());
    if (Number.isNaN(id)) return json({ error: 'bad_id' }, 400);

    if (req.method === 'GET') {
      const row = await env.CARDS_DB.prepare(`SELECT * FROM cards WHERE id = ?`).bind(id).all();
      if (!row || !row.results || row.results.length === 0) return json({ error: 'not_found' }, 404);
      return json({ card: row.results[0] });
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!isValidBasicAuth(authHeader, env.ADMIN_USER, env.ADMIN_PASS)) {
      return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"' } });
    }

    if (req.method === 'PUT') {
      const body = await req.json();
      const valid = validateCardPayload(body);
      if (!valid.ok) return json({ error: 'validation', details: valid.errors }, 400);
      await env.CARDS_DB.prepare(`
        UPDATE cards SET bank=?, last4=?, credit_limit=?, billing_day=?, repayment_mode=?, repayment_offset=?, grace_period=?, notes=?
        WHERE id=?
      `).bind(body.bank, body.last4, body.credit_limit || 0, body.billing_day, body.repayment_mode, body.repayment_offset, body.grace_period || 0, body.notes || '', id).run();
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await env.CARDS_DB.prepare(`DELETE FROM cards WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }
  }

  // POST /api/login - validate credentials and return ok (client stores Basic header)
  if (p === '/api/login' && req.method === 'POST') {
    const body = await req.json();
    const user = String(body.username || '');
    const pass = String(body.password || '');
    if (!env.ADMIN_USER || !env.ADMIN_PASS) return json({ error: 'server_misconfigured' }, 500);
    if (user === env.ADMIN_USER && pass === env.ADMIN_PASS) {
      return json({ ok: true, message: 'credentials_valid' });
    } else {
      return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"' } });
    }
  }

  // GET /api/check_auth - check Authorization header (Basic)
  if (p === '/api/check_auth' && req.method === 'GET') {
    const authHeader = req.headers.get('Authorization') || '';
    if (!isValidBasicAuth(authHeader, env.ADMIN_USER, env.ADMIN_PASS)) {
      return json({ authenticated: false });
    }
    return json({ authenticated: true, username: env.ADMIN_USER });
  }

  return json({ error: 'not_found' }, 404);
}

/* Frontend SPA */
function renderApp() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>信用卡管理</title>
<style>
  :root{--bg:#ffffff;--accent:#14a44d;--muted:#6b7280;--card:#f7faf7}
  html,body{height:100%;margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#111}
  .wrap{max-width:760px;margin:0 auto;padding:10px}
  header{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .title{font-size:18px;font-weight:700}
  .admin-wrap{display:flex;align-items:center;gap:8px;cursor:pointer}
  .admin-icon{width:34px;height:34px;border-radius:8px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:18px}
  .admin-name{font-size:13px;color:#333;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stats{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  .stat{flex:1 1 28%;min-width:100px;background:var(--card);padding:10px;border-radius:10px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
  .stat .label{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
  .stat .value{font-weight:700;font-size:16px;margin-top:6px}
  .search{margin-top:10px}
  .search input{width:100%;padding:10px;border-radius:10px;border:1px solid #e6e6e6;font-size:14px}
  .calendar{margin-top:10px;padding:8px;border-radius:8px;border:1px solid #eee}
  .cal-header{display:flex;align-items:center;justify-content:space-between}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:8px}
  .cal-day{padding:8px;border-radius:6px;text-align:center;font-size:13px;min-height:36px;display:flex;align-items:center;justify-content:center}
  .cal-day.mark-repay{background:#fff0f0;color:#c41d1d;font-weight:700;border:1px solid rgba(196,29,29,0.08)}
  .cal-day.mark-billing{background:#f0fff0;color:#0b9a3b;font-weight:700;border:1px solid rgba(11,154,59,0.08)}
  .section-title{display:flex;align-items:center;justify-content:space-between;margin-top:10px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px;table-layout:fixed}
  thead th{font-size:12px;color:var(--muted);text-align:left;padding:8px;border-bottom:1px solid #eee}
  tbody td{padding:10px;border-bottom:1px solid #f5f5f5;vertical-align:top;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  colgroup col:nth-child(1){width:44%}
  colgroup col:nth-child(2){width:26%}
  colgroup col:nth-child(3){width:18%}
  colgroup col:nth-child(4){width:12%}
  .bank-name{display:inline-flex;align-items:center;gap:8px;max-width:100%;overflow:hidden}
  .repay-small{font-weight:600}
  .add-btn{margin-top:12px;background:var(--accent);color:#fff;padding:10px;border-radius:8px;text-align:center;cursor:pointer;font-weight:700}
  .modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);z-index:50}
  .modal.open{display:flex}
  .panel{background:#fff;padding:14px;border-radius:12px;max-width:520px;width:94%;max-height:90vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,0.12)}
  .login-box{display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px}
  .avatar{width:84px;height:84px;border-radius:12px;background:linear-gradient(135deg,#eef2ff,#fff);display:flex;align-items:center;justify-content:center;border:1px solid #eee}
  .login-form{width:100%;display:flex;flex-direction:column;gap:10px}
  .login-form input{width:100%;padding:10px;border-radius:8px;border:1px solid #e6e6e6}
  .login-note{font-size:13px;color:#666;text-align:center}
  .form-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f3f3}
  .form-row label{flex:1;font-size:14px}
  input[type="text"],input[type="number"],textarea,select{flex:2;padding:8px;border-radius:6px;border:1px solid #e6e6e6;font-size:14px}
  .btn{padding:8px 10px;border-radius:8px;border:none;cursor:pointer}
  .btn.primary{background:var(--accent);color:#fff}
  .btn.ghost{background:#fff;border:1px solid #ddd}
  .small-muted{color:#888;font-size:12px}
  .legend{font-size:12px;color:#666;margin-left:8px}
  @media (max-width:420px){
    colgroup col:nth-child(1){width:48%}
    colgroup col:nth-child(2){width:26%}
    colgroup col:nth-child(3){width:14%}
    colgroup col:nth-child(4){width:12%}
  }
</style>
</head><body>
<div class="wrap">
  <header>
    <div class="title">我的信用卡概览</div>
    <div id="adminWrap" class="admin-wrap" title="管理员">
      <div id="adminIcon" class="admin-icon">🔒</div>
      <div id="adminName" class="admin-name"></div>
    </div>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="label">🔔 7天内到期还款卡片数</div>
      <div class="value" id="dueIn7">0</div>
    </div>
    <div class="stat">
      <div class="label">💳 卡片总数</div>
      <div class="value" id="cardCount">0 张</div>
    </div>
    <div class="stat">
      <div class="label">⏳ 最长剩余免息期</div>
      <div class="value" id="longest">0 天</div>
    </div>
  </div>

  <div class="search"><input id="searchInput" placeholder="🔎 搜索银行名称或尾号" /></div>

  <div class="calendar" id="calendar">
    <div class="cal-header">
      <div>
        <button id="prevMonth" class="btn">◀</button>
        <span id="monthTitle" class="small-muted">2025 年 11 月</span>
        <button id="nextMonth" class="btn">▶</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="legend">绿色-账单日&nbsp;&nbsp;红色-还款日</div>
      </div>
    </div>
    <div id="calGrid" class="cal-grid" style="margin-top:8px"></div>
  </div>

  <div class="section-title">
    <h3 style="margin:0">信用卡列表</h3>
    <div style="display:flex;gap:8px;align-items:center">
      <button id="sortToggle" class="btn small-muted" style="border-radius:16px;padding:6px 10px">还款日 ⌄</button>
    </div>
  </div>

  <table>
    <colgroup>
      <col/>
      <col/>
      <col/>
      <col/>
    </colgroup>
    <thead><tr><th>银行/尾号</th><th>还款日</th><th>账单日</th><th>免息期</th></tr></thead>
    <tbody id="cardsBody"></tbody>
  </table>

  <div id="addCardBtn" class="add-btn">➕ + 添加信用卡信息</div>
</div>

<!-- Modal -->
<div id="modal" class="modal"><div class="panel">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h3 id="modalTitle">添加信用卡</h3>
    <button id="closeModal" class="btn">关闭</button>
  </div>

  <div id="formArea">
    <div class="form-row"><label>卡号后4位</label><input id="f_last4" maxlength="4" /></div>
    <div class="form-row"><label>发卡银行</label><input id="f_bank" /></div>
    <div class="form-row"><label>卡片额度 (元)</label><input id="f_limit" type="number" min="0" max="1000000" /></div>
    <div class="form-row"><label>出账日</label><input id="f_billing" type="number" min="1" max="31" /></div>
    <div class="form-row"><label>还款日</label>
      <div style="display:flex;gap:8px">
        <select id="f_repay_mode"><option value="after">账后 xx 天</option><option value="fixed">每月固定 xx 日</option></select>
        <input id="f_repay_offset" type="number" min="1" max="31" style="width:90px"/>
      </div>
    </div>
    <div class="form-row"><label>宽限期 (天)</label><input id="f_grace" type="number" min="0" max="365" /></div>
    <div class="form-row" style="align-items:flex-start"><label>备注 (不超过100字)</label><textarea id="f_notes" maxlength="100" style="height:80px"></textarea></div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button id="btnCancel" class="btn ghost">取消</button>
      <button id="btnSave" class="btn primary">保存</button>
      <button id="btnUpdate" class="btn primary" style="display:none">更新</button>
      <button id="btnDelete" class="btn" style="background:#e04b4b;color:#fff;display:none">删除</button>
    </div>
    <div id="formMsg" class="small-muted" style="margin-top:8px"></div>
  </div>

  <div id="loginArea" style="display:none;margin-top:12px">
    <div class="login-box">
      <div class="avatar" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect rx="6" width="24" height="24" fill="#fff"/><path d="M12 12a3 3 0 100-6 3 3 0 000 6z" fill="#c7d2fe"/><path d="M4 20a8 8 0 0116 0" fill="#eef2ff"/></svg>
      </div>
      <div class="login-form">
        <input id="loginUser" placeholder="管理员用户名" />
        <input id="loginPass" type="password" placeholder="管理员密码" />
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="loginCancel" class="btn ghost">取消</button>
          <button id="loginBtn" class="btn primary">登录</button>
        </div>
        <div id="loginMsg" class="login-note"></div>
      </div>
      <div class="login-note">使用管理员账号登录以添加或管理信用卡信息</div>
    </div>
  </div>

</div></div>

<script>
(function(){
  const API = '/api';
  let cards = [];
  let mode = 'repayment';            // sorting mode: 'repayment' or 'billing'
  let calMarkMode = 'repayment';     // calendar marking: 'repayment' (red) or 'billing' (green)
  let currentMonth = new Date(); currentMonth.setDate(1);

  const el = {
    adminWrap: document.getElementById('adminWrap'),
    adminIcon: document.getElementById('adminIcon'),
    adminName: document.getElementById('adminName'),
    searchInput: document.getElementById('searchInput'),
    cardsBody: document.getElementById('cardsBody'),
    cardCount: document.getElementById('cardCount'),
    longest: document.getElementById('longest'),
    dueIn7: document.getElementById('dueIn7'),
    addCardBtn: document.getElementById('addCardBtn'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    closeModal: document.getElementById('closeModal'),
    f_last4: document.getElementById('f_last4'),
    f_bank: document.getElementById('f_bank'),
    f_limit: document.getElementById('f_limit'),
    f_billing: document.getElementById('f_billing'),
    f_repay_mode: document.getElementById('f_repay_mode'),
    f_repay_offset: document.getElementById('f_repay_offset'),
    f_grace: document.getElementById('f_grace'),
    f_notes: document.getElementById('f_notes'),
    btnSave: document.getElementById('btnSave'),
    btnCancel: document.getElementById('btnCancel'),
    btnUpdate: document.getElementById('btnUpdate'),
    btnDelete: document.getElementById('btnDelete'),
    formMsg: document.getElementById('formMsg'),
    loginArea: document.getElementById('loginArea'),
    loginUser: document.getElementById('loginUser'),
    loginPass: document.getElementById('loginPass'),
    loginBtn: document.getElementById('loginBtn'),
    loginCancel: document.getElementById('loginCancel'),
    loginMsg: document.getElementById('loginMsg'),
    prevMonth: document.getElementById('prevMonth'),
    nextMonth: document.getElementById('nextMonth'),
    monthTitle: document.getElementById('monthTitle'),
    calGrid: document.getElementById('calGrid'),
    sortToggle: document.getElementById('sortToggle')
  };

  let editingId = null;
  let isAdmin = false;
  let adminName = '';

  function getStoredAuth() { return localStorage.getItem('basicAuth') || ''; }
  function setStoredAuth(basic) { if (basic) localStorage.setItem('basicAuth', basic); else localStorage.removeItem('basicAuth'); }

  function apiFetch(path, opts = {}) {
    opts.headers = opts.headers || {};
    const basic = getStoredAuth();
    if (basic) opts.headers['Authorization'] = basic;
    opts.credentials = 'include';
    return fetch(path, opts);
  }

  async function fetchCards() {
    const q = encodeURIComponent(el.searchInput.value || '');
    const res = await apiFetch(\`\${API}/cards?q=\${q}&sortBy=\${mode==='repayment'?'repayment':'billing'}\`);
    if (!res.ok) return;
    const data = await res.json();
    cards = data.cards || [];
    el.cardCount.textContent = (cards.length || 0) + ' 张';
    el.longest.textContent = (data.longestRemaining || 0) + ' 天';
    el.dueIn7.textContent = (data.dueIn7 || 0);
    renderCards();
    renderCalendar();
  }

  function renderCards(){
    el.cardsBody.innerHTML = '';
    cards.forEach(c => {
      const tr = document.createElement('tr');

      // Bank cell - no icon to save space
      const bankCell = document.createElement('td');
      bankCell.innerHTML = '<div style="min-width:0"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(c.bank) + '</div><div class="small-muted" style="font-size:12px">尾号 ' + escapeHtml(c.last4) + '</div></div>';

      // Repayment cell - compact ("账后" instead of "账单后")
      const repayCell = document.createElement('td');
      const repModeText = c.repayment_mode === 'fixed' ? (c.repayment_offset + ' 日') : ('账后 ' + c.repayment_offset + ' 天');
      repayCell.innerHTML = '<div class="repay-small">🔁 ' + repModeText + '</div><div class="small-muted">剩余: ' + c.daysToRepay + ' 天</div>';

      // Billing cell - only the day number
      const billingCell = document.createElement('td');
      billingCell.textContent = c.billing_day + ' 日';

      // Grace
      const graceCell = document.createElement('td');
      graceCell.textContent = (c.grace_period || 0) + ' 天';

      tr.appendChild(bankCell); tr.appendChild(repayCell); tr.appendChild(billingCell); tr.appendChild(graceCell);
      if (isAdmin) { tr.classList.add('clickable'); tr.addEventListener('click', () => openEdit(c.id)); }
      el.cardsBody.appendChild(tr);
    });
  }

  function renderCalendar(){
    const year = currentMonth.getFullYear(), month = currentMonth.getMonth();
    el.monthTitle.textContent = year + ' 年 ' + (month + 1) + ' 月';
    const firstWeekday = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const marks = {};
    cards.forEach(c => {
      const billingDay = c.billing_day;
      const repMode = c.repayment_mode;
      const repOffset = c.repayment_offset;
      const billingDayClamped = Math.min(billingDay, new Date(year, month + 1, 0).getDate());
      const billingDate = new Date(year, month, billingDayClamped);
      let repaymentDate;
      if (repMode === 'fixed') {
        repaymentDate = new Date(year, month, Math.min(repOffset, new Date(year, month + 1, 0).getDate()));
      } else {
        repaymentDate = new Date(billingDate.getTime()); repaymentDate.setDate(repaymentDate.getDate() + repOffset);
      }
      if (billingDate.getMonth() === month) { marks[billingDate.getDate()] = marks[billingDate.getDate()] || {}; marks[billingDate.getDate()].billing = true; }
      if (repaymentDate.getMonth() === month) { marks[repaymentDate.getDate()] = marks[repaymentDate.getDate()] || {}; marks[repaymentDate.getDate()].repayment = true; }
    });

    el.calGrid.innerHTML = '';
    for (let i=0;i<firstWeekday;i++){ const d=document.createElement('div'); d.className='cal-day'; el.calGrid.appendChild(d); }
    for (let d=1; d<=days; d++){
      const div = document.createElement('div'); div.className='cal-day'; div.textContent = d;
      const mark = marks[d];
      if (mark) {
        if (calMarkMode === 'repayment' && mark.repayment) div.classList.add('mark-repay');
        if (calMarkMode === 'billing' && mark.billing) div.classList.add('mark-billing');
      }
      el.calGrid.appendChild(div);
    }
  }

  el.prevMonth.addEventListener('click', ()=>{ currentMonth.setMonth(currentMonth.getMonth()-1); renderCalendar(); });
  el.nextMonth.addEventListener('click', ()=>{ currentMonth.setMonth(currentMonth.getMonth()+1); renderCalendar(); });

  // calendar click toggles marking only
  el.calGrid.addEventListener('click', ()=>{ calMarkMode = calMarkMode === 'repayment' ? 'billing' : 'repayment'; renderCalendar(); });

  // sorting button - restored and functional
  el.sortToggle.addEventListener('click', ()=>{ 
    mode = mode === 'repayment' ? 'billing' : 'repayment'; 
    el.sortToggle.textContent = (mode === 'repayment' ? '还款日 ⌄' : '账单日 ⌄'); 
    fetchCards(); 
  });

  el.searchInput.addEventListener('input', debounce(()=>fetchCards(), 300));

  // Admin icon: if logged in, click logs out; else open login
  el.adminWrap.addEventListener('click', async () => {
    if (isAdmin) {
      setStoredAuth('');
      isAdmin = false; adminName = '';
      setAdminUI('');
      await fetchCards();
      return;
    }
    const chk = await apiFetch(API + '/check_auth', { method: 'GET' }).then(r => r.json()).catch(()=>({authenticated:false}));
    if (chk && chk.authenticated) {
      isAdmin = true; adminName = chk.username; setAdminUI(adminName);
      openModal('管理信用卡'); showFormAsEdit(false);
    } else {
      openModal('管理员登录', true);
    }
  });

  el.addCardBtn.addEventListener('click', async () => {
    const chk = await apiFetch(API + '/check_auth', { method: 'GET' }).then(r=>r.json()).catch(()=>({authenticated:false}));
    if (!chk || !chk.authenticated) { openModal('管理员登录', true); return; }
    isAdmin = true; adminName = chk.username; setAdminUI(adminName);
    openModal('添加信用卡'); showFormAsEdit(false);
  });

  function openModal(title, showLogin=false) {
    el.modal.classList.add('open'); el.modalTitle.textContent = title;
    if (showLogin) { el.loginArea.style.display = 'block'; document.getElementById('formArea').style.display = 'none'; }
    else { el.loginArea.style.display = 'none'; document.getElementById('formArea').style.display = 'block'; }
  }
  function closeModal(){ el.modal.classList.remove('open'); el.loginArea.style.display='none'; document.getElementById('formArea').style.display='block'; el.formMsg.textContent=''; el.loginMsg.textContent=''; editingId = null; }
  el.closeModal.addEventListener('click', closeModal);
  el.btnCancel.addEventListener('click', closeModal);
  el.loginCancel.addEventListener('click', closeModal);

  // login
  el.loginBtn.addEventListener('click', async () => {
    const user = el.loginUser.value.trim(), pass = el.loginPass.value;
    if (!user || !pass) { el.loginMsg.textContent = '请输入用户名和密码'; return; }
    try {
      const res = await fetch(API + '/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: user, password: pass }) });
      if (res.ok) {
        const basic = 'Basic ' + btoa(user + ':' + pass);
        setStoredAuth(basic);
        const chk = await apiFetch(API + '/check_auth', { method: 'GET' }).then(r => r.json()).catch(()=>({authenticated:false}));
        if (chk && chk.authenticated) {
          isAdmin = true; adminName = chk.username; setAdminUI(adminName);
          el.loginMsg.textContent = '登录成功';
          document.getElementById('formArea').style.display = 'block';
          el.loginArea.style.display = 'none';
          el.modalTitle.textContent = '添加信用卡';
          showFormAsEdit(false);
          await fetchCards();
        } else {
          el.loginMsg.textContent = '登录验证通过但服务器无法确认权限';
          setStoredAuth('');
        }
      } else {
        if (res.status === 401) el.loginMsg.textContent = '用户名或密码错误';
        else el.loginMsg.textContent = '登录失败';
      }
    } catch (e) {
      el.loginMsg.textContent = '登录请求失败';
    }
  });

  function setAdminUI(name) {
    el.adminIcon.textContent = isAdmin ? '👤' : '🔒';
    el.adminName.textContent = name || '';
    el.adminWrap.title = name ? ('管理员: ' + name) : '管理员';
  }

  async function openEdit(id) {
    const res = await apiFetch(API + '/cards/' + id, { method: 'GET' });
    if (!res.ok) { alert('读取卡片信息失败'); return; }
    const data = await res.json();
    const c = data.card;
    editingId = id;
    el.f_last4.value = c.last4 || '';
    el.f_bank.value = c.bank || '';
    el.f_limit.value = c.credit_limit || '';
    el.f_billing.value = c.billing_day || '';
    el.f_repay_mode.value = c.repayment_mode || 'after';
    el.f_repay_offset.value = c.repayment_offset || '';
    el.f_grace.value = c.grace_period || '';
    el.f_notes.value = c.notes || '';
    openModal('管理信用卡'); showFormAsEdit(true);
  }

  function showFormAsEdit(editMode) {
    if (editMode) {
      el.btnSave.style.display = 'none'; el.btnUpdate.style.display = 'inline-block'; el.btnDelete.style.display = 'inline-block';
    } else {
      el.btnSave.style.display = 'inline-block'; el.btnUpdate.style.display = 'none'; el.btnDelete.style.display = 'none';
      el.f_last4.value=''; el.f_bank.value=''; el.f_limit.value=''; el.f_billing.value=''; el.f_repay_mode.value='after'; el.f_repay_offset.value=''; el.f_grace.value=''; el.f_notes.value='';
    }
  }

  el.btnSave.addEventListener('click', async () => {
    const payload = collectForm();
    const ok = validateFormClient(payload);
    if (!ok.ok) { el.formMsg.textContent = ok.msg; return; }
    const res = await apiFetch(API + '/cards', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok && data.ok) { el.formMsg.textContent = '添加成功'; await fetchCards(); setTimeout(()=>closeModal(),700); }
    else { el.formMsg.textContent = data.error || '添加失败'; }
  });

  el.btnUpdate.addEventListener('click', async () => {
    if (!editingId) return;
    const payload = collectForm(); const ok = validateFormClient(payload);
    if (!ok.ok) { el.formMsg.textContent = ok.msg; return; }
    const res = await apiFetch(API + '/cards/' + editingId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok && data.ok) { el.formMsg.textContent = '更新成功'; await fetchCards(); setTimeout(()=>closeModal(),700); }
    else el.formMsg.textContent = data.error || '更新失败';
  });

  el.btnDelete.addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('确认删除此信用卡信息？')) return;
    const res = await apiFetch(API + '/cards/' + editingId, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.ok) { el.formMsg.textContent = '已删除'; await fetchCards(); setTimeout(()=>closeModal(),700); }
    else el.formMsg.textContent = data.error || '删除失败';
  });

  function collectForm() {
    return {
      bank: el.f_bank.value.trim(),
      last4: el.f_last4.value.trim(),
      credit_limit: Number(el.f_limit.value || 0),
      billing_day: Number(el.f_billing.value || 0),
      repayment_mode: el.f_repay_mode.value,
      repayment_offset: Number(el.f_repay_offset.value || 0),
      grace_period: Number(el.f_grace.value || 0),
      notes: el.f_notes.value.trim()
    };
  }

  function validateFormClient(payload) {
    if (!payload.bank || payload.bank.length === 0 || payload.bank.length > 10) return { ok:false, msg: '发卡银行不能为空且不超过10个字' };
    if (!/^[0-9]{4}$/.test(payload.last4)) return { ok:false, msg: '卡号后4位必须为4位数字' };
    if (!Number.isInteger(payload.billing_day) || payload.billing_day < 1 || payload.billing_day > 31) return { ok:false, msg: '出账日必须为1-31之间' };
    if (!['fixed','after'].includes(payload.repayment_mode)) return { ok:false, msg: '还款类型错误' };
    if (!Number.isInteger(payload.repayment_offset) || payload.repayment_offset < 1 || payload.repayment_offset > 31) return { ok:false, msg: '还款日或偏移必须为1-31之间' };
    if (!Number.isInteger(payload.grace_period) || payload.grace_period < 0 || payload.grace_period > 365) return { ok:false, msg: '宽限期格式错误' };
    if (!Number.isInteger(payload.credit_limit) || payload.credit_limit < 0 || payload.credit_limit > 1000000) return { ok:false, msg: '额度必须为0-1000000之间的数字' };
    if (payload.notes && payload.notes.length > 100) return { ok:false, msg: '备注不能超过100字' };
    return { ok:true };
  }

  (async function init(){
    await fetchCards();
    const chk = await apiFetch(API + '/check_auth', { method: 'GET' }).then(r => r.json()).catch(()=>({authenticated:false}));
    if (chk && chk.authenticated) { isAdmin = true; adminName = chk.username; setAdminUI(adminName); }
  })();

  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn.apply(null,a), ms); }; }

})();
</script>
</body></html>`;
}

/* Main fetch entry */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApiRequest(request, env);
      } catch (e) {
        return json({ error: 'server_error', message: String(e) }, 500);
      }
    }
    try { await ensureSchemaAndSeed(env); } catch (e) { console.error(e); }
    return html(renderApp());
  }
};
