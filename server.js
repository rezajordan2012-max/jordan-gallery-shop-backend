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

// ============================================================
// GEMINI AI
// ============================================================
// کلید Gemini را در Render با نام GEMINI_API_KEY قرار بده.
// مدل پیش‌فرض برای مصرف اقتصادی‌تر انتخاب شده است.
// در صورت نیاز می‌توانی در Render متغیر GEMINI_MODEL را نیز تنظیم کنی.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

// برای ویژگی «جستجوی مشخصات ادکلن بر اساس نام محصول» — کلید رایگان از fraganty.ai
const FRAGANTY_API_KEY = process.env.FRAGANTY_API_KEY;
const FRAGANTY_BASE_URL = 'https://fraganty.ai';

// برای ویژگی «حذف خودکار پس‌زمینه‌ی عکس محصول»
const REMOVEBG_API_KEY = process.env.REMOVEBG_API_KEY;

// ============================================================
// MONGODB
// ============================================================

const MONGODB_URI = process.env.MONGODB_URI;

let mongoClientPromise = null;
let inMemoryFallback = null;

if (!MONGODB_URI) {
  console.warn('⚠️  هشدار: MONGODB_URI تنظیم نشده — از حافظه‌ی موقت استفاده می‌شود.');
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'rezajordan2012@gmail.com').toLowerCase();

const SEED_PRODUCTS = [
  {
    id: 'p1',
    name: 'بلور شب',
    brand: 'جردن',
    category: 'perfume',
    subcategory: 'womenPerfume',
    price: 2450000,
    description: 'رایحه‌ای شرقی و گرم با نت‌های عود و وانیل، مناسب شب.',
    image: ''
  },
  {
    id: 'p2',
    name: 'باغ سپید',
    brand: 'جردن',
    category: 'perfume',
    subcategory: 'menPerfume',
    price: 1980000,
    description: 'ترکیبی تازه از یاس و مرکبات برای روزهای بهاری.',
    image: ''
  },
  {
    id: 'p3',
    name: 'کانسیلر پوششی',
    brand: 'اطلس',
    category: 'makeup',
    subcategory: 'face',
    type: 'concealer',
    price: 890000,
    description: 'کانسیلر با پوشش بالا، مناسب پوست‌های خشک و بی‌روح.',
    image: ''
  },
  {
    id: 'p4',
    name: 'پالت سایه صدف',
    brand: 'اطلس',
    category: 'makeup',
    subcategory: 'eye',
    type: 'eyeshadow',
    price: 1250000,
    description: 'پالت سایه با پیگمنت بالا و بافت مخملی.',
    image: ''
  },
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
  {
    id: 'p8',
    name: 'ست براش حرفه‌ای',
    brand: 'اطلس',
    category: 'makeup',
    subcategory: 'accessory',
    type: 'brushes',
    price: 540000,
    description: 'ست براش‌های آرایشی با موی مصنوعی نرم.',
    image: ''
  },
  {
    id: 'p9',
    name: 'شامپو ترمیم‌کننده',
    brand: 'ولوره',
    category: 'hygiene',
    subcategory: 'hairCare',
    price: 380000,
    description: 'شامپو بدون سولفات، مناسب موهای آسیب‌دیده.',
    image: ''
  },
  {
    id: 'p10',
    name: 'لوسیون آبرسان بدن',
    brand: 'ولوره',
    category: 'hygiene',
    subcategory: 'bodySkin',
    price: 420000,
    description: 'لوسیون سبک و سریع‌جذب برای آبرسانی روزانه‌ی پوست.',
    image: ''
  },
  {
    id: 'p5',
    name: 'سشوار حرفه‌ای یون‌دار',
    brand: 'ولوره',
    category: 'electronics',
    subcategory: 'hair',
    price: 3200000,
    description: 'قدرت ۲۲۰۰ وات، فناوری یونیزه برای کاهش وز مو.',
    image: ''
  },
  {
    id: 'p6',
    name: 'اپیلاتور بی‌سیم',
    brand: 'ولوره',
    category: 'electronics',
    subcategory: 'body',
    price: 2100000,
    description: 'طراحی مینیمال، شارژ سریع و کاربرد ملایم روی پوست.',
    image: ''
  },
  {
    id: 'p11',
    name: 'دستگاه پاکسازی صورت',
    brand: 'ولوره',
    category: 'electronics',
    subcategory: 'face',
    price: 1650000,
    description: 'برس سونیک برای پاکسازی عمیق منافذ پوست صورت.',
    image: ''
  },
];

function defaultState() {
  return {
    users: [],
    orders: [],
    products: SEED_PRODUCTS,
    settings: {},
    nextUserId: 1,
    nextOrderId: 1,
    nextProductId: 8
  };
}

async function getCollection() {
  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000
    });

    mongoClientPromise = client.connect().then(() => client);
  }

  const client = await mongoClientPromise;

  return client
    .db('jordan_gallery')
    .collection('store_state');
}

async function readDB() {
  if (!MONGODB_URI) {
    if (!inMemoryFallback) {
      inMemoryFallback = defaultState();
    }

    return inMemoryFallback;
  }

  const col = await getCollection();

  let doc = await col.findOne({ _id: 'main' });

  if (!doc) {
    doc = {
      _id: 'main',
      ...defaultState()
    };

    await col.insertOne(doc);
  }

  if (!Array.isArray(doc.products) || doc.products.length === 0) {
    doc.products = SEED_PRODUCTS;
  }

  if (!doc.nextProductId) {
    doc.nextProductId = 8;
  }

  if (!doc.settings || typeof doc.settings !== 'object') {
    doc.settings = {};
  }

  if (!Array.isArray(doc.users)) {
    doc.users = [];
  }

  if (!Array.isArray(doc.orders)) {
    doc.orders = [];
  }

  if (!doc.nextUserId) {
    doc.nextUserId = 1;
  }

  if (!doc.nextOrderId) {
    doc.nextOrderId = 1;
  }

  return doc;
}

