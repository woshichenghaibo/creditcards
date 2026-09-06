// 信用卡管理 Cloudflare Worker（前端 SPA + D1 API + scheduled 推送），worker.js版本：V3.3.20260102
// scheduled 用于定时检查并通过 PushPlus 推送“剩余1天还款”提醒
// 务必先修改第一行的ADMIN_TOKEN 的值。

const ADMIN_TOKEN = "strong-secret-12345";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      // 前端页面
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(getHtml(env), {
          headers: { 'Content-Type': 'text/html;charset=utf-8' },
        });
      }

      // 管理员登录
      if (url.pathname === '/api/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // 获取所有信用卡
      if (url.pathname === '/api/cards' && request.method === 'GET') {
        return getCards(request, env);
      }

      // 添加信用卡（受保护）
      if (url.pathname === '/api/cards' && request.method === 'POST') {
        if (!checkAuth(request)) return new Response('Unauthorized', { status: 401 });
        return addCard(request, env);
      }

      // 匹配 /api/cards/:id
      const cardMatch = url.pathname.match(/^\/api\/cards\/(\d+)$/);

      // 更新信用卡（受保护）
      if (cardMatch && request.method === 'PUT') {
        if (!checkAuth(request)) return new Response('Unauthorized', { status: 401 });
        const id = cardMatch[1];
        return updateCard(request, env, id);
      }

      // 删除信用卡（受保护）
      if (cardMatch && request.method === 'DELETE') {
        if (!checkAuth(request)) return new Response('Unauthorized', { status: 401 });
        const id = cardMatch[1];
        return deleteCard(request, env, id);
      }

      // 默认 404
      return new Response('Not Found', { status: 404 });

    } catch (e) {
      console.error(e);
      return new Response(e.message, { status: 500 });
    }
  },

  // Cron Trigger 调度入口
  async scheduled(event, env, ctx) {
    ctx.waitUntil(doScheduledPush(env));
  },
};

// ---------- 简单认证 ----------
function checkAuth(request) {
  const authHeader = request.headers.get('Authorization');
  return authHeader === `Bearer ${ADMIN_TOKEN}`;
}

// ---------- 登录 ----------
async function handleLogin(request, env) {
  try {
    const { username, password } = await request.json();
    
    const envUser = env.USERNAME;
    const envPass = env.PASSWORD;

    if (username === envUser && password === envPass) {
      return Response.json({
        success: true,
        token: ADMIN_TOKEN,
        username: envUser,
      });
    } else {
      return Response.json({ success: false, message: '用户名或密码错误' }, { status: 401 });
    }
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 400 });
  }
}

// ---------- 查询卡片 ----------
async function getCards(request, env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM credit_cards'
    ).all();
    return Response.json({ success: true, cards: results });
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 500 });
  }
}

