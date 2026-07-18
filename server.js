require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- ذخیره‌سازی ساده روی فایل JSON (بدون نیاز به کامپایل) ----------
const DB_FILE = path.join(__dirname, 'store-data.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], orders: [], nextUserId: 1, nextOrderId: 1 };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: [], orders: [], nextUserId: 1, nextOrderId: 1 };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

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
  const db = readDB();
  const exists = db.users.find((u) => u.email === email);
  if (exists) return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است' });

  const hash = await bcrypt.hash(password, 10);
  const user = { id: db.nextUserId++, email, password_hash: hash, full_name: fullName || '', created_at: new Date().toISOString() };
  db.users.push(user);
  writeDB(db);

  const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email, fullName: user.full_name } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const db = readDB();
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, fullName: user.full_name } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const db = readDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json({ user: { id: user.id, email: user.email, fullName: user.full_name } });
});

// ---------- Orders ----------
app.get('/api/orders', auth, (req, res) => {
  const db = readDB();
  const orders = db.orders
    .filter((o) => o.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(orders);
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
      const db = readDB();
      const order = {
        id: db.nextOrderId++,
        user_id: req.user.id,
        items: items || [],
        amount,
        authority,
        ref_id: null,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      db.orders.push(order);
      writeDB(db);
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
  const db = readDB();
  const order = db.orders.find((o) => o.authority === Authority);
  if (!order) return res.redirect(`${FRONTEND_URL}/payment/result?status=notfound`);

  if (Status !== 'OK') {
    order.status = 'canceled';
    writeDB(db);
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
      order.status = 'paid';
      order.ref_id = String(data.data.ref_id);
      writeDB(db);
      return res.redirect(`${FRONTEND_URL}/payment/result?status=success&ref=${data.data.ref_id}`);
    }
    order.status = 'failed';
    writeDB(db);
    res.redirect(`${FRONTEND_URL}/payment/result?status=failed`);
  } catch (e) {
    res.redirect(`${FRONTEND_URL}/payment/result?status=error`);
  }
});

app.get('/', (req, res) => res.send('Store API is running'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