async function writeDB(data) {
  if (!MONGODB_URI) {
    inMemoryFallback = data;
    return;
  }

  const col = await getCollection();

  const { _id, ...rest } = data;

  await col.replaceOne(
    { _id: 'main' },
    {
      _id: 'main',
      ...rest
    },
    {
      upsert: true
    }
  );
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const CALLBACK_URL =
  process.env.CALLBACK_URL ||
  'http://localhost:4000/payment/callback';

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  'http://localhost:5173';

// ============================================================
// AUTH
// ============================================================

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({
      error: 'ورود الزامی است'
    });
  }

  const token = header.replace('Bearer ', '');

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({
      error: 'نشست نامعتبر است، دوباره وارد شوید'
    });
  }
}

function requireAdmin(req, res, next) {
  if (
    !req.user ||
    String(req.user.email || '').toLowerCase() !== ADMIN_EMAIL
  ) {
    return res.status(403).json({
      error: 'اجازه‌ی دسترسی به این بخش را نداری'
    });
  }

  next();
}

function withDb(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      console.error('DB error:', e);

      res.status(500).json({
        error: 'مشکل در اتصال به پایگاه‌داده — لطفاً چند لحظه بعد دوباره امتحان کن'
      });
    }
  };
}

function noCache(req, res, next) {
  res.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  next();
}

// ============================================================
// GEMINI HELPERS
// ============================================================

// ارسال درخواست عمومی به Gemini
async function callGemini({
  contents,
  generationConfig = {},
  tools = null
}) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY روی سرور تنظیم نشده است'
    );
  }

  const body = {
    contents,
    generationConfig
  };

  if (tools) {
    body.tools = tools;
  }

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY
    },
    body: JSON.stringify(body)
  });

  const rawText = await response.text();

  let data = null;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data &&
      data.error &&
      data.error.message
        ? data.error.message
        : `Gemini API error (${response.status})`;

    throw new Error(message);
  }

  const parts =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    Array.isArray(data.candidates[0].content.parts)
      ? data.candidates[0].content.parts
      : [];

  const text = parts
    .map((part) => part && part.text ? part.text : '')
    .join('')
    .trim();

  if (!text) {
    throw new Error(
      'پاسخ متنی معتبری از Gemini دریافت نشد'
    );
  }

  return {
    text,
    data
  };
}

// استخراج JSON از پاسخ Gemini حتی اگر مدل اشتباهاً Markdown اضافه کند
function parseAiJson(text) {
  let cleaned = String(text || '').trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start >= 0 && end >= start) {
      const possibleJson = cleaned
        .slice(start, end + 1)
        .trim();

      return JSON.parse(possibleJson);
    }

    throw new Error(
      'پاسخ هوش مصنوعی قابل تفسیر نبود'
    );
  }
}

// ============================================================
// AUTH ROUTES
// ============================================================

app.post(
  '/api/auth/register',
  withDb(async (req, res) => {
    const {
      email,
      password,
      fullName
    } = req.body || {};

    if (
      !email ||
      !password ||
      password.length < 6
    ) {
      return res.status(400).json({
        error: 'ایمیل و رمز عبور (حداقل ۶ کاراکتر) الزامی است'
      });
    }

    const db = await readDB();

    const exists = db.users.find(
      (u) => u.email === email
    );

    if (exists) {
      return res.status(409).json({
        error: 'این ایمیل قبلاً ثبت شده است'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = {
      id: db.nextUserId++,
      email,
      password_hash: hash,
      full_name: fullName || '',
      created_at: new Date().toISOString()
    };

    db.users.push(user);

    await writeDB(db);

    const token = jwt.sign(
      {
        id: user.id,
        email
      },
      JWT_SECRET,
      {
        expiresIn: '7d'
      }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email,
        fullName: user.full_name,
        createdAt: user.created_at
      }
    });
  })
);

app.post(
  '/api/auth/login',
  withDb(async (req, res) => {
    const {
      email,
      password
    } = req.body || {};

    const db = await readDB();

    const user = db.users.find(
      (u) => u.email === email
    );

    if (!user) {
      return res.status(401).json({
        error: 'ایمیل یا رمز عبور اشتباه است'
      });
    }

    const ok = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!ok) {
      return res.status(401).json({
        error: 'ایمیل یا رمز عبور اشتباه است'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email
      },
      JWT_SECRET,
      {
        expiresIn: '7d'
      }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        createdAt: user.created_at || null
      }
    });
  })
);

app.get(
  '/api/auth/me',
  auth,
  withDb(async (req, res) => {
    const db = await readDB();

    const user = db.users.find(
      (u) => u.id === req.user.id
    );

    if (!user) {
      return res.status(404).json({
        error: 'کاربر یافت نشد'
      });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        createdAt: user.created_at || null
      }
    });
  })
);

// ============================================================
// REMOVE BACKGROUND
// ============================================================

async function removeBackgroundFromDataUri(dataUri) {
  if (!REMOVEBG_API_KEY) {
    console.warn(
      'REMOVEBG_API_KEY تنظیم نشده — حذف پس‌زمینه نادیده گرفته شد.'
    );

    return dataUri;
  }

  const match = dataUri.match(
    /^data:image\/(png|jpe?g|webp);base64,(.+)$/
  );

  if (!match) {
    return dataUri;
  }

  try {
    const res = await fetch(
      'https://api.remove.bg/v1.0/removebg',
      {
        method: 'POST',
        headers: {
          'X-Api-Key': REMOVEBG_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_file_b64: match[2],
          size: 'auto',
          format: 'png',
          bg_color: 'white'
        })
      }
    );

    if (!res.ok) {
      const errBody = await res
        .text()
        .catch(() => '');

      console.error(
        'remove.bg failed:',
        res.status,
        errBody
      );

      return dataUri;
    }

    const buffer = Buffer.from(
      await res.arrayBuffer()
    );

    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (e) {
    console.error(
      'remove.bg request failed (non-fatal):',
      e.message
    );

    return dataUri;
  }
}

// ============================================================
// CLOUDINARY
// ============================================================