// ---------- 新增卡片 ----------
async function addCard(request, env) {
  try {
    const card = await request.json();
    
    if (!card.bank_name) {
      return Response.json({ success: false, message: '发卡银行不能为空' }, { status: 400 });
    }

    const last4 = card.last_4_digits;
    if (typeof last4 !== 'string' || last4.length !== 4) {
        return Response.json({ success: false, message: '卡号后4位格式错误 (非4位)' }, { status: 400 });
    }
    const last4Num = parseInt(last4, 10);
    if (isNaN(last4Num) || last4Num < 0 || last4Num > 9999) {
        return Response.json({ success: false, message: '卡号后4位超出有效范围 (0000-9999)' }, { status: 400 });
    }

    const limitNum = Number(card.card_limit);
    if (isNaN(limitNum) || limitNum < 0 || limitNum > 1000000) {
      return Response.json({ success: false, message: '卡片额度必须是0到1,000,000之间的整数' }, { status: 400 });
    }

    const annualFeeNum = Number(card.annual_fee || 0);
    if (isNaN(annualFeeNum) || annualFeeNum < 0 || annualFeeNum > 1000000) {
      return Response.json({ success: false, message: '年费必须是0到1,000,000之间的整数' }, { status: 400 });
    }

    await env.DB.prepare(
      `INSERT INTO credit_cards (bank_name, last_4_digits, card_limit, billing_day, 
      payment_type, payment_value, grace_days, max_grace_period, annual_fee, notes) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      card.bank_name,
      card.last_4_digits,
      card.card_limit,
      card.billing_day,
      card.payment_type,
      card.payment_value,
      card.grace_days,
      card.max_grace_period,
      card.annual_fee,
      card.notes
    )
    .run();

    return Response.json({ success: true, message: '添加成功' });
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 500 });
  }
}

// ---------- 更新卡片 ----------
async function updateCard(request, env, id) {
  try {
    const card = await request.json();
    
    if (!card.bank_name) {
      return Response.json({ success: false, message: '发卡银行不能为空' }, { status: 400 });
    }

    const last4 = card.last_4_digits;
    if (typeof last4 !== 'string' || last4.length !== 4) {
        return Response.json({ success: false, message: '卡号后4位格式错误 (非4位)' }, { status: 400 });
    }
    const last4Num = parseInt(last4, 10);
    if (isNaN(last4Num) || last4Num < 0 || last4Num > 9999) {
        return Response.json({ success: false, message: '卡号后4位超出有效范围 (0000-9999)' }, { status: 400 });
    }

    const limitNum = Number(card.card_limit);
    if (isNaN(limitNum) || limitNum < 0 || limitNum > 1000000) {
      return Response.json({ success: false, message: '卡片额度必须是0到1,000,000之间的整数' }, { status: 400 });
    }

    const annualFeeNum = Number(card.annual_fee || 0);
    if (isNaN(annualFeeNum) || annualFeeNum < 0 || annualFeeNum > 1000000) {
      return Response.json({ success: false, message: '年费必须是0到1,000,000之间的整数' }, { status: 400 });
    }

    await env.DB.prepare(
      `UPDATE credit_cards SET bank_name = ?, last_4_digits = ?, card_limit = ?, 
      billing_day = ?, payment_type = ?, payment_value = ?, grace_days = ?, 
      max_grace_period = ?, annual_fee = ?, notes = ? WHERE id = ?`
    )
    .bind(
      card.bank_name,
      card.last_4_digits,
      card.card_limit,
      card.billing_day,
      card.payment_type,
      card.payment_value,
      card.grace_days,
      card.max_grace_period,
      card.annual_fee,
      card.notes,
      id
    )
    .run();

    return Response.json({ success: true, message: '更新成功' });
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 500 });
  }
}

// ---------- 删除卡片 ----------
async function deleteCard(request, env, id) {
  try {
    await env.DB.prepare('DELETE FROM credit_cards WHERE id = ?').bind(id).run();
    return Response.json({ success: true, message: '删除成功' });
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 500 });
  }
}

// ---------- 服务器端日期计算与定时推送 ----------
function calculatePaymentDeadlineServer(billingDate, paymentType, paymentValue, graceDays) {
  const paymentDate = new Date(billingDate.getTime());
  const pv = Number(paymentValue || 0);
  const gd = Number(graceDays || 0);

  if (paymentType === 'days_after_billing') {
    paymentDate.setDate(paymentDate.getDate() + pv);
  } else { // fixed_day
    const billingDay = paymentDate.getDate();
    if (pv > billingDay) {
      paymentDate.setDate(pv);
    } else {
      paymentDate.setMonth(paymentDate.getMonth() + 1);
      paymentDate.setDate(pv);
    }
  }

  // 暂时不考虑宽限期
  paymentDate.setDate(paymentDate.getDate() + gd -gd);
  return paymentDate;
}

function getCardDatesServer(card, refDate) {
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const todayDay = today.getDate();

  const billingDay = Number(card.billing_day);
  const paymentType = card.payment_type;
  const paymentValue = Number(card.payment_value);
  const graceDays = Number(card.grace_days || 0);

  let thisMonthBillingDate = new Date(today.getFullYear(), today.getMonth(), billingDay);
  let prevBillingDate, nextBillingDate;

  if (todayDay <= billingDay) {
    prevBillingDate = new Date(today.getFullYear(), today.getMonth() - 1, billingDay);
    nextBillingDate = thisMonthBillingDate;
  } else {
    prevBillingDate = thisMonthBillingDate;
    nextBillingDate = new Date(today.getFullYear(), today.getMonth() + 1, billingDay);
  }

  const deadlineForPrevBill = calculatePaymentDeadlineServer(prevBillingDate, paymentType, paymentValue, graceDays);

  if (today > deadlineForPrevBill) {
    const deadlineForNextBill = calculatePaymentDeadlineServer(nextBillingDate, paymentType, paymentValue, graceDays);
    const daysUntil = (deadlineForNextBill.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return {
      nextBillingDate: nextBillingDate,
      nextPaymentDeadline: deadlineForNextBill,
      daysUntilPayment: Math.ceil(daysUntil),
    };
  } else {
    const daysUntil = (deadlineForPrevBill.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return {
      nextBillingDate: prevBillingDate,
      nextPaymentDeadline: deadlineForPrevBill,
      daysUntilPayment: Math.ceil(daysUntil),
    };
  }
}

async function doScheduledPush(env) {
    function escapeHtmlServer(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  
    function formatDateYMD(d) {
      const dt = d instanceof Date ? d : new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  
    try {
      const { results } = await env.DB.prepare('SELECT * FROM credit_cards').all();
      const cards = results || [];
  
      const today = new Date();
      const dueSoon = [];
  
      for (const c of cards) {
        if (!c) continue;
        if (typeof c.billing_day === 'undefined' || typeof c.payment_type === 'undefined' || typeof c.payment_value === 'undefined') {
          continue;
        }
  
        const info = getCardDatesServer(c, today);
        if (info && Number(info.daysUntilPayment) === 1) {
          dueSoon.push({ card: c, info });
        }
      }
  
      if (dueSoon.length === 0) {
        console.log('[scheduled] no cards due in 1 day');
        return;
      }
  
      const listHtml = dueSoon.map(item => {
        const c = item.card;
        const deadline = item.info && item.info.nextPaymentDeadline ? new Date(item.info.nextPaymentDeadline) : null;
        const dateStr = deadline ? formatDateYMD(deadline) : '';
        const tail = c.last_4_digits ? `（${escapeHtmlServer(String(c.last_4_digits))}）` : '';
        return `<p style="margin:6px 0;font-size:14px;">${escapeHtmlServer(c.bank_name || '')}${tail}：到期日 <strong style="color:#e53e3e">${dateStr}</strong></p>`;
      }).join('');
  
      const contentHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;">
          <h2 style="margin:0 0 8px 0;font-size:16px;">信用卡还款提醒（仅剩余 1 天）</h2>
          ${listHtml}
          <br><h2 style="margin:0 0 8px 0;font-size:16px;">点击<a href="https://cards.guao.de/" title="卡掌柜日历" target="_blank"> 卡掌柜日历 </a>查看详细情况。</h2>
          <p style="margin-top:8px;color:#666;font-size:13px;">请及时还款以避免逾期费用。若已还款请忽略。</p>
        </div>
      `;
  
      const title = '信用卡还款日';
  
      const pushplusApi = env.PUSHPLUS_API;
      const token = env.PUSHPLUS_TOKEN;
      if (!token) {
        console.error('[scheduled] PUSHPLUS_TOKEN not set in environment');
        return;
      }
  
      const body = {
        token: token,
        title: title,
        content: contentHtml,
        template: 'html'
      };
  
      const resp = await fetch(pushplusApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  
      const respText = await resp.text().catch(() => '');
      console.log('[scheduled] pushplus status=', resp.status, 'body=', respText);
    } catch (err) {
      console.error('[scheduled] error in doScheduledPush:', err);
    }
  }

// ---------- 前端 HTML / JS ----------
function getHtml(env) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="cards" />
    <link rel="apple-touch-icon" href="https://www.guao.de/logos/cards.ico" />
    <link rel="shortcut icon" href="https://www.guao.de/logos/cards.ico" type="image/x-icon" />
    <link rel="icon" href="https://www.guao.de/logos/cards.ico" />
    <title>信用卡掌柜</title>
    
    <style>
    body {
        overflow-y: scroll;
    }
    .status.cards .thirteen.wide.column { 
        white-space: nowrap;
        overflow: hidden;
        letter-spacing: -0.2px;
    }
</style>
<!-- 返回顶部按钮 -->
<button id="topBtn" class="top-btn" 
    style="display: none; position: fixed; bottom: 11%; right: 20px; z-index: 9999; 
           background-color: #ffcc00; color: white; border: none; border-radius: 50%; 
           width: 40px; height: 40px; font-size: 20px; display: flex; 
           align-items: center; justify-content: center; cursor: pointer;">
    ▲
</button>
<script>
    document.addEventListener('DOMContentLoaded', function() {
        const topBtn = document.getElementById('topBtn');
        window.onscroll = function() { scrollFunction(); };
        scrollFunction();
        function scrollFunction() {
            if (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200) {
                topBtn.style.display = "flex";
            } else {
                topBtn.style.display = "none";
            }
        }
        topBtn.addEventListener('click', function() {
            document.body.scrollTop = 0;
            document.documentElement.scrollTop = 0;
        });
    });
</script>
<script>
    document.addEventListener('DOMContentLoaded', function() {
        try {
            document.querySelectorAll('.status.cards .thirteen.wide.column').forEach(element => {
                element.textContent = element.textContent.replace(/Cores/g, 'C');
            });
        } catch (e) {}
    });
</script>
    
    
    <!-- 引入 Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- 引入 Lucide Icons -->
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            -webkit-tap-highlight-color: transparent;
        }
        .calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 4px;
        }
        .calendar-day {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s;
        }
        .calendar-day.today {
            background-color: #4a5568;
            color: white;
            font-weight: bold;
        }
        .calendar-day.other-month {
            color: #4a5568;
        }
        .calendar-day.highlight-billing {
            background-color: #38a169;
            color: white;
        }
        .calendar-day.highlight-payment {
            background-color: #e53e3e;
            color: white;
        }
        #toast {
            position: fixed;
            top: 50%; 
            left: 50%;
            transform: translate(-50%, -50%); 
            padding: 12px 15px;
            border-radius: 8px;
            color: white;
            z-index: 100;
            opacity: 0;
            transition: opacity 0.3s; 
            visibility: hidden;
            min-width: 250px;
            max-width: 65vw;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-align: center;
        }
        #toast.show { opacity: 1; visibility: visible; }
        #toast.success { background-color: #38a169; }
        #toast.error { background-color: #e53e3e; }
        input[type=number]::-webkit-inner-spin-button, 
        input[type=number]::-webkit-outer-spin-button { 
            -webkit-appearance: none; 
            margin: 0; 
        }
        input[type=number] { -moz-appearance: textfield; }
        #export-cards-btn { background-color: #2563eb; color: white; padding: 0.5rem 0.75rem; border-radius: 0.5rem; font-weight: 600; }
        #export-cards-btn:hover { background-color: #1e40af; }
    </style>
