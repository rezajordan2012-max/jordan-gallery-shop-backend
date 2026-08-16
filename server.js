require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

// برای ویژگی «تشخیص هوشمند مشخصات محصول از روی عکس» — کلید API آنتروپیک را در محیط سرور تنظیم کن
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// برای ویژگی «جستجوی مشخصات ادکلن بر اساس نام محصول» — کلید رایگان از fraganty.ai
const FRAGANTY_API_KEY = process.env.FRAGANTY_API_KEY;
const FRAGANTY_BASE_URL = 'https://fraganty.ai';

const MONGODB_URI = process.env.MONGODB_URI;

let mongoClientPromise = null;
let inMemoryFallback = null;

if (!MONGODB_URI) {
  console.warn('⚠️  هشدار: MONGODB_URI تنظیم نشده — از حافظه‌ی موقت استفاده می‌شود.');
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'rezajordan2012@gmail.com').toLowerCase();

const SEED_PRODUCTS = [
  { id: 'p1', name: 'بلور شب', brand: 'جردن', category: 'perfume', subcategory: 'womenPerfume', price: 2450000, description: 'رایحه‌ای شرقی و گرم با نت‌های عود و وانیل، مناسب شب.', image: '' },
  { id: 'p2', name: 'باغ سپید', brand: 'جردن', category: 'perfume', subcategory: 'menPerfume', price: 1980000, description: 'ترکیبی تازه از یاس و مرکبات برای روزهای بهاری.', image: '' },
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

function defaultState() {
  return { users: [], orders: [], products: SEED_PRODUCTS, settings: {}, nextUserId: 1, nextOrderId: 1, nextProductId: 8 };
}

async function getCollection() {
  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    mongoClientPromise = client.connect().then(() => client);
  }
  const client = await mongoClientPromise;
  return client.db('jordan_gallery').collection('store_state');
}

async function readDB() {
  if (!MONGODB_URI) {
    if (!inMemoryFallback) inMemoryFallback = defaultState();
    return inMemoryFallback;
  }
  const col = await getCollection();
  let doc = await col.findOne({ _id: 'main' });
  if (!doc) {
    doc = { _id: 'main', ...defaultState() };
    await col.insertOne(doc);
  }
  if (!Array.isArray(doc.products) || doc.products.length === 0) doc.products = SEED_PRODUCTS;
  if (!doc.nextProductId) doc.nextProductId = 8;
  if (!doc.settings || typeof doc.settings !== 'object') doc.settings = {};
  if (!Array.isArray(doc.users)) doc.users = [];
  if (!Array.isArray(doc.orders)) doc.orders = [];
  if (!doc.nextUserId) doc.nextUserId = 1;
  if (!doc.nextOrderId) doc.nextOrderId = 1;
  return doc;
}

async function writeDB(data) {
  if (!MONGODB_URI) {
    inMemoryFallback = data;
    return;
  }
  const col = await getCollection();
  const { _id, ...rest } = data;
  await col.replaceOne({ _id: 'main' }, { _id: 'main', ...rest }, { upsert: true });
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

function requireAdmin(req, res, next) {
  if (!req.user || String(req.user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'اجازه‌ی دسترسی به این بخش را نداری' });
  }
  next();
}

function withDb(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      console.error('DB error:', e);
      res.status(500).json({ error: 'مشکل در اتصال به پایگاه‌داده — لطفاً چند لحظه بعد دوباره امتحان کن' });
    }
  };
}

function noCache(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
}

app.post('/api/auth/register', withDb(async (req, res) => {
  const { email, password, fullName } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'ایمیل و رمز عبور (حداقل ۶ کاراکتر) الزامی است' });
  }
  const db = await readDB();
  const exists = db.users.find((u) => u.email === email);
  if (exists) return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است' });

  const hash = await bcrypt.hash(password, 10);
  const user = { id: db.nextUserId++, email, password_hash: hash, full_name: fullName || '', created_at: new Date().toISOString() };
  db.users.push(user);
  await writeDB(db);

  const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email, fullName: user.full_name, createdAt: user.created_at } });
}));

app.post('/api/auth/login', withDb(async (req, res) => {
  const { email, password } = req.body || {};
  const db = await readDB();
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, fullName: user.full_name, createdAt: user.created_at || null } });
}));

app.get('/api/auth/me', auth, withDb(async (req, res) => {
  const db = await readDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json({ user: { id: user.id, email: user.email, fullName: user.full_name, createdAt: user.created_at || null } });
}));