async function uploadDataUriToCloudinary(dataUri) {
  if (
    !CLOUDINARY_CLOUD_NAME ||
    !CLOUDINARY_API_KEY ||
    !CLOUDINARY_API_SECRET
  ) {
    throw new Error(
      'تنظیمات Cloudinary روی سرور کامل نشده است'
    );
  }

  const imageMatch = dataUri.match(
    /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/
  );

  const videoMatch = dataUri.match(
    /^data:video\/(mp4|webm|quicktime|ogg|mov);base64,(.+)$/
  );

  if (!imageMatch && !videoMatch) {
    throw new Error(
      'فرمت فایل پشتیبانی نمی‌شود'
    );
  }

  const isVideo = !!videoMatch;

  const dataPart = isVideo
    ? videoMatch[2]
    : imageMatch[2];

  const approxBytes = Math.ceil(
    (dataPart.length * 3) / 4
  );

  const maxBytes = isVideo
    ? 30 * 1024 * 1024
    : 10 * 1024 * 1024;

  if (approxBytes > maxBytes) {
    throw new Error(
      isVideo
        ? 'حجم ویدیو بیش از حد مجاز است (حداکثر ۳۰ مگابایت)'
        : 'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)'
    );
  }

  const timestamp = Math.floor(
    Date.now() / 1000
  );

  const folder = 'maison-store';

  const signature = crypto
    .createHash('sha1')
    .update(
      `folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`
    )
    .digest('hex');

  const body = new URLSearchParams({
    file: dataUri,
    api_key: CLOUDINARY_API_KEY,
    timestamp: String(timestamp),
    folder,
    signature
  });

  const resourceType = isVideo
    ? 'video'
    : 'image';

  const cloudRes = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
      body
    }
  );

  const data = await cloudRes.json();

  if (
    !cloudRes.ok ||
    !data.secure_url
  ) {
    throw new Error(
      (data &&
        data.error &&
        data.error.message) ||
        'آپلود به Cloudinary ناموفق بود'
    );
  }

  return {
    url: data.secure_url,
    type: isVideo
      ? 'video'
      : 'image'
  };
}

async function mirrorRemoteImageToCloudinary(
  remoteUrl
) {
  try {
    if (
      !remoteUrl ||
      typeof remoteUrl !== 'string' ||
      !/^https?:\/\//i.test(remoteUrl)
    ) {
      return null;
    }

    const imgRes = await fetch(remoteUrl);

    if (!imgRes.ok) {
      return null;
    }

    const contentType =
      imgRes.headers.get('content-type') || '';

    if (!contentType.startsWith('image/')) {
      return null;
    }

    const buffer = Buffer.from(
      await imgRes.arrayBuffer()
    );

    if (
      buffer.length >
      10 * 1024 * 1024
    ) {
      return null;
    }

    const mimeForDataUri =
      contentType
        .split(';')[0]
        .replace(
          'image/jpg',
          'image/jpeg'
        );

    const supported = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif'
    ];

    if (
      !supported.includes(
        mimeForDataUri
      )
    ) {
      return null;
    }

    const dataUri =
      `data:${mimeForDataUri};base64,${buffer.toString('base64')}`;

    const cleaned =
      await removeBackgroundFromDataUri(
        dataUri
      );

    const uploaded =
      await uploadDataUriToCloudinary(
        cleaned
      );

    return uploaded.url;
  } catch (e) {
    console.error(
      'mirrorRemoteImageToCloudinary failed:',
      e.message
    );

    return null;
  }
}

// ============================================================
// UPLOAD
// ============================================================

app.post(
  '/api/upload',
  auth,
  requireAdmin,
  async (req, res) => {
    const {
      imageBase64,
      removeBackground
    } = req.body || {};

    if (
      !imageBase64 ||
      typeof imageBase64 !== 'string'
    ) {
      return res.status(400).json({
        error: 'فایل معتبر نیست'
      });
    }

    try {
      const isVideo =
        imageBase64.startsWith(
          'data:video/'
        );

      const dataToUpload =
        removeBackground && !isVideo
          ? await removeBackgroundFromDataUri(
              imageBase64
            )
          : imageBase64;

      const uploaded =
        await uploadDataUriToCloudinary(
          dataToUpload
        );

      res.json(uploaded);
    } catch (e) {
      const statusMap = {
        'تنظیمات Cloudinary روی سرور کامل نشده است': 500,
        'فرمت فایل پشتیبانی نمی‌شود': 400
      };

      res
        .status(
          statusMap[e.message] ||
          (
            e.message &&
            e.message.includes('حجم')
          )
            ? 413
            : 502
        )
        .json({
          error:
            e.message ||
            'آپلود ناموفق بود'
        });
    }
  }
);

// ============================================================
// AI: EXTRACT PRODUCT FROM IMAGE — GEMINI
// ============================================================

