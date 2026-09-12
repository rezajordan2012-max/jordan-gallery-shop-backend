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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FRAGANTY_API_KEY = process.env.FRAGANTY_API_KEY;
const FRAGANTY_BASE_URL = 'https://fraganty.ai';
const REMOVEBG_API_KEY = process.env.REMOVEBG_API_KEY;

// ============================================================
// NEW: Gemini — only the two requested additions
// 1) Product page URL -> Gemini -> structured product fields
// 2) Product image -> Gemini -> structured product fields
// ============================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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
async function resolveImageUrlFromCandidate(url) {
  if (!url) return null;

  // اگر خودش لینک تصویر بود
  if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
    return url;
  }

  // اگر لینک صفحه محصول بود
  try {
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!pageRes.ok) return null;

    const html = await pageRes.text();

    return extractPrimaryImageFromHtml(html, url);

  } catch (e) {
    console.error('resolveImageUrlFromCandidate failed:', e.message);
    return null;
  }
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

async function mirrorRemoteImageToCloudinary(remoteUrl) {
  try {
    if (!remoteUrl || typeof remoteUrl !== 'string' || !/^https?:\/\//i.test(remoteUrl)) return null;
    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) return null;
    const contentType = imgRes.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length > 10 * 1024 * 1024) return null;
    const mimeForDataUri = contentType.split(';')[0].replace('image/jpg', 'image/jpeg');
    const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!supported.includes(mimeForDataUri)) return null;
    const dataUri = `data:${mimeForDataUri};base64,${buffer.toString('base64')}`;
    const cleaned = await removeBackgroundFromDataUri(dataUri);
    const uploaded = await uploadDataUriToCloudinary(cleaned);
    return uploaded.url;
  } catch (e) { console.error('mirrorRemoteImageToCloudinary failed:', e.message); return null; }
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

// پیام‌های خطای خامِ سرویس‌های هوش مصنوعی (Gemini/Claude) گاهی چند پاراگراف طولانیِ انگلیسی و
// فنی هستند (مثلاً وقتی سهمیه‌ی یک مدل تمام شده) که برای مدیرِ فارسی‌زبانِ پنل هیچ کمکی نمی‌کند
// و فقط گیج‌کننده است. این تابع چنین خطاهایی را به یک پیامِ کوتاه و قابلِ‌اقدام تبدیل می‌کند؛ خطاهای
// کوتاه و از قبل فارسی/قابل‌فهم را دست‌نخورده برمی‌گرداند.
function friendlyAiError(err) {
  const raw = (err && err.message) || String(err || '');
  if (/quota|rate.?limit|429/i.test(raw)) {
    return 'سهمیه یا محدودیتِ استفاده‌ی سرویسِ هوش مصنوعی برای این مدل تمام شده — چند دقیقه صبر کن، یا در تنظیماتِ Render مقدارِ GEMINI_MODEL را بررسی کن (نباید روی یک مدلِ «تولیدِ عکس» مثل gemini-…-image تنظیم شده باشد؛ این ابزارها به یک مدلِ متنی/بینایی مثل gemini-2.5-flash نیاز دارند).';
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
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'کلید ANTHROPIC_API_KEY روی سرور تنظیم نشده است' });
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
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 700, messages: [{ role: 'user', content: instruction }] }) });
    const aiData = await aiRes.json();
    if (!aiRes.ok) return res.status(502).json({ error: (aiData && aiData.error && aiData.error.message) ? friendlyAiError(new Error(aiData.error.message)) : 'خطا در ارتباط با سرویس هوش مصنوعی' });
    const textBlock = (aiData.content || []).find((c) => c.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'پاسخ نامعتبر از هوش مصنوعی دریافت شد' });
    const parsed = parseJsonObject(textBlock.text);
    res.json({ description: parsed.description || '', properties: parsed.properties || '' });
  } catch (e) { console.error('AI translate-perfume-text error:', e); res.status(500).json({ error: 'خطای سرور هنگام ترجمه توضیحات' }); }
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

async function identifyBarcodeWithAI(code) {
  if (!ANTHROPIC_API_KEY) return null;
  const instruction = `کد بارکد زیر متعلق به یک محصول است: ${code}
با جستجوی وب، محصول واقعی متناظر را با اطمینان شناسایی کن. اگر مطمئن نیستی حدس نزن.
فقط JSON معتبر: {"found":true,"isPerfume":false,"name":"","nameEn":"","brand":"","imageUrl":"","description":"","properties":"","ingredients":"","volume":"","concentration":"","topNotes":"","middleNotes":"","baseNotes":"","mainAccords":"","perfumer":"","countryOfOrigin":"","yearMade":""}`;
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: instruction }] }) });
  const aiData = await aiRes.json();
  if (!aiRes.ok) throw new Error((aiData && aiData.error && aiData.error.message) || 'خطا در ارتباط با سرویس هوش مصنوعی');
  const textCombined = (aiData.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  if (!textCombined) throw new Error('پاسخ نامعتبر از هوش مصنوعی دریافت شد');
  const parsed = parseJsonObject(textCombined);
  if (!parsed || !parsed.found || !parsed.name) return null;
  return parsed;
}