app.post('/api/upload', auth, requireAdmin, async (req, res) => {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.status(500).json({ error: 'تنظیمات Cloudinary روی سرور کامل نشده است' });
  }
  const { imageBase64 } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'فایل معتبر نیست' });
  }

  const imageMatch = imageBase64.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  const videoMatch = imageBase64.match(/^data:video\/(mp4|webm|quicktime|ogg|mov);base64,(.+)$/);

  if (!imageMatch && !videoMatch) {
    return res.status(400).json({ error: 'فرمت فایل پشتیبانی نمی‌شود' });
  }

  const isVideo = !!videoMatch;
  const dataPart = isVideo ? videoMatch[2] : imageMatch[2];

  const approxBytes = Math.ceil((dataPart.length * 3) / 4);
  const maxBytes = isVideo ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
  if (approxBytes > maxBytes) {
    return res.status(413).json({
      error: isVideo ? 'حجم ویدیو بیش از حد مجاز است (حداکثر ۳۰ مگابایت)' : 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)',
    });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'maison-store';
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

    const resourceType = isVideo ? 'video' : 'image';
    const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await cloudRes.json();
    if (!cloudRes.ok || !data.secure_url) {
      return res.status(502).json({ error: data.error?.message || 'آپلود به Cloudinary ناموفق بود' });
    }
    res.json({ url: data.secure_url, type: isVideo ? 'video' : 'image' });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور هنگام آپلود فایل' });
  }
});