app.post(
  '/api/ai/extract-product',
  auth,
  requireAdmin,
  async (req, res) => {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error:
          'GEMINI_API_KEY روی سرور تنظیم نشده است — کلید Gemini را در متغیرهای محیطی Render اضافه کن'
      });
    }

    const {
      imageBase64
    } = req.body || {};

    if (
      !imageBase64 ||
      typeof imageBase64 !== 'string'
    ) {
      return res.status(400).json({
        error: 'تصویر معتبر نیست'
      });
    }

    const match =
      imageBase64.match(
        /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/
      );

    if (!match) {
      return res.status(400).json({
        error:
          'فرمت تصویر پشتیبانی نمی‌شود (فقط png, jpg, webp)'
      });
    }

    // Gemini از image/jpeg استفاده می‌کند.
    const mediaType =
      match[1] === 'image/jpg'
        ? 'image/jpeg'
        : match[1];

    const data = match[2];

    const approxBytes =
      Math.ceil(
        (data.length * 3) / 4
      );

    if (
      approxBytes >
      10 * 1024 * 1024
    ) {
      return res.status(413).json({
        error:
          'حجم تصویر بیش از حد مجاز است (حداکثر ۱۰ مگابایت)'
      });
    }

    const instruction = `تصویر پیوست‌شده اسکرین‌شاتِ صفحه‌ی یک محصول از یک فروشگاه اینترنتی یا شبکه‌ی اجتماعی است (می‌تواند عطر، آرایشی، بهداشتی، اسپری یا لوازم برقی شخصی باشد، به هر زبانی). با دقتِ کامل هر اطلاعاتی که با اطمینان از روی تصویر قابل تشخیص است را استخراج کن. اگر چیزی مطمئن نیستی یا در تصویر دیده نمی‌شود، همان فیلد را خالی ("") یا آرایه‌ی خالی بگذار — هرگز حدس نزن یا اطلاعات جعلی نساز.

قانون اجباری درباره‌ی زبان خروجی: تمام فیلدهای متنیِ زیر باید کاملاً به فارسیِ روان نوشته شوند، حتی اگر متن روی تصویر انگلیسی یا هر زبان دیگری باشد — باید ترجمه یا آوانویسیِ رایجِ فارسی را بنویسی، نه متن اصلی. تنها استثنا فیلد "nameEn" است که باید دقیقاً همان‌طور که روی تصویر نوشته شده (زبان اصلی) بماند.

قانونِ مهم درباره‌ی قیمت: فقط اگر قیمت روی تصویر به‌وضوح به تومان یا ریال نوشته شده، آن را در فیلد "priceToman" فقط به‌صورت رقمِ خام (بدون کاما، بدون واحد) بنویس. اگر قیمت به هر ارز خارجیِ دیگری (دلار، یورو و ...) نوشته شده، فیلد priceToman را خالی بگذار و همان مقدار و واحدِ اصلی را عیناً در فیلد "referencePriceNote" بنویس — هرگز خودت تبدیل ارز انجام نده.

فیلد "categoryGuess" باید دقیقاً یکی از این مقادیرِ ثابتِ انگلیسی باشد و فقط وقتی از دسته مطمئن هستی پر شود، وگرنه خالی بماند:
perfume, sprayAndSplash, makeup, hygiene, electronics

فقط و فقط یک شیء JSON معتبر برگردان، بدون Markdown و بدون توضیح اضافه، دقیقاً با این ساختار:

{
  "name": "",
  "nameEn": "",
  "brand": "",
  "categoryGuess": "",
  "subcategoryHint": "",
  "priceToman": "",
  "referencePriceNote": "",
  "description": "",
  "properties": "",
  "ingredients": "",
  "volume": "",
  "concentration": "",
  "topNotes": "",
  "middleNotes": "",
  "baseNotes": "",
  "perfumer": "",
  "countryOfOrigin": "",
  "yearMade": "",
  "variants": [
    {
      "label": "",
      "hex": ""
    }
  ]
}

قوانین concentration:
فقط برای عطر و دقیقاً یکی از این مقادیر:
Extrait de Parfum
Parfum
Eau de Parfum
Eau de Parfum Intense
Eau de Toilette
Eau de Cologne
Eau Fraiche

اگر مشخص نیست خالی بگذار.

برای variants فقط وقتی چند گزینه رنگی واقعاً در تصویر دیده می‌شود اطلاعات بده.`;

    try {
      const result =
        await callGemini({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inline_data: {
                    mime_type: mediaType,
                    data
                  }
                },
                {
                  text: instruction
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1700,
            responseMimeType:
              'application/json'
          }
        });

      const parsed =
        parseAiJson(
          result.text
        );

      res.json(parsed);
    } catch (e) {
      console.error(
        'Gemini extract-product error:',
        e.message
      );

      res.status(502).json({
        error:
          e.message ||
          'خطا هنگام تحلیل تصویر با Gemini'
      });
    }
  }
);

// ============================================================
// FRAGANTY SEARCH
// ============================================================

const FRAGANTY_QUOTA_MESSAGE =
  'سهمیه‌ی ماهانه‌ی رایگان fraganty.ai (۲۰ درخواست در ماه) تمام شده — تا ماه بعد صبر کن یا از fraganty.ai/pricing پلن پولی بگیر';

app.get(
  '/api/ai/search-perfume',
  auth,
  requireAdmin,
  async (req, res) => {
    if (!FRAGANTY_API_KEY) {
      return res.status(500).json({
        error:
          'FRAGANTY_API_KEY روی سرور تنظیم نشده است — کلید رایگان را از fraganty.ai بگیر و در متغیرهای محیطی سرور اضافه کن'
      });
    }

    const q =
      (req.query.q || '').trim();

    if (!q) {
      return res.status(400).json({
        error: 'نام محصول را وارد کن'
      });
    }

    try {
      const url =
        `${FRAGANTY_BASE_URL}/api/perfumes?q=${encodeURIComponent(q)}&limit=8`;

      const fRes =
        await fetch(url, {
          headers: {
            'X-API-Key':
              FRAGANTY_API_KEY
          }
        });

      const fData =
        await fRes.json();

      if (!fRes.ok) {
        console.error(
          'Fraganty search failed:',
          fRes.status,
          fData
        );

        return res
          .status(
            fRes.status === 429
              ? 429
              : 502
          )
          .json({
            error:
              fRes.status === 429
                ? FRAGANTY_QUOTA_MESSAGE
                : (
                    fData &&
                    fData.error
                  ) ||
                  'خطا در ارتباط با fraganty.ai'
          });
      }

      const results =
        (
          Array.isArray(
            fData.data
          )
            ? fData.data
            : []
        )
          .filter(
            (p) =>
              p &&
              p.id
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            brand: p.brand,
            year: p.year,
            image: p.image
          }));

      res.json({
        data: results
      });
    } catch (e) {
      console.error(
        'Fraganty search error:',
        e
      );

      res.status(500).json({
        error:
          'خطای سرور هنگام جستجو در fraganty.ai'
      });
    }
  }
);

// ============================================================
// FRAGANTY DETAILS
// ============================================================

app.get(
  '/api/ai/perfume-details',
  auth,
  requireAdmin,
  async (req, res) => {
    if (!FRAGANTY_API_KEY) {
      return res.status(500).json({
        error:
          'FRAGANTY_API_KEY روی سرور تنظیم نشده است'
      });
    }

    const slug =
      (req.query.slug || '').trim();

    if (!slug) {
      return res.status(400).json({
        error:
          'شناسه‌ی محصول نامعتبر است'
      });
    }

    try {
      const url =
        `${FRAGANTY_BASE_URL}/api/perfumes/${encodeURIComponent(slug)}`;

      const fRes =
        await fetch(url, {
          headers: {
            'X-API-Key':
              FRAGANTY_API_KEY
          }
        });

      const fData =
        await fRes.json();

      if (!fRes.ok) {
        console.error(
          'Fraganty details failed:',
          slug,
          fRes.status,
          fData
        );

        return res
          .status(
            fRes.status === 429
              ? 429
              : fRes.status === 404
                ? 404
                : 502
          )
          .json({
            error:
              fRes.status === 429
                ? FRAGANTY_QUOTA_MESSAGE
                : fRes.status === 404
                  ? 'این محصول در fraganty.ai پیدا نشد — یک نتیجه‌ی دیگر را امتحان کن'
                  : (
                      fData &&
                      fData.error
                    ) ||
                    'خطا در دریافت جزئیات از fraganty.ai'
          });
      }

      if (
        !fData ||
        !fData.name
      ) {
        console.error(
          'Fraganty details returned empty payload for slug:',
          slug,
          fData
        );

        return res.status(502).json({
          error:
            'این محصول در fraganty.ai اطلاعات کاملی ندارد — یک نتیجه‌ی دیگر را امتحان کن یا فیلدها را دستی پر کن.'
        });
      }

      res.json(fData);
    } catch (e) {
      console.error(
        'Fraganty details error:',
        e
      );

      res.status(500).json({
        error:
          'خطای سرور هنگام دریافت جزئیات از fraganty.ai'
      });
    }
  }
);

