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
    if (!aiRes.ok) return res.status(502).json({ error: (aiData && aiData.error && aiData.error.message) || `خطا در ارتباط با Gemini (${aiRes.status})` });
    const textBlock = (aiData.candidates || []).flatMap((c) => (c.content && c.content.parts) || []).map((c) => c.text || '').join('').trim();
    if (!textBlock) return res.status(502).json({ error: 'پاسخ نامعتبر از Gemini دریافت شد' });
    res.json(parseJsonObject(textBlock));
  } catch (e) {
    console.error('Gemini image extraction error:', e);
    res.status(502).json({ error: e.message || 'خطای سرور هنگام تحلیل تصویر با Gemini' });
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
    if (!aiRes.ok) return res.status(502).json({ error: (aiData && aiData.error && aiData.error.message) || 'خطا در ارتباط با سرویس هوش مصنوعی' });
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
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
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
function extractPrimaryImageFromHtml(html, baseUrl) {
  if (!html) return null;
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      try { return new URL(m[1], baseUrl).toString(); } catch { /* skip invalid */ }
    }
  }
  return null;
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
متن صفحه محصول در ادامه آمده است.
فقط اطلاعاتی را وارد کن که از منبع قابل تشخیص است؛ هرگز حدس نزن و اطلاعات جعلی نساز.
تمام فیلدهای متنی فارسی روان باشند، به‌جز nameEn که باید نام دقیق اصلی محصول باشد، concentration که باید مقدار استاندارد انگلیسی باشد، و mainAccords که باید همان کلمات انگلیسیِ اصلیِ «Main accords» (مثل Resinous, Smoky, Spicy, Woody) با ویرگول جدا از هم باشد.
قیمت خارجی را به تومان تبدیل نکن. اگر قیمت صفحه تومان/ریال است، priceToman را فقط به رقم خام بده؛ در غیر این صورت خالی و مقدار و ارز اصلی را در referencePriceNote بیاور.
categoryGuess فقط یکی از perfume, sprayAndSplash, makeup, hygiene, electronics یا خالی.
برای عطر، نت‌ها، آکوردهای اصلی، عطار و غلظت را فقط در صورت وجود منبع بده.
scentScore/longevityScore/sillageScore فقط اعداد بین ۰ تا ۱۰ هستند (مثلاً همان امتیازهای Scent/Longevity/Sillage در Fragrantica)؛ scentRatings/longevityRatings/sillageRatings تعداد رأی‌دهندگان همان امتیاز است. اگر هیچ‌کدام در منبع نبود، همه را خالی بگذار.
JSON دقیقاً با این ساختار برگردان:
{
"name":"","nameEn":"","brand":"","categoryGuess":"","subcategoryHint":"","priceToman":"","referencePriceNote":"","description":"","properties":"","ingredients":"","volume":"","concentration":"","topNotes":"","middleNotes":"","baseNotes":"","mainAccords":"","perfumer":"","countryOfOrigin":"","yearMade":"","scentScore":"","scentRatings":"","longevityScore":"","longevityRatings":"","sillageScore":"","sillageRatings":"","variants":[]
}
variants آرایه‌ای از {"label":"","hex":""} باشد.

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
    // اگر صفحه‌ی محصول یک عکسِ اصلی (og:image/twitter:image) داشته باشد، همان عکس را دانلود و
    // مستقیماً روی Cloudinary خودمان آپلود می‌کنیم (نه یک لینکِ خارجیِ خام) تا در «تصویر واقعی
    // محصول» فرم مدیریت جایگزین شود؛ اگر مرورش با شکست مواجه شد (non-fatal)، بدون عکس ادامه می‌دهیم.
    const rawImageUrl = extractPrimaryImageFromHtml(page.html, page.finalUrl);
    const mirroredImageUrl = rawImageUrl ? await mirrorRemoteImageToCloudinary(rawImageUrl) : null;
    res.json({ ...product, imageUrl: mirroredImageUrl || undefined, sourceUrl: page.finalUrl });
  } catch (e) {
    console.error('Gemini URL extraction error:', e);
    res.status(e.message && e.message.includes('GEMINI_API_KEY') ? 500 : 502).json({ error: e.message || 'تحلیل لینک با Gemini ناموفق بود' });
  }
});
   const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || 'خطا در ارتباط با Gemini' });
    const text = (data.candidates || []).flatMap((c) => c.content && c.content.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) return res.status(502).json({ error: 'پاسخ نامعتبر از Gemini دریافت شد' });
    res.json(parseJsonObject(text));
  } catch (e) {
    console.error('Gemini image extraction error:', e);
    res.status(502).json({ error: e.message || 'تحلیل تصویر با Gemini ناموفق بود' });
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
    // همان منطقِ mirror کردنِ عکسِ اصلیِ صفحه (og:image/twitter:image) روی Cloudinary — این
    // endpoint همان چیزی است که فرانت‌اند برای «ورود محصول با لینک» واقعاً صدا می‌زند.
    const rawImageUrl = extractPrimaryImageFromHtml(page.html, page.finalUrl);
    const mirroredImageUrl = rawImageUrl ? await mirrorRemoteImageToCloudinary(rawImageUrl) : null;
    res.json({ ...product, imageUrl: mirroredImageUrl || undefined, sourceUrl: page.finalUrl });
  } catch (e) {
    console.error('Gemini URL extraction error:', e);
    res.status(e.message && e.message.includes('GEMINI_API_KEY') ? 500 : 502).json({ error: e.message || 'تحلیل لینک با Gemini ناموفق بود' });
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
    if (!r.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || `خطا در ارتباط با Gemini (${r.status})` });
    const resultText = (data.candidates || []).flatMap((c) => (c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
    if (!resultText) return res.status(502).json({ error: 'پاسخ نامعتبر از Gemini دریافت شد' });
    res.json(parseJsonObject(resultText));
  } catch (e) {
    console.error('Gemini perfume image error:', e);
    res.status(502).json({ error: e.message || 'تحلیل تصویر با Gemini ناموفق بود' });
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
