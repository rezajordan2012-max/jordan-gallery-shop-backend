require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// ---------- آپلود عکس محصولات — روی Cloudinary ذخیره می‌شود (پایدار، برخلاف دیسک سرور) ----------
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

// ---------- ذخیره‌سازی ساده روی فایل JSON (بدون نیاز به کامپایل) ----------
const DB_FILE = path.join(__dirname, 'store-data.json');

// فقط همین ایمیل اجازه‌ی افزودن/ویرایش/حذف محصول را دارد.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'rezajordan2012@gmail.com').toLowerCase();

const CATEGORY_LABEL = {
  perfume: 'عطر و ادکلن',
  beauty: 'آرایشی و بهداشتی',
  electronics: 'لوازم برقی شخصی',
};

const SEED_PRODUCTS = [
  { id: 'p1', name: 'بلور شب', brand: 'خانه میسان', category: 'perfume', subcategory: 'women', price: 2450000, description: 'رایحه‌ای شرقی و گرم با نت‌های عود و وانیل، مناسب شب.', image: '' },
  { id: 'p2', name: 'باغ سپید', brand: 'خانه میسان', category: 'perfume', subcategory: 'unisex', price: 1980000, description: 'ترکیبی تازه از یاس و مرکبات برای روزهای بهاری.', image: '' },
  { id: 'p3', name: 'کانسیلر پوششی', brand: 'اطلس', category: 'makeup', subcategory: 'face', type: 'concealer', price: 890000, description: 'کانسیلر با پوشش بالا، مناسب پوست‌های خشک و بی‌روح.', image: '' },
  { id: 'p4', name: 'پالت سایه صدف', brand: 'اطلس', category: 'makeup', subcategory: 'eye', type: 'eyeshadow', price: 1250000, description: 'پالت سایه با پیگمنت بالا و بافت مخملی.', image: '' },
  {
    id: 'p7',
    name: 'رژ لب مخملی',
    brand: 'اطلس',
    category: 'makeup',
    subcategory: 'lip',
    type: 'lipstick',
    price: 620000,
    description: 'بافت مخملی و ماندگاری بالا، با طیف گسترده‌ی رنگ — رنگ و شماره را انتخاب کن.',
    image: '',
    variants: [
      { id: 'v1', label: 'شماره ۱ - قرمز کلاسیک', hex: '#B0202E', image: '' },
      { id: 'v2', label: 'شماره ۲ - صورتی ملایم', hex: '#D98CA0', image: '' },
      { id: 'v3', label: 'شماره ۳ - نارنجی مرجانی', hex: '#E06B4E', image: '' },
      { id: 'v4', label: 'شماره ۴ - بژ خاکی', hex: '#B98567', image: '' },
      { id: 'v5', label: 'شماره ۵ - قرمز آجری', hex: '#8C3A2B', image: '' },
      { id: 'v6', label: 'شماره ۶ - زرشکی تیره', hex: '#5C1A2E', image: '' },
    ],
  },
  { id: 'p8', name: 'ست براش حرفه‌ای', brand: 'اطلس', category: 'makeup', subcategory: 'accessory', type: 'brushes', price: 540000, description: 'ست براش‌های آرایشی با موی مصنوعی نرم.', image: '' },
  { id: 'p9', name: 'شامپو ترمیم‌کننده', brand: 'ولوره', category: 'hygiene', subcategory: 'hairCare', price: 380000, description: 'شامپو بدون سولفات، مناسب موهای آسیب‌دیده.', image: '' },
  { id: 'p10', name: 'لوسیون آبرسان بدن', brand: 'ولوره', category: 'hygiene', subcategory: 'bodySkin', price: 420000, description: 'لوسیون سبک و سریع‌جذب برای آبرسانی روزانه‌ی پوست.', image: '' },
  { id: 'p5', name: 'سشوار حرفه‌ای یون‌دار', brand: 'ولوره', category: 'electronics', subcategory: 'hair', price: 3200000, description: 'قدرت ۲۲۰۰ وات، فناوری یونیزه برای کاهش وز مو.', image: '' },
  { id: 'p6', name: 'اپیلاتور بی‌سیم', brand: 'ولوره', category: 'electronics', subcategory: 'body', price: 2100000, description: 'طراحی مینیمال، شارژ سریع و کاربرد ملایم روی پوست.', image: '' },
  { id: 'p11', name: 'دستگاه پاکسازی صورت', brand: 'ولوره', category: 'electronics', subcategory: 'face', price: 1650000, description: 'برس سونیک برای پاکسازی عمیق منافذ پوست صورت.', image: '' },
];

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], orders: [], products: SEED_PRODUCTS, settings: {}, nextUserId: 1, nextOrderId: 1, nextProductId: 8 };
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // فایل‌های قدیمی‌تر ممکن است فیلد products را نداشته باشند؛ در آن صورت با مقادیر پیش‌فرض پر می‌شود.
    if (!Array.isArray(data.products)) data.products = SEED_PRODUCTS;
    if (!data.nextProductId) data.nextProductId = 8;
    if (!data.settings || typeof data.settings !== 'object') data.settings = {};
    return data;
  } catch (e) {
    return { users: [], orders: [], products: SEED_PRODUCTS, settings: {}, nextUserId: 1, nextOrderId: 1, nextProductId: 8 };
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

// فقط بعد از auth استفاده شود: تضمین می‌کند کاربر همان ایمیل مدیر سایت است.
function requireAdmin(req, res, next) {
  if (!req.user || String(req.user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'اجازه‌ی دسترسی به این بخش را نداری' });
  }
  next();
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

// ---------- Upload تصویر (فقط مدیر) — به‌جای دیسک سرور، روی Cloudinary ذخیره می‌شود ----------
// ورودی: { imageBase64: "data:image/jpeg;base64,...." }
// خروجی: { url: "https://res.cloudinary.com/.../xxxx.jpg" }
app.post('/api/upload', auth, requireAdmin, async (req, res) => {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.status(500).json({ error: 'تنظیمات Cloudinary روی سرور کامل نشده است (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' });
  }
  const { imageBase64 } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string' || !imageBase64.startsWith('data:image/')) {
    return res.status(400).json({ error: 'فایل تصویر معتبر نیست' });
  }
  const match = imageBase64.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'فرمت تصویر پشتیبانی نمی‌شود (فقط jpg, png, webp, gif)' });

  // حداکثر حجم: تقریباً ۱۰ مگابایت
  const approxBytes = Math.ceil((match[2].length * 3) / 4);
  if (approxBytes > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)' });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'maison-store';
    // امضای درخواست طبق مستندات Cloudinary: sha1(پارامترها به‌ترتیب حروف‌الفبا + api_secret)
    const signature = crypto
      .createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
      .digest('hex');

    const body = new URLSearchParams({
      file: imageBase64,
      api_key: CLOUDINARY_API_KEY,
      timestamp: String(timestamp),
      folder,
      signature,
    });

    const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await cloudRes.json();
    if (!cloudRes.ok || !data.secure_url) {
      return res.status(502).json({ error: data.error?.message || 'آپلود به Cloudinary ناموفق بود' });
    }
    res.json({ url: data.secure_url });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور هنگام آپلود تصویر' });
  }
});