// جستجوی عکسِ محصول (یا یک رنگِ خاص از محصول) در اینترنت — دقیقاً از همان موتوری استفاده می‌کند
// که «جستجوی هوشمند لینک» استفاده می‌کند (Gemini، با ابزارِ google_search برای جستجوی واقعیِ وب)؛
// به‌جای یک عکسِ تک، چند نامزدِ مختلف برمی‌گرداند تا مدیر خودش بهترین را انتخاب کند.
async function searchProductColorCandidatesGemini(query) {

  if (!GEMINI_API_KEY)
    throw new Error('کلید GEMINI_API_KEY روی سرور تنظیم نشده است');


  const endpoint =
    `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;


  const prompt = `
با جستجوی وب صفحه‌های معتبر محصول را برای این درخواست پیدا کن:

"${query}"

هدف فقط پیدا کردن عکس‌های واقعی طیف رنگ محصول است.
مخصوصاً:
- swatch رنگ
- shade image
- color variant image
- عکس شماره رنگ

اگر صفحه محصول پیدا شد لینک صفحه را بده.
اگر لینک مستقیم عکس رنگ پیدا شد همان را بده.

هرگز لینک جعلی نساز.

فقط JSON معتبر:
{
"results":[
 {
  "url":"",
  "source":""
 }
]
}
`;


  const r = await fetch(endpoint, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-goog-api-key':GEMINI_API_KEY
    },

    body:JSON.stringify({

      contents:[
        {
          role:'user',
          parts:[
            {
              text:prompt
            }
          ]
        }
      ],

      tools:[
        {
          google_search:{}
        }
      ],

      generationConfig:{
        temperature:0.1
      }

    })
  });


  const data = await r.json().catch(()=>({}));

  if(!r.ok)
    throw new Error(
      data?.error?.message ||
      `Gemini error ${r.status}`
    );


  const text =
    (data.candidates || [])
    .flatMap(c=>c.content?.parts || [])
    .map(p=>p.text || '')
    .join('')
    .trim();


  const parsed=parseJsonObject(text);


  return Array.isArray(parsed.results)
    ? parsed.results.slice(0,10)
    : [];

}
  if (!GEMINI_API_KEY) throw new Error('کلید GEMINI_API_KEY روی سرور تنظیم نشده است');
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const prompt = `با جستجوی وب، ۵ تا ۶ عکسِ باکیفیت و مرتبط برای این محصول پیدا کن: "${query}"
اگر لینک مستقیم فایل تصویر (jpg/jpeg/png/webp) پیدا کردی همان را بده.
اگر فقط صفحه محصول معتبر پیدا کردی، لینک صفحه را هم بده ولی source را "product_page" قرار بده.
هرگز لینک جعلی نساز. . فقط عکس‌هایی را انتخاب کن که به‌وضوح همین محصول (یا همین رنگِ مشخص‌شده، اگر در عبارتِ جستجو نامِ رنگ آمده) را نشان می‌دهند — نه محصولِ مشابه از برندِ دیگر، نه بنر یا لوگو. اگر برای بخشی از درخواست عکسِ مطمئنی پیدا نکردی، آن را خالی بگذار و فقط عکس‌های مطمئن را برگردان؛ هرگز آدرس جعل نکن.
فقط یک JSON معتبر و بدون Markdown برگردان، دقیقاً با این ساختار: {"results":[{"url":"","source":""}]}`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1 },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) ? friendlyAiError(new Error(data.error.message)) : `خطا در ارتباط با Gemini (${r.status})`);
  const text = (data.candidates || []).flatMap((c) => (c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('پاسخ نامعتبر از Gemini دریافت شد');
  const parsed = parseJsonObject(text);
  const results = Array.isArray(parsed && parsed.results) ? parsed.results : [];
  return results.filter((item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)).slice(0, 6);
}

// نسخه‌ی پشتیبان (fallback) — همان جستجوی عکس، این‌بار با Claude + web_search. فقط وقتی به کار
// می‌رود که Gemini در دسترس نباشد یا شکست بخورد و کلیدِ Anthropic هم روی سرور تنظیم شده باشد؛
// این‌طور اگر یکی از دو سرویس موقتاً مشکل داشت (مثلاً اتمامِ اعتبار یا سهمیه)، کارِ مدیر متوقف نمی‌شود.
async function searchProductImageCandidatesAnthropic(query) {
  if (!ANTHROPIC_API_KEY) throw new Error('کلید ANTHROPIC_API_KEY روی سرور تنظیم نشده است');
  const instruction = `با جستجوی وب، ۵ تا ۶ عکسِ باکیفیت و مرتبط برای این محصول پیدا کن: "${query}"
هر آدرس باید مستقیماً به خودِ فایلِ تصویر (jpg/jpeg/png/webp) ختم شود، نه به یک صفحه‌ی HTML. فقط عکس‌هایی را انتخاب کن که به‌وضوح همین محصول (یا همین رنگِ مشخص‌شده، اگر در عبارتِ جستجو نامِ رنگ آمده) را نشان می‌دهند — نه محصولِ مشابه از برندِ دیگر، نه بنر یا لوگو. اگر برای بخشی از درخواست (مثلاً یک رنگِ خاص) عکسِ مطمئنی پیدا نکردی، آن را خالی بگذار و فقط عکس‌های مطمئن را برگردان.
فقط JSON معتبر: {"results":[{"url":"","source":""}]}`;
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1500, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: instruction }] }),
  });
  const aiData = await aiRes.json();
  if (!aiRes.ok) throw new Error((aiData && aiData.error && aiData.error.message) ? friendlyAiError(new Error(aiData.error.message)) : 'خطا در ارتباط با سرویس هوش مصنوعی');
  const textCombined = (aiData.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  if (!textCombined) throw new Error('پاسخ نامعتبر از هوش مصنوعی دریافت شد');
  const parsed = parseJsonObject(textCombined);
  const results = Array.isArray(parsed && parsed.results) ? parsed.results : [];
  return results.filter((r) => r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url)).slice(0, 6);
}

async function searchProductImageCandidates(query) {
  async function searchProductImageCandidates(query) {
  if (!GEMINI_API_KEY) {
    throw new Error('کلید GEMINI_API_KEY روی سرور تنظیم نشده است');
  }

  const results = await searchProductImageCandidatesGemini(query);

  return results;
}
      if (results.length > 0) return results;
    } catch (e) {
      console.error('Gemini image search failed:', e.message);
      if (!ANTHROPIC_API_KEY) throw e;
      // اگر Anthropic هم تنظیم شده، بی‌سروصدا سراغش می‌رویم؛ اگر نه، همان خطای Gemini بالا می‌رود.
    }
  }
  if (ANTHROPIC_API_KEY) return searchProductImageCandidatesAnthropic(query);
  throw new Error('برای جستجوی عکس، حداقل یکی از GEMINI_API_KEY یا ANTHROPIC_API_KEY باید روی سرور تنظیم شده باشد');
}
  app.post('/api/ai/search-product-image', auth, requireAdmin, async (req, res) => {
  const query = ((req.body && req.body.query) || '').trim();

  if (!query) {
    return res.status(400).json({
      error: 'عبارتِ جستجو را وارد کن'
    });
  }

  try {
    const candidates = await searchProductImageCandidates(query);

    res.json({
      results: candidates
    });

  } catch (e) {
    console.error('search-product-image error:', e);

    res.status(502).json({
      error: friendlyAiError(e)
    });
  }
});



    const finalResults = [];


    for (const item of candidates) {

      let imageUrls = [];


      try {

        // اگر لینک مستقیم عکس بود
        if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(item.url)) {

          imageUrls.push({
            url: item.url,
            label: ''
          });


        } else {

          // اگر لینک صفحه محصول بود
          const pageRes = await fetch(item.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0'
            }
          });


          if (pageRes.ok) {

            const html = await pageRes.text();


            imageUrls =
              extractColorImagesFromHtml(
                html,
                item.url
              );

          }

        }


      } catch (e) {

        console.error(
          'color page extraction failed:',
          e.message
        );

      }



      // انتقال عکس‌های رنگ به Cloudinary

      for (const img of imageUrls) {

        try {

          const cloudUrl =
            await mirrorRemoteImageToCloudinary(
              img.url
            );


          if (cloudUrl) {

            finalResults.push({

              url: cloudUrl,

              label:
                img.label ||
                item.source ||
                ''

            });

          }


        } catch (e) {

          console.error(
            'color cloudinary upload failed:',
            e.message
          );

        }

      }


    }


    res.json({

      results:
        finalResults.slice(0,20)

    });


  } catch (e) {

    console.error(
      'search-product-color error:',
      e
    );


    res.status(502).json({

      error:
        friendlyAiError(e)

    });

  }

});
  try {
    const candidates = await searchProductImageCandidates(query);
    if (candidates.length === 0) return res.json({ results: [] });
    // هرکدام از نتایج را همین الان روی Cloudinary خودمان آپلود می‌کنیم — تا چیزی که مدیر در
    // پنجره‌ی نتایج می‌بیند، دقیقاً همان چیزی باشد که با یک کلیک ذخیره می‌شود (نه یک لینکِ
    // خارجیِ ناپایدار که ممکن است فردا از دسترس خارج شود).
    const mirrored = await Promise.all(
  candidates.map(async (c) => {
    try {
      const imageUrl = await resolveImageUrlFromCandidate(c.url);

      if (!imageUrl) return null;

      const url = await mirrorRemoteImageToCloudinary(imageUrl);

      return url ? { 
        url, 
        source: c.source || '' 
      } : null;

    } catch (e) { 
      console.error('candidate mirror failed:', e.message);
      return null;
    }
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
  if (ANTHROPIC_API_KEY) {
    try { ai = await identifyBarcodeWithAI(code); if (!ai) aiError = 'محصول با جستجوی هوش مصنوعی هم شناسایی نشد'; }
    catch (e) { aiError = e.message; console.error('identifyBarcodeWithAI failed (non-fatal):', aiError); }
  }
  let note = null;
  if (!ai) note = !ANTHROPIC_API_KEY ? 'کلید هوش مصنوعی روی سرور تنظیم نشده — نام فارسی، توضیح، ویژگی‌ها، ترکیبات و نت‌های عطر را باید دستی وارد کنی' : `غنی‌سازی با هوش مصنوعی ناموفق بود — ${aiError || ''}`;
  if (!free && !ai) return res.json({ foundInOwnDb: false, external: null, note });
  const rawImage = (ai && ai.imageUrl) || (free && free.image) || '';
  const mirroredImage = rawImage ? await mirrorRemoteImageToCloudinary(rawImage) : null;
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

function stripHtmlForGemini(html) {
  let imgCount = 0;
  const IMG_LIMIT = 60;
  let text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  // پیش از حذفِ کلیِ تگ‌ها، تگ‌های <img> را به یک نشانه‌ی متنیِ فشرده تبدیل می‌کند که هم آدرسِ
  // عکس (src — یا معادل‌های تنبل‌بارگذاری مثل data-src/data-original/srcset) و هم متنِ
  // جایگزینش (alt — معمولاً همان نامِ رنگ/طیف در صفحاتِ محصولاتِ آرایشی) را نگه می‌دارد؛ همین
  // یعنی Gemini می‌تواند تشخیص دهد کدام عکس مالِ کدام طیفِ رنگ است.
  text = text.replace(/<img[^>]*>/gi, (tag) => {
    imgCount += 1;
    if (imgCount > IMG_LIMIT) return ' ';
    const srcMatch =
      tag.match(/\ssrc=["']([^"']+)["']/i) ||
      tag.match(/\sdata-src=["']([^"']+)["']/i) ||
      tag.match(/\sdata-original=["']([^"']+)["']/i) ||
      tag.match(/\sdata-lazy(?:-src)?=["']([^"']+)["']/i) ||
      tag.match(/\ssrcset=["']([^"',\s]+)/i);
    const altMatch = tag.match(/\salt=["']([^"']*)["']/i) || tag.match(/\stitle=["']([^"']*)["']/i);
    const src = srcMatch ? srcMatch[1] : '';
    if (!src) return ' ';
    const alt = altMatch ? altMatch[1].replace(/["\[\]]/g, '') : '';
    return ` [IMG src="${src}" alt="${alt}"] `;
  });

  // خیلی از سوآچ‌های رنگِ محصولاتِ آرایشی (رژلب، سایه، کرم‌پودر) به‌جای <img>، یک عنصرِ ساده
  // (div/span/a) با پس‌زمینه‌ی CSS تنظیم‌شده (background-image:url(...)) هستند — این عنصرها را
  // هم به همان قالبِ نشانه‌ی [IMG] تبدیل می‌کند تا Gemini همان‌ها را هم به‌عنوانِ عکسِ طیف رنگ ببیند.
  text = text.replace(/<[a-z][a-z0-9]*\b[^>]*\sstyle=["'][^"']*background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)[^"']*["'][^>]*>/gi, (tag, rawUrl) => {
    imgCount += 1;
    if (imgCount > IMG_LIMIT) return ' ';
    const src = String(rawUrl || '').trim();
    if (!src) return ' ';
    const labelMatch = tag.match(/\s(?:title|aria-label|data-label|data-name|data-color)=["']([^"']*)["']/i);
    const alt = labelMatch ? labelMatch[1].replace(/["\[\]]/g, '') : '';
    return ` [IMG src="${src}" alt="${alt}"] `;
  });

  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120000);
}

// از روی HTML خام صفحه (پیش از حذف تگ‌ها)، محتمل‌ترین عکسِ اصلیِ محصول را با گشتن در متاتگ‌های
// استاندارد og:image / twitter:image پیدا می‌کند — همان تگ‌هایی که تقریباً همه‌ی فروشگاه‌های
// آنلاین برای پیش‌نمایشِ لینک (مثلاً هنگام اشتراک‌گذاری در تلگرام/واتساپ) پر می‌کنند، پس معمولاً
// دقیق‌ترین و باکیفیت‌ترین عکسِ محصول همین است. آدرسِ نسبی را هم نسبت به baseUrl کامل می‌کند.
function extractPrimaryImageFromHtml(html, baseUrl) {// استخراج عکس‌های طیف رنگ محصول از صفحه
// مخصوص رژلب، سایه، کرم‌پودر، لاک و محصولات دارای shade/variant
function extractColorImagesFromHtml(html, baseUrl) {
  const results = [];
  if (!html) return results;

  const seen = new Set();

  function addImage(url, label = '') {
    if (!url) return;

    try {
      const absolute = new URL(url, baseUrl).toString();

      if (!/^https?:\/\//i.test(absolute)) return;

      if (seen.has(absolute)) return;

      seen.add(absolute);

      results.push({
        url: absolute,
        label
      });

    } catch {}
  }


  // img های رنگی
  const imgTags = html.match(/<img[^>]*>/gi) || [];

  for (const tag of imgTags) {

    const src =
      (tag.match(/\ssrc=["']([^"']+)/i) || [])[1] ||
      (tag.match(/\sdata-src=["']([^"']+)/i) || [])[1] ||
      (tag.match(/\sdata-original=["']([^"']+)/i) || [])[1];

    const label =
      (tag.match(/\salt=["']([^"']+)/i) || [])[1] ||
      (tag.match(/\sdata-color=["']([^"']+)/i) || [])[1] ||
      (tag.match(/\sdata-label=["']([^"']+)/i) || [])[1] ||
      '';

    if (src) {
      addImage(src, label);
    }
  }


  // background-image رنگ‌ها
  const bgMatches = html.matchAll(
    /background(?:-image)?\s*:\s*url\(['"]?([^'")]+)['"]?\)/gi
  );

  for (const m of bgMatches) {
    addImage(m[1], '');
  }


  return results.slice(0, 20);
}
  if (!html) return null;
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    // پشتیبانِ سایت‌هایی که og:image درست تنظیم نکرده‌اند (خیلی رایج در فروشگاه‌های آرایشی
    // کوچک‌تر) — این سه الگو، منابعِ استانداردِ دیگری هستند که همچنان معمولاً به عکسِ واقعیِ
    // محصول اشاره می‌کنند، نه لوگوی سایت.
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
  // راهِ آخر: خیلی از فروشگاه‌ها اطلاعاتِ ساختاریافته‌ی schema.org (JSON-LD) را برای موتورهای
  // جست‌وجو در صفحه می‌گذارند که معمولاً شاملِ فیلدِ "image" همان محصول است — حتی اگر og:image
  // خالی یا اشتباه (مثلاً لوگوی سایت) تنظیم شده باشد، این مقدار معمولاً درست است.
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

// نمودارهای «Ratings» (Scent/Longevity/Sillage) که در بسیاری از سایت‌های عطر (یا ویجت‌های شخص
// ثالثِ تعبیه‌شده مثل «Smell & Feel») نمایش داده می‌شوند، معمولاً به‌صورت متنِ ساده‌ی «SCENT 7.9
// 4608 RATINGS» کنار هم قرار دارند. چون خواندنِ این اعداد توسط مدلِ زبانی گاهی دقیق نیست (ممکن
// است رند یا اشتباه کپی شود)، این‌جا مستقیماً با یک الگوی متنی، عددِ امتیاز (۰ تا ۱۰) و تعدادِ
// رأی‌های هرکدام را از خودِ متن استخراج می‌کنیم — نتیجه‌اش همیشه دقیقاً همان عددی است که روی
// سایتِ مبدأ نوشته شده، نه یک برآوردِ هوش مصنوعی.
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

// آدرس‌های همه‌ی iframeهای داخلِ یک صفحه را (نسبت به baseUrl کامل‌شده) برمی‌گرداند — برای وقتی که
// نمودارِ Ratings یا بخشِ «Main accords» نه در خودِ HTML صفحه، بلکه داخلِ یک ویجتِ شخص‌ثالثِ
// تعبیه‌شده (iframe، مثلاً ویجتِ «Smell & Feel») بارگذاری می‌شود و باید جداگانه واکشی شود.
function extractIframeSrcs(html, baseUrl) {
  const out = [];
  const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 5) {
    try { out.push(new URL(m[1], baseUrl).toString()); } catch { /* skip invalid */ }
  }
  return out;
}

// واژه‌نامه‌ی شناخته‌شده‌ی آکوردهای رایج عطر (انگلیسی) — پایه‌ی تشخیصِ «کدام کلمه واقعاً یک
// آکورد است» به‌جای حدسِ صرفِ «کلمه‌ی با حرفِ اول بزرگ». عبارت‌های دوکلمه‌ای (مثل white floral،
// warm spicy) عمداً قبل از تک‌کلمه‌ای‌هایشان آمده‌اند تا در تطبیق، اول آن‌ها بررسی شوند و به‌اشتباه
// به دو آکوردِ جدا شکسته نشوند؛ ولی کلماتی که کنارِ هم آمده‌اند بدون این‌که یک عبارتِ دوکلمه‌ایِ
// شناخته‌شده باشند (مثل «Oriental Woody» که خودش در این لیست نیست)، هرکدام جدا شناسایی می‌شوند.
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

// متنِ داده‌شده را برای وجودِ هرکدام از KNOWN_ACCORD_WORDS می‌گردد و آکوردهایی که واقعاً پیدا
// شده‌اند را به‌ترتیبِ ظاهرشدن‌شان در متن برمی‌گرداند — عبارت‌های دوکلمه‌ای (مثل white floral)
// اول بررسی می‌شوند تا از تداخل با تک‌کلمه‌ای‌هایشان (floral) جلوگیری شود؛ هر بازه‌ی متنی که یک‌بار
// تطبیق پیدا کرد دوباره برای عبارتِ دیگری بررسی نمی‌شود، پس «Oriental» و «Woody»ی کنارِ هم هرگز
// یک آکورد واحد نمی‌شوند مگر خودِ عبارتِ دوکلمه‌ایشان در فهرست باشد.
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

// بخشِ «Main accords» (که روی سایت‌هایی مثل Fragrantica/Parfumo یا ویجت‌های مشابه، زیرِ یک
// عنوانِ کوچک با چند برچسبِ رنگی — مثل Oriental, Woody, Spicy, Sweet, Floral — نشان داده
// می‌شود) را مستقیماً از متنِ خام استخراج می‌کند: عنوانِ «main accords» را پیدا می‌کند و در
// متنِ بعدش (تا رسیدن به عنوانِ بعدی مثل «Fragrance Pyramid») فقط دنبالِ کلماتی می‌گردد که در
// واژه‌نامه‌ی KNOWN_ACCORD_WORDS باشند — همین یعنی هرچیزِ نامرتبط (مثل برندینگِ ویجت‌های
// شخص‌ثالث یا نشانه‌های داخلیِ خودمان) دیگر هرگز به‌اشتباه به‌عنوانِ آکورد ثبت نمی‌شود، و ترتیبِ
// ظاهرشدن‌شان هم دقیقاً همان ترتیبِ شدت/اهمیتِ آکورد در صفحه‌ی مبدأ (از قوی‌تر به ضعیف‌تر) است.
function extractMainAccordsFromText(text) {
  const t = String(text || "");
  const m = t.match(/main accords[:\s]*(.*?)(?:fragrance pyramid|top notes|search by accords|user ratings|when to wear|$)/i);
  if (!m || !m[1]) return null;
  const chunk = m[1].trim();
  if (!chunk) return null;
  const words = matchKnownAccordsInText(chunk).slice(0, 10);
  return words.length ? words.join(", ") : null;
}

// خیلی از این ویجت‌های شخص‌ثالث (مثل Smell & Feel) داده‌شان را با جاوااسکریپت رندر می‌کنند، اما
// معمولاً همان داده‌ی خام (JSON) از قبل، داخل یک تگِ <script> در همان HTML اولیه هم قرار دارد —
// این تابع تمام بلوک‌های <script>ی که کلمه‌ی scent/longevity/sillage/accord در آن‌ها هست را
// برمی‌گرداند تا جدا از متنِ قابل‌مشاهده، همان‌جا هم دنبالِ اعداد/آکوردها بگردیم.
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

// همان سه امتیازِ Scent/Longevity/Sillage را این‌بار از داخلِ بلوک‌های JSON/جاوااسکریپتِ تعبیه‌شده
// (نه متنِ قابل‌مشاهده) پیدا می‌کند — برای سایت‌هایی که این عدد‌ها را با جاوااسکریپت رسم می‌کنند
// ولی خودِ داده‌ی خام در HTML اولیه هم هست.
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

// همان «Main accords» را این‌بار از یک آرایه‌ی JSON تعبیه‌شده (مثل "accords":["Sweet","Gourmand",...])
// پیدا می‌کند — چه رشته‌های ساده باشند، چه اشیائی با یک فیلدِ name/label/title. نتیجه هم از همان
// واژه‌نامه‌ی KNOWN_ACCORD_WORDS عبور می‌کند تا اگر کلیدهای نامرتبطِ دیگری از همان JSON به‌اشتباه
// گرفته شده باشند، حذف شوند و فقط آکوردهای واقعی باقی بمانند.
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

// موتورِ اصلیِ پیدا کردنِ نمودارِ Ratings و بخشِ Main accords — چهار لایه، از دقیق‌ترین به کلی‌ترین:
// ۱) متنِ قابل‌مشاهده‌ی خودِ صفحه   ۲) بلوک‌های JSON تعبیه‌شده در خودِ صفحه
// ۳) متنِ قابل‌مشاهده‌ی iframeهای صفحه (با هدرِ Referer درست، چون بعضی ویجت‌ها بدونش جواب نمی‌دهند)
// ۴) بلوک‌های JSON تعبیه‌شده داخل همان iframeها
// به‌محض این‌که هم امتیازها و هم آکوردها پیدا شوند، جست‌وجو متوقف می‌شود؛ در غیر این صورت تا آخرین
// iframe ادامه می‌دهد و هرکدام را که پیدا کرد برمی‌گرداند (حتی اگر فقط یکی از دو مورد باشد).
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

// نتیجه‌ی extractPerfumeRatingBars را (در صورت پیدا شدن هرکدام) روی شیء محصولِ برگشتی از Gemini
// می‌نشاند — این اعداد چون مستقیماً از خودِ متنِ سایتِ مبدأ خوانده شده‌اند، همیشه به عددهایی که
// هوش مصنوعی احتمالاً حدس زده یا کمی نادرست کپی کرده، اولویت دارند (جایگزینشان می‌شوند).
function applyRatingBarsToProduct(product, bars) {
  if (!bars) return product;
  if (bars.scent) { product.scentScore = String(bars.scent.score); product.scentRatings = String(bars.scent.ratings); }
  if (bars.longevity) { product.longevityScore = String(bars.longevity.score); product.longevityRatings = String(bars.longevity.ratings); }
  if (bars.sillage) { product.sillageScore = String(bars.sillage.score); product.sillageRatings = String(bars.sillage.ratings); }
  return product;
}

// عکسِ هرکدام از طیف‌های رنگ (variants) را — اگر Gemini از روی نشانه‌های [IMG] صفحه، آدرسِ عکسِ
// همان رنگ را تشخیص داده باشد — دانلود و مستقیماً روی Cloudinary خودمان آپلود می‌کند (نه یک
// لینکِ خارجیِ خام)، دقیقاً همان اتفاقی که برای عکسِ اصلیِ محصول می‌افتد. حداکثر ۱۲ رنگِ اول
// پردازش می‌شود (برای جلوگیری از کندیِ بیش از حد در صفحاتی با طیفِ خیلی زیاد).
async function mirrorVariantImages(variants, baseUrl) {
  if (!Array.isArray(variants) || variants.length === 0) return [];
  const LIMIT = 12;
  const toProcess = variants.slice(0, LIMIT);
  const rest = variants.slice(LIMIT);
  const mirrored = await Promise.all(
    toProcess.map(async (v) => {
      const label = (v && v.label) || '';
      const hex = (v && v.hex) || '';
      const rawUrl = v && v.imageUrl;
      if (!rawUrl) return { label, hex, image: '' };
      try {
        const resolved = new URL(rawUrl, baseUrl).toString();
        const uploadedUrl = await mirrorRemoteImageToCloudinary(resolved);
        return { label, hex, image: uploadedUrl || '' };
      } catch (e) {
        return { label, hex, image: '' };
      }
    })
  );
  return [...mirrored, ...rest.map((v) => ({ label: (v && v.label) || '', hex: (v && v.hex) || '', image: '' }))];
}

async function fetchProductPage(url) {
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

async function callGeminiText(prompt) {
  if (!GEMINI_API_KEY) throw new Error('کلید GEMINI_API_KEY روی سرور تنظیم نشده است');
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || 'خطا در ارتباط با Gemini');
  const text = (data.candidates || []).flatMap((c) => c.content && c.content.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('پاسخ نامعتبر از Gemini دریافت شد');
  return parseJsonObject(text);
}

function buildGeminiProductPrompt(sourceText, sourceUrl) {
  return `تو مسئول استخراج اطلاعات دقیق محصول برای پنل مدیریت فروشگاه هستی.
منبع: ${sourceUrl}
متن صفحه محصول در ادامه آمده است. هرجا نشانه‌ی [IMG src="..." alt="..."] دیدی، یعنی در آن نقطه از صفحه یک عکس بوده — src آدرس عکس و alt توضیح/برچسبِ کنار آن عکس است (مثلاً اسمِ رنگ در صفحه‌ی محصولاتی مثل رژلب یا کرم‌پودر). از این نشانه‌ها برای تشخیص «کدام عکس مالِ کدام طیفِ رنگ است» و «کدام عکس، تصویرِ اصلیِ خودِ محصول است» استفاده کن.
فقط اطلاعاتی را وارد کن که از منبع قابل تشخیص است؛ هرگز حدس نزن و اطلاعات جعلی نساز.
تمام فیلدهای متنی فارسی روان باشند، به‌جز nameEn که باید نام دقیق اصلی محصول باشد، concentration که باید مقدار استاندارد انگلیسی باشد، و mainAccords که باید همان کلمات انگلیسیِ اصلیِ بخشِ «Main accords» باشد — هر آکورد را جدا و با ویرگول از بعدی جدا کن (مثلاً Oriental, Woody, Spicy — نه «Oriental Woody» به‌عنوانِ یک آیتم، مگر خودِ عبارت روی صفحه دقیقاً یک اصطلاحِ دوکلمه‌ای شناخته‌شده مثل «White Floral» یا «Warm Spicy» باشد). ترتیبِ آکوردها را دقیقاً همان ترتیبِ روی صفحه (از قوی‌ترین/بزرگ‌ترین به ضعیف‌ترین) نگه دار. نامِ برندینگِ ویجت‌های شخص‌ثالثِ نمایش‌دهنده‌ی این بخش (مثل «Smell»، «Feel»، «Smell & Feel») و نشانه‌های [IMG ...] هرگز آکورد نیستند — آن‌ها را در mainAccords نیاور.
قیمت خارجی را به تومان تبدیل نکن. اگر قیمت صفحه تومان/ریال است، priceToman را فقط به رقم خام بده؛ در غیر این صورت خالی و مقدار و ارز اصلی را در referencePriceNote بیاور.
categoryGuess فقط یکی از perfume, sprayAndSplash, makeup, hygiene, electronics یا خالی.
برای عطر، نت‌ها، آکوردهای اصلی، عطار و غلظت را فقط در صورت وجود منبع بده.
scentScore/longevityScore/sillageScore فقط اعداد بین ۰ تا ۱۰ هستند (مثلاً همان امتیازهای Scent/Longevity/Sillage در Fragrantica)؛ scentRatings/longevityRatings/sillageRatings تعداد رأی‌دهندگان همان امتیاز است. اگر هیچ‌کدام در منبع نبود، همه را خالی بگذار.
mainImageUrl را فقط اگر یک [IMG] با src مشخص، به‌وضوح تصویرِ اصلیِ خودِ محصول (نه لوگو، نه بنر، نه آیکون، و نه یک دایره‌ی کوچکِ سوآچِ رنگ) باشد پر کن؛ همان src را بدون تغییر بده. اگر صفحه چند [IMG] پشتِ‌سرهم و شبیه‌به‌هم دارد که هرکدام با نامِ یک رنگ/شماره در alt همراه است، اینها سوآچِ رنگ‌ها هستند نه تصویرِ اصلی — آن‌ها را فقط در variants بیاور، نه در mainImageUrl.
اگر محصول طیفِ رنگ دارد (مثل رژلب، کرم‌پودر، سایه، لاک)، برای هر رنگ یک آیتم در variants بساز: label نامِ فارسیِ همان رنگ/شماره، hex کدِ رنگِ نزدیک (اگر مشخص نبود خالی)، و imageUrl همان src از نزدیک‌ترین [IMG] که alt یا متنِ اطرافش با نامِ همان رنگ می‌خواند — اگر برای یک رنگ عکسِ مجزا پیدا نشد، imageUrl را خالی بگذار (هرگز عکسِ یک رنگِ دیگر را به‌اشتباه نسبت نده).
JSON دقیقاً با این ساختار برگردان:
{
"name":"","nameEn":"","brand":"","categoryGuess":"","subcategoryHint":"","priceToman":"","referencePriceNote":"","description":"","properties":"","ingredients":"","volume":"","concentration":"","topNotes":"","middleNotes":"","baseNotes":"","mainAccords":"","perfumer":"","countryOfOrigin":"","yearMade":"","scentScore":"","scentRatings":"","longevityScore":"","longevityRatings":"","sillageScore":"","sillageRatings":"","mainImageUrl":"","variants":[]
}
variants آرایه‌ای از {"label":"","hex":"","imageUrl":""} باشد.

متن صفحه:
${sourceText}`;
}

app.post('/api/ai/extract-product-from-url', auth, requireAdmin, async (req, res) => {
  const url = validateProductUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'لینک محصول معتبر نیست' });
  try {
    const page = await fetchProductPage(url);
    const text = stripHtmlForGemini(page.html);
    if (!text) return res.status(422).json({ error: 'متن قابل استفاده‌ای از صفحه محصول پیدا نشد' });
    const product = await callGeminiText(buildGeminiProductPrompt(text, page.finalUrl));
    // نمودارِ Ratings (رایحه/ماندگاری/پخش بو) و بخشِ «Main accords» را با چهار لایه‌ی جست‌وجو
    // (متنِ صفحه، JSONِ تعبیه‌شده در صفحه، متنِ iframeها، JSONِ تعبیه‌شده در iframeها) پیدا
    // می‌کنیم؛ این مقادیر — چون مستقیماً از خودِ منبع خوانده شده‌اند — جایگزینِ حدسِ Gemini می‌شوند.
    const { bars, mainAccords: mainAccordsFound } = await analyzeFragranceWidget(page.html, text, page.finalUrl);
    applyRatingBarsToProduct(product, bars);
    if (mainAccordsFound) product.mainAccords = mainAccordsFound;
    // طیف‌های رنگ (variants) که Gemini از روی نشانه‌های [IMG] صفحه تشخیص داده را — اگر عکسِ
    // مجزایی برایشان پیدا شده — دانلود و روی Cloudinary آپلود می‌کنیم.
    product.variants = await mirrorVariantImages(product.variants, page.finalUrl);
    // اگر صفحه‌ی محصول یک عکسِ اصلی (og:image/twitter:image) داشته باشد، همان عکس را دانلود و
    // مستقیماً روی Cloudinary خودمان آپلود می‌کنیم (نه یک لینکِ خارجیِ خام) تا در «تصویر واقعی
    // محصول» فرم مدیریت جایگزین شود؛ اگر مرورش با شکست مواجه شد (non-fatal)، بدون عکس ادامه می‌دهیم.
    const rawImageUrl = extractPrimaryImageFromHtml(page.html, page.finalUrl);
    let mirroredImageUrl = rawImageUrl ? await mirrorRemoteImageToCloudinary(rawImageUrl) : null;
    // اگر og:image پیدا نشد یا آپلودش شکست خورد، به‌عنوانِ راهِ دوم سراغِ mainImageUrl‌ای که خودِ
    // Gemini از روی نشانه‌های [IMG] متنِ صفحه پیشنهاد داده می‌رویم.
    if (!mirroredImageUrl && product.mainImageUrl) {
      try {
        const resolved = new URL(product.mainImageUrl, page.finalUrl).toString();
        mirroredImageUrl = await mirrorRemoteImageToCloudinary(resolved);
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
    // نمودارِ Ratings (رایحه/ماندگاری/پخش بو) و بخشِ «Main accords» را با چهار لایه‌ی جست‌وجو
    // (متنِ صفحه، JSONِ تعبیه‌شده در صفحه، متنِ iframeها، JSONِ تعبیه‌شده در iframeها) پیدا
    // می‌کنیم؛ این مقادیر — چون مستقیماً از خودِ منبع خوانده شده‌اند — جایگزینِ حدسِ Gemini می‌شوند.
    const { bars, mainAccords: mainAccordsFound } = await analyzeFragranceWidget(page.html, sourceText, page.finalUrl);
    applyRatingBarsToProduct(product, bars);
    if (mainAccordsFound) product.mainAccords = mainAccordsFound;
    // طیف‌های رنگ (variants) که Gemini از روی نشانه‌های [IMG] صفحه تشخیص داده را — اگر عکسِ
    // مجزایی برایشان پیدا شده — دانلود و روی Cloudinary آپلود می‌کنیم.
    product.variants = await mirrorVariantImages(product.variants, page.finalUrl);
    // همان منطقِ mirror کردنِ عکسِ اصلیِ صفحه (og:image/twitter:image) روی Cloudinary — این
    // endpoint همان چیزی است که فرانت‌اند برای «ورود محصول با لینک» واقعاً صدا می‌زند.
    const rawImageUrl = extractPrimaryImageFromHtml(page.html, page.finalUrl);
    let mirroredImageUrl = rawImageUrl ? await mirrorRemoteImageToCloudinary(rawImageUrl) : null;
    if (!mirroredImageUrl && product.mainImageUrl) {
      try {
        const resolved = new URL(product.mainImageUrl, page.finalUrl).toString();
        mirroredImageUrl = await mirrorRemoteImageToCloudinary(resolved);
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
