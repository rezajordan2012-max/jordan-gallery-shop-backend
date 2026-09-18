require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// ============================================================
// مرورگر هدلس (Headless Browser) — برای صفحاتی مثل دیور که رنگ‌ها/عکس‌ها را فقط با اجرای
// واقعیِ جاوااسکریپت در صفحه می‌سازند (نه در HTMLِ خامی که یک fetch ساده برمی‌گرداند).
// بارِ نصب روی سرور (این دو پکیج باید در package.json/npm install اضافه شوند):
//   npm install puppeteer-core @sparticuz/chromium
// چرا این ترکیب و نه پکیجِ کاملِ puppeteer؟ چون @sparticuz/chromium یک باینریِ Chromium
// فشرده و تا حدِ زیادی self-contained ارائه می‌دهد که روی هاست‌های محدود مثل Render (بدونِ نیاز
// به نصبِ دستیِ کتابخانه‌های سیستمیِ اضافه) هم معمولاً بالا می‌آید؛ پکیجِ کاملِ puppeteer اغلب
// روی چنین هاست‌هایی به خطای «missing shared libraries» می‌خورد.
// اگر این دو پکیج نصب نشده باشند (یا نتوانند روی هاستِ فعلی بالا بیایند)، کلِ سایت همچنان کار
// می‌کند — فقط ابزارهای «ورود محصول با لینک» و «استخراج طیف رنگ از لینک» به همان روشِ قدیمی
// (fetch سبک، بدون اجرای جاوااسکریپت) برمی‌گردند؛ یعنی این قابلیت هرگز چیزی را خراب نمی‌کند.
let puppeteerCore = null;
let chromiumPkg = null;
try {
  puppeteerCore = require('puppeteer-core');
  chromiumPkg = require('@sparticuz/chromium');
} catch (e) {
  console.warn('⚠️ puppeteer-core یا @sparticuz/chromium نصب نشده — مرورگر هدلس غیرفعال می‌ماند و صفحاتِ JS-محور (مثل دیور) فقط با HTMLِ خام پردازش می‌شوند. برای فعال‌سازیِ کامل: npm install puppeteer-core @sparticuz/chromium');
}
const HEADLESS_BROWSER_ENABLED = !!(puppeteerCore && chromiumPkg) && process.env.DISABLE_HEADLESS_BROWSER !== '1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const FRAGANTY_API_KEY = process.env.FRAGANTY_API_KEY;
const FRAGANTY_BASE_URL = 'https://fraganty.ai';
const REMOVEBG_API_KEY = process.env.REMOVEBG_API_KEY;

// ============================================================
// NEW: Gemini — only the two requested additions
// 1) Product page URL -> Gemini -> structured product fields
// 2) Product image -> Gemini -> structured product fields
// ============================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const MONGODB_URI = process.env.MONGODB_URI;
let mongoClientPromise = null;
let inMemoryFallback = null;

if (!MONGODB_URI) {
  console.warn('⚠️ هشدار: MONGODB_URI تنظیم نشده — از حافظه موقت استفاده می‌شود');
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'rezajordan2012@gmail.com').toLowerCase();

const SEED_PRODUCTS = [
  { id: 'p1', name: 'شب بلور', brand: 'جردن', category: 'perfume', subcategory: 'womenPerfume', price: 2450000, description: 'رایحه‌ای شرقی و گرم با نت‌های عود و وانیل، مناسب شب.', image: '' },
  { id: 'p2', name: 'سپید باغ', brand: 'جردن', category: 'perfume', subcategory: 'menPerfume', price: 1980000, description: 'ترکیبی تازه از یاس و مرکبات برای روزهای بهاری.', image: '' },
  { id: 'p3', name: 'پوششی کانسیلر', brand: 'اطلس', category: 'makeup', subcategory: 'face', type: 'concealer', price: 890000, description: 'کانسیلر با پوشش بالا، مناسب پوست‌های خشک و بی‌روح.', image: '' },
  { id: 'p4', name: 'صدف سایه پالت', brand: 'اطلس', category: 'makeup', subcategory: 'eye', type: 'eyeshadow', price: 1250000, description: 'پالت سایه با پیگمنت بالا و بافت مخملی.', image: '' },
  {
    id: 'p7', name: 'رژ لب مخملی', brand: 'اطلس', category: 'makeup', subcategory: 'lip', type: 'lipstick', price: 620000,
    description: 'بافت مخملی و ماندگاری بالا، با طیف گسترده رنگ — رنگ و شماره را انتخاب کن.', image: '',
    variants: [
      { id: 'v1', label: 'قرمز - شماره ۱ کلاسیک', hex: '#B0202E', image: '' },
      { id: 'v2', label: 'صورتی - شماره ۲ ملایم', hex: '#D98CA0', image: '' },
      { id: 'v3', label: 'نارنجی - شماره ۳ مرجانی', hex: '#E06B4E', image: '' },
      { id: 'v4', label: 'شماره ۴ - بژ خاکی', hex: '#B98567', image: '' },
      { id: 'v5', label: 'شماره ۵ - قرمز آجری', hex: '#8C3A2B', image: '' },
      { id: 'v6', label: 'زرشکی - شماره ۶ تیره', hex: '#5C1A2E', image: '' },
    ],
  },
  { id: 'p8', name: 'ست براش حرفه‌ای', brand: 'اطلس', category: 'makeup', subcategory: 'accessory', type: 'brushes', price: 540000, description: 'ست براش‌های آرایشی با موی مصنوعی نرم.', image: '' },
  { id: 'p9', name: 'شامپو ترمیم‌کننده', brand: 'ولوره', category: 'hygiene', subcategory: 'hairCare', price: 380000, description: 'شامپو بدون سولفات، مناسب موهای آسیب‌دیده.', image: '' },
  { id: 'p10', name: 'لوسیون آبرسان بدن', brand: 'ولوره', category: 'hygiene', subcategory: 'bodySkin', price: 420000, description: 'لوسیون سبک و سریع‌جذب برای آبرسانی روزانه پوست.', image: '' },
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
  if (!MONGODB_URI) { inMemoryFallback = data; return; }
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
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'نشست نامعتبر است، دوباره وارد شوید' }); }
}

function requireAdmin(req, res, next) {
  if (!req.user || String(req.user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'اجازه دسترسی به این بخش را نداری' });
  }
  next();
}

function withDb(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      console.error('DB error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'مشکل اتصال به پایگاه‌داده — لطفًا چند لحظه بعد دوباره امتحان کن' });
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
  if (!email || !password || password.length < 6) return res.status(400).json({ error: 'ایمیل و رمز عبور (حداقل ۶ کاراکتر) الزامی است' });
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

async function removeBackgroundFromDataUri(dataUri) {
  if (!REMOVEBG_API_KEY) return dataUri;
  const match = dataUri.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!match) return dataUri;
  try {
    const r = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': REMOVEBG_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_file_b64: match[2], size: 'auto', format: 'png', bg_color: 'white' }),
    });
    if (!r.ok) return dataUri;
    const buffer = Buffer.from(await r.arrayBuffer());
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (e) { console.error('remove.bg request failed (non-fatal):', e.message); return dataUri; }
}

async function uploadDataUriToCloudinary(dataUri) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) throw new Error('تنظیمات Cloudinary روی سرور کامل نشده است');
  const imageMatch = dataUri.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  const videoMatch = dataUri.match(/^data:video\/(mp4|webm|quicktime|ogg|mov);base64,(.+)$/);
  if (!imageMatch && !videoMatch) throw new Error('فرمت فایل پشتیبانی نمی‌شود');
  const isVideo = !!videoMatch;
  const dataPart = isVideo ? videoMatch[2] : imageMatch[2];
  const approxBytes = Math.ceil((dataPart.length * 3) / 4);
  const maxBytes = isVideo ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
  if (approxBytes > maxBytes) throw new Error(isVideo ? 'حجم ویدیو بیش از حد مجاز است (حداکثر ۳۰ مگابایت)' : 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)');
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'maison-store';
  const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`).digest('hex');
  const body = new URLSearchParams({ file: dataUri, api_key: CLOUDINARY_API_KEY, timestamp: String(timestamp), folder, signature });
  const resourceType = isVideo ? 'video' : 'image';
  const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await cloudRes.json();
  if (!cloudRes.ok || !data.secure_url) throw new Error((data && data.error && data.error.message) || 'آپلود Cloudinary ناموفق بود');
  return { url: data.secure_url, type: isVideo ? 'video' : 'image' };
}

// توضیحِ اصلاحِ مهم: نسخه‌ی قبلی این تابع، عکس را با یک fetch ساده (بدون هیچ هدری) از سایتِ
// مبدأ می‌گرفت. خیلی از CDNهای بزرگ (از جمله همان‌هایی که برندهایی مثل دیور از آن‌ها استفاده
// می‌کنند — Akamai، Scene7 و مشابه) هر درخواستی را که User-Agent مرورگر نداشته باشد یا هدرِ
// Referer درستی (آدرسِ همان صفحه‌ای که عکس رویش نمایش داده می‌شود) نفرستد، با کدِ ۴۰۳ رد
// می‌کنند — یعنی «حفاظت در برابر هات‌لینک». دقیقاً همین بود که باعث می‌شد این تابع همیشه (بدون
// هیچ خطای قابل‌مشاهده‌ای برای مدیر، چون فقط در لاگِ سرور ثبت می‌شد) null برگرداند و در نتیجه
// «فقط شماره‌ی رنگ» منتقل شود ولی خودِ عکس هرگز آپلود نشود. برای رفعِ این مشکل:
//   ۱) یک User-Agent و Accept کاملاً شبیهِ مرورگرِ واقعی می‌فرستیم.
//   ۲) اگر referer (آدرسِ صفحه‌ی مبدأ) داده شده باشد، آن را هم می‌فرستیم.
//   ۳) اگر عکس مستقیماً به‌صورت data: URI باشد (بعضی صفحات به‌جای لینک، خودِ عکس را به همین شکل
//      داخل HTML می‌گذارند)، دیگر نیازی به دانلود نیست — مستقیم آپلود می‌شود.
//   ۴) اگر دانلود یا آپلود شکست بخورد، دلیلِ دقیق را برمی‌گرداند (نه فقط null) تا لایه‌ی بالاتر
//      بتواند به‌جای عکس، لینکِ خامِ اصلی را نگه دارد (بهتر از گم‌شدنِ کاملِ عکس است) و اگر لازم
//      شد پیام روشنی به مدیر نشان دهد.
async function mirrorRemoteImageToCloudinary(remoteUrl, options = {}) {
  const referer = options && options.referer;
  // برای سوآچ‌های رنگ (دایره/مربعِ تخت‌رنگِ کوچک)، حذفِ پس‌زمینه نه لازم است و نه مفید — این
  // عکس‌ها اصلاً پس‌زمینه‌ی جداگانه‌ای برای حذف ندارند؛ رد کردنِ این مرحله هم سریع‌تر است و هم
  // سهمیه‌ی remove.bg را برای دفعاتِ بعدی (که واقعاً لازم است، مثلِ عکسِ اصلیِ محصول) نگه می‌دارد.
  const skipBackgroundRemoval = !!(options && options.skipBackgroundRemoval);
  try {
    if (!remoteUrl || typeof remoteUrl !== 'string') return { url: null, reason: 'آدرس عکس خالی است' };

    // حالت data: URI — عکس از قبل داخلِ خودِ صفحه به‌صورت base64 آمده، نیازی به دانلود نیست.
    if (/^data:image\//i.test(remoteUrl)) {
      const cleanedDirect = skipBackgroundRemoval ? remoteUrl : await removeBackgroundFromDataUri(remoteUrl);
      const uploadedDirect = await uploadDataUriToCloudinary(cleanedDirect);
      return { url: uploadedDirect.url, reason: null };
    }

    if (!/^https?:\/\//i.test(remoteUrl)) return { url: null, reason: 'فرمتِ آدرسِ عکس پشتیبانی نمی‌شود' };

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (referer) fetchHeaders['Referer'] = referer;

    const imgRes = await fetch(remoteUrl, { headers: fetchHeaders });
    if (!imgRes.ok) return { url: null, reason: `دانلودِ عکس با کدِ ${imgRes.status} رد شد (احتمالاً سایتِ مبدأ دانلودِ خودکار را مسدود کرده)` };
    const contentType = imgRes.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return { url: null, reason: `پاسخِ سایتِ مبدأ عکس نبود (${contentType || 'نامشخص'})` };
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length > 10 * 1024 * 1024) return { url: null, reason: 'حجمِ عکس بیش از ۱۰ مگابایت است' };
    const mimeForDataUri = contentType.split(';')[0].replace('image/jpg', 'image/jpeg');
    const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!supported.includes(mimeForDataUri)) return { url: null, reason: `فرمتِ عکس (${mimeForDataUri}) پشتیبانی نمی‌شود` };
    const dataUri = `data:${mimeForDataUri};base64,${buffer.toString('base64')}`;
    const cleaned = skipBackgroundRemoval ? dataUri : await removeBackgroundFromDataUri(dataUri);
    const uploaded = await uploadDataUriToCloudinary(cleaned);
    return { url: uploaded.url, reason: null };
  } catch (e) {
    console.error('mirrorRemoteImageToCloudinary failed:', e.message);
    return { url: null, reason: e.message || 'خطای ناشناخته هنگام دانلود/آپلود عکس' };
  }
}

app.post('/api/upload', auth, requireAdmin, async (req, res) => {
  const { imageBase64, removeBackground } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'فایل معتبر نیست' });
  try {
    const isVideo = imageBase64.startsWith('data:video/');
    const dataToUpload = removeBackground && !isVideo ? await removeBackgroundFromDataUri(imageBase64) : imageBase64;
    res.json(await uploadDataUriToCloudinary(dataToUpload));
  } catch (e) {
    const statusMap = { 'تنظیمات Cloudinary روی سرور کامل نشده است': 500, 'فرمت فایل پشتیبانی نمی‌شود': 400 };
    res.status(statusMap[e.message] || (e.message && e.message.includes('حجم') ? 413 : 502)).json({ error: e.message || 'آپلود ناموفق بود' });
  }
});

// Existing image extraction endpoint — Gemini free-tier model
app.post('/api/ai/extract-product', auth, requireAdmin, async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'کلید GEMINI_API_KEY روی سرور تنظیم نشده است' });
  const { imageBase64 } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'تصویر معتبر نیست' });
  const match = imageBase64.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) return res.status(400).json({ error: 'فرمت تصویر پشتیبانی نمی‌شود (فقط png، jpg، webp)' });
  const approxBytes = Math.ceil((match[2].length * 3) / 4);
  if (approxBytes > 10 * 1024 * 1024) return res.status(413).json({ error: 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)' });
  try {
    const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
    const aiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: match[1], data: match[2] } },
          { text: buildProductExtractionPrompt() },
        ] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    const aiData = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) return res.status(502).json({ error: (aiData && aiData.error && aiData.error.message) ? friendlyAiError(new Error(aiData.error.message)) : `خطا در ارتباط با Gemini (${aiRes.status})` });
    const textBlock = (aiData.candidates || []).flatMap((c) => (c.content && c.content.parts) || []).map((c) => c.text || '').join('').trim();
    if (!textBlock) return res.status(502).json({ error: 'پاسخ نامعتبر از Gemini دریافت شد' });
    res.json(parseJsonObject(textBlock));
  } catch (e) {
    console.error('Gemini image extraction error:', e);
    res.status(502).json({ error: friendlyAiError(e) });
  }
});

function buildProductExtractionPrompt() {
  return `عکسی از محصول/جعبه/برچسب/صفحه مرجع محصول دریافت کرده‌ای. هدف: پر کردن فیلدهای فرم محصول در پنل مدیریت.