// ============================================================
// AI: TRANSLATE PERFUME TEXT — GEMINI
// ============================================================

app.post(
  '/api/ai/translate-perfume-text',
  auth,
  requireAdmin,
  async (req, res) => {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error:
          'GEMINI_API_KEY روی سرور تنظیم نشده است — کلید Gemini را در متغیرهای محیطی Render اضافه کن'
      });
    }

    const {
      name,
      brand,
      description,
      accords,
      seasons,
      dayNight,
      gender,
      rating
    } = req.body || {};

    if (!name) {
      return res.status(400).json({
        error:
          'نام محصول لازم است'
      });
    }

    const instruction = `اطلاعات زیر درباره‌ی یک عطر است (از یک دیتابیس انگلیسی‌زبان عطر گرفته شده):

نام: ${name}
برند: ${brand || ''}
جنسیت: ${gender || ''}
امتیاز کاربران: ${rating || ''}
توضیح اصلی (انگلیسی، ممکن است خالی باشد): ${description || ''}
آکوردهای اصلی: ${
      Array.isArray(accords)
        ? accords
            .map((a) =>
              typeof a === 'string'
                ? a
                : a.name
            )
            .filter(Boolean)
            .join('، ')
        : ''
    }
مناسب‌ترین فصل‌ها (درصد تناسب): ${
      seasons
        ? JSON.stringify(seasons)
        : ''
    }
مناسب‌ترین زمان استفاده (درصد تناسب روز/شب): ${
      dayNight
        ? JSON.stringify(dayNight)
        : ''
    }

بر اساس این اطلاعات فقط و فقط یک شیء JSON معتبر برگردان، بدون Markdown، بدون backtick و بدون هیچ توضیح اضافه:

{
  "description": "یک توضیح کوتاه دو تا سه جمله‌ای، کاملاً فارسی و روان، درباره‌ی حال‌وهوا و شخصیت این عطر.",
  "properties": "چند ویژگی کلیدی، هر ویژگی در یک خط جدا. حداکثر ۵ خط و کاملاً فارسی."
}

اگر توضیح اصلی انگلیسی موجود بود بر پایه‌ی همان بنویس؛ اگر خالی بود، از روی آکوردها و مشخصات یک توضیح معنادار بساز.`;

    try {
      const result =
        await callGemini({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: instruction
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 700,
            responseMimeType:
              'application/json'
          }
        });

      const parsed =
        parseAiJson(
          result.text
        );

      res.json({
        description:
          parsed.description || '',
        properties:
          parsed.properties || ''
      });
    } catch (e) {
      console.error(
        'Gemini translate-perfume-text error:',
        e.message
      );

      res.status(502).json({
        error:
          e.message ||
          'خطای سرور هنگام ترجمه‌ی توضیحات'
      });
    }
  }
);

// ============================================================
// BARCODE — OPEN FACTS
// ============================================================

async function lookupOpenFacts(code) {
  const bases = [
    'https://world.openbeautyfacts.org/api/v2/product',
    'https://world.openfoodfacts.org/api/v2/product'
  ];

  for (const base of bases) {
    try {
      const r =
        await fetch(
          `${base}/${encodeURIComponent(code)}.json`
        );

      if (!r.ok) {
        continue;
      }

      const data =
        await r.json();

      if (
        !data ||
        data.status !== 1 ||
        !data.product
      ) {
        continue;
      }

      const p =
        data.product;

      const title =
        (
          p.product_name ||
          p.product_name_en ||
          p.generic_name ||
          ''
        ).trim();

      if (!title) {
        continue;
      }

      const brand =
        (p.brands || '')
          .split(',')[0]
          .trim();

      const image =
        p.image_front_url ||
        p.image_url ||
        '';

      const ingredients =
        (
          p.ingredients_text ||
          p.ingredients_text_en ||
          ''
        ).trim();

      const volMatch =
        (
          p.quantity ||
          p.product_quantity ||
          ''
        )
          .toString()
          .match(
            /([\d.,]+)\s*m?\s*l\b/i
          );

      const volume =
        volMatch
          ? volMatch[1].replace(
              ',',
              '.'
            )
          : '';

      return {
        title,
        brand,
        image,
        ingredients,
        volume
      };
    } catch (e) {
      console.error(
        'Open Facts lookup failed:',
        base,
        e.message
      );
    }
  }

  return null;
}

// ============================================================
// BARCODE AI — GEMINI + GOOGLE SEARCH
// ============================================================

