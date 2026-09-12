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
// این فایل عمداً و صریحاً از Gemini 3.5 Flash استفاده می‌کند.
const GEMINI_MODEL = 'gemini-3.5-flash';
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
  const imageMatch = dataUri.match(/^data:i
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
    // می‌کنیم؛ این مقادیر — چون مستقیماً از خودِ منبع خوانده شده‌اند — جایگزینِ حدسِ Gemini می‌شون
د.  const imageMatch = dataUri.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
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
    return 'سهمیه یا محدودیتِ استفاده‌ی سرویسِ هوش مصنوعی برای این مدل تمام شده — چند دقیقه صبر کن، یا در تنظیماتِ Render مقدارِ GEMINI_MODEL را بررسی کن (نباید روی یک مدلِ «تولیدِ عکس» مثل gemini-…-image تنظیم شده باشد؛ این ابزارها به یک مدلِ متنی/بینایی مثل gemini-3.5-flash نیاز دارند).';
  }
  if (raw.length > 220) {
    return raw.slice(0, 200).trim() + '…';
  }
  return raw || 'خطای نامشخصی رخ داد';
}const FRAGANTY_QUOTA_MESSAGE = 'سهمیه ماهانه رایگان ai.fraganty تمام شده — تا ماه بعد صبر کن یا از پلن پولی بگیر';
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

// جستجوی عکسِ محصول (یا یک رنگِ خاص از محصول) در اینترنت.
//
// نکته‌ی مهم: Gemini 3.5 Flash از Google Search grounding پشتیبانی می‌کند، اما
// «Google Image Search grounding» مخصوص مدل‌های Image است. بنابراین برای اینکه
// این قابلیت واقعاً روی همان Gemini 3.5 Flash متنی کار کند، ابتدا Gemini 3.5 Flash
// با Google Search صفحات واقعی و مرتبط را پیدا می‌کند؛ سپس سرور عکس‌های واقعیِ همان
// صفحات (og:image / twitter:image / JSON-LD / img / background-image) را استخراج،
 // اعتبارسنجی و روی Cloudinary آینه می‌کند. به این ترتیب دیگر به
