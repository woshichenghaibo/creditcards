// 这是一个完整的 Cloudflare Worker 脚本
// 它包含后端 API 逻辑 和 前端 HTML/CSS/JS

// =============================================
// 后端 API 路由
// =============================================

// 定义一个简单的静态令牌用于管理员认证
// 在实际生产中，您应该使用更安全的方法（如 JWT），但对于个人项目和“临时登录”的要求，这足够简单
const ADMIN_TOKEN = "secret-admin-token-12345";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      // 1. 路由：提供前端页面
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(getHtml(env), {
          headers: { 'Content-Type': 'text/html;charset=utf-8' },
        });
      }

      // 2. 路由：API - 管理员登录
      if (url.pathname === '/api/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // 3. 路由：API - 获取所有信用卡
      if (url.pathname === '/api/cards' && request.method === 'GET') {
        return getCards(request, env);
      }

      // 4. 路由：API - 添加新信用卡 (受保护)
      if (url.pathname === '/api/cards' && request.method === 'POST') {
        if (!checkAuth(request)) return new Response('Unauthorized', { status: 401 });
        return addCard(request, env);
      }

      // 匹配 /api/cards/:id
      const cardMatch = url.pathname.match(/^\/api\/cards\/(\d+)$/);

      // 5. 路由：API - 更新信用卡 (受保护)
      if (cardMatch && request.method === 'PUT') {
        if (!checkAuth(request)) return new Response('Unauthorized', { status: 401 });
        const id = cardMatch[1];
        return updateCard(request, env, id);
      }

      // 6. 路由：API - 删除信用卡 (受保护)
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
};

// =============================================
// API 处理器
// =============================================

/**
 * 检查管理员认证
 */
function checkAuth(request) {
  const authHeader = request.headers.get('Authorization');
  return authHeader === `Bearer ${ADMIN_TOKEN}`;
}

/**
 * 处理管理员登录
 */
async function handleLogin(request, env) {
  try {
    const { username, password } = await request.json();
    
    // 从环境变量中获取用户名和密码
    const envUser = env.USERNAME;
    const envPass = env.PASSWORD;

    if (username === envUser && password === envPass) {
      // 登录成功
      return Response.json({
        success: true,
        token: ADMIN_TOKEN, // 发送回客户端
        username: envUser,
      });
    } else {
      // 登录失败
      return Response.json({ success: false, message: '用户名或密码错误' }, { status: 401 });
    }
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 400 });
  }
}

/**
 * API: 获取所有信用卡
 */
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

/**
 * API: 添加新信用卡
 */