async function identifyBarcodeWithAI(code) {
  const instruction = `کد بارکد زیر متعلق به یک محصول است:

${code}

با استفاده از جستجوی وب، این بارکد را در پایگاه‌های بارکد معتبر، سایت‌های فروشگاهی و منابع معتبر جستجو کن و محصول واقعیِ متناظر با این بارکد را شناسایی کن.

در صورت احتمال عطر/ادکلن بودن، منابع تخصصی عطر را نیز بررسی کن.

مهم:
- فقط وقتی محصول را با اطمینان معقول پیدا کردی found=true بده.
- اگر مطمئن نیستی found=false بده.
- هرگز محصول را حدس نزن.
- هرگز اطلاعات جعلی نساز.
- برای imageUrl فقط لینک مستقیم و معتبر تصویر خود محصول را بده.
- تمام متن‌های فارسی باید کاملاً فارسی باشند.
- nameEn باید نام اصلی محصول در منبع باشد.
- concentration فقط یکی از مقادیر مجاز زیر باشد:
Extrait de Parfum
Parfum
Eau de Parfum
Eau de Parfum Intense
Eau de Toilette
Eau de Cologne
Eau Fraiche

فقط و فقط یک شیء JSON معتبر برگردان:

{
  "found": true,
  "isPerfume": false,
  "name": "",
  "nameEn": "",
  "brand": "",
  "imageUrl": "",
  "description": "",
  "properties": "",
  "ingredients": "",
  "volume": "",
  "concentration": "",
  "topNotes": "",
  "middleNotes": "",
  "baseNotes": "",
  "perfumer": "",
  "countryOfOrigin": "",
  "yearMade": ""
}

قواعد:
- اگر found=false است، همه‌ی فیلدهای دیگر را تا حد امکان خالی بگذار.
- ingredients فقط برای محصول غیرعطر در صورت پیدا شدن.
- volume فقط عدد بر حسب میلی‌لیتر.
- yearMade فقط عدد.
- نت‌های عطر با ویرگول فارسی «،» جدا شوند.
- properties حداکثر ۵ خط کوتاه باشد.`;

  const result =
    await callGemini({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: instruction
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000
      },
      tools: [
        {
          google_search: {}
        }
      ]
    });

  const parsed =
    parseAiJson(
      result.text
    );

  if (
    !parsed ||
    !parsed.found ||
    !parsed.name
  ) {
    return null;
  }

  return parsed;
}

// ============================================================
// BARCODE LOOKUP
// ============================================================

app.get(
  '/api/ai/barcode-lookup',
  auth,
  requireAdmin,
  withDb(async (req, res) => {
    const code =
      (req.query.code || '').trim();

    if (!code) {
      return res.status(400).json({
        error:
          'کد بارکد نامعتبر است'
      });
    }

    const db =
      await readDB();

    // مرحله اول: دیتابیس خود فروشگاه
    const ownMatch =
      db.products.find(
        (p) =>
          p.barcode &&
          p.barcode === code
      );

    if (ownMatch) {
      return res.json({
        foundInOwnDb: true,
        product: {
          id: ownMatch.id,
          name: ownMatch.name,
          category:
            ownMatch.category,
          subcategory:
            ownMatch.subcategory
        }
      });
    }

    // مرحله دوم: Open Beauty Facts / Open Food Facts
    let free = null;

    try {
      free =
        await lookupOpenFacts(
          code
        );
    } catch (e) {
      console.error(
        'lookupOpenFacts error:',
        e.message
      );
    }

    // مرحله سوم: Gemini + Google Search
    let ai = null;
    let aiError = null;

    if (GEMINI_API_KEY) {
      try {
        ai =
          await identifyBarcodeWithAI(
            code
          );

        if (!ai) {
          aiError =
            'محصول با جستجوی هوش مصنوعی هم شناسایی نشد';
        }
      } catch (e) {
        aiError =
          e.message;

        console.error(
          'identifyBarcodeWithAI failed (non-fatal):',
          aiError
        );
      }
    }

    let note = null;

    if (!ai) {
      note =
        !GEMINI_API_KEY
          ? 'کلید هوش مصنوعی (GEMINI_API_KEY) روی سرور تنظیم نشده — نام فارسی، توضیح، ویژگی‌ها، ترکیبات و نت‌های عطر را باید دستی وارد کنی.'
          : `غنی‌سازی با هوش مصنوعی ناموفق بود (${aiError}) — نام فارسی، توضیح، ویژگی‌ها، ترکیبات و نت‌های عطر را باید دستی وارد کنی.`;
    }

    if (!free && !ai) {
      return res.json({
        foundInOwnDb: false,
        external: null,
        note
      });
    }

    // اولویت تصویر Gemini، سپس Open Facts
    const rawImage =
      (ai && ai.imageUrl) ||
      (free && free.image) ||
      '';

    const mirroredImage =
      rawImage
        ? await mirrorRemoteImageToCloudinary(
            rawImage
          )
        : null;

    return res.json({
      foundInOwnDb: false,
      note,
      external: {
        found: true,

        source: ai
          ? free
            ? 'ai+free'
            : 'ai'
          : 'free',

        isPerfume:
          ai
            ? !!ai.isPerfume
            : null,

        name:
          (ai && ai.name) ||
          '',

        title:
          (ai && ai.nameEn) ||
          (free && free.title) ||
          '',

        brand:
          (ai && ai.brand) ||
          (free && free.brand) ||
          '',

        image:
          mirroredImage ||
          rawImage ||
          '',

        description:
          (ai && ai.description) ||
          '',

        properties:
          (ai && ai.properties) ||
          '',

        ingredients:
          (ai && ai.ingredients) ||
          (free && free.ingredients) ||
          '',

        volume:
          (ai && ai.volume) ||
          (free && free.volume) ||
          '',

        concentration:
          (ai && ai.concentration) ||
          '',

        topNotes:
          (ai && ai.topNotes) ||
          '',

        middleNotes:
          (ai && ai.middleNotes) ||
          '',

        baseNotes:
          (ai && ai.baseNotes) ||
          '',

        perfumer:
          (ai && ai.perfumer) ||
          '',

        countryOfOrigin:
          (ai && ai.countryOfOrigin) ||
          '',

        yearMade:
          ai && ai.yearMade
            ? String(ai.yearMade)
            : ''
      }
    });
  })
);

// ============================================================
// SETTINGS
// ============================================================

app.get(
  '/api/settings',
  noCache,
  withDb(async (req, res) => {
    const db =
      await readDB();

    res.json(
      db.settings || {}
    );
  })
);

app.put(
  '/api/settings',
  auth,
  requireAdmin,
  withDb(async (req, res) => {
    const db =
      await readDB();

    db.settings = {
      ...db.settings,
      ...(req.body || {})
    };

    await writeDB(db);

    res.json(
      db.settings
    );
  })
);

// ============================================================
// SALES COUNT
// ============================================================

function computeSalesCounts(
  orders
) {
  const counts = {};

  (orders || []).forEach(
    (order) => {
      if (
        order.status !== 'paid'
      ) {
        return;
      }

      (order.items || []).forEach(
        (item) => {
          if (
            !item ||
            !item.id
          ) {
            return;
          }

          counts[item.id] =
            (counts[item.id] || 0) +
            (Number(item.qty) || 0);
        }
      );
    }
  );

  return counts;
}