// ---------- Settings (مثل تصویر Hero صفحه‌ی اصلی) ----------
app.get('/api/settings', (req, res) => {
  const db = readDB();
  res.json(db.settings || {});
});

app.put('/api/settings', auth, requireAdmin, (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...(req.body || {}) };
  writeDB(db);
  res.json(db.settings);
});

// ---------- Products ----------
// مشاهده‌ی محصولات برای همه آزاد است (فروشگاه عمومی)
app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json(db.products || []);
});

// افزودن، ویرایش و حذف محصول فقط برای مدیر سایت (auth + requireAdmin)
app.post('/api/products', auth, requireAdmin, (req, res) => {
  const p = req.body || {};
  if (!p.name || !p.price) return res.status(400).json({ error: 'نام و قیمت محصول الزامی است' });
  const db = readDB();
  const id = 'p' + db.nextProductId++;
  const product = {
    id,
    name: p.name,
    brand: p.brand || '',
    category: p.category || 'perfume',
    subcategory: p.subcategory || '',
    type: p.type || '',
    price: Number(p.price),
    description: p.description || '',
    image: p.image || '',
    ...(Array.isArray(p.variants) && p.variants.length > 0 ? { variants: p.variants } : {}),
  };
  db.products.push(product);
  writeDB(db);
  res.json(product);
});

app.put('/api/products/:id', auth, requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.products.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'محصول یافت نشد' });
  const p = req.body || {};
  const updated = {
    ...db.products[idx],
    name: p.name ?? db.products[idx].name,
    brand: p.brand ?? db.products[idx].brand,
    category: p.category ?? db.products[idx].category,
    subcategory: p.subcategory !== undefined ? p.subcategory : db.products[idx].subcategory,
    type: p.type !== undefined ? p.type : db.products[idx].type,
    price: p.price !== undefined ? Number(p.price) : db.products[idx].price,
    description: p.description ?? db.products[idx].description,
    image: p.image ?? db.products[idx].image,
  };
  if (Array.isArray(p.variants) && p.variants.length > 0) {
    updated.variants = p.variants;
  } else if (p.variants !== undefined) {
    delete updated.variants;
  }
  db.products[idx] = updated;
  writeDB(db);
  res.json(updated);
});

app.delete('/api/products/:id', auth, requireAdmin, (req, res) => {
  const db = readDB();
  const before = db.products.length;
  db.products = db.products.filter((x) => x.id !== req.params.id);
  if (db.products.length === before) return res.status(404).json({ error: 'محصول یافت نشد' });
  writeDB(db);
  res.json({ ok: true });
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