async function addCard(request, env) {
  try {
    const card = await request.json();
    
    // 后端验证: 银行名称
    if (!card.bank_name) {
      return Response.json({ success: false, message: '发卡银行不能为空' }, { status: 400 });
    }
    
    // 后端验证: 卡号后4位 (0000-9999)
    const last4 = card.last_4_digits;
    // 检查是否是字符串（客户端会补零），且长度为4
    if (typeof last4 !== 'string' || last4.length !== 4) {
        return Response.json({ success: false, message: '卡号后4位格式错误 (非4位)' }, { status: 400 });
    }
    const last4Num = parseInt(last4, 10);
    if (isNaN(last4Num) || last4Num < 0 || last4Num > 9999) {
        return Response.json({ success: false, message: '卡号后4位超出有效范围 (0000-9999)' }, { status: 400 });
    }
    // 校验通过

    await env.DB.prepare(
      `INSERT INTO credit_cards (bank_name, last_4_digits, card_limit, billing_day, 
      payment_type, payment_value, grace_days, max_grace_period, notes) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      card.notes
    )
    .run();

    return Response.json({ success: true, message: '添加成功' });
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 500 });
  }
}

/**
 * API: 更新信用卡
 */
async function updateCard(request, env, id) {
  try {
    const card = await request.json();
    
    // 后端验证: 银行名称
    if (!card.bank_name) {
      return Response.json({ success: false, message: '发卡银行不能为空' }, { status: 400 });
    }

    // 后端验证: 卡号后4位 (0000-9999)
    const last4 = card.last_4_digits;
    // 检查是否是字符串（客户端会补零），且长度为4
    if (typeof last4 !== 'string' || last4.length !== 4) {
        return Response.json({ success: false, message: '卡号后4位格式错误 (非4位)' }, { status: 400 });
    }
    const last4Num = parseInt(last4, 10);
    if (isNaN(last4Num) || last4Num < 0 || last4Num > 9999) {
        return Response.json({ success: false, message: '卡号后4位超出有效范围 (0000-9999)' }, { status: 400 });
    }
    // 校验通过

    await env.DB.prepare(
      `UPDATE credit_cards SET bank_name = ?, last_4_digits = ?, card_limit = ?, 
      billing_day = ?, payment_type = ?, payment_value = ?, grace_days = ?, 
      max_grace_period = ?, notes = ? WHERE id = ?`
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
      card.notes,
      id
    )
    .run();

    return Response.json({ success: true, message: '更新成功' });
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 500 });
  }
}

/**
 * API: 删除信用卡
 */
async function deleteCard(request, env, id) {
  try {
    await env.DB.prepare('DELETE FROM credit_cards WHERE id = ?').bind(id).run();
    return Response.json({ success: true, message: '删除成功' });
  } catch (e) {
    return Response.json({ success: false, message: e.message }, { status: 500 });
  }
}

// =============================================
// 前端 HTML, CSS, JS
// =============================================

/**
 * 返回单页应用(SPA)的完整 HTML
 */
function getHtml(env) {
  // 注意： env.DOMAIN 变量在这里被注入到 HTML 中 (虽然您说暂时不用)
  // const domain = env.DOMAIN || 'your-domain.com';

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
        white-space: nowrap; /* 防止文本换行 */
        overflow: hidden; /* 隐藏溢出的内容 */
        letter-spacing: -0.2px;/* 字符间距略小 */
    }
    </style>

<!-- 返回顶部按钮 -->
<button id="topBtn" class="top-btn" 
    style="display: none; position: fixed; bottom: 20px; right: 20px; z-index: 9999; 
           background-color: #ffcc00; color: white; border: none; border-radius: 50%; 
           width: 40px; height: 40px; font-size: 20px; display: flex; 
           align-items: center; justify-content: center; cursor: pointer;">
    ▲
</button>

<script>
    // 获取返回顶部按钮
    const topBtn = document.getElementById('topBtn');

    // 当DOM加载完成后执行
    document.addEventListener('DOMContentLoaded', function() {
        // 监听滚动事件
        window.onscroll = function() { scrollFunction(); };

        // 显示或隐藏返回顶部按钮
        function scrollFunction() {
            if (document.body.scrollTop > 70 || document.documentElement.scrollTop > 70) {
                topBtn.style.display = "block";
            } else {
                topBtn.style.display = "none";
            }
        }

        // 点击按钮时滚动到顶部
        topBtn.addEventListener('click', function() {
            document.body.scrollTop = 0; // 对于 Safari
            document.documentElement.scrollTop = 0; // 对于 Chrome, Firefox, IE 和 Opera
        });
    });
</script>

<script>
    document.querySelectorAll('.status.cards .thirteen.wide.column').forEach(element => {
        element.textContent = element.textContent.replace(/Cores/g, 'C');
    });
</script>
    
    
    <!-- 引入 Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- 引入 Lucide Icons -->
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        /* 深色主题和基本样式 */
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            -webkit-tap-highlight-color: transparent; /* 移除移动端点击高亮 */
        }
        
        /* 日历样式 */
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
            background-color: #4a5568; /* gray-700 */
            color: white;
            font-weight: bold;
        }
        .calendar-day.other-month {
            color: #4a5568; /* gray-700 */
        }
        .calendar-day.highlight-billing {
            background-color: #38a169; /* green-600 */
            color: white;
        }
        .calendar-day.highlight-payment {
            background-color: #e53e3e; /* red-600 */
            color: white;
        }
        
        /* Toast 消息提示 */
        #toast {
            position: fixed;
            top: 30px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 15px;
            border-radius: 8px;
            color: white;
            z-index: 100;
            opacity: 0;
            transition: opacity 0.3s, top 0.3s;
            visibility: hidden;
            /* 新增样式 - 推荐这个组合 */
            min-width: 300px; /* 设置最小宽度 */
            max-width: 70vw; /* 最大宽度为视口宽度的80% */
            */
            white-space: nowrap; /* 禁止文本换行 */
            overflow: hidden; /* 隐藏溢出的文本 */
            text-overflow: ellipsis; /* 超出的文本显示省略号 */
            text-align: center;
        }
        #toast.show {
            opacity: 1;
            top: 40px;
            visibility: visible;
        }
        #toast.success {
            background-color: #38a169; /* green-600 */
        }
        #toast.error {
            background-color: #e53e3e; /* red-600 */
        }

        /* 隐藏数字输入框的箭头 */
        input[type=number]::-webkit-inner-spin-button, 
        input[type=number]::-webkit-outer-spin-button { 
            -webkit-appearance: none; 
            margin: 0; 
        }
        input[type=number] {
            -moz-appearance: textfield;
        }
    </style>
</head>
<body class="bg-white text-gray-900">

    <!-- 主容器 -->
    <div class="max-w-md mx-auto min-h-screen bg-white pb-16">

        <!-- ====================== -->
        <!-- 1. 主页面 (卡片概览)   -->
        <!-- ====================== -->
        <div id="page-main">
            <!-- 顶部栏 -->
            <header class="flex justify-between items-center p-4">
            <a href="https://github.com/woshichenghaibo/creditcards" target="_blank" class="text-xl font-bold">我的信用卡概览</a>
                <div id="auth-container">
                    <!-- 未登录状态 -->
                    <button id="login-button" class="cursor-pointer">
                        <i data-lucide="log-in" class="w-5 h-5"></i>
                    </button>
                    <!-- 已登录状态 (默认隐藏) -->
                    <div id="admin-info" class="hidden flex items-center space-x-2">
                        <span id="admin-username" class="text-sm"></span>
                        <button id="logout-button" class="cursor-pointer">
                            <i data-lucide="log-out" class="w-5 h-5 text-red-500"></i>
                        </button>
                    </div>
                </div>
            </header>

            <!-- 统计概览 -->
            <div class="grid grid-cols-3 gap-3 px-4">
                <div class="bg-gray-50 p-3 rounded-lg text-center">
                    <div class="text-sm text-gray-600">卡片总数</div>
                    <div id="stat-total-cards" class="text-2xl font-bold">0 张</div>
                </div>
                <div class="bg-gray-50 p-3 rounded-lg text-center">
                    <div class="text-sm text-gray-600">7日内待还</div>
                    <div id="stat-due-in-7" class="text-2xl font-bold">0 张</div>
                </div>
                <div class="bg-gray-50 p-3 rounded-lg text-center">
                    <div class="text-sm text-gray-600">最长免息期</div>
                    <div id="stat-max-grace" class="text-2xl font-bold">0 天</div>
                </div>
            </div>

            <!-- 搜索栏 -->
            <div class="px-4 mt-4">
                <div class="relative">
                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <i data-lucide="search" class="w-5 h-5 text-gray-600"></i>
                    </div>
                    <input type="search" id="search-bar" class="w-full bg-white border border-gray-300 rounded-lg pl-10 pr-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="搜索银行名称">
                </div>
            </div>

            <!-- 日历控件 -->
            <div class="px-4 mt-4">
                <div class="bg-gray-50 p-4 rounded-lg">
                    <!-- 日历头部 -->
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
                    <!-- 日历网格 -->
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
                        <!-- 日期单元格将由 JS 填充 -->
                    </div>
                    <!-- 图例 -->
                    <div class="text-xs text-gray-600 mt-3 flex justify-center items-center space-x-4">
                    <span class="flex items-center"><span class="w-3 h-3 bg-gray-600 rounded-full mr-1"></span> 今日</span>    
                    <span class="flex items-center"><span class="w-3 h-3 bg-green-600 rounded-full mr-1"></span> 账单日</span>
                    <span class="flex items-center"><span class="w-3 h-3 bg-red-600 rounded-full mr-1"></span> 还款日</span>
                    </div>
                </div>
            </div>

            <!-- 信用卡列表 -->
            <div class="px-4 mt-4">
                <!-- 列表头部 -->
                <div class="flex justify-between items-center mb-2">
                    <h2 class="text-lg font-bold">信用卡列表</h2>
                    <button id="sort-toggle-button" class="text-sm text-blue-400 flex items-center">
                        <span id="sort-toggle-label">还款日</span>
                        <i data-lucide="chevrons-up-down" class="w-4 h-4 ml-1"></i>
                    </button>
                </div>

                <!-- 列表表头: 调整为 grid-cols-7，重新分配列宽 -->
                <div class="grid grid-cols-7 gap-1 text-xs text-gray-600 px-3 py-2">
                    <div class="col-span-3">银行/尾号</div>
                    <div class="col-span-1 text-center">账单日</div>
                    <div class="col-span-2 text-center">还款日</div>
                    <div class="col-span-1 text-right">免息期</div>
                </div>

                <!-- 列表内容 -->
                <div id="card-list" class="space-y-2">
                    <!-- 卡片条目将由 JS 填充 -->
                </div>
            </div>

            <!-- 添加按钮 (固定在底部) -->
            <div id="add-card-btn-container" class="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-white bg-opacity-90 backdrop-blur-sm">
                <button id="add-card-btn-main" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition hover:bg-green-700">
                    <i data-lucide="plus-circle" class="w-5 h-5"></i>
                    <span>添加信用卡信息</span>
                </button>
            </div>

        </div>

        <!-- ====================== -->
        <!-- 2. 管理员登录页面      -->
        <!-- ====================== -->
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

        <!-- ====================== -->
        <!-- 3. 添加/编辑卡片页面   -->
        <!-- ====================== -->
        <div id="page-card-form" class="hidden p-4">
            <header class="flex justify-between items-center mb-6">
                <h1 id="form-title" class="text-xl font-bold">添加信用卡</h1>
                <button id="form-cancel-button">
                    <i data-lucide="x" class="w-6 h-6 text-gray-900"></i>
                </button>
            </header>
            
            <form id="card-form" class="space-y-4">
                <input type="hidden" id="card-id">
                
                <!-- 银行名称 -->
                <div>
                    <label for="bank_name" class="block text-sm font-medium text-gray-600">发卡银行</label>
                    <input type="text" id="bank_name" placeholder="例如：招商银行" maxlength="10" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <!-- 尾号 -->
                <div>
                    <label for="last_4_digits" class="block text-sm font-medium text-gray-600">卡号后4位 (0000-9999)</label>
                    <!-- 更改为 type="number" 并设置 min/max 限制 -->
                    <input type="number" id="last_4_digits" placeholder="例如：8888" min="0" max="9999" inputmode="numeric" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <!-- 额度 -->
                <div>
                    <label for="card_limit" class="block text-sm font-medium text-gray-600">卡片额度 (元)</label>
                    <input type="number" id="card_limit" placeholder="例如：50000" max="1000000" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <!-- 账单日 -->
                <div>
                    <label for="billing_day" class="block text-sm font-medium text-gray-600">出账日 (每月x日)</label>
                    <input type="number" id="billing_day" placeholder="1-31" min="1" max="31" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <!-- 还款日 -->
                <div>
                    <label class="block text-sm font-medium text-gray-600">还款日</label>
                    <div class="mt-1 flex items-center space-x-2">
                        <!-- 模式一: 账单日后xx天 -->
                        <div id="payment-type-days-after" class="flex-1">
                            <div class="flex items-center space-x-2">
                                <span class="text-nowrap">账单日后</span>
                                <input type="number" id="payment_value_days" min="1" max="31" class="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="20">
                                <span>天</span>
                            </div>
                        </div>
                        <!-- 模式二: 每月固定xx日 -->
                        <div id="payment-type-fixed-day" class="hidden flex-1">
                            <div class="flex items-center space-x-2">
                                <span class="text-nowrap">每月固定</span>
                                <input type="number" id="payment_value_fixed" min="1" max="31" class="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="15">
                                <span>日</span>
                            </div>
                        </div>
                        <!-- 切换按钮 -->
                        <button type="button" id="payment-type-toggle" class="p-2 bg-gray-100 rounded-lg">
                            <i data-lucide="repeat-2" class="w-5 h-5 text-gray-900"></i>
                        </button>
                    </div>
                    <input type="hidden" id="payment_type" value="days_after_billing">
                </div>
                
                <!-- 宽限期 -->
                <div>
                    <label for="grace_days" class="block text-sm font-medium text-gray-600">宽限期 (天)</label>
                    <input type="number" id="grace_days" placeholder="例如：3" min="0" max="31" value="0" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                </div>

                <!-- 备注 -->
                <div>
                    <label for="notes" class="block text-sm font-medium text-gray-600">备注</label>
                    <textarea id="notes" rows="3" maxlength="100" class="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="可选，最多100字..."></textarea>
                </div>

                <!-- 按钮组 -->
                <div class="pt-4">
                    <!-- 添加模式按钮 -->
                    <div id="form-buttons-add" class="flex space-x-4">
                        <button type="button" id="form-add-cancel" class="w-full bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-lg transition hover:bg-gray-100">取消</button>
                        <button type="submit" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg transition hover:bg-green-700">确认添加</button>
                    </div>
                    <!-- 编辑模式按钮 -->
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

    <!-- Toast 提示框 -->
    <div id="toast" class=""></div>

    <!-- ============================================= -->
    <!-- 客户端 JavaScript                               -->
    <!-- ============================================= -->
    <script>
        // 全局状态
        let allCards = [];
        let filteredCards = [];
        let currentSort = 'paymentDay'; // 'paymentDay' 或 'billingDay'
        let calendarMode = 'paymentDay'; // 'paymentDay' 或 'billingDay'
        let calendarDate = new Date(); // 日历当前显示的月份
        let adminToken = sessionStorage.getItem('adminToken') || null;
        let adminUsername = sessionStorage.getItem('adminUsername') || null;
        let currentEditingCard = null; // 用于编辑模式

        // DOM 元素引用
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
            // maxGracePeriod 字段已从表单中移除
            notes: document.getElementById('notes'),
            addButtons: document.getElementById('form-buttons-add'),
            editButtons: document.getElementById('form-buttons-edit'),
        };
        
        // --- 页面导航 ---
        function showPage(pageId) {
            Object.values(pages).forEach(page => page.classList.add('hidden'));
            if (pages[pageId]) {
                pages[pageId].classList.remove('hidden');
                window.scrollTo(0, 0); // 切换页面时滚动到顶部
            }
        }

        // --- Toast 提示 ---
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

        // --- 核心日期计算逻辑 ---
        
        /**
         * 获取指定卡片的下一个账单日和还款截止日
         * @param {object} card - 信用卡对象
         * @param {Date} refDate - 参考日期 (通常是 "today")
         * @returns {object} { nextBillingDate, nextPaymentDeadline, daysUntilPayment }
         */
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
                // 这个月的账单日还没到
                prevBillingDate = new Date(today.getFullYear(), today.getMonth() - 1, billingDay);
                nextBillingDate = thisMonthBillingDate;
            } else {
                // 这个月的账单日已经过了
                prevBillingDate = thisMonthBillingDate;
                nextBillingDate = new Date(today.getFullYear(), today.getMonth() + 1, billingDay);
            }

            // 计算 "上个账单" 的还款截止日
            const deadlineForPrevBill = calculatePaymentDeadline(prevBillingDate, paymentType, paymentValue, graceDays);

            if (today > deadlineForPrevBill) {
                // 上个账单的还款日已过，计算 "下个账单" 的还款截止日
                const deadlineForNextBill = calculatePaymentDeadline(nextBillingDate, paymentType, paymentValue, graceDays);
                const daysUntil = (deadlineForNextBill - today) / (1000 * 60 * 60 * 24);
                return {
                    nextBillingDate: nextBillingDate,
                    nextPaymentDeadline: deadlineForNextBill,
                    daysUntilPayment: Math.ceil(daysUntil),
                };
            } else {
                // "上个账单" 仍是当前活跃的还款周期
                const daysUntil = (deadlineForPrevBill - today) / (1000 * 60 * 60 * 24);
                return {
                    nextBillingDate: prevBillingDate, // 关联的账单日
                    nextPaymentDeadline: deadlineForPrevBill,
                    daysUntilPayment: Math.ceil(daysUntil),
                };
            }
        }

        /**
         * 辅助函数：根据账单日计算还款截止日
         */
        function calculatePaymentDeadline(billingDate, paymentType, paymentValue, graceDays) {
            let paymentDate = new Date(billingDate.getTime());
            
            if (paymentType === 'days_after_billing') {
                paymentDate.setDate(paymentDate.getDate() + paymentValue);
            } else { // fixed_day
                const billingDay = billingDate.getDate();
                if (paymentValue > billingDay) {
                    // 还款日在账单日同月
                    paymentDate.setDate(paymentValue);
                } else {
                    // 还款日在账单日次月
                    paymentDate.setMonth(paymentDate.getMonth() + 1);
                    paymentDate.setDate(paymentValue);
                }
            }
            
            // 加上宽限期
            paymentDate.setDate(paymentDate.getDate() + graceDays);
            return paymentDate;
        }

        // --- 渲染函数 ---

        /**
         * 刷新整个仪表板
         */
        function refreshDashboard() {
            // 1. (重新)计算所有卡片日期
            const today = new Date();
            const cardsWithDates = filteredCards.map(card => {
                return {
                    ...card,
                    ...getCardDates(card, today),
                };
            });

            // 2. 渲染统计
            renderSummaryStats(cardsWithDates);

            // 3. 渲染日历 (使用 allCards, 不受搜索过滤影响)
            renderCalendar(calendarDate);

            // 4. 排序
            cardsWithDates.sort((a, b) => {
                if (currentSort === 'paymentDay') {
                    return a.daysUntilPayment - b.daysUntilPayment;
                } else { // billingDay
                    // 比较下一个账单日
                    const todayDay = today.getDate();
                    const aNextBill = a.billing_day < todayDay ? a.billing_day + 31 : a.billing_day;
                    const bNextBill = b.billing_day < todayDay ? b.billing_day + 31 : b.billing_day;
                    return aNextBill - bNextBill;
                }
            });

            // 5. 渲染列表
            renderCardList(cardsWithDates);

            // 6. 更新认证状态
            updateAuthUI();
        }

        /**
         * 渲染统计概览
         */
        function renderSummaryStats(cardsWithDates) {
            stats.totalCards.textContent = \`\${allCards.length} 张\`;

            const dueIn7 = cardsWithDates.filter(c => c.daysUntilPayment >= 0 && c.daysUntilPayment <= 7).length;
            stats.dueIn7.textContent = \`\${dueIn7} 张\`;
            if (dueIn7 > 0) {
                stats.dueIn7.classList.add('text-red-500');
            } else {
                stats.dueIn7.classList.remove('text-red-500');
            }

            // FIX: "最长免息期"统计应从所有卡片中找最大值 (基于数据库存储的值)
            const maxGrace = allCards.reduce((max, c) => (c.max_grace_period > max ? c.max_grace_period : max), 0);
            stats.maxGrace.textContent = \`\${Math.max(0, maxGrace)} 天\`;
        }

        /**
         * 渲染卡片列表
         */
        function renderCardList(cardsWithDates) {
            list.container.innerHTML = ''; // 清空列表
            if (filteredCards.length === 0) {
                list.container.innerHTML = '<p class="text-gray-600 text-center py-4">没有找到信用卡。</p>';
                return;
            }

            cardsWithDates.forEach(card => {
                const row = document.createElement('div');
                // *** 核心改动: grid-cols-7, 适应新的 3-1-2-1 比例 ***
                row.className = 'bg-gray-50 p-3 rounded-lg grid grid-cols-7 gap-1 items-center text-xs';
                
                // 如果已登录，添加点击事件
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
                    paymentColor = 'text-yellow-400 font-bold';
                } else {
                    paymentText = \`剩余 \${daysUntil} 天\`;
                    paymentColor = 'text-gray-600';
                }

                row.innerHTML = \`
                    <!-- 银行/尾号: col-span-3 (原 2/5 -> 3/7) -->
                    <div class="col-span-3">
                        <div class="font-bold text-sm text-gray-900 truncate">\${card.bank_name}</div>
                        <div class="text-xs text-gray-600">尾号 \${card.last_4_digits}</div>
                    </div>
                    <!-- 账单日: col-span-1 (原 1/5 -> 1/7) -->
                    <div class="col-span-1 text-center">
                        <div class="text-gray-900">\${card.billing_day} 日</div>
                    </div>
                    <!-- 还款日: col-span-2 (原 1/5 -> 2/7) -->
                    <div class="col-span-2 text-center">
                        <div class="text-gray-900">\${card.nextPaymentDeadline.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</div>
                        <div class="text-xs \${paymentColor}">\${paymentText}</div>
                    </div>
                    <!-- 免息期: col-span-1 (原 1/5 -> 1/7) -->
                    <div class="col-span-1 text-right">
                        <div class="text-gray-900">\${card.max_grace_period} 天</div>
                    </div>
                \`;
                list.container.appendChild(row);
            });
        }

        /**
         * 渲染日历
         */
        function renderCalendar(date) {
            calendar.body.innerHTML = '';
            calendar.monthYear.textContent = \`\${date.getFullYear()} 年 \${date.getMonth() + 1} 月\`;
            
            const today = new Date();
            const month = date.getMonth();
            const year = date.getFullYear();
            
            const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0-6 (Sun-Sat)
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            // 预先计算本月高亮日期
            // 简化：只高亮 "固定" 的日期，不动态计算 "账单日后xx天"
            const billingDays = new Set(allCards.map(c => parseInt(c.billing_day)));
            const paymentDays = new Set(allCards
                .filter(c => c.payment_type === 'fixed_day')
                .map(c => parseInt(c.payment_value))
            );

            // 填充上个月的空白
            for (let i = 0; i < firstDayOfMonth; i++) {
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day other-month';
                calendar.body.appendChild(dayEl);
            }

            // 填充本月日期
            for (let day = 1; day <= daysInMonth; day++) {
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day';
                dayEl.textContent = day;

                // 标记今天
                if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
                    dayEl.classList.add('today');
                }

                // 高亮
                const isBilling = billingDays.has(day);
                const isPayment = paymentDays.has(day);

                if (calendarMode === 'billingDay' && isBilling) {
                    dayEl.classList.add('highlight-billing');
                } else if (calendarMode === 'paymentDay' && isPayment) {
                    dayEl.classList.add('highlight-payment');
                } else if (isBilling) {
                    dayEl.classList.add('opacity-50', 'bg-green-50'); // 弱显示
                } else if (isPayment) {
                    dayEl.classList.add('opacity-50', 'bg-red-50'); // 弱显示
                }
                
                calendar.body.appendChild(dayEl);
            }
        }
        
        /**
         * 切换日历月份
         */
        function changeMonth(offset) {
            calendarDate.setMonth(calendarDate.getMonth() + offset);
            renderCalendar(new Date(calendarDate));
        }

        /**
         * 切换日历高亮模式
         */
        function toggleCalendarMode() {
            calendarMode = (calendarMode === 'paymentDay') ? 'billingDay' : 'paymentDay';
            renderCalendar(calendarDate);
            showToast(\`已切换到 \${calendarMode === 'paymentDay' ? '还款日' : '账单日'} 显示\`);
        }
        
        /**
         * 切换卡片列表排序
         */
        function toggleSort() {
            currentSort = (currentSort === 'paymentDay') ? 'billingDay' : 'paymentDay';
            list.sortLabel.textContent = (currentSort === 'paymentDay') ? '还款日' : '账单日';
            refreshDashboard();
            showToast(\`已按 \${currentSort === 'paymentDay' ? '还款日' : '账单日'} 排序\`);
        }
        
        /**
         * 处理搜索
         */
        function handleSearch() {
            const query = list.searchBar.value.toLowerCase().trim();
            if (!query) {
                filteredCards = [...allCards];
            } else {
                const keywords = query.split(/\\s+/); // 按空格拆分关键词
                filteredCards = allCards.filter(card => {
                    const bankName = card.bank_name.toLowerCase();
                    // 必须匹配所有关键词
                    return keywords.every(kw => bankName.includes(kw));
                });
            }
            refreshDashboard();
        }

        // --- 认证 和 API 调用 ---
        
        /**
         * 更新顶部认证区域UI
         */
        function updateAuthUI() {
            if (adminToken) {
                authContainer.loginButton.classList.add('hidden');
                authContainer.adminInfo.classList.remove('hidden');
                authContainer.adminUsername.textContent = adminUsername;
                document.getElementById('add-card-btn-container').classList.remove('hidden'); // 显示添加按钮
            } else {
                authContainer.loginButton.classList.remove('hidden');
                authContainer.adminInfo.classList.add('hidden');
                authContainer.adminUsername.textContent = '';
                document.getElementById('add-card-btn-container').classList.add('hidden'); // 隐藏添加按钮
            }
        }
        
        /**
         * 异步获取卡片数据
         */
        async function fetchCards() {
            try {
                const response = await fetch('/api/cards');
                const data = await response.json();
                if (data.success) {
                    allCards = data.cards;
                    handleSearch(); // 应用初始过滤 (即显示全部)
                } else {
                    showToast(data.message, true);
                }
            } catch (error) {
                showToast('加载数据失败', true);
            }
        }
        
        /**
         * 处理登录
         */
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
                    sessionStorage.setItem('adminToken', adminToken); // 临时存储
                    sessionStorage.setItem('adminUsername', adminUsername);
                    showToast('登录成功');
                    showPage('main');
                    fetchCards(); // 重新加载数据 (为了列表可点击)
                } else {
                    showToast(data.message || '登录失败', true);
                }
            } catch (error) {
                showToast('登录请求失败', true);
            }
        }

        /**
         * 处理登出
         */
        function handleLogout() {
            adminToken = null;
            adminUsername = null;
            sessionStorage.removeItem('adminToken');
            sessionStorage.removeItem('adminUsername');
            showToast('已退出登录');
            refreshDashboard(); // 刷新UI
        }
        
        // --- 卡片表单 ---
        
        /**
         * 显示卡片表单 (添加或编辑)
         */
        function showCardForm(mode, card = null) {
            currentEditingCard = card; // 存储当前编辑的卡
            form.form.reset(); // 重置表单

            if (mode === 'add') {
                form.title.textContent = '添加信用卡';
                form.addButtons.classList.remove('hidden');
                form.editButtons.classList.add('hidden');
                // 确保还款日UI重置
                setPaymentTypeUI('days_after_billing'); 
            } else { // edit
                form.title.textContent = '管理信用卡信息';
                form.addButtons.classList.add('hidden');
                form.editButtons.classList.remove('hidden');
                
                // 填充数据
                form.cardId.value = card.id;
                form.bankName.value = card.bank_name;
                // 填充时，去掉前导零，让用户看到纯数字（例如 '0123' 变为 '123'）
                form.last4.value = parseInt(card.last_4_digits, 10);
                form.limit.value = card.card_limit;
                form.billingDay.value = card.billing_day;
                form.graceDays.value = card.grace_days;
                // maxGracePeriod 字段已从表单中移除
                form.notes.value = card.notes;
                
                // 设置还款日UI
                setPaymentTypeUI(card.payment_type);
                if (card.payment_type === 'days_after_billing') {
                    form.paymentValueDays.value = card.payment_value;
                } else {
                    form.paymentValueFixed.value = card.payment_value;
                }
            }
            showPage('cardForm');
        }
        
        /**
         * 切换还款日输入UI
         */
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
                form.paymentValueFixed.value = ''; // 清空
            } else {
                form.paymentTypeDaysAfter.classList.add('hidden');
                form.paymentTypeFixedDay.classList.remove('hidden');
                form.paymentValueDays.value = ''; // 清空
            }
        }

        /**
         * 提交卡片表单 (添加或更新)
         */
        async function handleFormSubmit(e) {
            e.preventDefault();
            if (!adminToken) {
                showToast('请先登录', true);
                return;
            }

            // --- 客户端输入校验 ---
            
            // 0. 卡号后4位校验 (0-9999)
            const last4Value = form.last4.value; // 获取原始输入值 (字符串)
            const last4Num = parseInt(last4Value, 10);
            
            if (isNaN(last4Num) || last4Num < 0 || last4Num > 9999) {
                showToast('卡号后4位必须是0000到9999之间的数字', true);
                form.last4.focus();
                return;
            }
            // 校验通过后，补齐为4位字符串（例如 '123' -> '0123'）
            const last4Padded = last4Value.padStart(4, '0').slice(-4);
            
            // 1. 银行名称校验
            const bankName = form.bankName.value.trim();
            if (bankName.length === 0 || bankName.length > 10) {
                showToast('发卡银行不能为空且最多10个字符', true);
                form.bankName.focus();
                return;
            }
            
            // 2. 额度校验
            const limit = parseInt(form.limit.value);
            if (isNaN(limit) || limit < 0 || limit > 1000000) {
                showToast('卡片额度必须是0到1,000,000之间的整数', true);
                form.limit.focus();
                return;
            }

            // 3. 出账日校验
            const billingDay = parseInt(form.billingDay.value);
            if (isNaN(billingDay) || billingDay < 1 || billingDay > 31) {
                showToast('出账日必须是1-31之间的整数', true);
                form.billingDay.focus();
                return;
            }
            
            // 4. 还款日数值校验
            const paymentType = form.paymentType.value;
            const paymentValueRaw = (paymentType === 'days_after_billing') ? form.paymentValueDays.value : form.paymentValueFixed.value;
            const paymentValue = parseInt(paymentValueRaw);
            
            if (isNaN(paymentValue) || paymentValue < 1 || paymentValue > 31) {
                showToast('还款日/天数必须是1-31之间的整数', true);
                // 聚焦到当前可见的输入框
                if (paymentType === 'days_after_billing') {
                     form.paymentValueDays.focus();
                } else {
                    form.paymentValueFixed.focus();
                }
                return;
            }
            
            // 5. 宽限期校验
            const graceDays = parseInt(form.graceDays.value);
            if (isNaN(graceDays) || graceDays < 0 || graceDays > 31) {
                showToast('宽限期必须是0-31之间的整数', true);
                form.graceDays.focus();
                return;
            }
            // --- 客户端输入校验结束 ---


            // 自动计算最长免息期: 
            // "最长免息期" = "还款周期" + "一个账单周期(约30天)"
            // "还款周期" (账单日到还款日的天数) *不* 包含 "宽限期"
            let payment_period_days;
            if (paymentType === 'days_after_billing') {
                payment_period_days = paymentValue; // (e.g., 25 days)
            } else { // fixed_day
                // 这是一个近似值计算
                if (paymentValue > billingDay) {
                    // 同月, e.g., 账单日 1, 还款日 20 -> 19 天
                    payment_period_days = (paymentValue - billingDay);
                } else {
                    // 跨月, e.g., 账单日 28, 还款日 10 -> (30-28) + 10 = 12 天 (近似)
                    payment_period_days = (30 - billingDay) + paymentValue;
                }
            }
            
            // 最长免息期 = (还款周期天数) + 30天 (一个账单周期)
            const calculatedMaxGrace = payment_period_days + 30;

            const cardData = {
                bank_name: bankName,
                last_4_digits: last4Padded, // 使用补齐后的4位字符串
                card_limit: limit,
                billing_day: billingDay,
                payment_type: paymentType,
                payment_value: paymentValue,
                grace_days: graceDays,
                max_grace_period: calculatedMaxGrace, // 使用计算出的值
                notes: form.notes.value.substring(0, 100)
            };
            
            let url = '/api/cards';
            let method = 'POST';
            
            if (currentEditingCard) { // 编辑模式
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
                    fetchCards(); // 刷新列表
                } else {
                    showToast(data.message || '操作失败', true);
                }
            } catch (error) {
                showToast('请求失败', true);
            }
        }
        
        /**
         * 处理删除卡片
         */
        async function handleDeleteCard() {
            if (!currentEditingCard || !adminToken) return;
            
            // 简单的确认 (因为不能用 window.confirm)
            // 在实际应用中, 你会想用一个自定义的模态框
            const userConfirmed = confirm(\`确定要删除 \${currentEditingCard.bank_name} (尾号 \${currentEditingCard.last_4_digits}) 吗？\`);
            if (!userConfirmed) {
                return; 
            }

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
                    fetchCards(); // 刷新列表
                } else {
                    showToast(data.message || '删除失败', true);
                }
            } catch (error) {
                showToast('请求失败', true);
            }
        }

        // --- 初始化和事件绑定 ---
        document.addEventListener('DOMContentLoaded', () => {
            // 页面导航
            authContainer.loginButton.onclick = () => showPage('login');
            document.getElementById('login-cancel-button').onclick = () => showPage('main');
            document.getElementById('login-form-cancel').onclick = () => showPage('main');
            document.getElementById('add-card-btn-main').onclick = () => showCardForm('add');
            document.getElementById('form-cancel-button').onclick = () => showPage('main');
            document.getElementById('form-add-cancel').onclick = () => showPage('main');
            
            // 认证
            document.getElementById('login-form').onsubmit = handleLogin;
            authContainer.logoutButton.onclick = handleLogout;
            
            // 主页交互
            calendar.prevMonth.onclick = () => changeMonth(-1);
            calendar.nextMonth.onclick = () => changeMonth(1);
            calendar.toggleMode.onclick = toggleCalendarMode;
            calendar.body.onclick = toggleCalendarMode; // 点击日历任意位置切换
            list.sortButton.onclick = toggleSort;
            list.searchBar.oninput = handleSearch;
            
            // 表单交互
            form.paymentToggle.onclick = togglePaymentTypeUI;
            form.form.onsubmit = handleFormSubmit;
            document.getElementById('form-delete-button').onclick = handleDeleteCard;

            // 初始化
            fetchCards(); // 初始加载数据
            lucide.createIcons(); // 激活图标
        });

    </script>
</body>
</html>
  `;
}