اگر چیزی مطمئن نیستی یا در تصویر دیده نمی‌شود، همان فیلد را خالی یا آرایه خالی بگذار؛ هرگز حدس نزن.
تمام فیلدهای متنی فارسی باشند، به‌جز nameEn که دقیقاً به زبان اصلی بماند، concentration که یکی از مقادیر استاندارد انگلیسی باشد، و mainAccords که همان کلماتِ انگلیسیِ اصلیِ «Main accords» (در صورت وجود روی تصویر) با ویرگول جدا از هم باشد.
priceToman فقط وقتی عدد خام قیمت تومان/ریال روی تصویر واضح است. ارز خارجی را تبدیل نکن و در referencePriceNote نگه دار.
categoryGuess فقط یکی از perfume, sprayAndSplash, makeup, hygiene, electronics یا خالی.
فقط JSON معتبر و بدون Markdown برگردان:
{
"name":"","nameEn":"","brand":"","categoryGuess":"","subcategoryHint":"","priceToman":"","referencePriceNote":"","description":"","properties":"","ingredients":"","volume":"","concentration":"","topNotes":"","middleNotes":"","baseNotes":"","mainAccords":"","perfumer":"","countryOfOrigin":"","yearMade":"","variants":[]
}
variants آرایه‌ای از {"label":"","hex":""} باشد.`;
}

function parseJsonObject(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(start >= 0 && end >= start ? cleaned.slice(start, end + 1) : cleaned);
}

// پیام‌های خطای خامِ سرویسِ هوش مصنوعی (Gemini) گاهی چند پاراگراف طولانیِ انگلیسی و
// فنی هستند (مثلاً وقتی سهمیه‌ی یک مدل تمام شده) که برای مدیرِ فارسی‌زبانِ پنل هیچ کمکی نمی‌کند
// و فقط گیج‌کننده است. این تابع چنین خطاهایی را به یک پیامِ کوتاه و قابلِ‌اقدام تبدیل می‌کند؛ خطاهای
// کوتاه و از قبل فارسی/قابل‌فهم را دست‌نخورده برمی‌گرداند.
function friendlyAiError(err) {
  const raw = (err && err.message) || String(err || '');
  // خطای «شلوغیِ موقتِ مدل» — callGeminiText قبل از رسیدن به این‌جا خودش چند بار دوباره تلاش
  // کرده؛ اگر بازهم همین خطا برگشته، یعنی سرویسِ Google برای این مدلِ خاص واقعاً برای چند
  // دقیقه شلوغ است، نه اینکه مشکلی در تنظیماتِ خودمان باشد.
  if (isTransientGeminiError(raw)) {
    return `سرویسِ هوش مصنوعی (مدلِ ${GEMINI_MODEL}) موقتاً شلوغ است — چند بار خودکار دوباره تلاش شد ولی بازهم جواب نداد. چند دقیقه صبر کن و دوباره امتحان کن؛ اگر این خطا مدام تکرار شد، در Google AI Studio بررسی کن که این مدل روی حسابت واقعاً فعال و پایدار (نه یک نسخه‌ی آزمایشیِ کم‌ظرفیت) باشد.`;
  }
  if (/quota|rate.?limit|429/i.test(raw)) {
    return 'سهمیه یا محدودیتِ استفاده‌ی سرویسِ هوش مصنوعی برای این مدل تمام شده — چند دقیقه صبر کن، یا در تنظیماتِ Render مقدارِ GEMINI_MODEL را بررسی کن (نباید روی یک مدلِ «تولیدِ عکس» مثل gemini-…-image تنظیم شده باشد؛ این ابزارها به یک مدلِ متنی/بینایی مثل gemini-2.5-flash نیاز دارند).';
  }
  // خطای «مدل پیدا نشد» — معمولاً یعنی مقدارِ GEMINI_MODEL روی Render دقیقاً با شناسه‌ی رسمیِ
  // مدل در Google AI Studio یکی نیست (مثلاً gemini-3.5-flash اگر هنوز روی حسابِ شما فعال/منتشر
  // نشده باشد). با همین پیام، مدیر می‌داند دقیقاً کجا را باید چک کند.
  if (/not found|404|is not supported|not_found/i.test(raw) && /model/i.test(raw)) {
    return `مدلِ هوش مصنوعیِ تنظیم‌شده (GEMINI_MODEL="${GEMINI_MODEL}") پیدا نشد یا برای این کلید فعال نیست — در Google AI Studio (aistudio.google.com) شناسهٔ دقیقِ مدلی که به آن دسترسی داری را ببین (مثلاً gemini-2.5-flash یا gemini-2.0-flash) و همان را در متغیرِ محیطیِ GEMINI_MODEL روی Render قرار بده.`;
  }
  if (raw.length > 220) {
    return raw.slice(0, 200).trim() + '…';
  }
  return raw || 'خطای نامشخصی رخ داد';
}

// Existing Fraganty endpoints.
const FRAGANTY_QUOTA_MESSAGE = 'سهمیه ماهانه رایگان ai.fraganty تمام شده — تا ماه بعد صبر کن یا از پلن پولی بگیر';
app.get('/api/ai/search-perfume', auth, requireAdmin, async (req, res) => {
  if (!FRAGANTY_API_KEY) return res.status(500).json({ error: 'کلید FRAGANTY_API_KEY روی سرور تنظیم نشده است' });
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'نام محصول را وارد کن' });
  try {
    const fRes = await fetch(`${FRAGANTY_BASE_URL}/api/perfumes?q=${encodeURIComponent(q)}&limit=8`, { headers: { 'X-API-Key': FRAGANTY_API_KEY } });
    const fData = await fRes.json();
    if (!fRes.ok) return res.status(fRes.status === 429 ? 429 : 502).json({ error: fRes.status === 429 ? FRAGANTY_QUOTA_MESSAGE : (fData && fData.error) || 'خطا در ارتباط با ai.fraganty' });
    const results = (Array.isArray(fData.data) ? fData.data : []).filter((p) => p && p.id).map((p) => ({ id: p.id, name: p.name, brand: p.brand, year: p.year, image: p.image }));
    res.json({ data: results });
  } catch (e) { console.error('Fraganty search error:', e); res.status(500).json({ error: 'خطای سرور هنگام جستجو در ai.fraganty' }); }
});

app.get('/api/ai/perfume-details', auth, requireAdmin, async (req, res) => {
  if (!FRAGANTY_API_KEY) return res.status(500).json({ error: 'کلید FRAGANTY_API_KEY روی سرور تنظیم نشده است' });
  const slug = (req.query.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'شناسه محصول نامعتبر است' });
  try {
    const fRes = await fetch(`${FRAGANTY_BASE_URL}/api/perfumes/${encodeURIComponent(slug)}`, { headers: { 'X-API-Key': FRAGANTY_API_KEY } });
    const fData = await fRes.json();
    if (!fRes.ok) return res.status(fRes.status === 429 ? 429 : fRes.status === 404 ? 404 : 502).json({ error: fRes.status === 429 ? FRAGANTY_QUOTA_MESSAGE : fRes.status === 404 ? 'این محصول در ai.fraganty پیدا نشد — یک نتیجه دیگر را امتحان کن' : (fData && fData.error) || 'خطا در دریافت جزئیات از ai.fraganty' });
    if (!fData || !fData.name) return res.status(502).json({ error: 'این محصول در ai.fraganty اطلاعات کاملی ندارد — یک نتیجه دیگر را امتحان کن یا فیلدها را دستی پر کن' });
    res.json(fData);
  } catch (e) { console.error('Fraganty details error:', e); res.status(500).json({ error: 'خطای سرور هنگام دریافت جزئیات از ai.fraganty' }); }
});

app.post('/api/ai/translate-perfume-text', auth, requireAdmin, async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'کلید GEMINI_API_KEY روی سرور تنظیم نشده است' });
  const { name, brand, description, accords, seasons, dayNight, gender, rating } = req.body || {};
  if (!name) return res.status(400).json({ error: 'نام محصول الزم است' });
  const instruction = `اطلاعات زیر درباره یک عطر است. یک JSON معتبر بدون Markdown برگردان.
