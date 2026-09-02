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

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

// ------------------------------------------------------------
// Google Gemini
// ------------------------------------------------------------
// کلید Gemini فقط از Environment Variable خوانده می‌شود.
// هرگز کلید API را مستقیماً داخل این فایل قرار نده.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// مدل پیش‌فرض سبک‌تر برای کاهش مصرف.
// در صورت نیاز می‌توانی در Render مقدار GEMINI_MODEL را تغییر دهی.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ------------------------------------------------------------
// Fraganty
// ------------------------------------------------------------

const FRAGANTY_API_KEY = process.env.FRAGANTY_API_KEY;
const FRAGANTY_BASE_URL = 'https://fraganty.ai';

// ------------------------------------------------------------
// remove.bg
// ------------------------------------------------------------

const REMOVEBG_API_KEY = process.env.REMOVEBG_API_KEY;

// ------------------------------------------------------------
// MongoDB
// ------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI;

let mongoClientPromise = null;
let inMemoryFallback = null;

if (!MONGODB_URI) {
  console.warn(
    '⚠️ هشدار: MONGODB_URI تنظیم نشده — از حافظه‌ی موقت استفاده می‌شود.'
  );
}

// ------------------------------------------------------------
// Authentication / Payment
// ------------------------------------------------------------

const ADMIN_EMAIL = (
  process.env.ADMIN_EMAIL || 'rezajordan2012@gmail.com'
).toLowerCase();

const JWT_SECRET =
  process.env.JWT_SECRET || 'change-this-secret';

const ZARINPAL_MERCHANT_ID =
  process.env.ZARINPAL_MERCHANT_ID;

const CALLBACK_URL =
  process.env.CALLBACK_URL ||
  'http://localhost:4000/payment/callback';

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  'http://localhost:5173';


// ============================================================
// SEED PRODUCTS
// ============================================================

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
    description:
      'بافت مخملی و ماندگاری بالا، با طیف گسترده‌ی رنگ — رنگ و شماره را انتخاب کن.',
    image: '',
    variants: [
      {
        id: 'v1',
        label: 'شماره ۱ - قرمز کلاسیک',
        hex: '#B0202E',
        image: ''
      },
      {
        id: 'v2',
        label: 'شماره ۲ - صورتی ملایم',
        hex: '#D98CA0',
        image: ''
      },
      {
        id: 'v3',
        label: 'شماره ۳ - نارنجی مرجانی',
        hex: '#E06B4E',
        image: ''
      },
      {
        id: 'v4',
        label: 'شماره ۴ - بژ خاکی',
        hex: '#B98567',
        image: ''
      },
      {
        id: 'v5',
        label: 'شماره ۵ - قرمز آجری',
        hex: '#8C3A2B',
        image: ''
      },
      {
        id: 'v6',
        label: 'شماره ۶ - زرشکی تیره',
        hex: '#5C1A2E',
        image: ''
      }
    ]
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
    description:
      'لوسیون سبک و سریع‌جذب برای آبرسانی روزانه‌ی پوست.',
    image: ''
  },
  {
    id: 'p5',
    name: 'سشوار حرفه‌ای یون‌دار',
    brand: 'ولوره',
    category: 'electronics',
    subcategory: 'hair',
    price: 3200000,
    description:
      'قدرت ۲۲۰۰ وات، فناوری یونیزه برای کاهش وز مو.',
    image: ''
  },
  {
    id: 'p6',
    name: 'اپیلاتور بی‌سیم',
    brand: 'ولوره',
    category: 'electronics',
    subcategory: 'body',
    price: 2100000,
    description:
      'طراحی مینیمال، شارژ سریع و کاربرد ملایم روی پوست.',
    image: ''
  },
  {
    id: 'p11',
    name: 'دستگاه پاکسازی صورت',
    brand: 'ولوره',
    category: 'electronics',
    subcategory: 'face',
    price: 1650000,
    description:
      'برس سونیک برای پاکسازی عمیق منافذ پوست صورت.',
    image: ''
  }
];


// ============================================================
// DATABASE
// ============================================================

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

  if (!
