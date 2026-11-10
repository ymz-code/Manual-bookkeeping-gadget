/* 记账本 · 前端逻辑 */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const SERIES = ['#C86B4A', '#DFA05A', '#8C9C74', '#B4877A', '#A2947F'];
  const PAIRS = [
    ['#FBEAD5', '#B4763C'], ['#E6EDF2', '#4E6E88'], ['#FBE4E0', '#B5584A'],
    ['#EFE9DE', '#7A6A52'], ['#E7F0E6', '#4C7A57'], ['#F9E3E0', '#A65348'],
    ['#F6EFD7', '#8A7433'], ['#E3EEF0', '#3F7A82'], ['#F0E7F2', '#8A6F91'],
  ];
  const PICKER_ICONS = [
    'utensils', 'car', 'shopping-bag', 'house', 'gamepad-2', 'pill', 'book-open',
    'plane', 'briefcase', 'trending-up', 'gift', 'banknote', 'wallet', 'credit-card',
    'coffee', 'target', 'repeat', 'tags', 'receipt', 'calendar', 'bell', 'cloud',
  ];

  const state = {
    screen: 'home',
    type: 'expense',
    amount: '',
    categoryId: null,
    note: '',
    catType: 'expense',
    catCache: {},
    accounts: [],
    statMonth: '',
  };

  let knownIcons = new Set();

  /* ---------------- 工具 ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function money(n) {
    return (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function icon(name, cls = 'ic') {
    const key = knownIcons.has(name) ? name : 'circle-plus';
    return `<svg class="${cls}" aria-hidden="true"><use href="#i-${key}"></use></svg>`;
  }
  function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function addMonth(m, delta) {
    const [y, mm] = m.split('-').map(Number);
    const d = new Date(y, mm - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function monthLabel(m) {
    const [y, mm] = m.split('-');
    return `${y}年${Number(mm)}月`;
  }
  function todayLabel() {
    const d = new Date();
    return `${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`;
  }
  function greeting(name) {
    const h = new Date().getHours();
    const word = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    return `${word}，${name || '记账用户'}`;
  }

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET' };
    if (opts.body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch (_) { /* 忽略空响应 */ }
    if (!res.ok) throw new Error((data && data.message) || `请求失败（${res.status}）`);
    return data;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------------- 页面切换 ---------------- */
  const loaders = {
    home: loadHome,
    stats: loadStats,
    assets: loadAssets,
    profile: loadProfile,
    categories: loadCategories,
  };

  async function go(name) {
    state.screen = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
    $$('.ni').forEach(n => n.classList.toggle('on', n.dataset.goto === name));
    if (name === 'add') resetAdd();
    const fn = loaders[name];
    if (fn) {
      try { await fn(); } catch (e) { toast(e.message || '加载失败'); }
    }
  }

  /* ---------------- 明细 ---------- */
  async function loadHome() {
    const [summary, profile, bills] = await Promise.all([
      api('/api/summary'),
      api('/api/profile'),
      api('/api/bills'),
    ]);

    $('#home-date').textContent = todayLabel();
    $('#greeting').textContent = greeting(profile.name);
    $('#home-balance').textContent = money(summary.balance);
    $('#home-income').textContent = money(summary.income);
    $('#home-expense').textContent = money(summary.expense);
    $('#home-transfer').textContent = money(summary.transfer);

    const budget = summary.budget || { amount: 0, used: 0, percent: 0 };
    $('#bud-label').textContent = `月度预算 ¥${money(budget.amount)}`;
    $('#bud-pct').textContent = `已用 ${budget.percent}%`;
    $('#bud-fill').style.width = `${Math.min(100, budget.percent)}%`;

    renderGroups(bills.groups, $('#home-bills'));
  }

  function renderGroups(groups, container) {
    if (!groups || !groups.length) {
      container.innerHTML = '<div class="empty">本月还没有账单<br>点下方 + 记一笔吧</div>';
      return;
    }
    container.innerHTML = groups.map(g => {
      const sums = [];
      if (g.expense) sums.push(`<span class="out">-${money(g.expense)}</span>`);
      if (g.income) sums.push(`<span class="in">+${money(g.income)}</span>`);
      return `<div class="grp-h"><span>${esc(g.label)}<em>${esc(g.weekday || '')}</em></span><span class="sum">${sums.join(' ')}</span></div>`
        + g.items.map(rowHtml).join('');
    }).join('');
  }

  function rowHtml(t) {
    const isTransfer = t.type === 'transfer';
    const catName = t.category || (isTransfer ? '转账' : '未分类');
    const chipIcon = isTransfer ? 'repeat' : (t.category_icon_name || 'circle-plus');
    const bg = isTransfer ? '#E6EDF2' : (t.category_color || '#EFE9DE');
    const fg = isTransfer ? '#4E6E88' : (t.category_icon_color || '#7A6A52');
    const title = t.note || (isTransfer ? `${t.account_name || '账户'} → ${t.to_account_name || '账户'}` : catName);
    const sub = `${(t.occurred_at || '').slice(11, 16)} · ${isTransfer ? catName : catName}`;

    let amount;
    if (t.type === 'income') amount = `<span class="row-a in">+${money(t.amount)}</span>`;
    else if (t.type === 'expense') amount = `<span class="row-a out">-${money(t.amount)}</span>`;
    else amount = `<span class="row-a tr">${money(t.amount)}</span>`;

    return `<div class="row"><span class="chip" style="background:${bg};color:${fg}">${icon(chipIcon)}</span>`
      + `<div class="row-main"><div class="row-t">${esc(title)}</div><div class="row-s">${esc(sub)}</div></div>${amount}</div>`;
  }

  /* ---------------- 记一笔 ---------- */
  function resetAdd() {
    state.type = 'expense';
    state.amount = '';
    state.categoryId = null;
    state.note = '';
    $('#note-input').value = '';
    $('#add-date').textContent = '今天 · ' + todayLabel().split(' · ')[0];
    $('#save-btn').textContent = '保存';
    renderAmount();
    setAddType('expense');
  }

  async function setAddType(type) {
    state.type = type;
    $$('#add-seg span').forEach(s => s.classList.toggle('on', s.dataset.type === type));
    $('#amount-label').textContent = type === 'expense' ? '支出金额' : type === 'income' ? '收入金额' : '转账金额';

    if (type === 'transfer') {
      $('#category-grid').hidden = true;
      $('#transfer-box').hidden = false;
      await ensureAccounts();
      fillAccountSelects();
      return;
    }
    $('#transfer-box').hidden = true;
    $('#category-grid').hidden = false;
    await ensureCategories(type);
    const list = state.catCache[type] || [];
    state.categoryId = list.length ? list[0].id : null;
    renderGrid();
  }

  async function ensureCategories(type) {
    if (!state.catCache[type]) {
      state.catCache[type] = await api(`/api/categories?type=${type}`);
    }
  }

  function renderGrid() {
    const type = state.type;
    const list = state.catCache[type] || [];
    $('#category-grid').innerHTML = list.map(c => (
      `<button class="c ${state.categoryId === c.id ? 'on' : ''}" data-cid="${c.id}">`
      + `<span class="c-ic" style="background:${c.color};color:${c.icon_color}">${icon(c.icon_name)}</span>${esc(c.name)}</button>`
    )).join('')
      + `<button class="c add" data-custom="1"><span class="c-ic">${icon('plus')}</span>自定义</button>`;
  }

  async function ensureAccounts() {
    if (!state.accounts.length) {
      const data = await api('/api/accounts');
      state.accounts = data.accounts;
    }
  }

  function fillAccountSelects() {
    const accounts = state.accounts;
    if (!accounts.length) {
      toast('请先在「资产」中添加账户');
      return;
    }
    const funds = accounts.filter(a => a.kind === 'fund');
    const from = $('#from-account');
    const to = $('#to-account');
    const options = accounts.map(a => `<option value="${a.id}">${esc(a.name)}（${money(a.balance)}）</option>`).join('');
    from.innerHTML = options;
    to.innerHTML = options;
    const fromDefault = (funds[0] || accounts[0]).id;
    const toDefault = (funds[1] || accounts[1] || accounts[0]).id;
    from.value = String(fromDefault);
    to.value = String(toDefault);
    if (from.value === to.value && accounts.length > 1) {
      to.value = String(accounts.find(a => a.id !== fromDefault).id);
    }

    const transferCats = state.catCache.transfer || [];
    $('#transfer-category').innerHTML = '<option value="0">无分类</option>'
      + transferCats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }

  function renderAmount() {
    const raw = state.amount;
    let text = '0.00';
    if (raw) {
      if (raw.endsWith('.')) {
        text = Number(raw.slice(0, -1)).toLocaleString('zh-CN') + '.';
      } else {
        const parts = raw.split('.');
        text = Number(parts[0]).toLocaleString('zh-CN') + (parts.length > 1 ? '.' + parts[1] : '');
      }
    }
    $('#amount-text').textContent = text;
  }

  function pressKey(key) {
    if (key === 'del') {
      state.amount = state.amount.slice(0, -1);
    } else if (key === '.') {
      if (!state.amount) state.amount = '0.';
      else if (!state.amount.includes('.')) state.amount += '.';
    } else {
      if (state.amount.includes('.') && state.amount.split('.')[1].length >= 2) return;
      if (state.amount === '0') state.amount = key;
      else state.amount += key;
      if (state.amount.replace(/\D/g, '').length > 8) state.amount = state.amount.slice(0, -1);
    }
    renderAmount();
  }

  async function saveTransaction() {
    const amount = Number(state.amount);
    if (!amount) { toast('请输入金额'); return; }

    const payload = { type: state.type, amount, note: $('#note-input').value.trim() };

    if (state.type === 'transfer') {
      const fromId = Number($('#from-account').value);
      const toId = Number($('#to-account').value);
      const purpose = Number($('#transfer-category').value);
      if (!fromId || !toId) { toast('请选择转出与转入账户'); return; }
      if (fromId === toId) { toast('转出与转入账户不能相同'); return; }
      payload.account_id = fromId;
      payload.to_account_id = toId;
      payload.category_id = purpose || null;
    } else {
      if (!state.categoryId) { toast('请选择分类'); return; }
      payload.category_id = state.categoryId;
    }

    $('#save-btn').textContent = '保存中…';
    try {
      await api('/api/transactions', { method: 'POST', body: payload });
      state.catCache = {};
      toast('已保存');
      state.amount = '';
      $('#note-input').value = '';
      await go('home');
    } catch (e) {
      toast(e.message || '保存失败');
    } finally {
      $('#save-btn').textContent = '保存';
    }
  }

  /* ---------------- 图表 ---------- */
  async function loadStats() {
    const month = state.statMonth || (state.statMonth = currentMonth());
    const [stats, prev] = await Promise.all([
      api(`/api/stats?month=${month}`),
      api(`/api/stats?month=${addMonth(month, -1)}`).catch(() => null),
    ]);

    $('#stat-month').textContent = monthLabel(month);
    $('#stat-total').textContent = '¥' + money(stats.expense_total);

    let cmp = '本月支出';
    if (prev && prev.expense_total > 0) {
      const diff = Math.round(((stats.expense_total - prev.expense_total) / prev.expense_total) * 100);
      cmp = diff === 0 ? '与上月持平' : `较上月 ${diff > 0 ? '+' : ''}${diff}%`;
    }
    const cmpEl = $('#stat-cmp');
    cmpEl.textContent = cmp;
    cmpEl.style.color = cmp.startsWith('较上月 +') ? '#C9503C' : '#2F8F62';

    const donut = $('#donut');
    const total = stats.expense_total;
    if (stats.categories.length && total > 0) {
      let acc = 0;
      const stops = stats.categories.map((c, i) => {
        const from = acc;
        acc += (c.amount / total) * 100;
        return `${SERIES[i % SERIES.length]} ${from}% ${acc}%`;
      });
      donut.style.background = `conic-gradient(${stops.join(',')})`;
    } else {
      donut.style.background = 'var(--surface-2)';
    }

    const maxPercent = Math.max(...stats.categories.map(c => c.percent), 1);
    $('#rank').innerHTML = stats.categories.length
      ? stats.categories.map((c, i) => (
        `<div class="rank-row"><span class="rd" style="background:${SERIES[i % SERIES.length]}"></span>`
        + `<span class="rn">${esc(c.name)}</span>`
        + `<span class="rtrack"><i class="rfill" style="width:${Math.max(3, (c.percent / maxPercent) * 100)}%;background:${SERIES[i % SERIES.length]}"></i></span>`
        + `<span class="rv">${money(c.amount)}</span><span class="rp">${c.percent}%</span></div>`
      )).join('')
      : '<div class="empty">本月暂无支出</div>';

    const maxDaily = Math.max(...stats.daily.map(d => d.amount), 1);
    const avg = stats.daily.reduce((s, d) => s + d.amount, 0) / (stats.daily.length || 1);
    $('#week-avg').textContent = `日均 ¥${money(avg)}`;
    $('#bars').innerHTML = stats.daily.map(d => (
      `<div class="bcol"><div class="bbar${d.amount === maxDaily && d.amount > 0 ? ' hot' : ''}" `
      + `style="height:${d.amount ? Math.max(4, (d.amount / maxDaily) * 100) : 2}%"></div>`
      + `<span class="blab">${esc(d.label.split('/')[1])}</span></div>`
    )).join('');
  }

  /* ---------------- 资产 ---------- */
  async function loadAssets() {
    const data = await api('/api/accounts');
    state.accounts = data.accounts;

    $('#net-assets').textContent = money(data.net_assets);
    $('#total-assets').textContent = `总资产 ¥${money(data.total_assets)}`;
    $('#total-liabilities').textContent = `总负债 ¥${money(data.total_liabilities)}`;
    $('#funds-total').textContent = `¥${money(data.funds.reduce((s, a) => s + a.balance, 0))}`;
    $('#credits-total').textContent = `-¥${money(Math.abs(data.credits.reduce((s, a) => s + a.balance, 0)))}`;

    $('#funds-list').innerHTML = data.funds.length ? data.funds.map(accountRow).join('')
      : '<div class="empty">还没有资金账户</div>';
    $('#credits-list').innerHTML = data.credits.length ? data.credits.map(accountRow).join('')
      : '<div class="empty">还没有信用账户</div>';

    $$('#funds-list .row, #credits-list .row').forEach(row => {
      row.addEventListener('click', () => {
        const acc = state.accounts.find(a => a.id === Number(row.dataset.aid));
        if (acc) openAccountEditor(acc);
      });
    });
  }

  function accountRow(a) {
    return `<div class="row" data-aid="${a.id}"><span class="chip" style="background:${a.color};color:${a.icon_color}">${icon(a.icon)}</span>`
      + `<div class="row-main"><div class="row-t">${esc(a.name)}</div><div class="sub2">${esc(a.remark || (a.kind === 'fund' ? '资金账户' : '信用账户'))}</div></div>`
      + `<div class="row-a ${a.balance < 0 ? 'out' : ''}">${money(a.balance)}</div></div>`;
  }

  /* ---------------- 我的 ---------- */
  async function loadProfile() {
    const p = await api('/api/profile');
    state.profileName = p.name;
    $('#profile-avatar').textContent = (p.name || '记').slice(0, 1);
    $('#profile-name').textContent = p.name;
    $('#profile-sub').textContent = `ID ${p.user_no} · 已连续记账 ${p.streak} 天`;
    $('#profile-days').textContent = p.days;
    $('#profile-streak').textContent = p.streak;
    $('#profile-total').textContent = `¥${money(p.total_balance)}`;
  }

  /* ---------------- 分类管理 ---------- */
  function openProfileEditor(name) {
    const html = `
      <div class="form-item"><div class="form-label">昵称</div>
        <input class="form-input" id="p-name" maxlength="12" placeholder="请输入昵称" value="${esc(name)}">
      </div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="p-cancel">取消</button>
        <button class="btn-main" id="p-save">保存</button>
      </div>`;

    openSheet('编辑资料', html, () => {
      const input = $('#p-name');
      setTimeout(() => input.focus(), 280);
      $('#p-cancel').addEventListener('click', closeSheet);
      $('#p-save').addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) { toast('请输入昵称'); return; }
        try {
          const p = await api('/api/profile', { method: 'PUT', body: { name: value } });
          state.profileName = p.name;
          closeSheet();
          toast('昵称已更新');
          loadProfile().catch(() => { /* 忽略 */ });
          loadHome().catch(() => { /* 忽略 */ });
        } catch (e) {
          toast(e.message || '保存失败');
        }
      });
    });
  }

  async function loadCategories() {
    $$('#cat-seg span').forEach(s => s.classList.toggle('on', s.dataset.type === state.catType));
    const list = await api(`/api/categories?type=${state.catType}`);
    state.catCache[state.catType] = list;

    $('#cat-list').innerHTML = list.map(c => (
      `<div class="crow"><span class="chip" style="background:${c.color};color:${c.icon_color}">${icon(c.icon_name)}</span>`
      + `<span class="cname">${esc(c.name)}</span><span class="cuse">${c.usage_count || 0} 笔</span>`
      + `<span class="cact"><button class="cact-btn" data-edit="${c.id}">${icon('pencil')}</button>`
      + `<button class="cact-btn" data-del="${c.id}">${icon('trash-2')}</button></span></div>`
    )).join('') || '<div class="empty">还没有分类</div>';

    $$('#cat-list [data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = list.find(c => c.id === Number(btn.dataset.edit));
        if (cat) openCategoryEditor(cat);
      });
    });
    $$('#cat-list [data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cat = list.find(c => c.id === Number(btn.dataset.del));
        if (!cat) return;
        if (!confirm(`删除分类「${cat.name}」？`)) return;
        try {
          await api(`/api/categories/${cat.id}`, { method: 'DELETE' });
          state.catCache = {};
          toast('已删除');
          loadCategories();
        } catch (e) {
          toast(e.message || '删除失败');
        }
      });
    });
  }

  /* ---------------- 弹层 ---------------- */
  function openSheet(title, html, afterRender) {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    $('#sheet-mask').hidden = false;
    $('#sheet').hidden = false;
    requestAnimationFrame(() => {
      $('#sheet-mask').classList.add('show');
      $('#sheet').classList.add('open');
    });
    if (afterRender) afterRender();
  }

  function closeSheet() {
    $('#sheet-mask').classList.remove('show');
    $('#sheet').classList.remove('open');
    setTimeout(() => {
      $('#sheet').hidden = true;
      $('#sheet-mask').hidden = true;
      $('#sheet-body').innerHTML = '';
    }, 260);
  }

  function openCategoryEditor(cat) {
    const type = cat ? cat.type : state.catType;
    const sel = {
      name: cat ? cat.name : '',
      icon: cat ? (cat.icon_name || 'circle-plus') : PICKER_ICONS[0],
      color: cat ? cat.color : PAIRS[0][0],
      iconColor: cat ? cat.icon_color : PAIRS[0][1],
    };

    const html = `
      <div class="form-item"><div class="form-label">名称</div>
        <input class="form-input" id="f-name" maxlength="12" placeholder="例如 宠物" value="${esc(sel.name)}">
      </div>
      <div class="form-item"><div class="form-label">图标</div>
        <div class="icon-pick" id="f-icons">${PICKER_ICONS.map(n => (
          `<button class="ip-item ${n === sel.icon ? 'on' : ''}" data-icon="${n}">${icon(n)}</button>`
        )).join('')}</div>
      </div>
      <div class="form-item"><div class="form-label">颜色</div>
        <div class="color-pick" id="f-colors">${PAIRS.map(([bg, fg]) => (
          `<button class="cp-item ${bg === sel.color ? 'on' : ''}" data-bg="${bg}" data-fg="${fg}" style="background:${bg}">`
          + `<span class="cp-dot" style="background:${fg}"></span></button>`
        )).join('')}</div>
      </div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="f-cancel">取消</button>
        <button class="btn-main" id="f-save">保存</button>
      </div>`;

    openSheet(cat ? '编辑分类' : '新建分类', html, () => {
      $$('#f-icons .ip-item').forEach(btn => btn.addEventListener('click', () => {
        sel.icon = btn.dataset.icon;
        $$('#f-icons .ip-item').forEach(b => b.classList.toggle('on', b === btn));
      }));
      $$('#f-colors .cp-item').forEach(btn => btn.addEventListener('click', () => {
        sel.color = btn.dataset.bg;
        sel.iconColor = btn.dataset.fg;
        $$('#f-colors .cp-item').forEach(b => b.classList.toggle('on', b === btn));
      }));
      $('#f-cancel').addEventListener('click', closeSheet);
      $('#f-save').addEventListener('click', async () => {
        const name = $('#f-name').value.trim();
        if (!name) { toast('请输入分类名称'); return; }
        const payload = { name, icon_name: sel.icon, color: sel.color, icon_color: sel.iconColor };
        try {
          if (cat) await api(`/api/categories/${cat.id}`, { method: 'PUT', body: payload });
          else await api('/api/categories', { method: 'POST', body: Object.assign({ type }, payload) });
          state.catCache = {};
          closeSheet();
          toast('已保存');
          if (state.screen === 'categories') loadCategories();
          if (state.screen === 'add') setAddType(state.type);
        } catch (e) {
          toast(e.message || '保存失败');
        }
      });
    });
  }

  function openAccountEditor(acc) {
    const sel = {
      name: acc ? acc.name : '',
      kind: acc ? acc.kind : 'fund',
      balance: acc ? String(acc.initial_balance) : '',
      icon: acc ? acc.icon : 'wallet',
      color: acc ? acc.color : PAIRS[0][0],
      iconColor: acc ? acc.icon_color : PAIRS[0][1],
      remark: acc ? acc.remark : '',
    };
    const icons = ['wallet', 'credit-card', 'banknote', 'wallet-cards', 'coffee', 'briefcase'];

    const html = `
      <div class="form-item"><div class="form-label">账户名称</div>
        <input class="form-input" id="a-name" maxlength="20" placeholder="例如 招商银行储蓄卡" value="${esc(sel.name)}">
      </div>
      <div class="form-item"><div class="form-label">账户类型</div>
        <div class="form-seg" id="a-kind">
          <span class="${sel.kind === 'fund' ? 'on' : ''}" data-kind="fund">资金账户</span>
          <span class="${sel.kind === 'credit' ? 'on' : ''}" data-kind="credit">信用账户</span>
        </div>
      </div>
      <div class="form-item"><div class="form-label">${acc ? '初始余额' : '初始余额（负数为负债）'}</div>
        <input class="form-input" id="a-balance" type="number" inputmode="decimal" placeholder="0.00" value="${esc(sel.balance)}">
      </div>
      <div class="form-item"><div class="form-label">备注</div>
        <input class="form-input" id="a-remark" maxlength="20" placeholder="可选" value="${esc(sel.remark)}">
      </div>
      <div class="form-item"><div class="form-label">图标</div>
        <div class="icon-pick" id="a-icons">${icons.map(n => (
          `<button class="ip-item ${n === sel.icon ? 'on' : ''}" data-icon="${n}">${icon(n)}</button>`
        )).join('')}</div>
      </div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="a-cancel">取消</button>
        <button class="btn-main" id="a-save">保存</button>
      </div>`;

    openSheet(acc ? '编辑账户' : '添加账户', html, () => {
      $$('#a-kind span').forEach(btn => btn.addEventListener('click', () => {
        sel.kind = btn.dataset.kind;
        $$('#a-kind span').forEach(b => b.classList.toggle('on', b === btn));
      }));
      $$('#a-icons .ip-item').forEach(btn => btn.addEventListener('click', () => {
        sel.icon = btn.dataset.icon;
        $$('#a-icons .ip-item').forEach(b => b.classList.toggle('on', b === btn));
      }));
      $('#a-cancel').addEventListener('click', closeSheet);
      $('#a-save').addEventListener('click', async () => {
        const name = $('#a-name').value.trim();
        if (!name) { toast('请输入账户名称'); return; }
        const balance = Number($('#a-balance').value || 0);
        if (!Number.isFinite(balance)) { toast('余额格式不正确'); return; }
        const payload = {
          name,
          kind: sel.kind,
          icon: sel.icon,
          color: sel.color,
          icon_color: sel.iconColor,
          initial_balance: balance,
          remark: $('#a-remark').value.trim(),
        };
        try {
          if (acc) await api(`/api/accounts/${acc.id}`, { method: 'PUT', body: payload });
          else await api('/api/accounts', { method: 'POST', body: payload });
          state.accounts = [];
          closeSheet();
          toast('已保存');
          if (state.screen === 'assets') loadAssets();
        } catch (e) {
          toast(e.message || '保存失败');
        }
      });
    });
  }

  function openBudgetEditor() {
    const html = `
      <div class="form-item"><div class="form-label">本月预算金额</div>
        <input class="form-input" id="b-amount" type="number" inputmode="decimal" placeholder="3000">
      </div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="b-cancel">取消</button>
        <button class="btn-main" id="b-save">保存</button>
      </div>`;

    openSheet('预算设置', html, async () => {
      try {
        const current = await api('/api/budget');
        $('#b-amount').value = current.amount || '';
      } catch (_) { /* 忽略 */ }
      $('#b-cancel').addEventListener('click', closeSheet);
      $('#b-save').addEventListener('click', async () => {
        const amount = Number($('#b-amount').value);
        if (!Number.isFinite(amount) || amount < 0) { toast('请输入有效金额'); return; }
        try {
          await api('/api/budget', { method: 'PUT', body: { month: currentMonth(), amount } });
          closeSheet();
          toast('预算已更新');
          if (state.screen === 'home') loadHome();
        } catch (e) {
          toast(e.message || '保存失败');
        }
      });
    });
  }

  function openSearch() {
    const html = `<div class="search-box">${icon('search')}<input id="s-input" placeholder="搜索备注或分类" maxlength="20"></div><div id="s-result"></div>`;
    openSheet('搜索账单', html, () => {
      const input = $('#s-input');
      let timer = null;
      const render = async () => {
        const keyword = input.value.trim();
        const result = $('#s-result');
        if (!keyword) { result.innerHTML = '<div class="empty">输入关键词搜索全部账单</div>'; return; }
        try {
          const list = await api(`/api/transactions?limit=30&keyword=${encodeURIComponent(keyword)}`);
          result.innerHTML = list.length ? list.map(rowHtml).join('')
            : '<div class="empty">没有找到相关账单</div>';
        } catch (e) {
          toast(e.message || '搜索失败');
        }
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(render, 300);
      });
      render();
      setTimeout(() => input.focus(), 300);
    });
  }

  /* ---------------- PWA ---------------- */
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => { /* 忽略注册失败 */ });
      });
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    knownIcons = new Set($$('symbol').map(s => s.id.replace(/^i-/, '')));

    // 底部导航与页面跳转
    document.addEventListener('click', e => {
      const target = e.target.closest('[data-goto]');
      if (!target) return;
      go(target.dataset.goto);
    });

    $('#btn-search').addEventListener('click', openSearch);
    $('#btn-quick-add').addEventListener('click', () => go('add'));
    $('#q-transfer').addEventListener('click', async () => {
      await go('add');
      setAddType('transfer');
    });
    $('#q-bills').addEventListener('click', async () => {
      await go('home');
      $('#home-bills').scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#q-budget').addEventListener('click', openBudgetEditor);
    $('#mi-budget').addEventListener('click', openBudgetEditor);
    $$('[data-soon]').forEach(el => el.addEventListener('click', () => toast(`${el.dataset.soon}功能即将开放`)));

    // 记一笔
    $('#add-close').addEventListener('click', () => go('home'));
    $$('#add-seg span').forEach(s => s.addEventListener('click', () => setAddType(s.dataset.type)));
    $('#category-grid').addEventListener('click', e => {
      const custom = e.target.closest('[data-custom]');
      if (custom) {
        state.catType = state.type === 'income' ? 'income' : 'expense';
        go('categories');
        return;
      }
      const btn = e.target.closest('[data-cid]');
      if (!btn) return;
      state.categoryId = Number(btn.dataset.cid);
      $$('#category-grid .c').forEach(c => c.classList.toggle('on', c === btn));
    });
    $('#keypad').addEventListener('click', e => {
      const key = e.target.closest('[data-k]');
      if (key) pressKey(key.dataset.k);
    });
    $('#save-btn').addEventListener('click', saveTransaction);

    // 图表月份
    $('#stat-prev').addEventListener('click', () => {
      state.statMonth = addMonth(state.statMonth || currentMonth(), -1);
      loadStats().catch(err => toast(err.message));
    });
    $('#stat-next').addEventListener('click', () => {
      state.statMonth = addMonth(state.statMonth || currentMonth(), 1);
      loadStats().catch(err => toast(err.message));
    });

    // 资产
    $('#add-account').addEventListener('click', () => openAccountEditor(null));

    // 修改昵称
    $('#profile-me').addEventListener('click', () => openProfileEditor(state.profileName || $('#profile-name').textContent));
    $('#mi-profile').addEventListener('click', () => openProfileEditor(state.profileName || $('#profile-name').textContent));

    // 分类管理
    $('#cat-back').addEventListener('click', () => go('profile'));
    $('#cat-new').addEventListener('click', () => openCategoryEditor(null));
    $('#newcat-btn').addEventListener('click', () => openCategoryEditor(null));
    $$('#cat-seg span').forEach(s => s.addEventListener('click', () => {
      state.catType = s.dataset.type;
      loadCategories().catch(err => toast(err.message));
    }));

    // 弹层
    $('#sheet-close').addEventListener('click', closeSheet);
    $('#sheet-mask').addEventListener('click', closeSheet);

    state.statMonth = currentMonth();
    go('home');
    registerSW();
  }

  init();
})();