نام: ${name}
برند: ${brand || ''}
جنسیت: ${gender || ''}
امتیاز کاربران: ${rating || ''}
توضیح اصلی: ${description || ''}
آکوردها: ${Array.isArray(accords) ? accords.map((a) => typeof a === 'string' ? a : a.name).filter(Boolean).join('، ') : ''}
فصل‌ها: ${JSON.stringify(seasons || '')}
زمان استفاده روز/شب: ${JSON.stringify(dayNight || '')}
ساختار دقیق: {"description":"توضیح کوتاه دو تا سه جمله‌ای کاملاً فارسی","properties":"چند ویژگی کوتاه فارسی، هرکدام در خط جدا، حداکثر ۵ خط"}`;
  try {
    const parsed = await callGeminiText(instruction);
    res.json({ description: (parsed && parsed.description) || '', properties: (parsed && parsed.properties) || '' });
  } catch (e) { console.error('AI translate-perfume-text error:', e); res.status(502).json({ error: friendlyAiError(e) }); }
});

async function lookupOpenFacts(code) {
  const bases = ['https://world.openbeautyfacts.org/api/v2/product', 'https://world.openfoodfacts.org/api/v2/product'];
  for (const base of bases) {
    try {
      const r = await fetch(`${base}/${encodeURIComponent(code)}.json`);
      if (!r.ok) continue;
      const data = await r.json();
      if (!data || data.status !== 1 || !data.product) continue;
      const p = data.product;
      const title = (p.product_name || p.product_name_en || p.generic_name || '').trim();
      if (!title) continue;
      const brand = (p.brands || '').split(',')[0].trim();
      const image = p.image_front_url || p.image_url || '';
      const ingredients = (p.ingredients_text || p.ingredients_text_en || '').trim();
      const volMatch = (p.quantity || p.product_quantity || '').toString().match(/([\d.,]+)\s*m?l\b/i);
      const volume = volMatch ? volMatch[1].replace(',', '.') : '';
      return { title, brand, image, ingredients, volume };
    } catch (e) { console.error('Open Facts lookup failed:', base, e.message); }
  }
  return null;
}

async function identifyBarcodeWithGemini(code) {
  if (!GEMINI_API_KEY) return null;
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const instruction = `کد بارکد زیر متعلق به یک محصول است: ${code}
با جستجوی وب، محصول واقعی متناظر را با اطمینان شناسایی کن. اگر مطمئن نیستی حدس نزن و found را false بگذار.
فقط یک JSON معتبر و بدون Markdown برگردان، دقیقاً با این ساختار: {"found":true,"isPerfume":false,"name":"","nameEn":"","brand":"","imageUrl":"","description":"","properties":"","ingredients":"","volume":"","concentration":"","topNotes":"","middleNotes":"","baseNotes":"","mainAccords":"","perfumer":"","countryOfOrigin":"","yearMade":""}`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }] }],
      tools: [{ google_search: {} }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) ? friendlyAiError(new Error(data.error.message)) : `خطا در ارتباط با Gemini (${r.status})`);
  const text = (data.candidates || []).flatMap((c) => (c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('پاسخ نامعتبر از Gemini دریافت شد');
  const parsed = parseJsonObject(text);
  if (!parsed || !parsed.found || !parsed.name) return null;
  return parsed;
}

// جستجوی عکسِ محصول در اینترنت — نسخه‌ی قبلی از ابزارِ google_search خودِ Gemini استفاده می‌کرد،
// اما آن ابزار یک سهمیه‌ی کاملاً جدا و در تجربه بسیار محدودتر از سهمیه‌ی معمولیِ Gemini دارد (برای
// همین با اینکه «ورود محصول با لینک» — که هیچ جستجویی نمی‌کند، فقط یک صفحه‌ی مشخص را می‌خواند و
// متنش را به Gemini می‌دهد — خوب کار می‌کرد، همین قسمت به «سهمیه تمام شده» می‌خورد. راه‌حل: این
// قسمت را دقیقاً روی همان مسیرِ «ورود محصول با لینک» سوار کردیم — یعنی هیچ سهمیه‌ی هوش مصنوعیِ
// جداگانه‌ای مصرف نمی‌کند. ابتدا با یک جستجوی سادهٔ رایگان و بدون کلید (صفحه‌ی HTML ساده‌ی
// DuckDuckGo، بدون جاوااسکریپت) چند لینکِ صفحه‌ی واقعی پیدا می‌کنیم، سپس دقیقاً با همان تابعِ
// extractPrimaryImageFromHtml که «ورود محصول با لینک» استفاده می‌کند، عکسِ اصلیِ هرکدام از آن
// صفحات را درمی‌آوریم.
async function searchWebPages(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JordanGalleryProductImporter/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!r.ok) throw new Error(`جستجوی وب پاسخ نداد (کد ${r.status}) — چند لحظه صبر کن و دوباره امتحان کن`);
  const html = await r.text();
  const urls = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) && urls.length < 10) {
    let href = m[1];
    const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try { href = decodeURIComponent(uddgMatch[1]); } catch (e) { continue; }
    }
    if (/^https?:\/\//i.test(href)) urls.push(href);
  }
  return [...new Set(urls)];
}

async function searchProductImageCandidates(query) {
  const pageUrls = await searchWebPages(query);
  const found = [];
  for (const pageUrl of pageUrls) {
    if (found.length >= 6) break;
    try {
      const pr = await fetch(pageUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JordanGalleryProductImporter/1.0)', 'Accept': 'text/html,application/xhtml+xml' },
      });
      if (!pr.ok) continue;
      const contentType = pr.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) continue;
      const html = await pr.text();
      const imgUrl = extractPrimaryImageFromHtml(html, pr.url || pageUrl);
      if (imgUrl) found.push({ url: imgUrl, source: pageUrl });
    } catch (e) { /* این صفحه جواب نداد یا عکسی نداشت — سراغ صفحه‌ی بعدی */ }
  }
  return found;
}

app.post('/api/ai/search-product-image', auth, requireAdmin, async (req, res) => {
  const query = ((req.body && req.body.query) || '').trim();
  if (!query) return res.status(400).json({ error: 'عبارتِ جستجو را وارد کن' });
  try {
    const candidates = await searchProductImageCandidates(query);
    if (candidates.length === 0) return res.json({ results: [] });
    const mirrored = await Promise.all(
      candidates.map(async (c) => {
        try {
          const { url } = await mirrorRemoteImageToCloudinary(c.url, { referer: c.source });
          return url ? { url, source: c.source || '' } : null;
        } catch (e) { return null; }
      })
    );
    res.json({ results: mirrored.filter(Boolean) });
  } catch (e) {
    console.error('search-product-image error:', e);
    res.status(502).json({ error: friendlyAiError(e) });
  }
});

app.get('/api/ai/barcode-lookup', auth, requireAdmin, withDb(async (req, res) => {
  const code = (req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'کد بارکد نامعتبر است' });
  const db = await readDB();
  const ownMatch = db.products.find((p) => p.barcode && p.barcode === code);
  if (ownMatch) return res.json({ foundInOwnDb: true, product: { id: ownMatch.id, name: ownMatch.name, category: ownMatch.category, subcategory: ownMatch.subcategory } });
  let free = null;
  try { free = await lookupOpenFacts(code); } catch (e) { console.error('lookupOpenFacts error:', e.message); }
  let ai = null; let aiError = null;
  if (GEMINI_API_KEY) {
    try { ai = await identifyBarcodeWithGemini(code); if (!ai) aiError = 'محصول با جستجوی هوش مصنوعی هم شناسایی نشد'; }
    catch (e) { aiError = e.message; console.error('identifyBarcodeWithGemini failed (non-fatal):', aiError); }
  }
  let note = null;
  if (!ai) note = !GEMINI_API_KEY ? 'کلید هوش مصنوعی روی سرور تنظیم نشده — نام فارسی، توضیح، ویژگی‌ها، ترکیبات و نت‌های عطر را باید دستی وارد کنی' : `غنی‌سازی با هوش مصنوعی ناموفق بود — ${aiError || ''}`;
  if (!free && !ai) return res.json({ foundInOwnDb: false, external: null, note });
  const rawImage = (ai && ai.imageUrl) || (free && free.image) || '';
  const mirroredImage = rawImage ? (await mirrorRemoteImageToCloudinary(rawImage)).url : null;
  res.json({ foundInOwnDb: false, note, external: { found: true, source: ai ? (free ? 'ai+free' : 'ai') : 'free', isPerfume: ai ? !!ai.isPerfume : null, name: (ai && ai.name) || '', title: (ai && ai.nameEn) || (free && free.title) || '', brand: (ai && ai.brand) || (free && free.brand) || '', image: mirroredImage || rawImage || '', description: (ai && ai.description) || '', properties: (ai && ai.properties) || '', ingredients: (ai && ai.ingredients) || (free && free.ingredients) || '', volume: (ai && ai.volume) || (free && free.volume) || '', concentration: (ai && ai.concentration) || '', topNotes: (ai && ai.topNotes) || '', middleNotes: (ai && ai.middleNotes) || '', baseNotes: (ai && ai.baseNotes) || '', mainAccords: (ai && ai.mainAccords) || '', perfumer: (ai && ai.perfumer) || '', countryOfOrigin: (ai && ai.countryOfOrigin) || '', yearMade: ai && ai.yearMade ? String(ai.yearMade) : '' } });
}));

// ============================================================
// NEW CAPABILITY #1: Product page URL -> Gemini
// ============================================================
function validateProductUrl(value) {
  try {
    const u = new URL(String(value));
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u;
  } catch { return null; }
}

// از یک مقدارِ srcset (که می‌تواند چند کاندیدِ "آدرس عرضِ‌پیکسلی" با ویرگول جدا از هم داشته
// باشد — مثلاً «a.jpg 400w, b.jpg 800w, c.jpg 1600w») بزرگ‌ترین/باکیفیت‌ترین کاندید را برمی‌گرداند؛
// نسخه‌ی قبلی فقط اولین آدرسِ قبل از اولین ویرگول را برمی‌داشت که اغلب کوچک‌ترین/کم‌کیفیت‌ترین
// نسخه بود. اگر هیچ‌کدام عددِ عرض نداشتند، آخرین کاندید (که معمولاً بزرگ‌ترین است) انتخاب می‌شود.
function pickLargestFromSrcset(srcsetStr) {
  const candidates = String(srcsetStr || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const parts = c.split(/\s+/);
      const url = parts[0];
      const descriptor = parts[1] || '';
      const widthMatch = descriptor.match(/(\d+)w/);
      const densityMatch = descriptor.match(/(\d+(?:\.\d+)?)x/);
      const weight = widthMatch ? Number(widthMatch[1]) : densityMatch ? Number(densityMatch[1]) * 1000 : 0;
      return { url, weight };
    })
    .filter((c) => c.url);
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0].url;
}

// خیلی از فروشگاه‌های مدرن (از جمله سایت‌های ساخته‌شده با فریم‌ورک‌های Reactگونه مثل Next.js —
// دقیقاً مدلی که دیور و برندهای مشابه استفاده می‌کنند) اطلاعاتِ رنگ‌ها/طیف را به‌جای HTML ساده،
// به‌صورت یک بلوکِ JSON داخلِ <script> (مثلاً __NEXT_DATA__ یا state اولیه‌ی اپ) توی خودِ صفحه
// می‌گذارند تا بعداً با جاوااسکریپت رندر شود. چون سرورِ ما فقط HTMLِ خام را می‌خواند (جاوااسکریپت
// اجرا نمی‌کند)، تگ‌های <img> واقعی برای این رنگ‌ها هرگز به‌وجود نمی‌آیند — برای همین بود که فقط
// اسمِ رنگ (که جایی دیگر، مثلاً در متنِ نمایشی، هم آمده) پیدا می‌شد ولی عکسش نه. این تابع، پیش
// از حذفِ تگ‌های <script>، همان بلوک‌های JSON را می‌گردد و با یک تطبیقِ نزدیکی (کلیدهای شبیه به
// نام‌رنگ که نزدیکِ کلیدهای شبیه به عکس/کدِ‌رنگ افتاده‌اند) نشانه‌های مصنوعیِ [IMG]/[COLOR]
// می‌سازد و به متنی که برای Gemini فرستاده می‌شود اضافه می‌کند.
function extractSwatchDataFromScripts(html) {
  const scriptBlocks = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(String(html || '')))) {
    const body = m[1];
    if (body && body.length > 20 && /colou?r|swatch|variant/i.test(body)) {
      scriptBlocks.push(body.length > 400000 ? body.slice(0, 400000) : body);
    }
  }
  if (scriptBlocks.length === 0) return '';

  const nameRe = /"(?:colorName|colourName|colorTitle|colourTitle|variantName|shadeName|swatchName|name|title|label)"\s*:\s*"([^"]{1,80})"/gi;
  const imageRe = /"(?:swatchImage|swatchImageUrl|swatchUrl|colorImage|colourImage|variantImage|thumbnailImage|thumbnail|image|imageUrl|img|media|url)"\s*:\s*"((?:https?:)?\/\/[^"\\]+|\/[^"\\]+\.(?:jpg|jpeg|png|webp)[^"\\]*)"/gi;
  const hexRe = /"(?:hex|hexCode|colorHex|colourHex|swatchHex)"\s*:\s*"(#?[0-9a-fA-F]{3,8})"/gi;

  const WINDOW = 700; // بازه‌ی نزدیکیِ مجاز بین نامِ رنگ و عکس/کدش، برای جلوگیری از وصل‌شدنِ اشتباه به رنگِ کاملاً دیگر
  const tokens = [];
  const seenLabels = new Set();

  scriptBlocks.forEach((block) => {
    const names = [];
    let nm;
    nameRe.lastIndex = 0;
    while ((nm = nameRe.exec(block))) names.push({ idx: nm.index, val: nm[1] });
    const images = [];
    let im;
    imageRe.lastIndex = 0;
    while ((im = imageRe.exec(block))) images.push({ idx: im.index, val: im[1] });
    const hexes = [];
    let hm;
    hexRe.lastIndex = 0;
    while ((hm = hexRe.exec(block))) hexes.push({ idx: hm.index, val: hm[1] });

    names.forEach((n) => {
      const label = n.val.replace(/["\[\]]/g, '').trim();
      if (!label || seenLabels.has(label.toLowerCase())) return;
      const closestImage = images.reduce((best, img) => {
        const dist = Math.abs(img.idx - n.idx);
        return dist <= WINDOW && (!best || dist < best.dist) ? { ...img, dist } : best;
      }, null);
      const closestHex = hexes.reduce((best, hx) => {
        const dist = Math.abs(hx.idx - n.idx);
        return dist <= WINDOW && (!best || dist < best.dist) ? { ...hx, dist } : best;
      }, null);
      if (closestImage) {
        seenLabels.add(label.toLowerCase());
        tokens.push(` [IMG src="${closestImage.val}" alt="${label}"] `);
      } else if (closestHex) {
        seenLabels.add(label.toLowerCase());
        tokens.push(` [COLOR hex="${closestHex.val}" alt="${label}"] `);
      }
    });
  });

  return tokens.join('');
}

function stripHtmlForGemini(html) {
  let imgCount = 0;
  // این سقف را بالا بردیم چون محصولاتی مثل کرم‌پودرهای رنگ‌بندیِ گسترده (مثلاً ۳۷ شماره‌ی
  // کلارینس) به‌تنهایی ده‌ها [IMG]/[COLOR] فقط برای سوآچ‌های رنگ لازم دارند؛ سقفِ قبلی (۸۰) قبل
  // از رسیدن به همه‌ی رنگ‌ها متن را قطع می‌کرد.
  const IMG_LIMIT = 220;
  const rawHtml = String(html || '');

  // نکته‌ی مهم: این استخراج باید پیش از حذفِ <script> انجام شود، چون دقیقاً همان بلوک‌هایی که
  // الان حذف می‌کنیم منبعِ اصلیِ داده‌ی رنگ‌ها در سایت‌های JS-محور است.
  const swatchTokensFromScripts = extractSwatchDataFromScripts(rawHtml);

  let text = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  // تگ‌های <source> داخلِ <picture> — خیلی از سایت‌های مدرن (ازجمله دیور) عکسِ اصلی را به‌جای
  // یک <img> ساده، داخلِ چند <source srcset="..."> با فرمت‌ها/اندازه‌های مختلف می‌گذارند و فقط
  // یک <img> بی‌ربط یا خالی به‌عنوانِ fallback در انتها می‌آید.
  text = text.replace(/<source[^>]*>/gi, (tag) => {
    imgCount += 1;
    if (imgCount > IMG_LIMIT) return ' ';
    const srcsetMatch = tag.match(/\ssrcset=["']([^"']+)["']/i);
    const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i);
    const src = srcsetMatch ? pickLargestFromSrcset(srcsetMatch[1]) : srcMatch ? srcMatch[1] : '';
    if (!src) return ' ';
    return ` [IMG src="${src}" alt=""] `;
  });

  text = text.replace(/<img[^>]*>/gi, (tag) => {
    imgCount += 1;
    if (imgCount > IMG_LIMIT) return ' ';
    const srcsetMatch =
      tag.match(/\sdata-srcset=["']([^"']+)["']/i) ||
      tag.match(/\ssrcset=["']([^"']+)["']/i);
    const srcMatch =
      tag.match(/\ssrc=["']([^"']+)["']/i) ||
      tag.match(/\sdata-src=["']([^"']+)["']/i) ||
      tag.match(/\sdata-original=["']([^"']+)["']/i) ||
      tag.match(/\sdata-lazy(?:-src)?=["']([^"']+)["']/i) ||
      tag.match(/\sdata-zoom-image=["']([^"']+)["']/i) ||
      tag.match(/\sdata-large[_-]?image=["']([^"']+)["']/i) ||
      tag.match(/\sdata-full-src=["']([^"']+)["']/i) ||
      tag.match(/\sdata-defer-src=["']([^"']+)["']/i) ||
      tag.match(/\sdata-echo=["']([^"']+)["']/i);
    const altMatch = tag.match(/\salt=["']([^"']*)["']/i) || tag.match(/\stitle=["']([^"']*)["']/i);
    const src = srcsetMatch ? pickLargestFromSrcset(srcsetMatch[1]) : (srcMatch ? srcMatch[1] : '');
    if (!src || /^data:image\/gif/i.test(src)) return ' '; // gifِ شفافِ ۱پیکسلی معمولِ lazy-load را نادیده می‌گیریم
    const alt = altMatch ? altMatch[1].replace(/["\[\]]/g, '') : '';
    return ` [IMG src="${src}" alt="${alt}"] `;
  });

  text = text.replace(/<[a-z][a-z0-9]*\b[^>]*\sstyle=["'][^"']*background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)[^"']*["'][^>]*>/gi, (tag, rawUrl) => {
    imgCount += 1;
    if (imgCount > IMG_LIMIT) return ' ';
    const src = String(rawUrl || '').trim();
    if (!src) return ' ';
    const labelMatch = tag.match(/\s(?:title|aria-label|data-label|data-name|data-color)=["']([^"']*)["']/i);
    const alt = labelMatch ? labelMatch[1].replace(/["\[\]]/g, '') : '';
    return ` [IMG src="${src}" alt="${alt}"] `;
  });

  text = text.replace(/<[a-z][a-z0-9]*\b[^>]*\sstyle=["'][^"']*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)"']+\))[^"']*["'][^>]*>/gi, (tag, rawColor) => {
    const labelMatch = tag.match(/\s(?:title|aria-label|data-label|data-name|data-color)=["']([^"']*)["']/i);
    if (!labelMatch) return tag;
    imgCount += 1;
    if (imgCount > IMG_LIMIT) return ' ';
    const alt = labelMatch[1].replace(/["\[\]]/g, '');
    if (!alt) return tag;
    return ` [COLOR hex="${String(rawColor || '').trim()}" alt="${alt}"] `;
  });

  const cleaned = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // نشانه‌های استخراج‌شده از JSONِ داخلِ اسکریپت‌ها را در انتها اضافه می‌کنیم — این‌طور همیشه
  // در محدوده‌ی ۱۲۰هزار کاراکترِ نهایی باقی می‌مانند (نه این‌که وسطِ متنِ اصلی گم شوند)، و Gemini
  // آن‌ها را دقیقاً مثلِ بقیه‌ی نشانه‌های [IMG]/[COLOR] می‌خواند.
  const combined = swatchTokensFromScripts ? `${cleaned} ${swatchTokensFromScripts}` : cleaned;
  // این سقف را هم بالا بردیم — صفحاتِ پرمحتوا (مثلِ کلارینس با ده‌ها رنگ که معمولاً پایین‌ترِ
  // صفحه‌اند) با سقفِ قبلی (۱۲۰هزار کاراکتر) گاهی دقیقاً همان بخشِ رنگ‌بندی را از دست می‌دادند.
  return combined.slice(0, 200000);
}

// از روی HTML خام صفحه (پیش از حذف تگ‌ها)، محتمل‌ترین عکسِ اصلیِ محصول را با گشتن در متاتگ‌های
// استاندارد og:image / twitter:image پیدا می‌کند.
function extractPrimaryImageFromHtml(html, baseUrl) {
  if (!html) return null;
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      try { return new URL(m[1], baseUrl).toString(); } catch { /* skip invalid */ }
    }
  }
  const ldBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of ldBlocks) {
    const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
    try {
      const parsed = JSON.parse(inner);
      const candidates = Array.isArray(parsed) ? parsed : (Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
      for (const item of candidates) {
        const img = item && item.image;
        if (!img) continue;
        const url = Array.isArray(img) ? img[0] : (img && typeof img === 'object' ? img.url : img);
        if (url) { try { return new URL(url, baseUrl).toString(); } catch { /* skip invalid */ } }
      }
    } catch (e) { /* JSON-LD نامعتبر بود — رد شو و سراغ بلوکِ بعدی برو */ }
  }
  return null;
}

function extractPerfumeRatingBars(text) {
  function grab(label) {
    const re = new RegExp(label + "[^0-9]{0,60}(\\d{1,2}(?:\\.\\d)?)[^0-9]{0,60}([\\d,]{1,7})\\s*RATING", "i");
    const m = String(text || "").match(re);
    if (!m) return null;
    const score = parseFloat(m[1]);
    const ratings = parseInt(m[2].replace(/,/g, ""), 10);
    if (!Number.isFinite(score) || score < 0 || score > 10) return null;
    return { score, ratings: Number.isFinite(ratings) ? ratings : 0 };
  }
  const scent = grab("SCENT");
  const longevity = grab("LONGEVITY");
  const sillage = grab("SILLAGE");
  if (!scent && !longevity && !sillage) return null;
  return { scent, longevity, sillage };
}

function extractIframeSrcs(html, baseUrl) {
  const out = [];
  const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 5) {
    try { out.push(new URL(m[1], baseUrl).toString()); } catch { /* skip invalid */ }
  }
  return out;
}

const KNOWN_ACCORD_WORDS = [
  "white floral", "yellow floral", "green floral", "fruity floral", "citrus floral",
  "warm spicy", "fresh spicy", "oriental woody", "woody floral musk", "aromatic fougere",
  "resinous", "smoky", "powdery", "woody", "citrus", "citrusy", "floral", "patchouli", "musky",
  "musk", "sweet", "amber", "aromatic", "fruity", "green", "aquatic", "marine", "leathery",
  "leather", "gourmand", "tobacco", "chypre", "fougere", "earthy", "vanilla", "oud", "balsamic",
  "soapy", "mossy", "spicy", "oriental", "sour", "bitter", "fresh", "clean", "dry", "creamy",
  "soft", "herbal", "rose", "iris", "almond", "coconut", "honey", "caramel", "coffee", "tea",
  "anise", "licorice", "whiskey", "rum", "animalic", "metallic", "ozonic", "salty", "lactonic",
  "yeasty", "tropical", "mineral", "camphor", "medicinal", "nutty", "rummy", "smoked",
];

function matchKnownAccordsInText(text) {
  const t = " " + String(text || "").toLowerCase() + " ";
  const sorted = [...KNOWN_ACCORD_WORDS].sort((a, b) => b.length - a.length);
  const usedRanges = [];
  const found = [];
  for (const word of sorted) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\b" + escaped + "\\b", "gi");
    let m;
    while ((m = re.exec(t))) {
      const start = m.index;
      const end = start + m[0].length;
      const overlaps = usedRanges.some(([s, e]) => start < e && end > s);
      if (!overlaps) {
        usedRanges.push([start, end]);
        found.push({ start, label: word.replace(/\b\w/g, (c) => c.toUpperCase()) });
      }
    }
  }
  found.sort((a, b) => a.start - b.start);
  const seen = new Set();
  const ordered = [];
  for (const f of found) {
    const key = f.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(f.label);
  }
  return ordered;
}

function extractMainAccordsFromText(text) {
  const t = String(text || "");
  const m = t.match(/main accords[:\s]*(.*?)(?:fragrance pyramid|top notes|search by accords|user ratings|when to wear|$)/i);
  if (!m || !m[1]) return null;
  const chunk = m[1].trim();
  if (!chunk) return null;
  const words = matchKnownAccordsInText(chunk).slice(0, 10);
  return words.length ? words.join(", ") : null;
}

function extractScriptBlobs(html) {
  const out = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const body = m[1];
    if (body && body.trim().length > 10 && /scent|longevity|sillage|accord/i.test(body)) {
      out.push(body.length > 300000 ? body.slice(0, 300000) : body);
    }
  }
  return out;
}

function grabScoreNear(text, keys) {
  for (const key of keys) {
    const re = new RegExp("[\"']?" + key + "[\"']?\\s*[:=]\\s*\\{?\\s*[\"']?(?:value[\"']?\\s*[:=]\\s*)?[\"']?(\\d{1,2}(?:\\.\\d)?)", "i");
    const m = String(text || "").match(re);
    if (m) {
      const score = parseFloat(m[1]);
      if (Number.isFinite(score) && score >= 0 && score <= 10) return score;
    }
  }
  return null;
}

function grabCountNear(text, keys) {
  for (const key of keys) {
    const re = new RegExp("[\"']?" + key + "[\"']?\\s*[:=]\\s*[\"']?(\\d{2,7})", "i");
    const m = String(text || "").match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function extractRatingsFromScripts(scripts) {
  for (const s of scripts) {
    const scentScore = grabScoreNear(s, ["scentScore", "scent_score", "scent"]);
    const longevityScore = grabScoreNear(s, ["longevityScore", "longevity_score", "longevity"]);
    const sillageScore = grabScoreNear(s, ["sillageScore", "sillage_score", "sillage"]);
    if (scentScore == null && longevityScore == null && sillageScore == null) continue;
    const scentRatings = grabCountNear(s, ["scentRatings", "scentCount", "scent_count", "scentVotes"]);
    const longevityRatings = grabCountNear(s, ["longevityRatings", "longevityCount", "longevity_count", "longevityVotes"]);
    const sillageRatings = grabCountNear(s, ["sillageRatings", "sillageCount", "sillage_count", "sillageVotes"]);
    return {
      scent: scentScore != null ? { score: scentScore, ratings: scentRatings || 0 } : null,
      longevity: longevityScore != null ? { score: longevityScore, ratings: longevityRatings || 0 } : null,
      sillage: sillageScore != null ? { score: sillageScore, ratings: sillageRatings || 0 } : null,
    };
  }
  return null;
}

function extractAccordsFromScripts(scripts) {
  for (const s of scripts) {
    if (!/accord/i.test(s)) continue;
    const m = s.match(/accords?["']?\s*[:=]\s*(\[[^\]]{0,600}\])/i);
    if (!m) continue;
    let rawWords = [];
    try {
      const arr = JSON.parse(m[1].replace(/'/g, '"'));
      rawWords = arr.map((item) => (typeof item === "string" ? item : item && (item.name || item.label || item.title))).filter(Boolean);
    } catch (e) {
      const strs = m[1].match(/["']([A-Za-z][A-Za-z\s]{2,20})["']/g);
      rawWords = strs ? strs.map((x) => x.replace(/["']/g, "").trim()).filter(Boolean) : [];
    }
    if (rawWords.length === 0) continue;
    const filtered = matchKnownAccordsInText(rawWords.join(", ")).slice(0, 10);
    if (filtered.length) return filtered.join(", ");
  }
  return null;
}

async function analyzeFragranceWidget(mainHtml, mainText, baseUrl) {
  let bars = extractPerfumeRatingBars(mainText);
  let accords = extractMainAccordsFromText(mainText);
  if (bars && accords) return { bars, mainAccords: accords };

  const mainScripts = extractScriptBlobs(mainHtml);
  if (!bars) bars = extractRatingsFromScripts(mainScripts);
  if (!accords) accords = extractAccordsFromScripts(mainScripts);
  if (bars && accords) return { bars, mainAccords: accords };

  const iframeSrcs = extractIframeSrcs(mainHtml, baseUrl);
  for (const src of iframeSrcs) {
    try {
      const r = await fetch(src, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; JordanGalleryProductImporter/1.0)",
          "Referer": baseUrl,
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      if (!r.ok) continue;
      const html = await r.text();
      if (!bars) bars = extractPerfumeRatingBars(stripHtmlForGemini(html));
      if (!accords) accords = extractMainAccordsFromText(stripHtmlForGemini(html));
      if (!bars || !accords) {
        const scripts = extractScriptBlobs(html);
        if (!bars) bars = extractRatingsFromScripts(scripts);
        if (!accords) accords = extractAccordsFromScripts(scripts);
      }
      if (bars && accords) break;
    } catch (e) { /* این iframe جواب نداد — سراغ بعدی */ }
  }
  return { bars, mainAccords: accords };
}

function applyRatingBarsToProduct(product, bars) {
  if (!bars) return product;
  if (bars.scent) { product.scentScore = String(bars.scent.score); product.scentRatings = String(bars.scent.ratings); }
  if (bars.longevity) { product.longevityScore = String(bars.longevity.score); product.longevityRatings = String(bars.longevity.ratings); }
  if (bars.sillage) { product.sillageScore = String(bars.sillage.score); product.sillageRatings = String(bars.sillage.ratings); }
  return product;
}

// این تابع هرکدام از طیف‌های رنگی که Gemini از روی صفحه‌ی مبدأ تشخیص داده (و برایشان یک
// imageUrl پیشنهاد داده) را دانلود و روی Cloudinary خودمان آپلود می‌کند. دو اصلاحِ کلیدی نسبت
// به نسخه‌ی قبلی:
//   ۱) هدرِ Referer را برابرِ همان صفحه‌ی مبدأ (baseUrl) می‌فرستد — چون خیلی از CDNها بدون این
//      هدر، درخواست را رد می‌کنند (دقیقاً همان دلیلی که فقط شماره‌ی رنگ منتقل می‌شد، نه عکس).
//   ۲) اگر دانلود/آپلودِ خودکار به هر دلیلی شکست بخورد، به‌جای رها کردنِ عکس (رشته‌ی خالی)،
//      همان لینکِ اصلیِ عکس را برمی‌گرداند — این‌طور مدیر لینک را از دست نمی‌دهد و می‌تواند خودش
//      دستی همان لینک را باز کند یا از «جستجوی عکس» استفاده کند؛ ضمناً یک شمارشِ ساده
//      (attempted/uploaded) هم برمی‌گرداند تا پیامِ روشنی به مدیر نشان داده شود.
async function mirrorVariantImages(variants, baseUrl) {
  if (!Array.isArray(variants) || variants.length === 0) return { variants: [], attempted: 0, uploaded: 0 };
  // محصولاتی مثل کرم‌پودرهای رنگ‌بندیِ گسترده (مثلاً کلارینس با ۳۷ شماره) می‌توانند دهها رنگ
  // داشته باشند — سقفِ قبلی (۱۶) خیلی از آن‌ها را کلاً حذف می‌کرد. این سقف را بالا بردیم تا
  // «تمامِ رنگ‌ها» — نه فقط چند تای اول — فرصتِ دانلود/آپلود پیدا کنند.
  const LIMIT = 60;
  const toProcess = variants.slice(0, LIMIT);
  const rest = variants.slice(LIMIT);
  let attempted = 0;
  let uploaded = 0;
  const refererOrigin = (() => {
    try { return new URL(baseUrl).origin; } catch (e) { return baseUrl; }
  })();

  // دانلودِ همه‌ی رنگ‌ها را هم‌زمان (Promise.all بدونِ محدودیت) شلیک نمی‌کنیم — با ۳۷ تا ۶۰ عکس،
  // این کار می‌تواند سرورِ مبدأ را نگران‌کننده به نظر برساند (شبیهِ حمله) یا حافظه‌ی سرورِ خودمان
  // را فشار بیاورد. به‌جایش، دسته‌های کوچک (هر بار ۶ تا) پردازش می‌شوند.
  const BATCH_SIZE = 6;
  const mirrored = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (v) => {
        const label = (v && v.label) || '';
        const hex = (v && v.hex) || '';
        const rawUrl = v && v.imageUrl;
        if (!rawUrl) return { label, hex, image: '' };
        attempted += 1;
        try {
          const resolved = /^data:/i.test(rawUrl) ? rawUrl : new URL(rawUrl, baseUrl).toString();
          // skipBackgroundRemoval: true — سوآچِ رنگ یک دایره/مربعِ تخت‌رنگِ ساده است، پس‌زمینه‌ی
          // جداگانه‌ای برای حذف ندارد؛ رد کردنِ این مرحله هم سریع‌تر است هم سهمیه‌ی remove.bg را
          // برای جایی که واقعاً لازم است (عکسِ اصلیِ محصول) نگه می‌دارد.
          const { url: uploadedUrl, reason } = await mirrorRemoteImageToCloudinary(resolved, { referer: refererOrigin, skipBackgroundRemoval: true });
          if (uploadedUrl) {
            uploaded += 1;
            return { label, hex, image: uploadedUrl };
          }
          if (reason) console.warn(`mirrorVariantImages: عکسِ رنگِ «${label}» آپلود نشد — ${reason}`);
          // آپلودِ خودکار شکست خورد؛ به‌جای رها کردنِ کاملِ عکس، همان لینکِ خامِ اصلی را نگه می‌داریم
          // تا مدیر بتواند بعداً دستی از همان لینک استفاده کند.
          return { label, hex, image: resolved };
        } catch (e) {
          return { label, hex, image: '' };
        }
      })
    );
    mirrored.push(...batchResults);
  }
  const variantsOut = [...mirrored, ...rest.map((v) => ({ label: (v && v.label) || '', hex: (v && v.hex) || '', image: '' }))];
  return { variants: variantsOut, attempted, uploaded };
}

// ============================================================
// مدیریتِ چرخه‌ی عمرِ مرورگرِ هدلس — یک نمونه‌ی مرورگر به‌صورت مشترک بینِ درخواست‌ها نگه داشته
// می‌شود (نه یک مرورگرِ تازه برای هر درخواست، چون بالا آمدنِ Chromium خودش ۱ تا ۲ ثانیه طول
// می‌کشد)؛ برای هر درخواست فقط یک تبِ (page) جدید باز و در پایان بسته می‌شود. اگر مرورگر قطع
// شود (کرش کند)، دفعه‌ی بعد خودش را از نو بالا می‌آورد.
let browserInstancePromise = null;
async function getBrowserInstance() {
  if (!HEADLESS_BROWSER_ENABLED) return null;
  if (browserInstancePromise) {
    const existing = await browserInstancePromise.catch(() => null);
    if (existing && existing.isConnected && existing.isConnected()) return existing;
    browserInstancePromise = null; // مرورگرِ قبلی قطع شده — دوباره راه‌اندازی می‌کنیم
  }
  browserInstancePromise = (async () => {
    const executablePath = await chromiumPkg.executablePath();
    return puppeteerCore.launch({
      args: [...chromiumPkg.args, '--disable-dev-shm-usage', '--no-sandbox'],
      defaultViewport: { width: 1280, height: 1800 },
      executablePath,
      headless: chromiumPkg.headless !== undefined ? chromiumPkg.headless : true,
    });
  })().catch((e) => {
    console.error('راه‌اندازیِ مرورگرِ هدلس ناموفق بود — به روشِ fetch سبک برمی‌گردیم:', e.message);
    browserInstancePromise = null;
    return null;
  });
  return browserInstancePromise;
}

// خیلی از فروشگاه‌های مدرن (ازجمله دیور) عکسِ اصلی/رنگ‌ها را فقط وقتی صفحه به آن ناحیه اسکرول
// شود بارگذاری می‌کنند (lazy-load مبتنی بر IntersectionObserver). این تابع صفحه را چند مرحله‌ای
// تا انتها اسکرول می‌کند تا این‌جور محتوای «فقط-با-اسکرول» هم فرصتِ بارگذاری پیدا کند.
async function autoScrollPage(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const timer = setInterval(() => {
          const scrollHeight = document.body ? document.body.scrollHeight : 0;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight || totalHeight > 24000) {
            clearInterval(timer);
            resolve();
          }
        }, 180);
      });
    });
  } catch (e) { /* اگر اسکرول شکست خورد، بدونِ توقفِ کل فرآیند ادامه می‌دهیم */ }
}

// بسیاری از صفحاتِ محصول (دقیقاً مثلِ دو نمونه‌ای که مدیر فرستاد: کلارینس با دکمه‌ی «+32» و
// شیگلم با لینکِ «Select Color») فقط چند رنگِ اول را از ابتدا در صفحه می‌گذارند و بقیه‌ی
// رنگ‌ها را پشتِ یک دکمه/لینکِ «نمایشِ بیشتر» (یا یک مودالِ جداگانه) پنهان می‌کنند — این‌ها اصلاً
// در HTMLِ اولیه نیستند تا حتی مرورگرِ هدلس هم بدونِ کلیک کردن ببینتشان. این تابع دنبالِ چنین
// دکمه/لینک‌هایی می‌گردد (با تطبیقِ متن‌های رایج مثل «+عدد»، «Select Color»، «Show all»،
// «See all shades» و مشابه‌های فارسی) و رویشان کلیک می‌کند تا فهرستِ کاملِ رنگ‌ها باز/رندر شود.
async function expandColorSwatches(page) {
  try {
    const clickedCount = await page.evaluate(() => {
      const textPatterns = [
        /^\+\s*\d+$/, // «+32»، «+ ۵» و مشابه
        /select\s*colou?r/i,
        /show\s*all/i,
        /view\s*all/i,
        /see\s*all/i,
        /more\s*(colou?rs|shades)/i,
        /all\s*(colou?rs|shades)/i,
        /shade\s*finder/i,
        /رنگ‌بندی/,
        /همه‌?ی?\s*رنگ/,
        /مشاهده‌?ی?\s*همه/,
        /رنگ‌های\s*بیشتر/,
      ];
      const clickable = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'));
      const targets = clickable.filter((el) => {
        if (el.querySelector('button, a, [role="button"]')) return false; // فقط کوچک‌ترین/دقیق‌ترین عنصرِ قابل‌کلیک، نه یک والدِ بزرگ
        const text = (el.textContent || '').trim();
        if (!text || text.length > 30) return false;
        return textPatterns.some((re) => re.test(text));
      });
      let clicked = 0;
      for (const el of targets.slice(0, 6)) {
        try {
          el.scrollIntoView({ block: 'center' });
          el.click();
          clicked += 1;
        } catch (e) { /* این المان کلیک‌پذیر نبود — رد شو */ }
      }
      return clicked;
    });
    if (clickedCount > 0) {
      // فرصتِ کافی برای رندرشدنِ محتوای تازه‌بازشده (مودال یا فهرستِ گسترش‌یافته‌ی رنگ‌ها)، و یک
      // اسکرولِ دوباره چون این محتوای تازه ممکن است خودش هم عکس‌های lazy-load داشته باشد.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await autoScrollPage(page);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return clickedCount;
  } catch (e) {
    return 0; // اگر این مرحله شکست خورد، بدونِ توقفِ کل فرآیند با همان HTMLِ اولیه ادامه می‌دهیم
  }
}

// صفحه را با یک مرورگرِ واقعی (هدلس) باز می‌کند، منتظرِ آرام‌شدنِ شبکه می‌ماند، صفحه را اسکرول
// می‌کند تا محتوای lazy-load هم بیاید، سعی می‌کند دکمه‌های «نمایشِ همه‌ی رنگ‌ها» را هم پیدا و
// کلیک کند، و در پایان HTMLِ کاملاً رندرشده (بعد از اجرای جاوااسکریپت و هیدریشن) را برمی‌گرداند —
// دقیقاً همان چیزی که در مرورگرِ واقعیِ یک بازدیدکننده دیده می‌شود.
async function fetchProductPageWithBrowser(url) {
  const browser = await getBrowserInstance();
  if (!browser) throw new Error('مرورگر هدلس در دسترس نیست');
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(url.toString(), { waitUntil: 'networkidle2', timeout: 25000 });
    await autoScrollPage(page);
    // کمی صبرِ اضافه تا درخواست‌های XHR/fetchِ ناشی از اسکرول هم تمام شوند
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expandColorSwatches(page);
    const html = await page.content();
    const finalUrl = page.url();
    return { html, finalUrl };
  } finally {
    await page.close().catch(() => {});
  }
}

// بستنِ مرورگرِ هدلس هنگامِ خاموش‌شدنِ سرور (مثلاً موقعِ ری‌استارت/دیپلویِ Render) — تا پردازه‌ی
// Chromium یتیم روی سرور باقی نماند.
async function closeHeadlessBrowser() {
  if (!browserInstancePromise) return;
  try {
    const b = await browserInstancePromise;
    if (b) await b.close();
  } catch (e) { /* بی‌اهمیت — سرور دارد خاموش می‌شود */ }
}
process.on('SIGTERM', closeHeadlessBrowser);
process.on('SIGINT', closeHeadlessBrowser);

// بخشِ fetchِ سبک (بدونِ مرورگر) — به یک تابعِ جدا منتقل شد تا هم fetchProductPage (برایِ
// «ورود محصول با لینک») و هم fetchProductPageAndSwatches (برایِ «استخراج طیف رنگ») بتوانند
// از همین یک نسخه به‌عنوانِ راهِ جایگزین/fallback استفاده کنند، بدونِ تکرارِ کد.
async function plainFetchProductPage(url) {
  const r = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JordanGalleryProductImporter/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!r.ok) throw new Error(`صفحه محصول قابل دریافت نیست (${r.status})`);
  const contentType = r.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('لینک واردشده صفحه HTML محصول نیست');
  const html = await r.text();
  return { html, finalUrl: r.url || url.toString() };
}

// نکته‌ی مهم: قبلاً این تابع فقط یک fetch سبک انجام می‌داد که برای سایت‌های JS-سنگین (مثل دیور،
// که رنگ‌ها/عکس‌ها را فقط بعد از اجرای جاوااسکریپت می‌سازد) کافی نبود. حالا اول مرورگرِ هدلسِ
// واقعی را امتحان می‌کند؛ اگر آن در دسترس نبود یا با خطا مواجه شد (مثلاً محیطِ سرور منابعِ کافی
// نداشت یا پکیج‌هایش نصب نشده بودند)، بدونِ توقفِ کل قابلیت، به همان fetchِ سبکِ قبلی برمی‌گردد.
async function fetchProductPage(url) {
  if (HEADLESS_BROWSER_ENABLED) {
    try {
      const rendered = await fetchProductPageWithBrowser(url);
      if (rendered && rendered.html && rendered.html.length > 200) return rendered;
    } catch (e) {
      console.error('fetchProductPageWithBrowser ناموفق بود — با fetchِ سبک ادامه می‌دهیم:', e.message);
    }
  }
  return plainFetchProductPage(url);
}

// ============================================================
// استخراجِ مستقیمِ سوآچ‌های رنگ از خودِ صفحه‌ی رندرشده (نه از حدسِ هوش مصنوعی روی متنِ خام)
// ============================================================
// چرا این روش لازم است؟ خیلی از فروشگاه‌ها (ازجمله دقیقاً همین SHEGLAM که روی Shopify ساخته
// شده) رنگِ هر سوآچ را با یک کلاسِ CSS یا یک استایل‌شیتِ خارجی تنظیم می‌کنند، نه با یک attributeِ
// متنیِ قابل‌خواندن مثلِ style="background-color:...". یعنی هیچ رشته‌ی متنیِ قابل‌مشاهده‌ای از
// خودِ رنگ در HTML نیست تا هوش مصنوعی از رویش حدس بزند — تنها راهِ مطمئن این است که مرورگر
// خودش CSS را اجرا کند و رنگِ نهاییِ واقعاً رندرشده را با getComputedStyle بخوانیم؛ این روش
// کاملاً مستقل از این‌که رنگ از کجا آمده (inline، کلاس، متغیرِ CSS) است.
async function extractSwatchesViaDom(page) {
  try {
    const raw = await page.evaluate(() => {
      function rgbToHex(rgbStr) {
        const m = String(rgbStr || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) return '';
        const toHex = (n) => Number(n).toString(16).padStart(2, '0');
        return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`.toUpperCase();
      }
      function bgImageUrl(el) {
        if (!el) return '';
        const bg = getComputedStyle(el).backgroundImage;
        const m = bg && bg.match(/url\((['"]?)(.*?)\1\)/);
        return m ? m[2] : '';
      }
      function isRealSwatchColor(hex) {
        // سفیدِ کامل یا مشکیِ کامل معمولاً یعنی پس‌زمینه‌ی پیش‌فرضِ خودِ دکمه است، نه رنگِ واقعیِ
        // محصول — این‌ها را کنار می‌گذاریم تا نتیجه با موارد بی‌ربط شلوغ نشود.
        return !!hex && hex !== '#000000' && hex !== '#FFFFFF';
      }

      const nameOrLabelLooksLikeColor = /colou?r|shade|رنگ/i;
      const candidateNodes = [];

      // الگویِ ۱ (رایج‌ترین در Shopify): چند input[type=radio] که name‌شان اشاره به رنگ دارد.
      const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter((r) => nameOrLabelLooksLikeColor.test(r.name || ''));
      if (radios.length >= 2) {
        radios.forEach((r) => {
          const label = (r.id && document.querySelector(`label[for="${CSS && CSS.escape ? CSS.escape(r.id) : r.id}"]`)) || r.closest('label');
          candidateNodes.push({ visual: label || r, textSource: label || r, input: r });
        });
      }

      // الگویِ ۲: یک گروهِ رادیویی/سوآچِ عمومی زیرِ عنوانی که کلمه‌ی رنگ در آن است.
      if (candidateNodes.length === 0) {
        const groups = Array.from(document.querySelectorAll('fieldset, [role="radiogroup"], .product-form__input, .variant-picker__option, [class*="swatch-list" i], [class*="color-swatch" i], [class*="colour-swatch" i]'));
        for (const group of groups) {
          const legend = group.querySelector('legend, label, .form__label, .variant-picker__label') || group;
          if (!nameOrLabelLooksLikeColor.test(legend.textContent || '') && !nameOrLabelLooksLikeColor.test(group.className || '')) continue;
          const items = group.querySelectorAll('input[type="radio"], button, [role="radio"], li, a, span');
          items.forEach((it) => {
            if (it.querySelector('input, button, [role="radio"], li, a')) return; // فقط کوچک‌ترین عنصرِ قابل‌کلیک
            candidateNodes.push({ visual: it, textSource: it, input: it.matches('input') ? it : null });
          });
          if (candidateNodes.length > 0) break;
        }
      }

      // الگویِ ۳ (fallback عمومی): هر عنصری با کلاس/attributeِ شبیهِ سوآچِ رنگ، در کلِ صفحه.
      if (candidateNodes.length === 0) {
        const generic = document.querySelectorAll('[class*="swatch" i], [class*="color-option" i], [class*="colour-option" i], [data-color-swatch], [data-swatch]');
        generic.forEach((el) => {
          if (el.querySelector('[class*="swatch" i], [class*="color-option" i]')) return;
          candidateNodes.push({ visual: el, textSource: el, input: null });
        });
      }

      const results = [];
      const seen = new Set();
      candidateNodes.forEach((node) => {
        const visual = node.visual;
        if (!visual || !visual.getBoundingClientRect) return;
        const rect = visual.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return; // عنصرهای پنهان/صفرپیکسلی رد می‌شوند

        const label =
          (visual.getAttribute && (visual.getAttribute('aria-label') || visual.getAttribute('title') || visual.getAttribute('data-value') || visual.getAttribute('data-color-name'))) ||
          (node.input && (node.input.value || node.input.getAttribute('value'))) ||
          (node.textSource && node.textSource.textContent && node.textSource.textContent.trim()) ||
          '';
        const cleanLabel = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!cleanLabel || seen.has(cleanLabel.toLowerCase())) return;

        // عکس: یا از یک <img> داخلِ همان سوآچ، یا از پس‌زمینه‌ی محاسبه‌شده‌ی خودش/فرزندش.
        let imageUrl = '';
        const img = visual.querySelector && visual.querySelector('img');
        if (img && (img.currentSrc || img.src)) imageUrl = img.currentSrc || img.src;
        if (!imageUrl) imageUrl = bgImageUrl(visual);
        if (!imageUrl) {
          const innerNode = visual.querySelector && visual.querySelector('span, div, i');
          if (innerNode) imageUrl = bgImageUrl(innerNode);
        }

        // رنگ: computed background-color خودِ عنصر یا نزدیک‌ترین فرزندِ رنگی‌اش — این خط دقیقاً
        // همان چیزی است که مشکلِ اصلی را حل می‌کند (رنگ از هرجا که آمده باشد، همینجا رندر شده).
        let hex = '';
        const bgSources = [visual, visual.querySelector && visual.querySelector('span, div, i')].filter(Boolean);
        for (const src of bgSources) {
          const asHex = rgbToHex(getComputedStyle(src).backgroundColor);
          if (isRealSwatchColor(asHex)) { hex = asHex; break; }
        }

        if (!imageUrl && !hex) return; // نه عکس دارد نه رنگِ قابل‌تشخیص — احتمالاً سوآچِ واقعی نیست

        seen.add(cleanLabel.toLowerCase());
        results.push({ label: cleanLabel, hex, imageUrl });
      });

      return results;
    });
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.error('extractSwatchesViaDom failed:', e.message);
    return [];
  }
}

