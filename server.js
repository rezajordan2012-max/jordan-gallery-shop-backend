require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database('store.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  items TEXT NOT NULL,
  amount INTEGER NOT NULL,
  authority TEXT,
  ref_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:4000/payment/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'ورود الزامی است' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'نشست نامعتبر است، دوباره وارد شوید' });
  }
}

// ---------- Auth ----------
app.post('/api/auth/register', async (req, res) => {
  const { email, password, fullName } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'ایمیل و رمز عبور (حداقل ۶ کاراکتر) الزامی است' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است' });

  const hash = await bcrypt.hash(password, 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)')
    .run(email, hash, fullName || '');
  const token = jwt.sign({ id: info.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: info.lastInsertRowid, email, fullName: fullName || '' } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, fullName: user.full_name } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

// ---------- Orders ----------
app.get('/api/orders', auth, (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json(orders.map((o) => ({ ...o, items: JSON.parse(o.items) })));
});

// ---------- Zarinpal payment ----------
app.post('/api/payment/request', auth, async (req, res) => {
  const { items, amount, description } = req.body || {};
  if (!amount || amount < 1000) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  if (!ZARINPAL_MERCHANT_ID) return res.status(500).json({ error: 'ZARINPAL_MERCHANT_ID تنظیم نشده است' });

  try {
    const zRes = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: ZARINPAL_MERCHANT_ID,
        amount,
        callback_url: CALLBACK_URL,
        description: description || 'خرید از فروشگاه',
      }),
    });
    const data = await zRes.json();
    if (data.data && data.data.code === 100) {
      const authority = data.data.authority;
      db.prepare(
        'INSERT INTO orders (user_id, items, amount, authority, status) VALUES (?, ?, ?, ?, ?)'
      ).run(req.user.id, JSON.stringify(items || []), amount, authority, 'pending');
      res.json({ paymentUrl: `https://www.zarinpal.com/pg/StartPay/${authority}` });
    } else {
      res.status(400).json({ error: 'خطا در اتصال به درگاه پرداخت', detail: data });
    }
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور در ارتباط با درگاه' });
  }
});

// Zarinpal redirects the buyer's browser here after payment
app.get('/payment/callback', async (req, res) => {
  const { Authority, Status } = req.query;
  const order = db.prepare('SELECT * FROM orders WHERE authority = ?').get(Authority);
  if (!order) return res.redirect(`${FRONTEND_URL}/payment/result?status=notfound`);

  if (Status !== 'OK') {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('canceled', order.id);
    return res.redirect(`${FRONTEND_URL}/payment/result?status=canceled`);
  }

  try {
    const zRes = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: ZARINPAL_MERCHANT_ID,
        amount: order.amount,
        authority: Authority,
      }),
    });
    const data = await zRes.json();
    if (data.data && (data.data.code === 100 || data.data.code === 101)) {
      db.prepare('UPDATE orders SET status = ?, ref_id = ? WHERE id = ?').run(
        'paid',
        String(data.data.ref_id),
        order.id
      );
      return res.redirect(`${FRONTEND_URL}/payment/result?status=success&ref=${data.data.ref_id}`);
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', order.id);
    res.redirect(`${FRONTEND_URL}/payment/result?status=failed`);
  } catch (e) {
    res.redirect(`${FRONTEND_URL}/payment/result?status=error`);
  }
});

app.get('/', (req, res) => res.send('Store API is running'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