// ============================================================
// PRODUCTS
// ============================================================

app.get(
  '/api/products',
  noCache,
  withDb(async (req, res) => {
    const db =
      await readDB();

    const salesCounts =
      computeSalesCounts(
        db.orders
      );

    const products =
      (db.products || [])
        .map((p) => ({
          ...p,
          salesCount:
            salesCounts[p.id] ||
            0
        }));

    res.json(products);
  })
);

app.post(
  '/api/products',
  auth,
  requireAdmin,
  withDb(async (req, res) => {
    const p =
      req.body || {};

    if (
      !p.name ||
      !p.price
    ) {
      return res.status(400).json({
        error:
          'نام و قیمت محصول الزامی است'
      });
    }

    const db =
      await readDB();

    const id =
      'p' +
      db.nextProductId++;

    const product = {
      id,
      name: p.name,
      nameEn:
        p.nameEn || '',
      brand:
        p.brand || '',
      category:
        p.category ||
        'perfume',
      subcategory:
        p.subcategory ||
        '',
      type:
        p.type || '',
      facets:
        p.facets &&
        typeof p.facets === 'object'
          ? p.facets
          : {},
      price:
        Number(p.price),
      description:
        p.description ||
        '',
      properties:
        p.properties ||
        '',
      ingredients:
        p.ingredients ||
        '',
      topNotes:
        p.topNotes ||
        '',
      middleNotes:
        p.middleNotes ||
        '',
      baseNotes:
        p.baseNotes ||
        '',
      longevity:
        p.longevity ||
        '',
      sillage:
        p.sillage ||
        '',
      perfumer:
        p.perfumer ||
        '',
      countryOfOrigin:
        p.countryOfOrigin ||
        '',
      yearMade:
        p.yearMade ||
        '',
      fragranticaRating:
        p.fragranticaRating ||
        '',
      volume:
        p.volume ||
        '',
      barcode:
        p.barcode ||
        '',
      discountPercent:
        Number(
          p.discountPercent
        ) || 0,
      image:
        p.image || '',
      imageFit:
        p.imageFit === 'cover'
          ? 'cover'
          : 'contain',
      imagePosX:
        Number.isFinite(
          Number(
            p.imagePosX
          )
        )
          ? Number(
              p.imagePosX
            )
          : 50,
      imagePosY:
        Number.isFinite(
          Number(
            p.imagePosY
          )
        )
          ? Number(
              p.imagePosY
            )
          : 50,
      imageZoom:
        Number.isFinite(
          Number(
            p.imageZoom
          )
        ) &&
        Number(
          p.imageZoom
        ) > 0
          ? Number(
              p.imageZoom
            )
          : 1,

      ...(Array.isArray(
        p.variants
      ) &&
      p.variants.length > 0
        ? {
            variants:
              p.variants
          }
        : {})
    };

    db.products.push(
      product
    );

    await writeDB(db);

    res.json(
      product
    );
  })
);

// ============================================================
// UPDATE PRODUCT
// ============================================================

app.put(
  '/api/products/:id',
  auth,
  requireAdmin,
  withDb(async (req, res) => {
    const db =
      await readDB();

    const idx =
      db.products.findIndex(
        (x) =>
          x.id ===
          req.params.id
      );

    if (idx === -1) {
      return res.status(404).json({
        error:
          'محصول یافت نشد'
      });
    }

    const p =
      req.body || {};

    const updated = {
      ...db.products[idx],

      name:
        p.name ??
        db.products[idx].name,

      nameEn:
        p.nameEn !== undefined
          ? p.nameEn
          : (
              db.products[idx]
                .nameEn || ''
            ),

      brand:
        p.brand ??
        db.products[idx].brand,

      category:
        p.category ??
        db.products[idx].category,

      subcategory:
        p.subcategory !== undefined
          ? p.subcategory
          : db.products[idx]
              .subcategory,

      type:
        p.type !== undefined
          ? p.type
          : db.products[idx]
              .type,

      facets:
        p.facets !== undefined
          ? p.facets
          : db.products[idx]
              .facets,

      price:
        p.price !== undefined
          ? Number(p.price)
          : db.products[idx]
              .price,

      description:
        p.description ??
        db.products[idx]
          .description,

      properties:
        p.properties !== undefined
          ? p.properties
          : db.products[idx]
              .properties,

      ingredients:
        p.ingredients !== undefined
          ? p.ingredients
          : db.products[idx]
              .ingredients,

      topNotes:
        p.topNotes !== undefined
          ? p.topNotes
          : (
              db.products[idx]
                .topNotes || ''
            ),

      middleNotes:
        p.middleNotes !== undefined
          ? p.middleNotes
          : (
              db.products[idx]
                .middleNotes || ''
            ),

      baseNotes:
        p.baseNotes !== undefined
          ? p.baseNotes
          : (
              db.products[idx]
                .baseNotes || ''
            ),

      longevity:
        p.longevity !== undefined
          ? p.longevity
          : (
              db.products[idx]
                .longevity || ''
            ),

      sillage:
        p.sillage !== undefined
          ? p.sillage
          : (
              db.products[idx]
                .sillage || ''
            ),

      perfumer:
        p.perfumer !== undefined
          ? p.perfumer
          : (
              db.products[idx]
                .perfumer || ''
            ),

      countryOfOrigin:
        p.countryOfOrigin !== undefined
          ? p.countryOfOrigin
          : (
              db.products[idx]
                .countryOfOrigin || ''
            ),

      yearMade:
        p.yearMade !== undefined
          ? p.yearMade
          : (
              db.products[idx]
                .yearMade || ''
            ),

      fragranticaRating:
        p.fragranticaRating !== undefined
          ? p.fragranticaRating
          : (
              db.products[idx]
                .fragranticaRating || ''
            ),

      volume:
        p.volume !== undefined
          ? p.volume
          : (
              db.products[idx]
                .volume || ''
            ),

      barcode:
        p.barcode !== undefined
          ? p.barcode
          : (
              db.products[idx]
                .barcode || ''
            ),

      discountPercent:
        p.discountPercent !== undefined
          ? (
              Number(
                p.discountPercent
              ) || 0
            )
          : db.products[idx]
              .discountPercent,

      image:
        p.image ??
        db.products[idx]
          .image,

      imageFit:
        p.imageFit !== undefined
          ? (
              p.imageFit === 'cover'
                ? 'cover'
                : 'contain'
            )
          : (
              db.products[idx]
                .imageFit ||
              'contain'
            ),

      imagePosX:
        p.imagePosX !== undefined
          ? (
              Number(
                p.imagePosX
              ) || 50
            )
          : (
              db.products[idx]
                .imagePosX ??
              50
            ),

      imagePosY:
        p.imagePosY !== undefined
          ? (
              Number(
                p.imagePosY
              ) || 50
            )
          : (
              db.products[idx]
                .imagePosY ??
              50
            ),

      imageZoom:
        p.imageZoom !== undefined
          ? (
              Number(
                p.imageZoom
              ) || 1
            )
          : (
              db.products[idx]
                .imageZoom ??
              1
            )
    };

    if (
      Array.isArray(
        p.variants
      ) &&
      p.variants.length > 0
    ) {
      updated.variants =
        p.variants;
    } else if (
      p.variants !== undefined
    ) {
      delete updated.variants;
    }

    db.products[idx] =
      updated;

    await writeDB(db);

    res.json(
      updated
    );
  })
);