// نسخه‌ی مخصوصِ ابزارِ «استخراج طیف رنگ» — برخلافِ fetchProductPage (که فقط HTML برمی‌گرداند)،
// این تابع صفحه را باز نگه می‌دارد تا هم extractSwatchesViaDom (روشِ اصلی و دقیق) رویش اجرا شود
// و هم، برای مواقعی که آن روش چیزی پیدا نکرد، متنِ HTML برای مسیرِ قدیمیِ مبتنی‌بر Gemini آماده
// بماند. اگر مرورگرِ هدلس در دسترس نبود، دقیقاً مثلِ قبل با fetchِ سبک ادامه می‌دهد (domSwatches
// در آن حالت همیشه خالی است، چون بدونِ اجرای جاوااسکریپت امکانِ خواندنِ computed style نیست).
async function fetchProductPageAndSwatches(url) {
  if (HEADLESS_BROWSER_ENABLED) {
    try {
      const browser = await getBrowserInstance();
      if (browser) {
        const page = await browser.newPage();
        try {
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
          await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
          await page.goto(url.toString(), { waitUntil: 'networkidle2', timeout: 25000 });
          await autoScrollPage(page);
          await new Promise((resolve) => setTimeout(resolve, 1200));
          await expandColorSwatches(page);
          const domSwatches = await extractSwatchesViaDom(page);
          const html = await page.content();
          const finalUrl = page.url();
          return { html, finalUrl, domSwatches };
        } finally {
          await page.close().catch(() => {});
        }
      }
    } catch (e) {
      console.error('fetchProductPageAndSwatches (headless) ناموفق بود — با fetchِ سبک ادامه می‌دهیم:', e.message);
    }
  }
  const fallback = await plainFetchProductPage(url);
  return { ...fallback, domSwatches: [] };
}