// gemini-3.1-flash-image وابسته نیست و quota مدل تولید تصویر مصرف نمی‌شود.
async function searchProductImageCandidates(query) {
  if (!GEMINI_API_KEY) throw new Error('کلید GEMINI_API_KEY روی سرور تنظیم نشده است');

  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const instruction = `تو مسئول پیدا کردن منبع واقعیِ عکس محصول برای پنل مدیریت Jordan Gallery هستی.
عبارت جستجو: "${query}"

با Google Search چند صفحه‌ی واقعی و معتبر پیدا کن که دقیقاً همین محصول یا همین shade/رنگ/شماره را نمایش می‌دهند.
اولویت با صفحه رسمی برند، فروشگاه معتبر، یا صفحه محصول شناخته‌شده است.
اگر عبارت شامل نام یا شماره رنگ است، همان رنگ/شماره دقیق را اولویت بده.
صفحه‌ای که فقط محصول مشابه، برند دیگر، لوگو، بنر، مقاله عمومی یا محتوای نامرتبط دارد انتخاب نکن.
خودت تصویر تولید نکن؛ فقط منابع واقعی وب را پیدا کن.
پاسخ متنی لازم نیست؛ ما آدرس صفحات پیدا شده را از groundingMetadata می‌خوانیم.`;

  const aiRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1 },
    }),
  });
    });

  const aiData = await aiRes.json().catch(() => ({}));
  if (!aiRes.ok) {
    throw new Error((aiData && aiData.error && aiData.error.message) || `خطا در ارتباط با Gemini Search (${aiRes.status})`);
  }

  const candidates = Array.isArray(aiData.candidates) ? aiData.candidates : [];
  const sourcePages = [];
  const seenPages = new Set();

  for (const candidate of candidates) {
    const metadata = candidate && candidate.groundingMetadata;
    const chunks = metadata && Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : [];
    for (const chunk of chunks) {
      const web = chunk && chunk.web ? chunk.web : null;
      const source = web && (web.uri || web.url) ? String(web.uri || web.url) : '';
      const title = web && web.title ? String(web.title) : '';
      if (!/^https?:\/\//i.test(source)) continue;
      if (seenPages.has(source)) continue;
      seenPages.add(source);
      sourcePages.push({ source, title });
      if (sourcePages.length >= 10) break;
    }
    if (sourcePages.length >= 10) break;
  }

  if (sourcePages.length === 0) return [];

  // از صفحات واقعی، عکس‌های اصلی محصول را استخراج می‌کنیم. این مرحله عمداً بعد از
  // Google Search انجام می‌شود تا مدل متنی 3.5 Flash همان نقشی را داشته باشد که در
  // سایر جستجوهای هوشمند سایت دارد، ولی عکس نهایی مستقیماً از منبع واقعی بیاید.
  const allImages = [];
  const seenImages = new Set();

  for (const page of sourcePages) {
    try {
      const imageCandidates = await extractProductImagesFromPage(page.source, query);
      for (const image of imageCandidates) {
        if (!image || !image.url || seenImages.has(image.url)) continue;
        seenImages.add(image.url);
        allImages.push({
          url: image.url,
          source: page.source,
          title: image.title || page.title || '',
          score: image.score || 0,
        });
        if (allImages.length >= 12) break;
      }
    } catch (e) {
      // یک صفحه‌ی فروشگاهی ممکن است ضدبات/403/timeout باشد؛ سراغ منبع بعدی می‌رویم.
    }
    if (allImages.length >= 12) break;
  }

  return allImages
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 6)
    .map(({ url, source, title }) => ({ url, source, title }));
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/gi, '/');
}

function absoluteHttpUrl(rawUrl, baseUrl) {
  try {
    const cleaned = decodeHtmlEntities(String(rawUrl || '').trim());
    if (!cleaned || /^data:/i.test(cleaned) || /^blob:/i.test(cleaned)) return '';
    const u = new URL(cleaned, baseUrl);
    if (!/^https?:$/i.test(u.protocol)) return '';
    return u.toString();
  } catch (e) {
    return '';
  }
}

function imageUrlLooksUseful(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (/\b(icon|favicon|sprite|avatar|logo|placeholder|loader|spinner|pixel|tracking|badge|rating|star)\b/.test(lower)) return false;
  return true;
}

