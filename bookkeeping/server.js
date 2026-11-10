const path = require('path');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = 3002;
const DB_FILE = path.join(__dirname, 'bookkeeping.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

/* ====================== 工具 ====================== */
function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysAgo(k, hh, mm) {
  const d = new Date();
  const today = d.getDate();
  d.setDate(Math.max(1, today - k));
  return `${dateStr(d)} ${pad(hh)}:${pad(mm)}`;
}
function nowStr() {
  const d = new Date();
  return `${dateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/* ====================== 建表 ====================== */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_no TEXT NOT NULL,
  avatar TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fund',
  icon TEXT NOT NULL DEFAULT 'wallet',
  color TEXT NOT NULL DEFAULT '#EFE6D8',
  icon_color TEXT NOT NULL DEFAULT '#8A6B45',
  initial_balance REAL NOT NULL DEFAULT 0,
  remark TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'expense',
  amount REAL NOT NULL,
  category_id INTEGER,
  note TEXT DEFAULT '',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS budgets (
  month TEXT PRIMARY KEY,
  amount REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);
`);

// 兼容旧库：补充新字段
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('transactions', 'account_id', 'INTEGER');
ensureColumn('transactions', 'to_account_id', 'INTEGER');
ensureColumn('categories', 'icon_name', "TEXT DEFAULT ''");
ensureColumn('categories', 'icon_color', "TEXT DEFAULT ''");

/* ====================== 分类外观映射 ====================== */
const CATEGORY_STYLE = {
  餐饮: ['utensils', '#FBEAD5', '#B4763C'],
  交通: ['car', '#E6EDF2', '#4E6E88'],
  购物: ['shopping-bag', '#FBE4E0', '#B5584A'],
  居家: ['house', '#EFE9DE', '#7A6A52'],
  娱乐: ['gamepad-2', '#E7F0E6', '#4C7A57'],
  医疗: ['pill', '#F9E3E0', '#A65348'],
  学习: ['book-open', '#F6EFD7', '#8A7433'],
  旅行: ['plane', '#E3EEF0', '#3F7A82'],
  工资: ['banknote', '#E7F0E6', '#2F8F62'],
  兼职: ['briefcase', '#E6EDF2', '#4E6E88'],
  理财: ['trending-up', '#F6EFD7', '#8A7433'],
  其他: ['gift', '#F0E7F2', '#8A6F91'],
  账户互转: ['repeat', '#E6EDF2', '#4E6E88'],
  信用卡还款: ['credit-card', '#FBE4E0', '#B5584A'],
  生活费: ['wallet', '#EFE9DE', '#7A6A52'],
  其他转账: ['arrow-right-left', '#F6EFD7', '#8A7433'],
};
const DEFAULT_STYLE = ['circle-plus', '#EFE9DE', '#7A6A52'];

/* ====================== 初始化数据 ====================== */
function seed() {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
    db.prepare('INSERT INTO users (name, user_no, avatar) VALUES (?, ?, ?)')
      .run('李高泽', '20261106', '');
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM categories').get().c === 0) {
    const insert = db.prepare(
      'INSERT INTO categories (name, icon, icon_name, icon_color, color, type, sort) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const expense = [
      ['餐饮', '🍜', 1], ['交通', '🚗', 2], ['购物', '🛍️', 3], ['居家', '🏠', 4],
      ['娱乐', '🎮', 5], ['医疗', '💊', 6], ['学习', '📚', 7], ['旅行', '✈️', 8],
    ];
    const income = [
      ['工资', '💰', 1], ['兼职', '💼', 2], ['理财', '📈', 3], ['其他', '🎁', 4],
    ];
    const transfer = [
      ['账户互转', '🔁', 1], ['信用卡还款', '💳', 2], ['生活费', '👛', 3], ['其他转账', '↔️', 4],
    ];
    const tx = db.transaction(() => {
      [['expense', expense], ['income', income], ['transfer', transfer]].forEach(([type, rows]) => {
        rows.forEach(([name, emoji, sort]) => {
          const [iconName, bg, fg] = CATEGORY_STYLE[name] || DEFAULT_STYLE;
          insert.run(name, emoji, iconName, fg, bg, type, sort);
        });
      });
    });
    tx();
  }

  // 旧数据补齐新字段（分类）
  const legacy = db.prepare("SELECT id, name FROM categories WHERE icon_name IS NULL OR icon_name = ''").all();
  legacy.forEach(row => {
    const [iconName, bg, fg] = CATEGORY_STYLE[row.name] || DEFAULT_STYLE;
    db.prepare('UPDATE categories SET icon_name = ?, icon_color = ? WHERE id = ?')
      .run(iconName, fg, row.id);
    if (!row.color) db.prepare('UPDATE categories SET color = ? WHERE id = ?').run(bg, row.id);
  });

  if (db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c === 0) {
    const insert = db.prepare(`
      INSERT INTO accounts (name, kind, icon, color, icon_color, initial_balance, remark, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const rows = [
      ['招商银行储蓄卡', 'fund', 'credit-card', '#EFE6D8', '#8A6B45', 21300, '储蓄 ···· 6688', 1],
      ['支付宝', 'fund', 'wallet', '#E6EDF2', '#4E6E88', 5120, '余额', 2],
      ['微信零钱', 'fund', 'banknote', '#E7F0E6', '#4C7A57', 2040, '余额', 3],
      ['现金', 'fund', 'wallet-cards', '#F6EFD7', '#8A7433', 80, '随身', 4],
      ['花呗', 'credit', 'credit-card', '#FBE4E0', '#B5584A', -1280, '本期待还', 1],
      ['京东白条', 'credit', 'credit-card', '#FBEAD5', '#B4763C', -800, '本期待还', 2],
    ];
    const tx = db.transaction(() => rows.forEach(r => insert.run(...r)));
    tx();
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c === 0) {
    const catIds = {};
    db.prepare('SELECT id, name FROM categories').all()
      .forEach(c => { catIds[c.name] = c.id; });

    const rows = [
      // [type, amount, category, note, occurred_at]
      ['expense', 28.00, '餐饮', '午餐·兰州拉面', daysAgo(0, 12, 30)],
      ['expense', 6.00, '交通', '地铁通勤', daysAgo(1, 8, 15)],
      ['expense', 186.50, '购物', '超市购物', daysAgo(3, 19, 20)],
      ['expense', 19.90, '餐饮', '瑞幸咖啡', daysAgo(4, 15, 10)],
      ['expense', 39.00, '医疗', '感冒药', daysAgo(5, 10, 40)],
      ['expense', 100.00, '居家', '手机话费', daysAgo(6, 9, 0)],
      ['expense', 100.10, '居家', '水电费', daysAgo(6, 8, 30)],
      ['income', 4500.00, '兼职', '项目结算', daysAgo(8, 10, 0)],
    ];

    const insert = db.prepare(
      'INSERT INTO transactions (type, amount, category_id, note, occurred_at) VALUES (?, ?, ?, ?, ?)'
    );
    const tx = db.transaction(() => {
      rows.forEach(([type, amount, cat, note, at]) => {
        insert.run(type, amount, catIds[cat] || null, note, at);
      });
    });
    tx();
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM budgets').get().c === 0) {
    db.prepare('INSERT INTO budgets (month, amount) VALUES (?, ?)').run(currentMonth(), 3000);
  }
}
seed();

/* ====================== 查询工具 ====================== */
function getCategory(categoryId) {
  if (categoryId == null || categoryId === '') return null;
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
}

function getAccount(accountId) {
  if (accountId == null || accountId === '') return null;
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
}

function profile() {
  const user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
  const days = db.prepare(
    "SELECT COUNT(DISTINCT substr(occurred_at, 1, 10)) AS c FROM transactions"
  ).get().c;

  // 连续记账天数：从今天（或昨天）往前数
  const dateSet = new Set(
    db.prepare("SELECT DISTINCT substr(occurred_at, 1, 10) AS d FROM transactions").all().map(r => r.d)
  );
  let streak = 0;
  const cursor = new Date();
  if (!dateSet.has(dateStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dateSet.has(dateStr(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const total = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
    FROM transactions
  `).get();

  return {
    name: user ? user.name : '记账用户',
    user_no: user ? user.user_no : '',
    avatar: user ? (user.avatar || '') : '',
    days,
    streak,
    total_balance: round2(total.income - total.expense),
  };
}

function budgetInfo(month) {
  const m = month || currentMonth();
  const row = db.prepare('SELECT amount FROM budgets WHERE month = ?').get(m);
  const amount = round2(row ? row.amount : 0);
  const used = round2(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v FROM transactions
    WHERE type = 'expense' AND substr(occurred_at, 1, 7) = ?
  `).get(m).v);
  return {
    month: m,
    amount,
    used,
    remaining: round2(amount - used),
    percent: amount > 0 ? Math.round((used / amount) * 100) : 0,
  };
}

function summary(month) {
  const m = month || currentMonth();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense,
      COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END), 0) AS transfer
    FROM transactions
    WHERE substr(occurred_at, 1, 7) = ?
  `).get(m);
  return {
    month: m,
    income: round2(row.income),
    expense: round2(row.expense),
    transfer: round2(row.transfer),
    balance: round2(row.income - row.expense),
    budget: budgetInfo(m),
  };
}

function listTransactions({ month, type, limit, accountId, keyword } = {}) {
  let sql = `
    SELECT t.id, t.type, t.amount, t.note, t.occurred_at,
           t.category_id, t.account_id, t.to_account_id,
           c.name AS category,
           c.icon AS category_icon,
           c.icon_name AS category_icon_name,
           c.color AS category_color,
           c.icon_color AS category_icon_color,
           a.name AS account_name,
           a2.name AS to_account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts a2 ON a2.id = t.to_account_id
    WHERE 1 = 1
  `;
  const params = [];
  if (month) { sql += ' AND substr(t.occurred_at, 1, 7) = ?'; params.push(month); }
  if (type) { sql += ' AND t.type = ?'; params.push(type); }
  if (accountId) {
    sql += ' AND (t.account_id = ? OR t.to_account_id = ?)';
    params.push(Number(accountId), Number(accountId));
  }
  if (keyword) {
    sql += ' AND (t.note LIKE ? OR c.name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  sql += ' ORDER BY t.occurred_at DESC, t.id DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
  return db.prepare(sql).all(...params).map(r => ({ ...r, amount: round2(r.amount) }));
}

function accountsWithBalance() {
  const rows = db.prepare(`
    SELECT a.id, a.name, a.kind, a.icon, a.color, a.icon_color,
           a.initial_balance, a.remark, a.sort,
           a.initial_balance + COALESCE(SUM(CASE
             WHEN t.type = 'income' AND t.account_id = a.id THEN t.amount
             WHEN t.type = 'expense' AND t.account_id = a.id THEN -t.amount
             WHEN t.type = 'transfer' AND t.account_id = a.id THEN -t.amount
             WHEN t.type = 'transfer' AND t.to_account_id = a.id THEN t.amount
             ELSE 0 END), 0) AS balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id OR t.to_account_id = a.id
    GROUP BY a.id
    ORDER BY a.sort ASC, a.id ASC
  `).all().map(r => ({
    ...r,
    initial_balance: round2(r.initial_balance),
    balance: round2(r.balance),
  }));

  const totalAssets = round2(rows.reduce((s, r) => s + Math.max(r.balance, 0), 0));
  const totalLiabilities = round2(rows.reduce((s, r) => s + Math.min(r.balance, 0), 0) * -1);

  return {
    accounts: rows,
    funds: rows.filter(r => r.kind === 'fund'),
    credits: rows.filter(r => r.kind === 'credit'),
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    net_assets: round2(totalAssets - totalLiabilities),
  };
}

/* ====================== 账单校验 ====================== */
function validateTransaction(input, existing = {}) {
  const type = input.type !== undefined ? input.type : (existing.type || 'expense');
  if (!['expense', 'income', 'transfer'].includes(type)) {
    return { error: 'type 只能是 expense / income / transfer' };
  }

  const amount = input.amount !== undefined ? Number(input.amount) : Number(existing.amount);
  if (!isFinite(amount) || amount <= 0) return { error: '金额必须大于 0' };

  const occurredAt = input.occurred_at || existing.occurred_at || nowStr();
  const note = input.note !== undefined ? input.note : (existing.note || '');
  let categoryId = input.category_id !== undefined ? input.category_id : existing.category_id;
  let accountId = input.account_id !== undefined ? input.account_id : existing.account_id;
  let toAccountId = input.to_account_id !== undefined ? input.to_account_id : existing.to_account_id;
  if (accountId === '' || accountId === undefined) accountId = null;
  if (toAccountId === '' || toAccountId === undefined) toAccountId = null;
  if (categoryId === '' || categoryId === undefined) categoryId = null;

  if (type === 'transfer') {
    const from = getAccount(accountId);
    const to = getAccount(toAccountId);
    if (!from || !to) return { error: '转账需要选择有效的转出与转入账户' };
    if (from.id === to.id) return { error: '转出与转入账户不能相同' };
    if (categoryId != null) {
      const category = getCategory(categoryId);
      if (!category || category.type !== 'transfer') return { error: '转账分类无效' };
    } else {
      categoryId = null;
    }
    return {
      values: {
        type, amount: round2(amount), categoryId, accountId: from.id,
        toAccountId: to.id, note: note || '', occurredAt,
      },
    };
  }

  const category = getCategory(categoryId);
  if (!category) return { error: '请选择有效的分类' };
  if (category.type !== type) return { error: '分类类型与账单类型不一致' };
  if (accountId != null && !getAccount(accountId)) return { error: '账户不存在' };

  return {
    values: {
      type, amount: round2(amount), categoryId: category.id, accountId,
      toAccountId: null, note: note || '', occurredAt,
    },
  };
}

/* ====================== API ====================== */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 用户资料
app.get('/api/profile', (req, res) => {
  res.json(profile());
});

// 修改昵称
app.put('/api/profile', (req, res) => {
  const name = req.body && req.body.name;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: '昵称不能为空' });
  }
  if (String(name).trim().length > 12) {
    return res.status(400).json({ message: '昵称不能超过 12 个字符' });
  }
  const user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
  if (!user) return res.status(404).json({ message: '用户不存在' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), user.id);
  res.json(profile());
});