// خطای «This model is currently experiencing high demand» (یا معادل‌های مشابه مثل overloaded/
// UNAVAILABLE/503) خطای موقتیِ سمتِ خودِ Google است — یعنی مدلِ انتخاب‌شده الان شلوغ است، نه
// اینکه چیزی در کدِ ما خراب باشد. این‌جور خطاها معمولاً با چند بار تلاشِ دوباره (با کمی فاصله)
// برطرف می‌شوند؛ برای همین callGeminiText قبل از تسلیم‌شدن، خودش چند بار دوباره امتحان می‌کند.
function isTransientGeminiError(message) {
  return /high demand|overloaded|unavailable|503|try again later/i.test(String(message || ''));
}

async function callGeminiText(prompt, { retries = 3, baseDelayMs = 1500 } = {}) {
  if (!GEMINI_API_KEY) throw new Error('کلید GEMINI_API_KEY روی سرور تنظیم نشده است');
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const message = (data && data.error && data.error.message) || 'خطا در ارتباط با Gemini';
        const err = new Error(message);
        if (attempt < retries && isTransientGeminiError(message)) {
          lastErr = err;
          await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
          continue; // یک بارِ دیگر امتحان کن
        }
        throw err;
      }
      const text = (data.candidates || []).flatMap((c) => c.content && c.content.parts || []).map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('پاسخ نامعتبر از Gemini دریافت شد');
      return parseJsonObject(text);
    } catch (e) {
      if (attempt < retries && isTransientGeminiError(e.message)) {
        lastErr = e;
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('خطا در ارتباط با Gemini');
}

function buildGeminiProductPrompt(sourceText, sourceUrl) {
  return `تو مسئول استخراج اطلاعات دقیق محصول برای پنل مدیریت فروشگاه هستی.
منبع: ${sourceUrl}
متن صفحه محصول در ادامه آمده است. هرجا نشانه‌ی [IMG src="..." alt="..."] دیدی، یعنی در آن نقطه از صفحه یک عکس بوده — src آدرس عکس و alt توضیح/برچسبِ کنار آن عکس است (مثلاً اسمِ رنگ در صفحه‌ی محصولاتی مثل رژلب یا کرم‌پودر). هرجا نشانه‌ی [COLOR hex="..." alt="..."] دیدی، یعنی یک سوآچِ رنگِ ساده (بدون عکس، فقط یک دایره‌ی تخت‌رنگ) بوده — hex کدِ رنگ و alt نامِ همان رنگ است. از این نشانه‌ها برای تشخیص «کدام عکس/رنگ مالِ کدام طیفِ رنگ است» و «کدام عکس، تصویرِ اصلیِ خودِ محصول است» استفاده کن.
فقط اطلاعاتی را وارد کن که از منبع قابل تشخیص است؛ هرگز حدس نزن و اطلاعات جعلی نساز.
تمام فیلدهای متنی فارسی روان باشند، به‌جز nameEn که باید نام دقیق اصلی محصول باشد، concentration که باید مقدار استاندارد انگلیسی باشد، و mainAccords که باید همان کلمات انگلیسیِ اصلیِ بخشِ «Main accords» باشد — هر آکورد را جدا و با ویرگول از بعدی جدا کن (مثلاً Oriental, Woody, Spicy — نه «Oriental Woody» به‌عنوانِ یک آیتم، مگر خودِ عبارت روی صفحه دقیقاً یک اصطلاحِ دوکلمه‌ای شناخته‌شده مثل «White Floral» یا «Warm Spicy» باشد). ترتیبِ آکوردها را دقیقاً همان ترتیبِ روی صفحه (از قوی‌ترین/بزرگ‌ترین به ضعیف‌ترین) نگه دار. نامِ برندینگِ ویجت‌های شخص‌ثالثِ نمایش‌دهنده‌ی این بخش (مثل «Smell»، «Feel»، «Smell & Feel») و نشانه‌های [IMG ...] هرگز آکورد نیستند — آن‌ها را در mainAccords نیاور.
قیمت خارجی را به تومان تبدیل نکن. اگر قیمت صفحه تومان/ریال است، priceToman را فقط به رقم خام بده؛ در غیر این صورت خالی و مقدار و ارز اصلی را در referencePriceNote بیاور.
categoryGuess فقط یکی از perfume, sprayAndSplash, makeup, hygiene, electronics یا خالی.
برای عطر، نت‌ها، آکوردهای اصلی، عطار و غلظت را فقط در صورت وجود منبع بده.
scentScore/longevityScore/sillageScore فقط اعداد بین ۰ تا ۱۰ هستند (مثلاً همان امتیازهای Scent/Longevity/Sillage در Fragrantica)؛ scentRatings/longevityRatings/sillageRatings تعداد رأی‌دهندگان همان امتیاز است. اگر هیچ‌کدام در منبع نبود، همه را خالی بگذار.
mainImageUrl را فقط اگر یک [IMG] با src مشخص، به‌وضوح تصویرِ اصلیِ خودِ محصول (نه لوگو، نه بنر، نه آیکون، و نه یک دایره‌ی کوچکِ سوآچِ رنگ) باشد پر کن؛ همان src را بدون تغییر بده. اگر صفحه چند [IMG] پشتِ‌سرهم و شبیه‌به‌هم دارد که هرکدام با نامِ یک رنگ/شماره در alt همراه است، اینها سوآچِ رنگ‌ها هستند نه تصویرِ اصلی — آن‌ها را فقط در variants بیاور، نه در mainImageUrl.
اگر محصول طیفِ رنگ دارد (مثل رژلب، کرم‌پودر، سایه، لاک)، برای هر رنگ یک آیتم در variants بساز: label نامِ فارسیِ همان رنگ/شماره، hex کدِ رنگِ نزدیک (از یک [COLOR] یا هر جای دیگرِ صفحه که کد رنگ آمده؛ اگر پیدا نشد خالی)، و imageUrl همان src از نزدیک‌ترین [IMG] که alt یا متنِ اطرافش با نامِ همان رنگ می‌خواند — اگر برای یک رنگ عکسِ مجزا پیدا نشد، imageUrl را خالی بگذار (هرگز عکسِ یک رنگِ دیگر را به‌اشتباه نسبت نده).
JSON دقیقاً با این ساختار برگردان:
{
"name":"","nameEn":"","brand":"","categoryGuess":"","subcategoryHint":"","priceToman":"","referencePriceNote":"","description":"","properties":"","ingredients":"","volume":"","concentration":"","topNotes":"","middleNotes":"","baseNotes":"","mainAccords":"","perfumer":"","countryOfOrigin":"","yearMade":"","scentScore":"","scentRatings":"","longevityScore":"","longevityRatings":"","sillageScore":"","sillageRatings":"","mainImageUrl":"","variants":[]
}
variants آرایه‌ای از {"label":"","hex":"","imageUrl":""} باشد.

متن صفحه:
${sourceText}`;
}

function buildVariantExtractionPrompt(sourceText, sourceUrl) {
  return `تو فقط و فقط مسئولِ یک کار هستی: پیدا کردنِ «طیف رنگِ» این محصول از صفحه‌ی زیر.

⛔️ محدوده‌ی کار — این‌ها را به‌کل نادیده بگیر:
هیچ کاری به شکلِ ظاهریِ محصول، عکسِ اصلیِ محصول (بطری/جعبه/بسته‌بندی)، توضیحاتِ محصول، ترکیبات/Ingredients، ویژگی‌ها و خواص، نت‌های عطر، آکوردها، امتیازها، قیمت یا هر بخشِ دیگرِ صفحه نداشته باش — حتی اگر این‌ها را هم در متنِ زیر ببینی. فقط و فقط روی همان بخشِ مشخصِ «انتخابِ رنگ/شماره» تمرکز کن — همان ناحیه‌ای از صفحه که زیرِ عنوانی مثل «Color»، «Select Color»، «Shade»، «Shade Finder» یا معادلِ فارسی‌اش («انتخاب رنگ»، «رنگ‌بندی») می‌آید و شاملِ چند دایره یا مربعِ کوچکِ رنگی/شماره‌دار است.

🎯 مهم‌ترین قانون — همه‌ی رنگ‌ها را بده، نه فقط رنگِ پیش‌فرض/انتخاب‌شده:
اکثرِ صفحاتِ محصول یک رنگ را به‌صورتِ پیش‌فرض «انتخاب‌شده» نشان می‌دهند (مثلاً یک دایره با حاشیه‌ی پررنگ‌تر یا یک برچسبِ «Color: Bliss»)، ولی این فقط یکی از چندین/دهها رنگِ موجود است. باید هر رنگی که در ناحیه‌ی سوآچ دیده می‌شود را جدا استخراج کنی — چه رنگِ پیش‌فرض باشد چه نباشد. اگر صفحه نشانه‌ای مثلِ «+۳۲»، «+more»، «View all shades» یا «See all colors» دارد، یعنی رنگ‌های بیشتری فراتر از آن چند نمونه‌ی اولیه وجود دارد — بگرد و همه را (نه فقط چندتای نمایش‌دادهٔ اول) در متنِ زیر پیدا کن؛ اگر واقعاً چیزی فراتر از آنچه در متن آمده نبود، همان‌ها را کامل بده و حدس نزن.

🏷️ برای هر رنگ دقیقاً همین سه فیلد را بساز:
- label: نام/کد/شماره‌ی دقیقِ همان رنگ، عیناً همان‌طور که روی صفحه نوشته شده (مثلاً «M1C»، «107N»، «Bliss»، یک کدِ عددیِ ساده). اگر انگلیسی/عددی بود همان را بده، ترجمه نکن، خلاصه نکن، از خودت اسم نساز و دو رنگِ مختلف را هرگز زیرِ یک لیبل ادغام نکن.
- hex: کدِ رنگِ آن، فقط اگر در متن آمده (از یک [COLOR] یا هر نشانه‌ی دیگری)؛ اگر پیدا نکردی، رشته‌ی خالی بگذار — هرگز حدس نزن.
- imageUrl: اگر همان رنگ عکسِ مجزای خودش را دارد (از نزدیک‌ترین [IMG] که alt یا متنِ اطرافش دقیقاً با نامِ همان رنگ می‌خواند)، همان src را بده؛ اگر مطمئن نیستی کدام عکس مالِ کدام رنگ است، خالی بگذار — هرگز عکسِ یک رنگِ دیگر یا عکسِ اصلیِ محصول را به‌اشتباه به یک رنگ نسبت نده.

نشانه‌های موجود در متن: [IMG src="..." alt="..."] یعنی یک عکس بوده (alt معمولاً اسمِ همان رنگ است). [COLOR hex="..." alt="..."] یعنی یک سوآچِ رنگِ ساده (بدونِ عکس، فقط یک دایره‌ی تخت‌رنگ) بوده که alt اسمِ رنگ و hex کدِ آن است.

منبع: ${sourceUrl}
اگر اصلاً طیفِ رنگی روی صفحه پیدا نکردی، آرایه‌ی variants را خالی برگردان.
فقط یک JSON معتبر و بدون Markdown برگردان، دقیقاً با این ساختار: {"variants":[{"label":"","hex":"","imageUrl":""}]}

متن صفحه:
${sourceText}`;
}

app.post('/api/ai/extract-variants-from-url', auth, requireAdmin, async (req, res) => {
  const url = validateProductUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'لینک محصول معتبر نیست' });
  try {
    const page = await fetchProductPageAndSwatches(url);
    let rawVariants = [];
    let method = 'dom';
    // روشِ اصلی و دقیق‌تر: خواندنِ مستقیمِ رنگ‌های واقعاً رندرشده از خودِ صفحه (کارِ درست برایِ
    // سایت‌هایی مثلِ SHEGLAM/Shopify که رنگِ سوآچ فقط با CSS تنظیم می‌شود، نه متن). اگر این روش
    // چیزی پیدا نکرد (مثلاً ساختارِ سایت خیلی غیرِمعمول بود)، به‌جای دست خالی برگرداندن، به روشِ
    // قدیمی (خواندنِ متنِ صفحه با Gemini) برمی‌گردیم.
    if (page.domSwatches && page.domSwatches.length >= 2) {
      rawVariants = page.domSwatches;
    } else {
      method = 'ai';
      const text = stripHtmlForGemini(page.html);
      if (!text) return res.status(422).json({ error: 'متن قابل استفاده‌ای از صفحه محصول پیدا نشد' });
      const parsed = await callGeminiText(buildVariantExtractionPrompt(text, page.finalUrl));
      rawVariants = Array.isArray(parsed && parsed.variants) ? parsed.variants : [];
    }
    const { variants, attempted, uploaded } = await mirrorVariantImages(rawVariants, page.finalUrl);
    // پیامِ تشخیصی: هم می‌گوید از کدام روش استفاده شد، هم اینکه از چند عکسِ پیشنهادی چندتا واقعاً
    // دانلود/آپلود شد — این‌طور مدیر همیشه می‌داند دقیقاً چه اتفاقی افتاده، نه فقط یک نتیجه‌ی خام.
    let imageNote = null;
    if (variants.length === 0) {
      imageNote = 'هیچ رنگی روی این صفحه پیدا نشد — می‌تونی رنگ‌ها رو دستی از پایین اضافه کنی.';
    } else if (attempted > 0 && uploaded === 0) {
      imageNote = `${variants.length} رنگ (${method === 'dom' ? 'مستقیم از ساختارِ صفحه' : 'با هوش مصنوعی از متنِ صفحه'}) پیدا شد، اما هیچ‌کدام از عکس‌هایشان دانلود نشد — احتمالاً سایتِ مبدأ دانلودِ خودکارِ عکس را مسدود می‌کند. لینکِ خامِ عکس (در صورت وجود) در همان ردیف نگه داشته شده؛ می‌توانی با «افزودن عکس این رنگ» دستی آپلود کنی.`;
    } else if (attempted > uploaded) {
      imageNote = `${variants.length} رنگ (${method === 'dom' ? 'مستقیم از ساختارِ صفحه' : 'با هوش مصنوعی از متنِ صفحه'}) پیدا شد؛ از ${attempted} عکسِ پیشنهادی، ${uploaded} مورد با موفقیت دانلود و آپلود شد — بقیه را دستی تکمیل کن.`;
    } else {
      imageNote = `${variants.length} رنگ (${method === 'dom' ? 'مستقیم از ساختارِ صفحه' : 'با هوش مصنوعی از متنِ صفحه'}) پیدا و کامل پردازش شد.`;
    }
    res.json({ variants, imageNote });
  } catch (e) {
    console.error('extract-variants-from-url error:', e);
    res.status(502).json({ error: friendlyAiError(e) });
  }
});