</head>
<body class="bg-white text-gray-900">

    <div class="max-w-md mx-auto min-h-screen bg-white pb-16">

        <div id="page-main">
            <header class="flex justify-between items-center p-4">
            <a href="https://github.com/woshichenghaibo/creditcards" target="_blank" class="text-xl font-bold">信用卡概览</a>
                <div id="auth-container">
                    <button id="login-button" class="cursor-pointer">
                        <i data-lucide="log-in" class="w-5 h-5"></i>
                    </button>
                    <div id="admin-info" class="hidden flex items-center space-x-2">
                        <span id="admin-username" class="text-sm"></span>
                        <button id="logout-button" class="cursor-pointer">
                            <i data-lucide="log-out" class="w-5 h-5 text-red-500"></i>
                        </button>
                    </div>
                </div>
            </header>

            <div class="grid grid-cols-3 gap-3 px-4">
                <div class="bg-gray-200 p-3 rounded-lg text-center">
                    <div class="text-sm text-gray-700">卡片总数</div>
                    <div id="stat-total-cards" class="text-xl font-bold">0 张</div>
                </div>
                <div class="bg-gray-200 p-3 rounded-lg text-center">
                    <div class="text-sm text-gray-700">7日内待还</div>
                    <div id="stat-due-in-7" class="text-xl font-bold">0 张</div>
                </div>
                <div class="bg-gray-200 p-3 rounded-lg text-center">
                    <div class="text-sm text-gray-700">总授信额度</div>
                    <div id="stat-max-grace" class="text-xl font-bold">0 元</div>
                </div>
            </div>

            <div class="px-4 mt-4">
                <div class="relative">
                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <i data-lucide="search" class="w-5 h-5 text-gray-600"></i>
                    </div>
                    <input type="search" id="search-bar" class="w-full bg-white border border-gray-300 rounded-lg pl-10 pr-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="搜索银行名称">
                </div>
            </div>

            <div class="px-4 mt-4">
                <div class="bg-gray-50 p-4 rounded-lg">
                    <div class="flex justify-between items-center mb-3">
                        <button id="calendar-prev-month">
                            <i data-lucide="chevron-left" class="w-5 h-5 text-gray-900"></i>
                        </button>
                        <div class="text-center">
                            <div id="calendar-month-year" class="font-bold"></div>
                            <div id="calendar-toggle-mode" class="text-xs text-gray-600 cursor-pointer">
                                (点击切换标注模式)
                            </div>
                        </div>
                        <button id="calendar-next-month">
                            <i data-lucide="chevron-right" class="w-5 h-5 text-gray-900"></i>
                        </button>
                    </div>
                    <div class="calendar-grid text-sm mb-2">
                        <div class="text-center font-bold text-gray-600">日</div>
                        <div class="text-center font-bold text-gray-600">一</div>
                        <div class="text-center font-bold text-gray-600">二</div>
                        <div class="text-center font-bold text-gray-600">三</div>
                        <div class="text-center font-bold text-gray-600">四</div>
                        <div class="text-center font-bold text-gray-600">五</div>
                        <div class="text-center font-bold text-gray-600">六</div>
                    </div>
                    <div id="calendar-body" class="calendar-grid text-sm">
                    </div>
                    <div class="text-xs text-gray-600 mt-3 flex justify-center items-center space-x-4">
                    <span class="flex items-center"><span class="w-3 h-3 bg-gray-600 rounded-full mr-1"></span> 今日</span>    
                    <span class="flex items-center"><span class="w-3 h-3 bg-green-600 rounded-full mr-1"></span> 账单日</span>
                    <span class="flex items-center"><span class="w-3 h-3 bg-red-600 rounded-full mr-1"></span> 还款日</span>
                    </div>
                </div>
            </div>

            <div class="px-4 mt-4">
                <div class="flex justify-between items-center mb-2">
                    <h2 class="text-lg font-bold">信用卡列表</h2>
                    <button id="sort-toggle-button" class="text-sm text-red-700 flex items-center">
                        <span id="sort-toggle-label">还款日</span>
                        <i data-lucide="chevrons-up-down" class="w-4 h-4 ml-1"></i>
                    </button>
                </div>

                <div class="grid grid-cols-7 gap-1 text-xs text-gray-600 px-3 py-2">
                    <div class="col-span-3">银行/尾号</div>
                    <div class="col-span-1 text-center">账单日</div>
                    <div class="col-span-2 text-center">还款日</div>
                    <div class="col-span-1 text-right">免息期</div>
                </div>

                <div id="card-list" class="space-y-2">
                </div>
            </div>

            <div id="add-card-btn-container" class="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-white bg-opacity-90 backdrop-blur-sm">
                <div class="flex space-x-2">
                    <button id="add-card-btn-main" class="flex-1 bg-green-600 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition hover:bg-green-700">
                        <i data-lucide="plus-circle" class="w-5 h-5"></i>
                        <span>添加新卡</span>
                    </button>
                    <button id="export-cards-btn" title="导出当前所有信用卡数据为 Excel 表格" class="flex-1 bg-blue bg-blue-600 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition hover:bg-blue-700">
                    <i data-lucide="download" class="w-5 h-5"></i>
                    <span>数据导出</span>
                    </button>
                </div>
            </div>

            <div class="px-4 mt-4 mb-8 text-center text-sm text-gray-500">
                信用卡掌柜V3.4.2026.01.09 已在 <a href="https://github.com/woshichenghaibo/creditcards" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline">Github</a> 开源
            </div>

        </div>

        <div id="page-login" class="hidden p-4">
            <header class="flex justify-between items-center mb-6">
                <h1 class="text-xl font-bold">管理员登录</h1>
                <button id="login-cancel-button">
                    <i data-lucide="x" class="w-6 h-6 text-gray-900"></i>
                </button>
            </header>
            <form id="login-form" class="space-y-4">
                <div>
                    <label for="username" class="block text-sm font-medium text-gray-600">用户名</label>
                    <input type="text" id="username" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>
                <div>
                    <label for="password" class="block text-sm font-medium text-gray-600">密码</label>
                    <input type="password" id="password" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>
                <div class="flex space-x-4 pt-4">
                    <button type="button" id="login-form-cancel" class="w-full bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-lg transition hover:bg-gray-100">取消</button>
                    <button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg transition hover:bg-blue-700">登录</button>
                </div>
            </form>
        </div>

        <div id="page-card-form" class="hidden p-4">
            <header class="flex justify-between items-center mb-6">
                <h1 id="form-title" class="text-xl font-bold">添加信用卡</h1>
                <button id="form-cancel-button">
                    <i data-lucide="x" class="w-6 h-6 text-gray-900"></i>
                </button>
            </header>
            
            <form id="card-form" class="space-y-4">
                <input type="hidden" id="card-id">
                
                <div>
                    <label for="bank_name" class="block text-sm font-medium text-gray-600">发卡银行</label>
                    <input type="text" id="bank_name" placeholder="例如：招商银行" maxlength="10" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <div>
                    <label for="last_4_digits" class="block text-sm font-medium text-gray-600">卡号后4位 (0000-9999)</label>
                    <input type="number" id="last_4_digits" placeholder="例如：8888" min="0" max="9999" inputmode="numeric" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <div>
                    <label for="card_limit" class="block text-sm font-medium text-gray-600">卡片额度 (元)</label>
                    <input type="number" id="card_limit" placeholder="例如：50000" max="1000000" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <div>
                    <label for="billing_day" class="block text-sm font-medium text-gray-600">出账日 (每月x日)</label>
                    <input type="number" id="billing_day" placeholder="例如：5" min="1" max="31" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-600">还款日</label>
                    <div class="mt-1 flex items-center space-x-2">
                        <div id="payment-type-days-after" class="flex-1">
                            <div class="flex items-center space-x-2">
                                <span class="text-nowrap">账单日后</span>
                                <input type="number" id="payment_value_days" min="1" max="31" class="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="例如：20">
                                <span>天</span>
                            </div>
                        </div>
                        <div id="payment-type-fixed-day" class="hidden flex-1">
                            <div class="flex items-center space-x-2">
                                <span class="text-nowrap">每月固定</span>
                                <input type="number" id="payment_value_fixed" min="1" max="31" class="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="例如：15">
                                <span>日</span>
                            </div>
                        </div>
                        <button type="button" id="payment-type-toggle" class="p-2 bg-gray-100 rounded-lg">
                            <i data-lucide="repeat-2" class="w-5 h-5 text-gray-900"></i>
                        </button>
                    </div>
                    <input type="hidden" id="payment_type" value="days_after_billing">
                </div>
                
                <div>
                    <label for="grace_days" class="block text-sm font-medium text-gray-600">宽限期 (天)</label>
                    <input type="number" id="grace_days" placeholder="例如：3" min="0" max="31" value="0" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <div>
                    <label for="annual_fee" class="block text-sm font-medium text-gray-600">年费 (元)</label>
                    <input type="number" id="annual_fee" placeholder="例如：200。有年费则此卡被标注*号。" max="1000000" min="0" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>

                <div>
                    <label for="notes" class="block text-sm font-medium text-gray-600">备注</label>
                    <textarea id="notes" rows="3" maxlength="100" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="可选，最多100字..."></textarea>
                </div>

                <div class="pt-4">
                    <div id="form-buttons-add" class="flex space-x-4">
                        <button type="button" id="form-add-cancel" class="w-full bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-lg transition hover:bg-gray-100">取消</button>
                        <button type="submit" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg transition hover:bg-green-700">确认添加</button>
                    </div>
                    <div id="form-buttons-edit" class="hidden">
                        <div class="flex space-x-4">
                            <button type="button" id="form-delete-button" class="w-1/3 bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition hover:bg-red-800">删除</button>
                            <button type="submit" class="w-2/3 bg-blue-600 text-white font-bold py-3 px-4 rounded-lg transition hover:bg-blue-700">确认更新</button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <div id="toast" class=""></div>

    <script>
        // --- 客户端脚本 ---
        let allCards = [];
        let filteredCards = [];
        let currentSort = 'paymentDay';
        let calendarMode = 'paymentDay';
        let calendarDate = new Date();
        let adminToken = sessionStorage.getItem('adminToken') || null;
        let adminUsername = sessionStorage.getItem('adminUsername') || null;
        let currentEditingCard = null;

        const pages = {
            main: document.getElementById('page-main'),
            login: document.getElementById('page-login'),
            cardForm: document.getElementById('page-card-form'),
        };
        const authContainer = {
            loginButton: document.getElementById('login-button'),
            adminInfo: document.getElementById('admin-info'),
            adminUsername: document.getElementById('admin-username'),
            logoutButton: document.getElementById('logout-button'),
        };
        const stats = {
            totalCards: document.getElementById('stat-total-cards'),
            dueIn7: document.getElementById('stat-due-in-7'),
            maxGrace: document.getElementById('stat-max-grace'),
        };
        const calendar = {
            monthYear: document.getElementById('calendar-month-year'),
            toggleMode: document.getElementById('calendar-toggle-mode'),
            body: document.getElementById('calendar-body'),
            prevMonth: document.getElementById('calendar-prev-month'),
            nextMonth: document.getElementById('calendar-next-month'),
        };
        const list = {
            sortButton: document.getElementById('sort-toggle-button'),
            sortLabel: document.getElementById('sort-toggle-label'),
            container: document.getElementById('card-list'),
            searchBar: document.getElementById('search-bar'),
        };
        const form = {
            page: document.getElementById('page-card-form'),
            title: document.getElementById('form-title'),
            form: document.getElementById('card-form'),
            cardId: document.getElementById('card-id'),
            bankName: document.getElementById('bank_name'),
            last4: document.getElementById('last_4_digits'),
            limit: document.getElementById('card_limit'),
            billingDay: document.getElementById('billing_day'),
            paymentType: document.getElementById('payment_type'),
            paymentTypeDaysAfter: document.getElementById('payment-type-days-after'),
            paymentValueDays: document.getElementById('payment_value_days'),
            paymentTypeFixedDay: document.getElementById('payment-type-fixed-day'),
            paymentValueFixed: document.getElementById('payment_value_fixed'),
            paymentToggle: document.getElementById('payment-type-toggle'),
            graceDays: document.getElementById('grace_days'),
            annualFee: document.getElementById('annual_fee'),
            notes: document.getElementById('notes'),
            addButtons: document.getElementById('form-buttons-add'),
            editButtons: document.getElementById('form-buttons-edit'),
        };
        const exportBtn = document.getElementById('export-cards-btn');
        const addBtnContainer = document.getElementById('add-card-btn-container');
        
        function showPage(pageId) {
            Object.values(pages).forEach(page => page.classList.add('hidden'));
            if (pages[pageId]) {
                pages[pageId].classList.remove('hidden');
                window.scrollTo(0, 0);
            }
        }

        let toastTimer;
        function showToast(message, isError = false) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'show';
            toast.classList.add(isError ? 'error' : 'success');

            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toast.className = '';
            }, 3000);
        }

        function formatNumber(num) {
            try {
                return Number(num).toLocaleString();
            } catch (e) {
                return String(num);
            }
        }

        function getCardDates(card, refDate) {
            const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
            const todayDay = today.getDate();
            
            const billingDay = parseInt(card.billing_day);
            const paymentType = card.payment_type;
            const paymentValue = parseInt(card.payment_value);
            const graceDays = parseInt(card.grace_days || 0);

            let thisMonthBillingDate = new Date(today.getFullYear(), today.getMonth(), billingDay);
            let prevBillingDate, nextBillingDate;

            if (todayDay <= billingDay) {
                prevBillingDate = new Date(today.getFullYear(), today.getMonth() - 1, billingDay);
                nextBillingDate = thisMonthBillingDate;
            } else {
                prevBillingDate = thisMonthBillingDate;
                nextBillingDate = new Date(today.getFullYear(), today.getMonth() + 1, billingDay);
            }

            const deadlineForPrevBill = calculatePaymentDeadline(prevBillingDate, paymentType, paymentValue, graceDays);

            if (today > deadlineForPrevBill) {
                const deadlineForNextBill = calculatePaymentDeadline(nextBillingDate, paymentType, paymentValue, graceDays);
                const daysUntil = (deadlineForNextBill - today) / (1000 * 60 * 60 * 24);
                return {
                    nextBillingDate: nextBillingDate,
                    nextPaymentDeadline: deadlineForNextBill,
                    daysUntilPayment: Math.ceil(daysUntil),
                };
            } else {
                const daysUntil = (deadlineForPrevBill - today) / (1000 * 60 * 60 * 24);
                return {
                    nextBillingDate: prevBillingDate,
                    nextPaymentDeadline: deadlineForPrevBill,
                    daysUntilPayment: Math.ceil(daysUntil),
                };
            }
        }

        function calculatePaymentDeadline(billingDate, paymentType, paymentValue, graceDays) {
            let paymentDate = new Date(billingDate.getTime());
            
            if (paymentType === 'days_after_billing') {
                paymentDate.setDate(paymentDate.getDate() + paymentValue);
            } else {
                const billingDay = billingDate.getDate();
                if (paymentValue > billingDay) {
                    paymentDate.setDate(paymentValue);
                } else {
                    paymentDate.setMonth(paymentDate.getMonth() + 1);
                    paymentDate.setDate(paymentValue);
                }
            }
            // 暂时不考虑宽限期
            paymentDate.setDate(paymentDate.getDate() + graceDays -graceDays);
            return paymentDate;
        }

        function refreshDashboard() {
            const today = new Date();
            const cardsWithDates = filteredCards.map(card => {
                return {
                    ...card,
                    ...getCardDates(card, today),
                };
            });

            renderSummaryStats(cardsWithDates);
            renderCalendar(calendarDate);

            cardsWithDates.sort((a, b) => {
                if (currentSort === 'paymentDay') {
                    return a.daysUntilPayment - b.daysUntilPayment;
                } else {
                    const todayDay = today.getDate();
                    const aNextBill = a.billing_day < todayDay ? a.billing_day + 31 : a.billing_day;
                    const bNextBill = b.billing_day < todayDay ? b.billing_day + 31 : b.billing_day;
                    return aNextBill - bNextBill;
                }
            });

            renderCardList(cardsWithDates);
            updateAuthUI();
        }

        function renderSummaryStats(cardsWithDates) {
            stats.totalCards.textContent = \`\${allCards.length} 张\`;

            const dueIn7 = cardsWithDates.filter(c => c.daysUntilPayment >= 0 && c.daysUntilPayment <= 7).length;
            stats.dueIn7.textContent = \`\${dueIn7} 张\`;
            if (dueIn7 > 0) {
                stats.dueIn7.classList.add('text-red-500');
            } else {
                stats.dueIn7.classList.remove('text-red-500');
            }

            const totalCredit = allCards.reduce((sum, c) => {
                const v = Number(c.card_limit) || 0;
                return sum + v;
            }, 0);
            const totalInWanRounded = Math.round(totalCredit / 10000);
            stats.maxGrace.textContent = \`\${totalInWanRounded} 万元\`;
        }

        function renderCardList(cardsWithDates) {
            list.container.innerHTML = '';
            if (filteredCards.length === 0) {
                list.container.innerHTML = '<p class="text-gray-600 text-center py-4">没有找到信用卡。</p>';
                return;
            }

            cardsWithDates.forEach(card => {
                const row = document.createElement('div');
                row.className = 'bg-gray-50 p-3 rounded-lg grid grid-cols-7 gap-1 items-center text-xs';
                
                if (adminToken) {
                    row.classList.add('cursor-pointer', 'transition', 'hover:bg-gray-100');
                    row.onclick = () => showCardForm('edit', card);
                }

                const daysUntil = card.daysUntilPayment;
                let paymentText, paymentColor;
                if (daysUntil < 0) {
                    paymentText = \`已逾期 \${-daysUntil} 天\`;
                    paymentColor = 'text-red-400 font-bold';
                } else if (daysUntil <= 7) {
                    paymentText = \`剩余 \${daysUntil} 天\`;
                    paymentColor = 'text-orange-400 font-bold';
                } else {
                    paymentText = \`剩余 \${daysUntil} 天\`;
                    paymentColor = 'text-gray-600';
                }

                let bankNameHtml;
                const annualFeeVal = Number(card.annual_fee || 0);
                if (annualFeeVal > 0) {
                    bankNameHtml = \`<div class="font-bold text-sm text-black-900 truncate">\${card.bank_name}*</div>\`;
                } else {
                    bankNameHtml = \`<div class="font-bold text-sm text-gray-900 truncate">\${card.bank_name}</div>\`;
                }

                row.innerHTML = \`
                    <div class="col-span-3">
                        \${bankNameHtml}
                        <div class="text-xs text-gray-600">尾号 \${card.last_4_digits}</div>
                    </div>
                    <div class="col-span-1 text-center">
                        <div class="text-gray-900">\${card.billing_day} 日</div>
                    </div>
                    <div class="col-span-2 text-center">
                        <div class="text-gray-900">\${card.nextPaymentDeadline.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</div>
                        <div class="text-xs \${paymentColor}">\${paymentText}</div>
                    </div>
                    <div class="col-span-1 text-right">
                        <div class="text-gray-900">\${card.max_grace_period} 天</div>
                    </div>
                \`;
                list.container.appendChild(row);
            });
        }

        // 计算上个月的年与月
        function renderCalendar(date) {
            calendar.body.innerHTML = '';
            calendar.monthYear.textContent = \`\${date.getFullYear()} 年 \${date.getMonth() + 1} 月\`;
            
            const today = new Date();
            const month = date.getMonth();
            const year = date.getFullYear();
            
            const firstDayOfMonth = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const billingDays = new Set(allCards.map(c => {
                const raw = parseInt(c.billing_day);
                if (isNaN(raw)) return null;
                const clamped = Math.min(Math.max(1, raw), daysInMonth);
                return clamped;
            }).filter(x => x !== null));

            const paymentDays = new Set();

            allCards.forEach(c => {
                const paymentType = c.payment_type;
                const paymentValue = parseInt(c.payment_value);
                const graceDays = parseInt(c.grace_days || 0);
                const rawBillingDay = parseInt(c.billing_day);

                if (isNaN(rawBillingDay) || isNaN(paymentValue)) return;

                // 计算上个月的年/月并 clamp
                const prevMonth = (month === 0) ? 11 : (month - 1);
                const prevYear = (month === 0) ? (year - 1) : year;
                const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
                const billingDayPrevClamped = Math.min(Math.max(1, rawBillingDay), daysInPrevMonth);
                const billingDatePrev = new Date(prevYear, prevMonth, billingDayPrevClamped);

                const billingDayThisClamped = Math.min(Math.max(1, rawBillingDay), daysInMonth);
                const billingDateThis = new Date(year, month, billingDayThisClamped);

                const candidateBillingDates = [billingDatePrev, billingDateThis];

                candidateBillingDates.forEach(billingDate => {
                    const deadline = calculatePaymentDeadline(billingDate, paymentType, paymentValue, graceDays);
                    if (deadline.getFullYear() === year && deadline.getMonth() === month) {
                        paymentDays.add(deadline.getDate());
                    }
                });
            });

            for (let i = 0; i < firstDayOfMonth; i++) {
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day other-month';
                calendar.body.appendChild(dayEl);
            }

            for (let day = 1; day <= daysInMonth; day++) {
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day';
                dayEl.textContent = day;

                if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
                    dayEl.classList.add('today');
                }

                const isBilling = billingDays.has(day);
                const isPayment = paymentDays.has(day);

                if (calendarMode === 'billingDay' && isBilling) {
                    dayEl.classList.add('highlight-billing');
                } else if (calendarMode === 'paymentDay' && isPayment) {
                    dayEl.classList.add('highlight-payment');
                } else if (isBilling) {
                    dayEl.classList.add('opacity-90', 'bg-green-100');
                } else if (isPayment) {
                    dayEl.classList.add('opacity-90', 'bg-red-100');
                }
                
                calendar.body.appendChild(dayEl);
            }
        }
        
        function changeMonth(offset) {
            calendarDate.setMonth(calendarDate.getMonth() + offset);
            renderCalendar(new Date(calendarDate));
        }

        function toggleCalendarMode() {
            calendarMode = (calendarMode === 'paymentDay') ? 'billingDay' : 'paymentDay';
            renderCalendar(calendarDate);
            showToast(\`已切换到 \${calendarMode === 'paymentDay' ? '还款日' : '账单日'} 显示\`);
        }
        
        function toggleSort() {
            currentSort = (currentSort === 'paymentDay') ? 'billingDay' : 'paymentDay';
            list.sortLabel.textContent = (currentSort === 'paymentDay') ? '还款日' : '账单日';
            refreshDashboard();
            showToast(\`已按 \${currentSort === 'paymentDay' ? '还款日' : '账单日'} 排序\`);
        }
        
        function handleSearch() {
            const query = list.searchBar.value.toLowerCase().trim();
            if (!query) {
                filteredCards = [...allCards];
            } else {
                const keywords = query.split(/\\s+/);
                filteredCards = allCards.filter(card => {
                    const bankName = card.bank_name.toLowerCase();
                    return keywords.every(kw => bankName.includes(kw));
                });
            }
            refreshDashboard();
        }

        function updateAuthUI() {
            if (adminToken) {
                authContainer.loginButton.classList.add('hidden');
                authContainer.adminInfo.classList.remove('hidden');
                authContainer.adminUsername.textContent = adminUsername;
                addBtnContainer.classList.remove('hidden');
            } else {
                authContainer.loginButton.classList.remove('hidden');
                authContainer.adminInfo.classList.add('hidden');
                authContainer.adminUsername.textContent = '';
                addBtnContainer.classList.add('hidden');
            }
        }
        
        async function fetchCards() {
            try {
                const response = await fetch('/api/cards');
                const data = await response.json();
                if (data.success) {
                    allCards = data.cards;
                    handleSearch();
                } else {
                    showToast(data.message, true);
                }
            } catch (error) {
                showToast('加载数据失败', true);
            }
        }
        
        async function handleLogin(e) {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });

                const data = await response.json();
                if (data.success) {
                    adminToken = data.token;
                    adminUsername = data.username;
                    sessionStorage.setItem('adminToken', adminToken);
                    sessionStorage.setItem('adminUsername', adminUsername);
                    showToast('登录成功');
                    showPage('main');
                    fetchCards();
                } else {
                    showToast(data.message || '登录失败', true);
                }
            } catch (error) {
                showToast('登录请求失败', true);
            }
        }

        function handleLogout() {
            adminToken = null;
            adminUsername = null;
            sessionStorage.removeItem('adminToken');
            sessionStorage.removeItem('adminUsername');
            showToast('已退出登录');
            refreshDashboard();
        }
        
        function showCardForm(mode, card = null) {
            currentEditingCard = card;
            form.form.reset();

            if (mode === 'add') {
                form.title.textContent = '添加信用卡';
                form.addButtons.classList.remove('hidden');
                form.editButtons.classList.add('hidden');
                setPaymentTypeUI('days_after_billing'); 
                form.annualFee.value = '';
            } else {
                form.title.textContent = '管理信用卡信息';
                form.addButtons.classList.add('hidden');
                form.editButtons.classList.remove('hidden');
                
                form.cardId.value = card.id;
                form.bankName.value = card.bank_name;
                form.last4.value = parseInt(card.last_4_digits, 10);
                form.limit.value = card.card_limit;
                form.billingDay.value = card.billing_day;
                form.graceDays.value = card.grace_days;
                form.annualFee.value = card.annual_fee || '';
                form.notes.value = card.notes;
                
                setPaymentTypeUI(card.payment_type);
                if (card.payment_type === 'days_after_billing') {
                    form.paymentValueDays.value = card.payment_value;
                } else {
                    form.paymentValueFixed.value = card.payment_value;
                }
            }
            showPage('cardForm');
        }
        
        function togglePaymentTypeUI() {
            const currentType = form.paymentType.value;
            const newType = (currentType === 'days_after_billing') ? 'fixed_day' : 'days_after_billing';
            setPaymentTypeUI(newType);
        }

        function setPaymentTypeUI(type) {
            form.paymentType.value = type;
            if (type === 'days_after_billing') {
                form.paymentTypeDaysAfter.classList.remove('hidden');
                form.paymentTypeFixedDay.classList.add('hidden');
                form.paymentValueFixed.value = '';
            } else {
                form.paymentTypeDaysAfter.classList.add('hidden');
                form.paymentTypeFixedDay.classList.remove('hidden');
                form.paymentValueDays.value = '';
            }
        }

        async function handleFormSubmit(e) {
            e.preventDefault();
            if (!adminToken) {
                showToast('请先登录', true);
                return;
            }

            if ((form.bankName.value || '').trim() === '') {
                showToast('发卡银行不能为空', true);
                form.bankName.focus();
                return;
            }
            if ((form.last4.value || '').toString().trim() === '') {
                showToast('卡号后4位不能为空', true);
                form.last4.focus();
                return;
            }
            if ((form.limit.value || '').toString().trim() === '') {
                showToast('卡片额度不能为空', true);
                form.limit.focus();
                return;
            }
            if ((form.billingDay.value || '').toString().trim() === '') {
                showToast('出账日不能为空', true);
                form.billingDay.focus();
                return;
            }
            const paymentType = form.paymentType.value;
            const paymentValueRaw = (paymentType === 'days_after_billing') ? (form.paymentValueDays.value || '') : (form.paymentValueFixed.value || '');
            if (paymentValueRaw.toString().trim() === '') {
                showToast('还款日/天数不能为空', true);
                if (paymentType === 'days_after_billing') form.paymentValueDays.focus(); else form.paymentValueFixed.focus();
                return;
            }
            if ((form.graceDays.value || '').toString().trim() === '') {
                showToast('宽限期不能为空', true);
                form.graceDays.focus();
                return;
            }
            if ((form.annualFee.value || '').toString().trim() === '') {
                showToast('年费不能为空', true);
                form.annualFee.focus();
                return;
            }

            const last4Value = form.last4.value;
            const last4Num = parseInt(last4Value, 10);
            
            if (isNaN(last4Num) || last4Num < 0 || last4Num > 9999) {
                showToast('卡号后4位必须是0000到9999之间的数字', true);
                form.last4.focus();
                return;
            }
            const last4Padded = last4Value.padStart(4, '0').slice(-4);
            
            const bankName = form.bankName.value.trim();
            if (bankName.length === 0 || bankName.length > 10) {
                showToast('发卡银行不能为空且最多10个字符', true);
                form.bankName.focus();
                return;
            }
            
            const limit = parseInt(form.limit.value);
            if (isNaN(limit) || limit < 0 || limit > 1000000) {
                showToast('卡片额度必须是0到1,000,000之间的整数', true);
                form.limit.focus();
                return;
            }

            const billingDay = parseInt(form.billingDay.value);
            if (isNaN(billingDay) || billingDay < 1 || billingDay > 31) {
                showToast('出账日必须是1-31之间的整数', true);
                form.billingDay.focus();
                return;
            }

            const paymentValue = parseInt(paymentValueRaw);
            
            if (isNaN(paymentValue) || paymentValue < 1 || paymentValue > 31) {
                showToast('还款日/天数必须是1-31之间的整数', true);
                if (paymentType === 'days_after_billing') {
                     form.paymentValueDays.focus();
                } else {
                    form.paymentValueFixed.focus();
                }
                return;
            }
            
            const graceDays = parseInt(form.graceDays.value);
            if (isNaN(graceDays) || graceDays < 0 || graceDays > 31) {
                showToast('宽限期必须是0-31之间的整数', true);
                form.graceDays.focus();
                return;
            }

            const annualFee = parseInt(form.annualFee.value || '0');
            if (isNaN(annualFee) || annualFee < 0 || annualFee > 1000000) {
                showToast('年费必须是0到1,000,000之间的整数', true);
                form.annualFee.focus();
                return;
            }

            let payment_period_days;
            if (paymentType === 'days_after_billing') {
                payment_period_days = paymentValue;
            } else {
                if (paymentValue > billingDay) {
                    payment_period_days = (paymentValue - billingDay);
                } else {
                    payment_period_days = (30 - billingDay) + paymentValue;
                }
            }
            
            const calculatedMaxGrace = payment_period_days + 30;

            const cardData = {
                bank_name: bankName,
                last_4_digits: last4Padded,
                card_limit: limit,
                billing_day: billingDay,
                payment_type: paymentType,
                payment_value: paymentValue,
                grace_days: graceDays,
                max_grace_period: calculatedMaxGrace,
                annual_fee: annualFee,
                notes: form.notes.value.substring(0, 100)
            };
            
            let url = '/api/cards';
            let method = 'POST';
            
            if (currentEditingCard) {
                url = \`/api/cards/\${currentEditingCard.id}\`;
                method = 'PUT';
            }

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': \`Bearer \${adminToken}\`
                    },
                    body: JSON.stringify(cardData)
                });
                
                const data = await response.json();
                if (data.success) {
                    showToast(currentEditingCard ? '更新成功' : '添加成功');
                    currentEditingCard = null;
                    showPage('main');
                    fetchCards();
                } else {
                    showToast(data.message || '操作失败', true);
                }
            } catch (error) {
                showToast('请求失败', true);
            }
        }
        
        async function handleDeleteCard() {
            if (!currentEditingCard || !adminToken) return;
            const userConfirmed = confirm(\`确定要删除 \${currentEditingCard.bank_name} (尾号 \${currentEditingCard.last_4_digits}) 吗？\`);
            if (!userConfirmed) return;

            try {
                const response = await fetch(\`/api/cards/\${currentEditingCard.id}\`, {
                    method: 'DELETE',
                    headers: { 'Authorization': \`Bearer \${adminToken}\` }
                });
                
                const data = await response.json();
                if (data.success) {
                    showToast('删除成功');
                    currentEditingCard = null;
                    showPage('main');
                    fetchCards();
                } else {
                    showToast(data.message || '删除失败', true);
                }
            } catch (error) {
                showToast('请求失败', true);
            }
        }

        async function exportCardsToExcel() {
            try {
                let cards = allCards && allCards.length ? allCards : [];
                if (!cards.length) {
                    const resp = await fetch('/api/cards');
                    const data = await resp.json();
                    if (data.success) {
                        cards = data.cards;
                    } else {
                        showToast(data.message || '获取数据失败', true);
                        return;
                    }
                }

                const headers = ['ID', '发卡银行', '卡号后4位', '卡片额度(元)', '出账日', '还款类型', '还款值', '宽限期(天)', '最长免息期(天)', '年费(元)', '备注'];
                let table = '<table border="1"><thead><tr>';
                headers.forEach(h => {
                    table += '<th style="background-color:#f0f0f0;padding:4px;">' + h + '</th>';
                });
                table += '</tr></thead><tbody>';

                cards.forEach(c => {
                    table += '<tr>';
                    table += '<td>' + (c.id ?? '') + '</td>';
                    table += '<td>' + (escapeHtml(c.bank_name) ?? '') + '</td>';
                    table += '<td>' + (c.last_4_digits ?? '') + '</td>';
                    table += '<td>' + (c.card_limit ?? '') + '</td>';
                    table += '<td>' + (c.billing_day ?? '') + '</td>';
                    table += '<td>' + (c.payment_type ?? '') + '</td>';
                    table += '<td>' + (c.payment_value ?? '') + '</td>';
                    table += '<td>' + (c.grace_days ?? '') + '</td>';
                    table += '<td>' + (c.max_grace_period ?? '') + '</td>';
                    table += '<td>' + (c.annual_fee ?? '') + '</td>';
                    table += '<td>' + (escapeHtml(c.notes) ?? '') + '</td>';
                    table += '</tr>';
                });

                table += '</tbody></table>';

                const bom = '\uFEFF';
                const blob = new Blob([bom + table], { type: 'application/vnd.ms-excel;charset=utf-8' });

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                a.href = url;
                a.download = \`credit_cards_\${y}\${m}\${d}.xls\`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                showToast('导出已开始');
            } catch (err) {
                console.error(err);
                showToast('导出失败', true);
            }
        }

        function escapeHtml(str) {
            if (str == null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        document.addEventListener('DOMContentLoaded', () => {
            authContainer.loginButton.onclick = () => showPage('login');
            document.getElementById('login-cancel-button').onclick = () => showPage('main');
            document.getElementById('login-form-cancel').onclick = () => showPage('main');
            document.getElementById('add-card-btn-main').onclick = () => showCardForm('add');
            document.getElementById('form-cancel-button').onclick = () => showPage('main');
            document.getElementById('form-add-cancel').onclick = () => showPage('main');
            
            document.getElementById('login-form').onsubmit = handleLogin;
            authContainer.logoutButton.onclick = handleLogout;
            
            calendar.prevMonth.onclick = () => changeMonth(-1);
            calendar.nextMonth.onclick = () => changeMonth(1);
            calendar.toggleMode.onclick = toggleCalendarMode;
            calendar.body.onclick = toggleCalendarMode;
            list.sortButton.onclick = toggleSort;
            list.searchBar.oninput = handleSearch;
            
            form.paymentToggle.onclick = togglePaymentTypeUI;
            form.form.onsubmit = handleFormSubmit;
            document.getElementById('form-delete-button').onclick = handleDeleteCard;

            if (exportBtn) {
                exportBtn.onclick = exportCardsToExcel;
            }

            fetchCards();
            lucide.createIcons();
            updateAuthUI();
        });

    </script>
</body>
</html>
  `;
}