// 本月收支汇总（含预算）
app.get('/api/summary', (req, res) => {
  res.json(summary(req.query.month));
});

/* ---------- 分类管理 ---------- */
app.get('/api/categories', (req, res) => {
  let sql = `
    SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usage_count
    FROM categories c
  `;
  const params = [];
  if (req.query.type) { sql += ' WHERE c.type = ?'; params.push(req.query.type); }
  sql += ' ORDER BY c.type DESC, c.sort ASC, c.id ASC';
  res.json(db.prepare(sql).all(...params).map(c => ({
    ...c,
    icon_name: c.icon_name || DEFAULT_STYLE[0],
    icon_color: c.icon_color || DEFAULT_STYLE[2],
  })));
});

app.post('/api/categories', (req, res) => {
  const { name, icon, icon_name, color, icon_color, type } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ message: '分类名称不能为空' });
  if (!['expense', 'income', 'transfer'].includes(type)) {
    return res.status(400).json({ message: '分类类型不合法' });
  }
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories WHERE type = ?')
    .get(type).s;
  const info = db.prepare(`
    INSERT INTO categories (name, icon, icon_name, icon_color, color, type, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name).trim(),
    icon || '',
    icon_name || DEFAULT_STYLE[0],
    icon_color || DEFAULT_STYLE[2],
    color || DEFAULT_STYLE[1],
    type,
    sort
  );
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/categories/:id', (req, res) => {
  const exist = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!exist) return res.status(404).json({ message: '分类不存在' });

  const { name, icon, icon_name, color, icon_color, type, sort } = req.body || {};
  if (type !== undefined && !['expense', 'income', 'transfer'].includes(type)) {
    return res.status(400).json({ message: '分类类型不合法' });
  }
  if (type !== undefined && type !== exist.type) {
    const used = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?').get(exist.id).c;
    if (used) return res.status(400).json({ message: '该分类已被账单使用，不能切换类型' });
  }

  db.prepare(`
    UPDATE categories
    SET name = ?, icon = ?, icon_name = ?, icon_color = ?, color = ?, type = ?, sort = ?
    WHERE id = ?
  `).run(
    name !== undefined ? String(name).trim() : exist.name,
    icon !== undefined ? icon : exist.icon,
    icon_name !== undefined ? icon_name : exist.icon_name,
    icon_color !== undefined ? icon_color : exist.icon_color,
    color !== undefined ? color : exist.color,
    type !== undefined ? type : exist.type,
    sort !== undefined ? Number(sort) : exist.sort,
    exist.id
  );
  res.json({ success: true });
});

app.delete('/api/categories/:id', (req, res) => {
  const exist = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!exist) return res.status(404).json({ message: '分类不存在' });

  const used = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?').get(exist.id).c;
  if (used && !req.query.force) {
    return res.status(400).json({
      message: `该分类已被 ${used} 笔账单使用，无法删除`,
      usage_count: used,
    });
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(exist.id);
  res.json({ success: true });
});

/* ---------- 账户 ---------- */
app.get('/api/accounts', (req, res) => {
  res.json(accountsWithBalance());
});

app.post('/api/accounts', (req, res) => {
  const { name, kind, icon, color, icon_color, initial_balance, remark } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ message: '账户名称不能为空' });
  if (kind !== undefined && !['fund', 'credit'].includes(kind)) {
    return res.status(400).json({ message: '账户类型只能是 fund 或 credit' });
  }
  const balance = Number(initial_balance || 0);
  if (!isFinite(balance)) return res.status(400).json({ message: '初始余额不是有效数字' });

  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM accounts WHERE kind = ?')
    .get(kind || 'fund').s;
  const info = db.prepare(`
    INSERT INTO accounts (name, kind, icon, color, icon_color, initial_balance, remark, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name).trim(),
    kind || 'fund',
    icon || 'wallet',
    color || '#EFE6D8',
    icon_color || '#8A6B45',
    round2(balance),
    remark || '',
    sort
  );
  res.json({ id: info.lastInsertRowid, balance: round2(balance) });
});