app.post('/api/ai/extract-product-from-url', auth, requireAdmin, async (req, res) => {
  const url = validateProductUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'لینک محصول معتبر نیست' });
  try {
    const page = await fetchProductPage(url);
    const text = stripHtmlForGemini(page.html);
    if (!text) return res.status(422).json({ error: 'متن قابل استفاده‌ای از صفحه محصول پیدا نشد' });
    const product = await callGeminiText(buildGeminiProductPrompt(text, page.finalUrl));
    const { bars, mainAccords: mainAccordsFound } = await analyzeFragranceWidget(page.html, text, page.finalUrl);
    applyRatingBarsToProduct(product, bars);
    if (mainAccordsFound) product.mainAccords = mainAccordsFound;
    const refererOriginForMain = (() => { try { return new URL(page.finalUrl).origin; } catch (e) { return page.finalUrl; } })();
    const variantResult = await mirrorVariantImages(product.variants, page.finalUrl);
    product.variants = variantResult.variants;
    const rawImageUrl = extractPrimaryImageFromHtml(page.html, page.finalUrl);
    let mirroredImageUrl = rawImageUrl ? (await mirrorRemoteImageToCloudinary(rawImageUrl, { referer: refererOriginForMain })).url : null;
    if (!mirroredImageUrl && product.mainImageUrl) {
      try {
        const resolved = new URL(product.mainImageUrl, page.finalUrl).toString();
        mirroredImageUrl = (await mirrorRemoteImageToCloudinary(resolved, { referer: refererOriginForMain })).url;
      } catch (e) { /* لینکِ پیشنهادیِ Gemini معتبر نبود — بدون عکس ادامه می‌دهیم */ }
    }
    delete product.mainImageUrl;
    res.json({ ...product, imageUrl: mirroredImageUrl || undefined, sourceUrl: page.finalUrl });
  } catch (e) {
    console.error('Gemini URL extraction error:', e);
    res.status(e.message && e.message.includes('GEMINI_API_KEY') ? 500 : 502).json({ error: friendlyAiError(e) });
  }
});