function imageRelevanceScore(url, label, query) {
  const haystack = `${url} ${label} ${query}`.toLowerCase();
  let score = 0;
  if (/\b(og:image|product|pdp|sku|item|beauty|cosmetic|makeup|foundation|lipstick|shade|swatch)\b/i.test(haystack)) score += 3;
  if (/\.(jpe?g|png|webp)(?:[?#]|$)/i.test(url)) score += 2;
  if (/\b(1200|1000|800|600|500)\b/.test(url)) score += 1;
  if (/\b(thumbnail|thumb|small|tiny)\b/i.test(haystack)) score -= 2;
  if (/\b(banner|hero|campaign|advert|promo)\b/i.test(haystack)) score -= 3;
  return score;
}

async function extractProductImagesFromPage(pageUrl, query) {
  const r = await fetch(pageUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JordanGalleryImageSearch/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!r.ok) throw new Error(`صفحه تصویر قابل دریافت نیست (${r.status})`);
  const contentType = r.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('منبع جستجو صفحه HTML نیست');
  const html = await r.text();
  const baseUrl = r.url || pageUrl;
  const found = [];
  const push = (rawUrl, label, priority) => {
    const url = absoluteHttpUrl(rawUrl, baseUrl);
    if (!url || !imageUrlLooksUseful(url)) return;
    const score = priority + imageRelevanceScore(url, label, query);
    const existing = found.find((item) => item.url === url);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      if (!existing.title && label) existing.title = label;
      return;
    }
    found.push({ url, title: label || '', score });
  };

  // Open Graph
  const ogRegex = /<meta\b[^>]*\b(?:property|name)\s*=\s*["'](?:og:image|og:image:url|twitter:image)["'][^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = ogRegex.exec(html))) push(m[1], 'OpenGraph product image', 10);

  // بعضی صفحات attribute ها را برعکس می‌نویسند.
  const ogRegexReverse = /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\b(?:property|name)\s*=\s*["'](?:og:image|og:image:url|twitter:image)["'][^>]*>/gi;
  while ((m = ogRegexReverse.exec(html))) push(m[1], 'OpenGraph product image', 10);

  // JSON-LD / Product.image
  const jsonLdRegex = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonLdRegex.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.image) {
          const images = Array.isArray(node.image) ? node.image : [node.image];
          for (const image of images) {
            if (typeof image === 'string') push(image, 'JSON-LD product image', 9);
            else if (image && typeof image === 'object' && image.url) push(image.url, 'JSON-LD product image', 9);
          }
        }
        if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
      };
      nodes.forEach(visit);
    } catch (e) {
      // JSON-LD ناقص/نامعتبر است؛ سایر روش‌های استخراج ادامه پیدا می‌کنند.
    }
  }

  // <img> و lazy-loading attributes
  const imgRegex = /<img\b[^>]*>/gi;
  while ((m = imgRegex.exec(html))) {
    const tag = m[0];
    const attrs = {};
    const attrRegex = /([:\w-]+)\s*=\s*["']([^"']*)["']/gi;
    let a;
    while ((a = attrRegex.exec(tag))) attrs[a[1].toLowerCase()] = a[2];

    const label = [
      attrs.alt,
      attrs.title,
      attrs['data-alt'],
      attrs['aria-label'],
    ].filter(Boolean).join(' ');

    const candidates = [
      attrs.src,
      attrs['data-src'],
      attrs['data-original'],
      attrs['data-lazy-src'],
      attrs['data-image'],
      attrs['data-image-url'],
    ].filter(Boolean);

    for (const candidate of candidates) push(candidate, label, 6);

    const srcsets = [
      attrs.srcset,
      attrs['data-srcset'],
      attrs['data-lazy-srcset'],
    ].filter(Boolean);

    for (const srcset of srcsets) {
      for (const item of srcset.split(',')) {
        const parts = item.trim().split(/\s+/);
        if (parts[0]) push(parts[0], label, 7);
      }
    }
  }

  // CSS background-image:url(...)
  const bgRegex = /background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = bgRegex.exec(html))) push(m[1], 'CSS product image', 4);

  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
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
  let imgCount = 0;
  const IMG_LIMIT = 60;
      found.push({ url, title: label || '', score: priority + imageRelevanceScore(url, label, query) });
  };

  // OpenGraph / Twitter — معمولاً بهترین تصویر اصلی محصول.
  for (const match of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>/gi)) {
    push(match[1], 'product image', 10);
  }

  for (const match of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]*>/gi)) {
    push(match[1], 'product image', 10);
  }

  // JSON-LD Product.image
  for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = decodeHtmlEntities(block[1]);
    try {
      const json = JSON.parse(raw);
      const walk = (value, keyName = '') => {
        if (!value) return;
        if (typeof value === 'string' && /image/i.test(keyName)) {
          push(value, keyName, 8);
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value) walk(item, keyName);
          return;
        }
        if (typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) walk(item, key);
        }
      };
      walk(json);
    } catch (e) { /* JSON-LD خراب است؛ imgهای عادی را ادامه می‌دهیم */ }
  }

  // تصاویر واقعی داخل صفحه. srcset را هم می‌خوانیم و بزرگ‌ترین/آخرین گزینه را ترجیح می‌دهیم.
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const labelMatch = tag.match(/\b(?:alt|title|aria-label|data-name|data-color|data-testid)=["']([^"']*)["']/i);
    const label = labelMatch ? decodeHtmlEntities(labelMatch[1]) : '';
    const srcMatch = tag.match(/\b(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/i);
    if (srcMatch) push(srcMatch[1], label, 4);

    const srcsetMatch = tag.match(/\b(?:srcset|data-srcset)=["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',').map((part) => part.trim()).filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) push(last.split(/\s+/)[0], label, 5);
    }
  }

  // background-image سوآچ‌ها/عکس‌های محصول.
  for (const match of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    push(match[1], 'background image / swatch', 2);
  }

  const dedup = new Map();
  for (const item of found) {
    if (!dedup.has(item.url) || dedup.get(item.url).score < item.score) {
      dedup.set(item.url, item);
    }
  }

  return Array.from(dedup.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

app.post('/api/ai/search-product-image', auth, requireAdmin, async (req, res) => {
  const query = ((req.body && req.body.query) || '').trim();
  if (!query) return res.status(400).json({ error: 'عبارتِ جستجو را وارد کن' });

  try {
    const candidates = await searchProductImageCandidates(query);

    if (candidates.length === 0) {
      return res.json({ results: [] });
    }

    // هرکدام از نتایج را همین الان روی Cloudinary خودمان آپلود می‌کنیم — تا چیزی که مدیر در
    // پنجره‌ی نتایج می‌بیند، دقیقاً همان چیزی باشد که با یک کلیک ذخیره می‌شود (نه یک لینکِ
    // خارجیِ ناپایدار که ممکن است فردا از دسترس خارج شود).
    const mirrored = await Promise.all(
      candidates.map(async (c) => {
        try {
          const url = await mirrorRemoteImageToCloudinary(c.url);
          return url ? { url, source: c.source || '' } : null;
        } catch (e) {
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

  if (ownMatch) {
    return res.json({
      foundInOwnDb: true,
      product: {
        id: ownMatch.id,
        name: ownMatch.name,
        category: ownMatch.category,
        subcategory: ownMatch.subcategory
      }
    });
  }

  let free = null;
  try {
    free = await lookupOpenFacts(code);
  } catch (e) {
    console.error('lookupOpenFacts error:', e.message);
  }

  let ai = null;
  let aiError = null;

  if (ANTHROPIC_API_KEY) {
    try {
      ai = await identifyBarcodeWithAI(code);
      if (!ai) aiError = 'محصول با جستجوی هوش مصنوعی هم شناسایی نشد';
    } catch (e) {
      aiError = e.message;
      console.error('identifyBarcodeWithAI failed (non-fatal):', aiError);
    }
  }

  let note = null;
  if (!ai) {
    note = !ANTHROPIC_API_KEY
      ? 'کلید هوش مصنوعی روی سرور تنظیم نشده — نام فارسی، توضیح، ویژگی‌ها، ترکیبات و نت‌های عطر را باید دستی وارد کنی'
      : `غنی‌سازی با هوش مصنوعی ناموفق بود — ${aiError || ''}`;
  }

  if (!free && !ai) {
    return res.json({
      foundInOwnDb: false,
      external: null,
      note
    });
  }

  const rawImage = (ai && ai.imageUrl) || (free && free.image) || '';
  const mirroredImage = rawImage
    ? await mirrorRemoteImageToCloudinary(rawImage)
    : null;

  res.json({
    foundInOwnDb: false,
    note,
    external: {
      found: true,
      source: ai ? (free ? 'ai+free' : 'ai') : 'free',
      isPerfume: ai ? !!ai.isPerfume : null,
      name: (ai && ai.name) || '',
      title: (ai && ai.nameEn) || (free && free.title) || '',
      brand: (ai && ai.brand) || (free && free.brand) || '',
      image: mirroredImage || rawImage || '',
      description: (ai && ai.description) || '',
      properties: (ai && ai.properties) || '',
      ingredients: (ai && ai.ingredients) || (free && free.ingredients) || '',
      volume: (ai && ai.volume) || (free && free.volume) || '',
      concentration: (ai && ai.concentration) || '',
      topNotes: (ai && ai.topNotes) || '',
      middleNotes: (ai && ai.middleNotes) || '',
      baseNotes: (ai && ai.baseNotes) || '',
      mainAccords: (ai && ai.mainAccords) || '',
      perfumer: (ai && ai.perfumer) || '',
      countryOfOrigin: (ai && ai.countryOfOrigin) || '',
      yearMade: ai && ai.yearMade ? String(ai.yearMade) : ''
    }
  });
}));

// ============================================================
// NEW CAPABILITY #1: Product page URL -> Gemini
// ============================================================

function validateProductUrl(value) {
  try {
    const u = new URL(String(value));
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u;
  } catch {
    return null;
  }
}

function stripHtmlForGemini(html) {
  let imgCount = 0;
  const IMG_LIMIT = 60;
    let text = String(html || '');

  text = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');

  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    if (imgCount >= IMG_LIMIT) return ' ';
    imgCount += 1;

    const srcMatch = tag.match(/\b(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/i);
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);

    const src = srcMatch ? srcMatch[1] : '';
    const alt = altMatch ? altMatch[1] : '';

    return ` تصویر محصول: ${src} ${alt} `;
  });

  text = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, 30000);
}

async function fetchProductPage(url) {
  const r = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JordanGalleryAI/1.0)',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });

  if (!r.ok) {
    throw new Error(`صفحه محصول قابل دریافت نیست (${r.status})`);
  }

  const contentType = r.headers.get('content-type') || '';

  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error('آدرس واردشده صفحه HTML محصول نیست');
  }

  const html = await r.text();

  return {
    html,
    finalUrl: r.url || url.toString()
  };
}

async function extractProductFromUrlWithGemini(pageUrl, html) {
  if (!GEMINI_API_KEY) {
    throw new Error('کلید GEMINI_API_KEY روی سرور تنظیم نشده است');
  }

  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const cleanText = stripHtmlForGemini(html);

  const prompt = `تو دستیار هوشمند ثبت محصول برای فروشگاه Jordan Gallery هستی.

صفحه محصول زیر از اینترنت دریافت شده است.

URL صفحه:
${pageUrl}

محتوای صفحه:
${cleanText}

اطلاعات واقعی محصول را فقط از همین صفحه استخراج کن.

اگر یک مقدار در صفحه وجود ندارد، حدس نزن و مقدار خالی برگردان.

پاسخ فقط JSON معتبر باشد و هیچ متن دیگری خارج از JSON ننویس.

ساختار JSON:
{
  "name": "",
  "nameEn": "",
  "brand": "",
  "category": "",
  "subcategory": "",
  "description": "",
  "properties": "",
  "ingredients": "",
  "volume": "",
  "concentration": "",
  "barcode": "",
  "imageUrl": "",
  "images": [],
  "topNotes": "",
  "middleNotes": "",
  "baseNotes": "",
  "baseAccords": "",
  "mainAccords": "",
  "perfumer": "",
  "countryOfOrigin": "",
  "yearMade": "",
  "isPerfume": false
}

نکات مهم:
- نام محصول را دقیقاً از صفحه استخراج کن.
- برند را از صفحه استخراج کن.
- اگر محصول عطر است، نت‌های ابتدایی، میانی و پایه را استخراج کن.
- اگر محصول آرایشی است، ویژگی‌ها، رنگ، نوع محصول و اطلاعات مربوط به آن را استخراج کن.
- اگر چند تصویر واقعی محصول در صفحه وجود دارد، آنها را در images قرار بده.
- imageUrl باید بهترین تصویر اصلی محصول باشد.
- لوگوی برند، آیکون، بنر تبلیغاتی، عکس افراد و تصاویر نامرتبط را به‌عنوان تصویر اصلی انتخاب نکن.
- barcode را فقط در صورت وجود واقعی در صفحه وارد کن.
- اطلاعات ساختگی تولید نکن.`;

  const aiRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });

  const aiData = await aiRes.json().catch(() => ({}));

  if (!aiRes.ok) {
    throw new Error(
      (aiData && aiData.error && aiData.error.message) ||
      `خطا در ارتباط با Gemini (${aiRes.status})`
    );
  }

  const textBlock =
    aiData &&
    aiData.candidates &&
    aiData.candidates[0] &&
    aiData.candidates[0].content &&
    Array.isArray(aiData.candidates[0].content.parts)
      ? aiData.candidates[0].content.parts
          .map((p) => p && p.text ? p.text : '')
          .join('')
      : '';

  if (!textBlock) {
    throw new Error('Gemini اطلاعاتی از صفحه محصول برنگرداند');
  }

  const parsed = parseJsonObject(textBlock);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('پاسخ Gemini قابل پردازش نیست');
  }

  return parsed;
}