app.put('/api/accounts/:id', (req, res) => {
  const exist = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!exist) return res.status(404).json({ message: '账户不存在' });

  const { name, kind, icon, color, icon_color, initial_balance, remark, sort } = req.body || {};
  if (kind !== undefined && !['fund', 'credit'].includes(kind)) {
    return res.status(400).json({ message: '账户类型只能是 fund 或 credit' });
  }
  if (initial_balance !== undefined && !isFinite(Number(initial_balance))) {
    return res.status(400).json({ message: '初始余额不是有效数字' });
  }

  db.prepare(`
    UPDATE accounts
    SET name = ?, kind = ?, icon = ?, color = ?, icon_color = ?, initial_balance = ?, remark = ?, sort = ?
    WHERE id = ?
  `).run(
    name !== undefined ? String(name).trim() : exist.name,
    kind !== undefined ? kind : exist.kind,
    icon !== undefined ? icon : exist.icon,
    color !== undefined ? color : exist.color,
    icon_color !== undefined ? icon_color : exist.icon_color,
    initial_balance !== undefined ? round2(Number(initial_balance)) : exist.initial_balance,
    remark !== undefined ? remark : exist.remark,
    sort !== undefined ? Number(sort) : exist.sort,
    exist.id
  );
  res.json({ success: true });
});