// ============================================================
// NEW CAPABILITY #2: Product image -> Gemini Vision
// ============================================================
app.post('/api/ai/extract-product-from-image', auth, requireAdmin, async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'کلید GEMINI_API_KEY روی سرور تنظیم نشده است' });
  const imageBase64 = req.body && req.body.imageBase64;
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'تصویر معتبر نیست' });
  const match = imageBase64.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) return res.status(400).json({ error: 'فرمت تصویر پشتیبانی نمی‌شود (فقط png، jpg، jpeg، webp)' });
  const approxBytes = Math.ceil((match[2].length * 3) / 4);
  if (approxBytes > 10 * 1024 * 1024) return res.status(413).json({ error: 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)' });
  try {
    const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
    const prompt = buildGeminiProductPrompt('اطلاعات باید مستقیماً از تصویر پیوست‌شده استخراج شود. اگر چیزی دیده نمی‌شود، خالی بگذار.', 'image');
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: match[1], data: match[2] } }, { text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data && data.error && data.error.message) ? friendlyAiError(new Error(data.error.message)) : 'خطا در ارتباط با Gemini' });
    const text = (data.candidates || []).flatMap((c) => c.content && c.content.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) return res.status(502).json({ error: 'پاسخ نامعتبر از Gemini دریافت شد' });
    res.json(parseJsonObject(text));
  } catch (e) {
    console.error('Gemini image extraction error:', e);
    res.status(502).json({ error: friendlyAiError(e) });
  }
});