// ============================================================
// DELETE PRODUCT
// ============================================================

app.delete(
  '/api/products/:id',
  auth,
  requireAdmin,
  withDb(async (req, res) => {
    const db =
      await readDB();

    const before =
      db.products.length;

    db.products =
      db.products.filter(
        (x) =>
          x.id !==
          req.params.id
      );

    if (
      db.products.length ===
      before
    ) {
      return res.status(404).json({
        error:
          'محصول یافت نشد'
      });
    }

    await writeDB(db);

    res.json({
      ok: true
    });
  })
);

// ============================================================
// ORDERS
// ============================================================

app.get(
  '/api/orders',
  auth,
  noCache,
  withDb(async (req, res) => {
    const db =
      await readDB();

    const orders =
      db.orders
        .filter(
          (o) =>
            o.user_id ===
            req.user.id
        )
        .sort(
          (a, b) =>
            new Date(
              b.created_at
            ) -
            new Date(
              a.created_at
            )
        );

    res.json(
      orders
    );
  })
);

// ============================================================
// ZARINPAL PAYMENT REQUEST
// ============================================================

app.post(
  '/api/payment/request',
  auth,
  withDb(async (req, res) => {
    const {
      items,
      amount,
      description
    } = req.body || {};

    if (
      !amount ||
      amount < 1000
    ) {
      return res.status(400).json({
        error:
          'مبلغ نامعتبر است'
      });
    }

    if (
      !ZARINPAL_MERCHANT_ID
    ) {
      return res.status(500).json({
        error:
          'ZARINPAL_MERCHANT_ID تنظیم نشده است'
      });
    }

    try {
      const zRes =
        await fetch(
          'https://api.zarinpal.com/pg/v4/payment/request.json',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              merchant_id:
                ZARINPAL_MERCHANT_ID,
              amount,
              callback_url:
                CALLBACK_URL,
              description:
                description ||
                'خرید از فروشگاه'
            })
          }
        );

      const data =
        await zRes.json();

      if (
        data.data &&
        data.data.code ===
          100
      ) {
        const authority =
          data.data.authority;

        const db =
          await readDB();

        const order = {
          id:
            db.nextOrderId++,
          user_id:
            req.user.id,
          items:
            items || [],
          amount,
          authority,
          ref_id: null,
          status:
            'pending',
          created_at:
            new Date().toISOString()
        };

        db.orders.push(
          order
        );

        await writeDB(
          db
        );

        res.json({
          paymentUrl:
            `https://www.zarinpal.com/pg/StartPay/${authority}`
        });
      } else {
        res.status(400).json({
          error:
            'خطا در اتصال به درگاه پرداخت',
          detail: data
        });
      }
    } catch (e) {
      res.status(500).json({
        error:
          'خطای سرور در ارتباط با درگاه'
      });
    }
  })
);

// ============================================================
// ZARINPAL CALLBACK
// ============================================================

app.get(
  '/payment/callback',
  async (req, res) => {
    const {
      Authority,
      Status
    } = req.query;

    let db;

    try {
      db =
        await readDB();
    } catch (e) {
      return res.redirect(
        `${FRONTEND_URL}/payment/result?status=error`
      );
    }

    const order =
      db.orders.find(
        (o) =>
          o.authority ===
          Authority
      );

    if (!order) {
      return res.redirect(
        `${FRONTEND_URL}/payment/result?status=notfound`
      );
    }

    if (
      Status !== 'OK'
    ) {
      order.status =
        'canceled';

      await writeDB(db);

      return res.redirect(
        `${FRONTEND_URL}/payment/result?status=canceled`
      );
    }

    try {
      const zRes =
        await fetch(
          'https://api.zarinpal.com/pg/v4/payment/verify.json',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              merchant_id:
                ZARINPAL_MERCHANT_ID,
              amount:
                order.amount,
              authority:
                Authority
            })
          }
        );

      const data =
        await zRes.json();

      if (
        data.data &&
        (
          data.data.code ===
            100 ||
          data.data.code ===
            101
        )
      ) {
        order.status =
          'paid';

        order.ref_id =
          String(
            data.data.ref_id
          );

        await writeDB(
          db
        );

        return res.redirect(
          `${FRONTEND_URL}/payment/result?status=success&ref=${data.data.ref_id}`
        );
      }

      order.status =
        'failed';

      await writeDB(db);

      res.redirect(
        `${FRONTEND_URL}/payment/result?status=failed`
      );
    } catch (e) {
      res.redirect(
        `${FRONTEND_URL}/payment/result?status=error`
      );
    }
  }
);

// ============================================================
// ROOT
// ============================================================

app.get(
  '/',
  (req, res) =>
    res.send(
      'Store API is running'
    )
);

// ============================================================
// START SERVER
// ============================================================

const PORT =
  process.env.PORT || 4000;

app.listen(
  PORT,
  () =>
    console.log(
      `Server running on port ${PORT}`
    )
);