app.delete('/api/accounts/:id', (req, res) => {
  const exist = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!exist) return res.status(404).json({ message: '账户不存在' });

  const used = db.prepare(`
    SELECT COUNT(*) AS c FROM transactions WHERE account_id = ? OR to_account_id = ?
  `).get(exist.id, exist.id).c;
  if (used) {
    return res.status(400).json({ message: `该账户已被 ${used} 笔账单使用，无法删除` });
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(exist.id);
  res.json({ success: true });
});

/* ---------- 账单 ---------- */
app.get('/api/transactions', (req, res) => {
  res.json(listTransactions({
    month: req.query.month,
    type: req.query.type,
    limit: req.query.limit,
    accountId: req.query.account_id,
    keyword: req.query.keyword,
  }));
});

// 按日分组的账单（明细页）
app.get('/api/bills', (req, res) => {
  const month = req.query.month || currentMonth();
  const rows = listTransactions({ month });
  const groups = [];
  const map = new Map();

  rows.forEach(item => {
    const date = item.occurred_at.slice(0, 10);
    if (!map.has(date)) {
      const group = { date, items: [], income: 0, expense: 0 };
      map.set(date, group);
      groups.push(group);
    }
    const group = map.get(date);
    group.items.push(item);
    if (item.type === 'income') group.income = round2(group.income + item.amount);
    if (item.type === 'expense') group.expense = round2(group.expense + item.amount);
  });

  const today = dateStr(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = dateStr(yesterday);

  groups.forEach(group => {
    const [y, m, d] = group.date.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    group.weekday = '周' + '日一二三四五六'[date.getDay()];
    if (group.date === today) group.label = '今天';
    else if (group.date === yesterdayStr) group.label = '昨天';
    else group.label = `${m}月${d}日`;
  });

  const total = summary(month);
  res.json({
    month,
    income: total.income,
    expense: total.expense,
    transfer: total.transfer,
    groups,
  });
});

// 新增一笔（支出 / 收入 / 转账）
app.post('/api/transactions', (req, res) => {
  const check = validateTransaction(req.body || {});
  if (check.error) return res.status(400).json({ message: check.error });

  const v = check.values;
  const info = db.prepare(`
    INSERT INTO transactions (type, amount, category_id, account_id, to_account_id, note, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(v.type, v.amount, v.categoryId, v.accountId, v.toAccountId, v.note, v.occurredAt);

  res.json({
    id: info.lastInsertRowid,
    type: v.type,
    amount: v.amount,
    category_id: v.categoryId,
    account_id: v.accountId,
    to_account_id: v.toAccountId,
    note: v.note,
    occurred_at: v.occurredAt,
  });
});

// 修改一笔
app.put('/api/transactions/:id', (req, res) => {
  const exist = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!exist) return res.status(404).json({ message: '账单不存在' });

  const check = validateTransaction(req.body || {}, exist);
  if (check.error) return res.status(400).json({ message: check.error });

  const v = check.values;
  db.prepare(`
    UPDATE transactions
    SET type = ?, amount = ?, category_id = ?, account_id = ?, to_account_id = ?, note = ?, occurred_at = ?
    WHERE id = ?
  `).run(v.type, v.amount, v.categoryId, v.accountId, v.toAccountId, v.note, v.occurredAt, exist.id);

  res.json({ success: true });
});

// 删除一笔
app.delete('/api/transactions/:id', (req, res) => {
  const exist = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!exist) return res.status(404).json({ message: '账单不存在' });
  db.prepare('DELETE FROM transactions WHERE id = ?').run(exist.id);
  res.json({ success: true });
});

/* ---------- 预算 ---------- */
app.get('/api/budget', (req, res) => {
  res.json(budgetInfo(req.query.month));
});

app.put('/api/budget', (req, res) => {
  const month = req.body && req.body.month ? req.body.month : currentMonth();
  const amount = Number(req.body && req.body.amount);
  if (!isFinite(amount) || amount < 0) {
    return res.status(400).json({ message: '预算金额必须是有效的非负数' });
  }
  db.prepare(`
    INSERT INTO budgets (month, amount) VALUES (?, ?)
    ON CONFLICT(month) DO UPDATE SET amount = excluded.amount
  `).run(month, round2(amount));
  res.json(budgetInfo(month));
});

/* ---------- 统计 ---------- */
app.get('/api/stats', (req, res) => {
  const m = req.query.month || currentMonth();
  const expenseTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v FROM transactions
    WHERE type = 'expense' AND substr(occurred_at, 1, 7) = ?
  `).get(m).v;
  const incomeTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v FROM transactions
    WHERE type = 'income' AND substr(occurred_at, 1, 7) = ?
  `).get(m).v;

  // 近 7 天支出柱状图
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateStr(d);
    const v = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS v FROM transactions
      WHERE type = 'expense' AND substr(occurred_at, 1, 10) = ?
    `).get(key).v;
    daily.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, amount: round2(v) });
  }

  // 本月支出分类占比
  const rows = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon_name, COALESCE(SUM(t.amount), 0) AS amount
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND substr(t.occurred_at, 1, 7) = ?
    GROUP BY c.id, c.name, c.color, c.icon_name
    ORDER BY amount DESC
  `).all(m);

  const total = expenseTotal;
  const categories = rows.map(r => ({
    id: r.id,
    name: r.name || '未分类',
    color: r.color || '#EFE9DE',
    icon_name: r.icon_name || DEFAULT_STYLE[0],
    amount: round2(r.amount),
    percent: total > 0 ? Math.round((r.amount / total) * 100) : 0,
  }));

  res.json({
    month: m,
    expense_total: round2(expenseTotal),
    income_total: round2(incomeTotal),
    daily,
    categories,
  });
});

/* ---------- 兜底 ---------- */
app.use('/api', (req, res) => {
  res.status(404).json({ message: '接口不存在' });
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: '请求体不是合法的 JSON' });
  }
  console.error(err);
  res.status(500).json({ message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`记账服务已启动: http://localhost:${PORT}`);
  console.log(`数据库文件: ${DB_FILE}`);
});