// Current App endpoint aliases — no frontend change required.
app.post('/api/ai/import-product-url', auth, requireAdmin, async (req, res) => {
  const url = validateProductUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'لینک محصول معتبر نیست' });
  try {
    const page = await fetchProductPage(url);
    const sourceText = stripHtmlForGemini(page.html);
    if (!sourceText) return res.status(422).json({ error: 'متن قابل استفاده‌ای از صفحه محصول پیدا نشد' });
    const product = await callGeminiText(buildGeminiProductPrompt(sourceText, page.finalUrl));
    const { bars, mainAccords: mainAccordsFound } = await analyzeFragranceWidget(page.html, sourceText, page.finalUrl);
    applyRatingBarsToProduct(product, bars);
    if (mainAccordsFound) product.mainAccords = mainAccordsFound;
    const refererOriginForMain2 = (() => { try { return new URL(page.finalUrl).origin; } catch (e) { return page.finalUrl; } })();
    const variantResult2 = await mirrorVariantImages(product.variants, page.finalUrl);
    product.variants = variantResult2.variants;
    const rawImageUrl = extractPrimaryImageFromHtml(page.html, page.finalUrl);
    let mirroredImageUrl = rawImageUrl ? (await mirrorRemoteImageToCloudinary(rawImageUrl, { referer: refererOriginForMain2 })).url : null;
    if (!mirroredImageUrl && product.mainImageUrl) {
      try {
        const resolved = new URL(product.mainImageUrl, page.finalUrl).toString();
        mirroredImageUrl = (await mirrorRemoteImageToCloudinary(resolved, { referer: refererOriginForMain2 })).url;
      } catch (e) { /* لینکِ پیشنهادیِ Gemini معتبر نبود — بدون عکس ادامه می‌دهیم */ }
    }
    delete product.mainImageUrl;
    res.json({ ...product, imageUrl: mirroredImageUrl || undefined, sourceUrl: page.finalUrl });
  } catch (e) {
    console.error('Gemini URL extraction error:', e);
    res.status(e.message && e.message.includes('GEMINI_API_KEY') ? 500 : 502).json({ error: friendlyAiError(e) });
  }
});

app.post('/api/ai/analyze-perfume-image', auth, requireAdmin, async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'کلید GEMINI_API_KEY روی سرور تنظیم نشده است' });
  const imageBase64 = req.body && req.body.imageBase64;
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'تصویر معتبر نیست' });
  const match = imageBase64.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) return res.status(400).json({ error: 'فرمت تصویر پشتیبانی نمی‌شود (فقط png، jpg، jpeg، webp)' });
  if (Math.ceil((match[2].length * 3) / 4) > 10 * 1024 * 1024) return res.status(413).json({ error: 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)' });
  try {
    const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: match[1], data: match[2] } },
          { text: buildGeminiProductPrompt('اطلاعات باید مستقیماً از تصویر پیوست‌شده استخراج شود. اگر چیزی دیده نمی‌شود، خالی بگذار و هرگز حدس نزن.', 'image') },
        ] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: (data && data.error && data.error.message) ? friendlyAiError(new Error(data.error.message)) : `خطا در ارتباط با Gemini (${r.status})` });
    const resultText = (data.candidates || []).flatMap((c) => (c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
    if (!resultText) return res.status(502).json({ error: 'پاسخ نامعتبر از Gemini دریافت شد' });
    res.json(parseJsonObject(resultText));
  } catch (e) {
    console.error('Gemini perfume image error:', e);
    res.status(502).json({ error: friendlyAiError(e) });
  }
});

// ابزارِ تشخیصی برای مدیر — بعد از دیپلویِ روی Render می‌توانی با یک درخواستِ GET (همراه با
// توکنِ ادمین) ببینی مرورگرِ هدلس واقعاً بالا آمده یا نه، بدونِ نیاز به گشتنِ لاگ‌های سرور.
app.get('/api/ai/headless-status', auth, requireAdmin, async (req, res) => {
  if (!HEADLESS_BROWSER_ENABLED) {
    return res.json({ enabled: false, connected: false, note: 'پکیج‌های puppeteer-core و @sparticuz/chromium نصب نشده‌اند یا DISABLE_HEADLESS_BROWSER=1 تنظیم شده است.' });
  }
  try {
    const browser = await getBrowserInstance();
    const connected = !!(browser && browser.isConnected && browser.isConnected());
    res.json({ enabled: true, connected, note: connected ? 'مرورگرِ هدلس فعال و آماده است.' : 'راه‌اندازیِ مرورگر ناموفق بود — لاگ‌های سرور را ببین.' });
  } catch (e) {
    res.json({ enabled: true, connected: false, note: e.message || 'خطای نامشخص هنگامِ بررسیِ مرورگرِ هدلس' });
  }
});

app.get('/api/settings', noCache, withDb(async (req, res) => { const db = await readDB(); res.json(db.settings || {}); }));
app.put('/api/settings', auth, requireAdmin, withDb(async (req, res) => { const db = await readDB(); db.settings = { ...db.settings, ...(req.body || {}) }; await writeDB(db); res.json(db.settings); }));

function computeSalesCounts(orders) {
  const counts = {};
  (orders || []).forEach((order) => {
    if (order.status !== 'paid') return;
    (order.items || []).forEach((item) => { if (!item || !item.id) return; counts[item.id] = (counts[item.id] || 0) + (Number(item.qty) || 0); });
  });
  return counts;
}

app.get('/api/products', noCache, withDb(async (req, res) => {
  const db = await readDB();
  const salesCounts = computeSalesCounts(db.orders);
  res.json((db.products || []).map((p) => ({ ...p, salesCount: salesCounts[p.id] || 0 })));
}));

app.post('/api/products', auth, requireAdmin, withDb(async (req, res) => {
  const p = req.body || {};
  if (!p.name || !p.price) return res.status(400).json({ error: 'قیمت و نام محصول الزامی است' });
  const db = await readDB();
  const id = 'p' + db.nextProductId++;
  const product = {
    id, name: p.name, nameEn: p.nameEn || '', brand: p.brand || '', category: p.category || 'perfume', subcategory: p.subcategory || '', type: p.type || '',
    facets: (p.facets && typeof p.facets === 'object') ? p.facets : {}, price: Number(p.price), description: p.description || '', properties: p.properties || '', ingredients: p.ingredients || '',
    topNotes: p.topNotes || '', middleNotes: p.middleNotes || '', baseNotes: p.baseNotes || '', mainAccords: p.mainAccords || '',
    scentScore: Number.isFinite(Number(p.scentScore)) ? Number(p.scentScore) : 0, scentRatings: Number.isFinite(Number(p.scentRatings)) ? Number(p.scentRatings) : 0,
    longevityScore: Number.isFinite(Number(p.longevityScore)) ? Number(p.longevityScore) : 0, longevityRatings: Number.isFinite(Number(p.longevityRatings)) ? Number(p.longevityRatings) : 0,
    sillageScore: Number.isFinite(Number(p.sillageScore)) ? Number(p.sillageScore) : 0, sillageRatings: Number.isFinite(Number(p.sillageRatings)) ? Number(p.sillageRatings) : 0,
    perfumer: p.perfumer || '', countryOfOrigin: p.countryOfOrigin || '', yearMade: p.yearMade || '', fragranticaRating: p.fragranticaRating || '', volume: p.volume || '', barcode: p.barcode || '', discountPercent: Number(p.discountPercent) || 0,
    image: p.image || '', imageFit: p.imageFit === 'cover' ? 'cover' : 'contain', imagePosX: Number.isFinite(Number(p.imagePosX)) ? Number(p.imagePosX) : 50, imagePosY: Number.isFinite(Number(p.imagePosY)) ? Number(p.imagePosY) : 50,
    imageZoom: Number.isFinite(Number(p.imageZoom)) && Number(p.imageZoom) > 0 ? Number(p.imageZoom) : 1,
    ...(Array.isArray(p.variants) && p.variants.length > 0 ? { variants: p.variants } : {}),
  };
  db.products.push(product); await writeDB(db); res.json(product);
}));

app.put('/api/products/:id', auth, requireAdmin, withDb(async (req, res) => {
  const db = await readDB();
  const idx = db.products.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'محصول یافت نشد' });
  const p = req.body || {}; const old = db.products[idx];
  const updated = {
    ...old, name: p.name ?? old.name, nameEn: p.nameEn !== undefined ? p.nameEn : (old.nameEn || ''), brand: p.brand ?? old.brand, category: p.category ?? old.category,
    subcategory: p.subcategory !== undefined ? p.subcategory : old.subcategory, type: p.type !== undefined ? p.type : old.type, facets: p.facets !== undefined ? p.facets : old.facets,
    price: p.price !== undefined ? Number(p.price) : old.price, description: p.description ?? old.description, properties: p.properties !== undefined ? p.properties : old.properties,
    ingredients: p.ingredients !== undefined ? p.ingredients : old.ingredients, topNotes: p.topNotes !== undefined ? p.topNotes : (old.topNotes || ''), middleNotes: p.middleNotes !== undefined ? p.middleNotes : (old.middleNotes || ''), baseNotes: p.baseNotes !== undefined ? p.baseNotes : (old.baseNotes || ''),
    mainAccords: p.mainAccords !== undefined ? p.mainAccords : (old.mainAccords || ''),
    scentScore: p.scentScore !== undefined ? (Number(p.scentScore) || 0) : (old.scentScore || 0), scentRatings: p.scentRatings !== undefined ? (Number(p.scentRatings) || 0) : (old.scentRatings || 0),
    longevityScore: p.longevityScore !== undefined ? (Number(p.longevityScore) || 0) : (old.longevityScore || 0), longevityRatings: p.longevityRatings !== undefined ? (Number(p.longevityRatings) || 0) : (old.longevityRatings || 0),
    sillageScore: p.sillageScore !== undefined ? (Number(p.sillageScore) || 0) : (old.sillageScore || 0), sillageRatings: p.sillageRatings !== undefined ? (Number(p.sillageRatings) || 0) : (old.sillageRatings || 0),
    perfumer: p.perfumer !== undefined ? p.perfumer : (old.perfumer || ''), countryOfOrigin: p.countryOfOrigin !== undefined ? p.countryOfOrigin : (old.countryOfOrigin || ''), yearMade: p.yearMade !== undefined ? p.yearMade : (old.yearMade || ''), fragranticaRating: p.fragranticaRating !== undefined ? p.fragranticaRating : (old.fragranticaRating || ''), volume: p.volume !== undefined ? p.volume : (old.volume || ''), barcode: p.barcode !== undefined ? p.barcode : (old.barcode || ''),
    discountPercent: p.discountPercent !== undefined ? (Number(p.discountPercent) || 0) : old.discountPercent, image: p.image ?? old.image, imageFit: p.imageFit !== undefined ? (p.imageFit === 'cover' ? 'cover' : 'contain') : (old.imageFit || 'contain'), imagePosX: p.imagePosX !== undefined ? (Number(p.imagePosX) || 50) : (old.imagePosX ?? 50), imagePosY: p.imagePosY !== undefined ? (Number(p.imagePosY) || 50) : (old.imagePosY ?? 50), imageZoom: p.imageZoom !== undefined ? (Number(p.imageZoom) || 1) : (old.imageZoom ?? 1),
  };
  if (Array.isArray(p.variants) && p.variants.length > 0) updated.variants = p.variants;
  else if (p.variants !== undefined) delete updated.variants;
  db.products[idx] = updated; await writeDB(db); res.json(updated);
}));

app.delete('/api/products/:id', auth, requireAdmin, withDb(async (req, res) => {
  const db = await readDB(); const before = db.products.length; db.products = db.products.filter((x) => x.id !== req.params.id);
  if (db.products.length === before) return res.status(404).json({ error: 'محصول یافت نشد' });
  await writeDB(db); res.json({ ok: true });
}));

app.get('/api/orders', auth, noCache, withDb(async (req, res) => {
  const db = await readDB();
  res.json(db.orders.filter((o) => o.user_id === req.user.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
}));

app.post('/api/payment/request', auth, withDb(async (req, res) => {
  const { items, amount, description } = req.body || {};
  if (!amount || amount < 1000) return res.status(400).json({ error: 'مبلغ نامعتبر است' });
  if (!ZARINPAL_MERCHANT_ID) return res.status(500).json({ error: 'ZARINPAL_MERCHANT_ID تنظیم نشده است' });
  try {
    const zRes = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, amount, callback_url: CALLBACK_URL, description: description || 'خرید از فروشگاه' }) });
    const data = await zRes.json();
    if (data.data && data.data.code === 100) {
      const authority = data.data.authority; const db = await readDB();
      db.orders.push({ id: db.nextOrderId++, user_id: req.user.id, items: items || [], amount, authority, ref_id: null, status: 'pending', created_at: new Date().toISOString() });
      await writeDB(db); return res.json({ paymentUrl: `https://www.zarinpal.com/pg/StartPay/${authority}` });
    }
    res.status(400).json({ error: 'خطا در اتصال به درگاه پرداخت', detail: data });
  } catch (e) { res.status(500).json({ error: 'خطای سرور در ارتباط با درگاه' }); }
}));

app.get('/payment/callback', async (req, res) => {
  const { Authority, Status } = req.query; let db;
  try { db = await readDB(); } catch { return res.redirect(`${FRONTEND_URL}/payment/result?status=error`); }
  const order = db.orders.find((o) => o.authority === Authority);
  if (!order) return res.redirect(`${FRONTEND_URL}/payment/result?status=notfound`);
  if (Status !== 'OK') { order.status = 'canceled'; await writeDB(db); return res.redirect(`${FRONTEND_URL}/payment/result?status=canceled`); }
  try {
    const zRes = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT_ID, amount: order.amount, authority: Authority }) });
    const data = await zRes.json();
    if (data.data && (data.data.code === 100 || data.data.code === 101)) { order.status = 'paid'; order.ref_id = String(data.data.ref_id); await writeDB(db); return res.redirect(`${FRONTEND_URL}/payment/result?status=success&ref=${data.data.ref_id}`); }
    order.status = 'failed'; await writeDB(db); res.redirect(`${FRONTEND_URL}/payment/result?status=failed`);
  } catch { res.redirect(`${FRONTEND_URL}/payment/result?status=error`); }
});

app.get('/', (req, res) => res.send('Store API is running'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