// ---------- تشخیص هوشمند مشخصات محصول از روی عکس (فقط مدیر) ----------
// عکسی از جعبه/برچسب/صفحه‌ی مرجع محصول (مثلاً عطر) می‌گیرد، آن را به مدل بینایی Claude می‌دهد،
// و یک JSON ساختاریافته با فیلدهای قابل‌تشخیص برمی‌گرداند تا پنل مدیریت آن‌ها را در فرم پر کند.
app.post('/api/ai/extract-product', auth, requireAdmin, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY روی سرور تنظیم نشده است — برای فعال‌سازی این ویژگی، کلید API آنتروپیک را در متغیرهای محیطی سرور (Render) اضافه کن' });
  }
  const { imageBase64 } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'تصویر معتبر نیست' });
  }
  const match = imageBase64.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'فرمت تصویر پشتیبانی نمی‌شود (فقط png, jpg, webp)' });
  }
  const mediaType = match[1];
  const data = match[2];
  const approxBytes = Math.ceil((data.length * 3) / 4);
  if (approxBytes > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)' });
  }

  const instruction = `تصویر پیوست‌شده را با دقت بررسی کن. این تصویر می‌تواند جعبه، برچسب، بطری یک محصول (مثلاً عطر/ادکلن) یا اسکرین‌شاتی از یک سایت مرجع عطر (مثل Fragrantica) باشد. هر اطلاعاتی که با اطمینان از روی تصویر قابل تشخیص است را استخراج کن. اگر مطمئن نیستی یا چیزی در تصویر دیده نمی‌شود، آن فیلد را خالی ("") بگذار — هرگز حدس نزن یا اطلاعات جعلی نساز.

قانون مهم و اجباری درباره‌ی زبان خروجی: تمام فیلدهای زیر باید به فارسی نوشته شوند، حتی اگر متن روی خود تصویر انگلیسی یا هر زبان دیگری باشد — یعنی باید ترجمه یا آوانویسی رایج فارسی همان کلمه را بنویسی، نه متن اصلی به زبان مبدأ. تنها استثنا فیلد "nameEn" است که باید دقیقاً همان‌طور که روی تصویر نوشته شده (به زبان اصلی) باقی بماند. برای نمونه اگر برند "Chanel" است در فیلد brand بنویس "شنل"؛ اگر کشور سازنده "France" است بنویس "فرانسه"؛ اگر نتی به اسم "Bergamot" روی تصویر است در فیلدهای نت، "برگاموت" بنویس. حتی توضیح (description) هم باید کاملاً فارسی و روان نوشته شود.

فقط و فقط یک شیء JSON معتبر برگردان (بدون توضیح اضافه، بدون Markdown، بدون backtick)، دقیقاً با این ساختار:
{
  "name": "نام محصول به فارسی (اگر روی تصویر انگلیسی است، به فارسی رایج/معمول ترجمه یا آوانویسی کن)",
  "nameEn": "نام دقیق محصول همان‌طور که روی تصویر/جعبه نوشته شده (تنها فیلدی که به زبان اصلی/انگلیسی می‌ماند)",
  "brand": "نام برند، به فارسی رایج (آوانویسی‌شده)، مثلاً Chanel -> شنل، Dior -> دیور، Lalique -> لالیک",
  "concentration": "نوع غلظت در صورت مشاهده، دقیقاً یکی از این مقادیر انگلیسی (این یکی فقط استثنائاً انگلیسی می‌ماند چون داخلی و کدی است): Extrait de Parfum, Parfum, Eau de Parfum, Eau de Parfum Intense, Eau de Toilette, Eau de Cologne, Eau Fraiche — یا خالی",
  "topNotes": "نت‌های آغازین دیده‌شده، با ویرگول فارسی (،) جدا از هم، همه به فارسی رایج نام نت (مثلاً «برگاموت، لیمو») حتی اگر روی تصویر انگلیسی نوشته شده باشند",
  "middleNotes": "نت‌های میانی به همین شکل، همه به فارسی",
  "baseNotes": "نت‌های پایه به همین شکل، همه به فارسی",
  "perfumer": "نام عطار در صورت مشاهده، به فارسی آوانویسی‌شده",
  "countryOfOrigin": "کشور سازنده در صورت مشاهده، به فارسی (مثلاً France -> فرانسه، Italy -> ایتالیا)",
  "yearMade": "سال ساخت در صورت مشاهده (فقط عدد)",
  "description": "یک توضیح کوتاه دو تا سه جمله‌ای کاملاً فارسی درباره‌ی محصول بر پایه‌ی آنچه از تصویر برداشت می‌شود (اختیاری، فقط اگر اطلاعات کافی برای یک توضیح معنادار وجود دارد)"
}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
              { type: 'text', text: instruction },
            ],
          },
        ],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      return res.status(502).json({ error: (aiData && aiData.error && aiData.error.message) || 'خطا در ارتباط با سرویس هوش مصنوعی' });
    }
    const textBlock = (aiData.content || []).find((c) => c.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'پاسخ نامعتبر از هوش مصنوعی دریافت شد' });
    }
    let parsed;
    try {
      const cleaned = textBlock.text.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: 'پاسخ هوش مصنوعی قابل تفسیر نبود — دوباره امتحان کن' });
    }
    res.json(parsed);
  } catch (e) {
    console.error('AI extract error:', e);
    res.status(500).json({ error: 'خطای سرور هنگام تحلیل تصویر' });
  }
});

// ---------- جستجوی مشخصات ادکلن بر اساس نام محصول (فقط مدیر) — از دیتابیس رایگان fraganty.ai ----------
// مرحله‌ی ۱: جستجو با اسم، لیست کوتاهی از محصولات محتمل برمی‌گرداند تا مدیر مورد درست را انتخاب کند.
app.get('/api/ai/search-perfume', auth, requireAdmin, async (req, res) => {
  if (!FRAGANTY_API_KEY) {
    return res.status(500).json({ error: 'FRAGANTY_API_KEY روی سرور تنظیم نشده است — کلید رایگان را از fraganty.ai بگیر و در متغیرهای محیطی سرور اضافه کن' });
  }
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'نام محصول را وارد کن' });

  try {
    const url = `${FRAGANTY_BASE_URL}/api/perfumes?q=${encodeURIComponent(q)}&limit=8`;
    const fRes = await fetch(url, { headers: { 'X-API-Key': FRAGANTY_API_KEY } });
    const fData = await fRes.json();
    if (!fRes.ok) {
      return res.status(fRes.status === 429 ? 429 : 502).json({
        error: fRes.status === 429
          ? 'سهمیه‌ی ماهانه‌ی رایگان fraganty.ai تمام شده — تا ماه بعد صبر کن یا پلن پولی بگیر'
          : (fData && fData.error) || 'خطا در ارتباط با fraganty.ai',
      });
    }
    const results = (fData.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      year: p.year,
      image: p.image,
    }));
    res.json({ data: results });
  } catch (e) {
    console.error('Fraganty search error:', e);
    res.status(500).json({ error: 'خطای سرور هنگام جستجو در fraganty.ai' });
  }
});

// مرحله‌ی ۲: بعد از انتخاب مدیر، جزئیات کامل همان محصول (نت‌ها، غلظت، عطار، سال و ...) را می‌گیرد.
app.get('/api/ai/perfume-details', auth, requireAdmin, async (req, res) => {
  if (!FRAGANTY_API_KEY) {
    return res.status(500).json({ error: 'FRAGANTY_API_KEY روی سرور تنظیم نشده است' });
  }
  const slug = (req.query.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'شناسه‌ی محصول نامعتبر است' });

  try {
    const url = `${FRAGANTY_BASE_URL}/api/perfumes/${encodeURIComponent(slug)}`;
    const fRes = await fetch(url, { headers: { 'X-API-Key': FRAGANTY_API_KEY } });
    const fData = await fRes.json();
    if (!fRes.ok) {
      return res.status(fRes.status === 429 ? 429 : 502).json({
        error: fRes.status === 429
          ? 'سهمیه‌ی ماهانه‌ی رایگان fraganty.ai تمام شده'
          : (fData && fData.error) || 'خطا در دریافت جزئیات از fraganty.ai',
      });
    }
    res.json(fData);
  } catch (e) {
    console.error('Fraganty details error:', e);
    res.status(500).json({ error: 'خطای سرور هنگام دریافت جزئیات از fraganty.ai' });
  }
});

app.get('/api/settings', noCache, withDb(async (req, res) => {
  const db = await readDB();
  res.json(db.settings || {});
}));

app.put('/api/settings', auth, requireAdmin, withDb(async (req, res) => {
  const db = await readDB();
  db.settings = { ...db.settings, ...(req.body || {}) };
  await writeDB(db);
  res.json(db.settings);
}));

app.get('/api/products', noCache, withDb(async (req, res) => {
  const db = await readDB();
  res.json(db.products || []);
}));

// افزودن محصول — فیلد nameEn (نام انگلیسی، اختیاری) هم اضافه شد
app.post('/api/products', auth, requireAdmin, withDb(async (req, res) => {
  const p = req.body || {};
  if (!p.name || !p.price) return res.status(400).json({ error: 'نام و قیمت محصول الزامی است' });
  const db = await readDB();
  const id = 'p' + db.nextProductId++;
  const product = {
    id,
    name: p.name,
    nameEn: p.nameEn || '',
    brand: p.brand || '',
    category: p.category || 'perfume',
    subcategory: p.subcategory || '',
    type: p.type || '',
    facets: (p.facets && typeof p.facets === 'object') ? p.facets : {},
    price: Number(p.price),
    description: p.description || '',
    properties: p.properties || '',
    ingredients: p.ingredients || '',
    topNotes: p.topNotes || '',
    middleNotes: p.middleNotes || '',
    baseNotes: p.baseNotes || '',
    longevity: p.longevity || '',
    sillage: p.sillage || '',
    perfumer: p.perfumer || '',
    countryOfOrigin: p.countryOfOrigin || '',
    yearMade: p.yearMade || '',
    fragranticaRating: p.fragranticaRating || '',
    discountPercent: Number(p.discountPercent) || 0,
    image: p.image || '',
    imageFit: p.imageFit === 'cover' ? 'cover' : 'contain',
    imagePosX: Number.isFinite(Number(p.imagePosX)) ? Number(p.imagePosX) : 50,
    imagePosY: Number.isFinite(Number(p.imagePosY)) ? Number(p.imagePosY) : 50,
    imageZoom: Number.isFinite(Number(p.imageZoom)) && Number(p.imageZoom) > 0 ? Number(p.imageZoom) : 1,
    ...(Array.isArray(p.variants) && p.variants.length > 0 ? { variants: p.variants } : {}),
  };
  db.products.push(product);
  await writeDB(db);
  res.json(product);
}));

// ویرایش محصول — فیلد nameEn هم به‌روزرسانی می‌شود
app.put('/api/products/:id', auth, requireAdmin, withDb(async (req, res) => {
  const db = await readDB();
  const idx = db.products.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'محصول یافت نشد' });
  const p = req.body || {};
  const updated = {
    ...db.products[idx],
    name: p.name ?? db.products[idx].name,
    nameEn: p.nameEn !== undefined ? p.nameEn : (db.products[idx].nameEn || ''),
    brand: p.brand ?? db.products[idx].brand,
    category: p.category ?? db.products[idx].category,
    subcategory: p.subcategory !== undefined ? p.subcategory : db.products[idx].subcategory,
    type: p.type !== undefined ? p.type : db.products[idx].type,
    facets: p.facets !== undefined ? p.facets : db.products[idx].facets,
    price: p.price !== undefined ? Number(p.price) : db.products[idx].price,
    description: p.description ?? db.products[idx].description,
    properties: p.properties !== undefined ? p.properties : db.products[idx].properties,
    ingredients: p.ingredients !== undefined ? p.ingredients : db.products[idx].ingredients,
    topNotes: p.topNotes !== undefined ? p.topNotes : (db.products[idx].topNotes || ''),
    middleNotes: p.middleNotes !== undefined ? p.middleNotes : (db.products[idx].middleNotes || ''),
    baseNotes: p.baseNotes !== undefined ? p.baseNotes : (db.products[idx].baseNotes || ''),
    longevity: p.longevity !== undefined ? p.longevity : (db.products[idx].longevity || ''),
    sillage: p.sillage !== undefined ? p.sillage : (db.products[idx].sillage || ''),
    perfumer: p.perfumer !== undefined ? p.perfumer : (db.products[idx].perfumer || ''),
    countryOfOrigin: p.countryOfOrigin !== undefined ? p.countryOfOrigin : (db.products[idx].countryOfOrigin || ''),
    yearMade: p.yearMade !== undefined ? p.yearMade : (db.products[idx].yearMade || ''),
    fragranticaRating: p.fragranticaRating !== undefined ? p.fragranticaRating : (db.products[idx].fragranticaRating || ''),
    discountPercent: p.discountPercent !== undefined ? (Number(p.discountPercent) || 0) : db.products[idx].discountPercent,
    image: p.image ?? db.products[idx].image,
    imageFit: p.imageFit !== undefined ? (p.imageFit === 'cover' ? 'cover' : 'contain') : (db.products[idx].imageFit || 'contain'),
    imagePosX: p.imagePosX !== undefined ? (Number(p.imagePosX) || 50) : (db.products[idx].imagePosX ?? 50),
    imagePosY: p.imagePosY !== undefined ? (Number(p.imagePosY) || 50) : (db.products[idx].imagePosY ?? 50),
    imageZoom: p.imageZoom !== undefined ? (Number(p.imageZoom) || 1) : (db.products[idx].imageZoom ?? 1),
  };
  if (Array.isArray(p.variants) && p.variants.length > 0) {
    updated.variants = p.variants;
  } else if (p.variants !== undefined) {
    delete updated.variants;
  }
  db.products[idx] = updated;
  await writeDB(db);
  res.json(updated);
}));

app.delete('/api/products/:id', auth, requireAdmin, withDb(async (req, res) => {
  const db = await readDB();
  const before = db.products.length;
  db.products = db.products.filter((x) => x.id !== req.params.id);
  if (db.products.length === before) return res.status(404).json({ error: 'محصول یافت نشد' });
  await writeDB(db);
  res.json({ ok: true });
}));

app.get('/api/orders', auth, noCache, withDb(async (req, res) => {
  const db = await readDB();
  const orders = db.orders
    .filter((o) => o.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(orders);
}));

app.post('/api/payment/request', auth, withDb(async (req, res) => {
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
      const db = await readDB();
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
      await writeDB(db);
      res.json({ paymentUrl: `https://www.zarinpal.com/pg/StartPay/${authority}` });
    } else {
      res.status(400).json({ error: 'خطا در اتصال به درگاه پرداخت', detail: data });
    }
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور در ارتباط با درگاه' });
  }
}));

app.get('/payment/callback', async (req, res) => {
  const { Authority, Status } = req.query;
  let db;
  try {
    db = await readDB();
  } catch (e) {
    return res.redirect(`${FRONTEND_URL}/payment/result?status=error`);
  }
  const order = db.orders.find((o) => o.authority === Authority);
  if (!order) return res.redirect(`${FRONTEND_URL}/payment/result?status=notfound`);

  if (Status !== 'OK') {
    order.status = 'canceled';
    await writeDB(db);
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
      await writeDB(db);
      return res.redirect(`${FRONTEND_URL}/payment/result?status=success&ref=${data.data.ref_id}`);
    }
    order.status = 'failed';
    await writeDB(db);
    res.redirect(`${FRONTEND_URL}/payment/result?status=failed`);
  } catch (e) {
    res.redirect(`${FRONTEND_URL}/payment/result?status=error`);
  }
});

app.get('/', (req, res) => res.send('Store API is running'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