app.post('/api/ai/extract-product-url', auth, requireAdmin, async (req, res) => {
  const rawUrl = ((req.body && req.body.url) || '').trim();
  const url = validateProductUrl(rawUrl);

  if (!url) {
    return res.status(400).json({
      error: 'آدرس صفحه محصول معتبر نیست'
    });
  }

  try {
    const page = await fetchProductPage(url);
    const product = await extractProductFromUrlWithGemini(
      page.finalUrl,
      page.html
    );

    let imageUrl = product.imageUrl || '';

    if (imageUrl) {
      try {
        const absoluteImage = absoluteHttpUrl(
          imageUrl,
          page.finalUrl
        );

        if (absoluteImage) {
          const mirrored = await mirrorRemoteImageToCloudinary(
            absoluteImage
          );

          if (mirrored) {
            imageUrl = mirrored;
          }
        }
      } catch (e) {
        console.error(
          'extract-product-url image mirror error:',
          e.message
        );
      }
    }

    const images = Array.isArray(product.images)
      ? product.images
          .map((item) => absoluteHttpUrl(item, page.finalUrl))
          .filter(Boolean)
          .slice(0, 12)
      : [];

    res.json({
      success: true,
      sourceUrl: page.finalUrl,
      product: {
        ...product,
        imageUrl,
        images
      }
    });
  } catch (e) {
    console.error('extract-product-url error:', e);

    res.status(502).json({
      error: friendlyAiError(e)
    });
  }
});
  // آدرس‌های همه‌ی iframeهای داخلِ یک صفحه را (نسبت به baseUrl کامل‌شده) برمی‌گرداند — برای وقتی که
  // اطلاعات محصول داخل یک ویجت/صفحه‌ی توکار قرار گرفته باشد.
  function extractIframeUrls(html, baseUrl) {
    const urls = [];
    const seen = new Set();

    for (const match of String(html || '').matchAll(
      /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi
    )) {
      try {
        const url = new URL(match[1], baseUrl).toString();
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      } catch {
        // URL نامعتبر را نادیده می‌گیریم.
      }
    }

    return urls.slice(0, 10);
  }

  function normalizeAiProductResult(data) {
    if (!data || typeof data !== 'object') return {};

    const result = { ...data };

    const stringFields = [
      'name',
      'nameEn',
      'brand',
      'category',
      'subcategory',
      'description',
      'properties',
      'ingredients',
      'volume',
      'concentration',
      'barcode',
      'imageUrl',
      'topNotes',
      'middleNotes',
      'baseNotes',
      'baseAccords',
      'mainAccords',
      'perfumer',
      'countryOfOrigin',
      'yearMade'
    ];

    for (const field of stringFields) {
      if (result[field] == null) result[field] = '';
      else if (typeof result[field] !== 'string') result[field] = String(result[field]);
    }

    if (!Array.isArray(result.images)) {
      result.images = result.imageUrl ? [result.imageUrl] : [];
    }

    result.images = result.images
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);

    result.isPerfume = !!result.isPerfume;

    return result;
  }

  app.post('/api/ai/extract-product-url', auth, requireAdmin, async (req, res) => {
    const rawUrl = ((req.body && req.body.url) || '').trim();
    const url = validateProductUrl(rawUrl);

    if (!url) {
      return res.status(400).json({
        error: 'آدرس صفحه محصول معتبر نیست'
      });
    }

    try {
      const page = await fetchProductPage(url);
      let product = await extractProductFromUrlWithGemini(
        page.finalUrl,
        page.html
      );

      product = normalizeAiProductResult(product);

      if (!product.imageUrl) {
        product.imageUrl = extractPrimaryImageFromHtml(
          page.html,
          page.finalUrl
        ) || '';
      }

      if (product.imageUrl) {
        const absoluteImage = absoluteHttpUrl(
          product.imageUrl,
          page.finalUrl
        );

        if (absoluteImage) {
          try {
            const mirrored = await mirrorRemoteImageToCloudinary(
              absoluteImage
            );

            if (mirrored) {
              product.imageUrl = mirrored;
            }
          } catch (e) {
            console.error(
              'extract-product-url image mirror error:',
              e.message
            );
          }
        }
      }

      product.images = product.images
        .map((item) => absoluteHttpUrl(item, page.finalUrl))
        .filter(Boolean)
        .slice(0, 12);

      res.json({
        success: true,
        sourceUrl: page.finalUrl,
        product
      });
    } catch (e) {
      console.error('extract-product-url error:', e);
      res.status(502).json({
        error: friendlyAiError(e)
      });
    }
  });

  app.post('/api/ai/extract-product', auth, requireAdmin, async (req, res) => {
    try {
      const imageBase64 = String(
        (req.body && req.body.imageBase64) || ''
      ).trim();

      if (!imageBase64) {
        return res.status(400).json({
          error: 'تصویر محصول ارسال نشده است'
        });
      }

      const match = imageBase64.match(
        /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i
      );

      if (!match) {
        return res.status(400).json({
          error: 'فرمت تصویر باید PNG، JPG یا WEBP باشد'
        });
      }

      const buffer = Buffer.from(match[2], 'base64');

      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({
          error: 'حجم تصویر نباید بیشتر از ۱۰ مگابایت باشد'
        });
      }

      const mimeType =
        match[1].toLowerCase() === 'jpg' ||
        match[1].toLowerCase() === 'jpeg'
          ? 'image/jpeg'
          : `image/${match[1].toLowerCase()}`;

      const endpoint =
        `${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

      const prompt = buildProductExtractionPrompt();

      const aiRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: match[2]
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      });

      const aiData = await aiRes.json().catch(() => ({}));

      if (!aiRes.ok) {
        throw new Error(
          (aiData &&
            aiData.error &&
            aiData.error.message) ||
          `خطا در ارتباط با Gemini (${aiRes.status})`
        );
      }

      const textBlock =
        aiData &&
        aiData.candidates &&
        aiData.candidates[0] &&
        aiData.candidates[0].content &&
        Array.isArray(aiData.candidates[0].content.parts)
          ? aiData.candidates[0].content.parts
              .map((part) => part && part.text ? part.text : '')
              .join('')
          : '';

      if (!textBlock) {
        throw new Error(
          'Gemini اطلاعاتی از تصویر محصول برنگرداند'
        );
      }

      const parsed = parseJsonObject(textBlock);

      if (!parsed || typeof parsed !== 'object') {
        throw new Error(
          'پاسخ Gemini قابل پردازش نیست'
        );
      }

      res.json({
        success: true,
        product: normalizeAiProductResult(parsed)
      });
    } catch (e) {
      console.error('extract-product error:', e);
      res.status(502).json({
        error: friendlyAiError(e)
      });
    }
  });
