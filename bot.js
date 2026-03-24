// ============================================================
// MONEYMATRIX DATA HUB — UNIFIED BOT v2.0
// One bot. No duplicates. No broken RSS. No fake data.
// ============================================================

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const cron = require('node-cron');

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ]
});

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  OWNER_USER_ID: '1035326507385626644',
  CHANNELS: {
    DAILY_DIGEST:      '1445590996976013468',
    FEAR_GREED:        '1482893173268418640',
    ECONOMIC_CALENDAR: '1445520237935067146',
    EARNINGS_CALENDAR: '1482893279761797220',
    WATCHLIST:         '1483095521563513103',
    ETF_HOLDINGS:      '1483542217976184985',
    WELCOME:           '1210665182531952700',
    BOT_LAB:           '1485851856805560461',
  },
  KEYS: {
    ANTHROPIC:   process.env.ANTHROPIC_API_KEY,
    POLYGON:     process.env.POLYGON_API_KEY,
    FINNHUB:     process.env.FINNHUB_API_KEY,
    TWELVE_DATA: process.env.TWELVE_DATA_API_KEY,
  }
};

// ============================================================
// HELPERS
// ============================================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sendImage(channelId, buffer, filename, content = '') {
  try {
    const channel = await client.channels.fetch(channelId);
    const attachment = new AttachmentBuilder(buffer, { name: filename });
    await channel.send({ content, files: [attachment] });
  } catch (e) {
    console.error(`sendImage error [${filename}]:`, e.message);
  }
}

async function sendImageToDM(userId, buffer, filename, content = '') {
  try {
    const user = await client.users.fetch(userId);
    const attachment = new AttachmentBuilder(buffer, { name: filename });
    await user.send({ content, files: [attachment] });
  } catch (e) {
    console.error(`sendImageToDM error:`, e.message);
  }
}

async function sendChunked(channelId, text) {
  try {
    const channel = await client.channels.fetch(channelId);
    const chunks = text.match(/[\s\S]{1,1900}/g) || [text];
    for (const chunk of chunks) {
      await channel.send(chunk);
      await sleep(600);
    }
  } catch (e) {
    console.error('sendChunked error:', e.message);
  }
}

// ============================================================
// MARKET CALENDAR
// ============================================================
const MARKET_HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03',
  '2026-05-25','2026-07-03','2026-09-07','2026-11-26','2026-12-25'
]);

function getTodayEST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function isMarketOpen() {
  const today = getTodayEST();
  const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  if (['Sat','Sun'].includes(day)) return false;
  if (MARKET_HOLIDAYS_2026.has(today)) return false;
  return true;
}

function isMonday() {
  const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  return day === 'Mon' && isMarketOpen();
}

function isWednesday() {
  const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  return day === 'Wed' && isMarketOpen();
}

// ============================================================
// DOUBLE POST PROTECTION
// ============================================================
const postedToday = new Set();
const alreadyPosted = (key) => postedToday.has(key);
const markPosted = (key) => { postedToday.add(key); console.log(`📌 Posted: ${key}`); };

cron.schedule('0 0 * * *', () => {
  postedToday.clear();
  console.log('🔄 Post tracker reset for new day');
}, { timezone: 'America/Chicago' });

// ============================================================
// WATCHLIST — 7-DAY ROTATION
// ============================================================
const WATCHLIST = [
  "AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AVGO",
  "JPM","UNH","V","XOM","MA","PG","COST","JNJ","HD","MRK",
  "ABBV","CVX","WMT","BAC","KO","NFLX","AMD","ORCL","CRM",
  "ADBE","TMO","CSCO","ACN","MCD","QCOM","GE","IBM","TXN",
  "CAT","DIS","PLTR","CRWD","PANW","MRVL","NOW","DDOG",
  "ARM","RKLB","ASTS","IONQ","ZS","NET"
];

const recentTickers = [];

function getNextTicker() {
  const available = WATCHLIST.filter(t => !recentTickers.includes(t));
  const pool = available.length > 0 ? available : WATCHLIST;
  const ticker = pool[Math.floor(Math.random() * pool.length)];
  recentTickers.push(ticker);
  if (recentTickers.length > 7) recentTickers.shift();
  return ticker;
}

// ============================================================
// PUPPETEER — PERSISTENT BROWSER
// One instance, reused for all images. Faster + less RAM.
// ============================================================
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox','--disable-setuid-sandbox',
        '--disable-dev-shm-usage','--disable-gpu',
        '--no-first-run','--no-zygote'
      ]
    });
    console.log('🌐 Puppeteer browser launched');
  }
  return browser;
}

async function generateImage(html, width = 800, height = 600) {
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#0a0d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}</style></head><body>${html}</body></html>`);
    await sleep(700);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    return screenshot;
  } catch (e) {
    console.error('generateImage error:', e.message);
    // Try to recover browser on crash
    browser = null;
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ============================================================
// API — POLYGON (primary price data, batch calls)
// ============================================================
async function polygonBatch(tickers) {
  try {
    const joined = tickers.join(',');
    const res = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${joined}&apiKey=${CONFIG.KEYS.POLYGON}`
    );
    const data = await res.json();
    const map = {};
    for (const t of (data.tickers || [])) {
      map[t.ticker] = t;
    }
    return map;
  } catch (e) {
    console.error('Polygon batch error:', e.message);
    return {};
  }
}

async function polygonSingle(ticker) {
  try {
    const res = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${CONFIG.KEYS.POLYGON}`
    );
    const data = await res.json();
    return data.ticker || null;
  } catch (e) {
    console.error(`Polygon single error [${ticker}]:`, e.message);
    return null;
  }
}

async function polygonMovers() {
  try {
    const [gRes, lRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${CONFIG.KEYS.POLYGON}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${CONFIG.KEYS.POLYGON}`)
    ]);
    const [gData, lData] = await Promise.all([gRes.json(), lRes.json()]);
    return {
      gainers: gData.tickers?.slice(0, 5) || [],
      losers: lData.tickers?.slice(0, 5) || []
    };
  } catch (e) {
    console.error('Polygon movers error:', e.message);
    return { gainers: [], losers: [] };
  }
}

// ============================================================
// API — FINNHUB (news, ratings, earnings, profiles)
// ============================================================
async function finnhubGet(path) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1${path}&token=${CONFIG.KEYS.FINNHUB}`);
    return await res.json();
  } catch (e) {
    console.error(`Finnhub error [${path}]:`, e.message);
    return null;
  }
}

async function finnhubProfile(symbol) {
  return finnhubGet(`/stock/profile2?symbol=${symbol}`);
}

async function finnhubRatings(symbol) {
  const data = await finnhubGet(`/stock/recommendation?symbol=${symbol}`);
  return Array.isArray(data) ? data[0] : null;
}

async function finnhubNews(symbol) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const data = await finnhubGet(`/company-news?symbol=${symbol}&from=${from}&to=${to}`);
  return Array.isArray(data) ? data.slice(0, 3) : [];
}

async function finnhubEarnings() {
  const to = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  const from = new Date().toISOString().split('T')[0];
  const data = await finnhubGet(`/calendar/earnings?from=${from}&to=${to}`);
  return data?.earningsCalendar || [];
}

async function finnhubQuote(symbol) {
  return finnhubGet(`/quote?symbol=${symbol}`);
}

// ============================================================
// API — TWELVE DATA (indicators only, spaced calls)
// ============================================================
async function twelveIndicators(symbol) {
  try {
    await sleep(500);
    const rsiRes = await fetch(`https://api.twelvedata.com/rsi?symbol=${symbol}&interval=1day&apikey=${CONFIG.KEYS.TWELVE_DATA}`);
    await sleep(500);
    const maRes = await fetch(`https://api.twelvedata.com/ma?symbol=${symbol}&interval=1day&ma_type=SMA&time_period=50&apikey=${CONFIG.KEYS.TWELVE_DATA}`);
    await sleep(500);
    const macdRes = await fetch(`https://api.twelvedata.com/macd?symbol=${symbol}&interval=1day&apikey=${CONFIG.KEYS.TWELVE_DATA}`);
    const [rsi, ma, macd] = await Promise.all([rsiRes.json(), maRes.json(), macdRes.json()]);
    return {
      rsi:  rsi.values?.[0]?.rsi   ? parseFloat(rsi.values[0].rsi).toFixed(1)   : 'N/A',
      ma50: ma.values?.[0]?.ma     ? parseFloat(ma.values[0].ma).toFixed(2)      : 'N/A',
      macd: macd.values?.[0]?.macd ? parseFloat(macd.values[0].macd).toFixed(3)  : 'N/A',
    };
  } catch (e) {
    console.error(`Twelve indicators error [${symbol}]:`, e.message);
    return { rsi: 'N/A', ma50: 'N/A', macd: 'N/A' };
  }
}

// ============================================================
// API — CLAUDE
// ============================================================
async function claudeAI(system, user, useSonnet = false, useSearch = false) {
  try {
    const body = {
      model: useSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
      max_tokens: useSonnet ? 1500 : 800,
      system,
      messages: [{ role: 'user', content: user }]
    };
    if (useSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CONFIG.KEYS.ANTHROPIC,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  } catch (e) {
    console.error('Claude error:', e.message);
    return '';
  }
}

// ============================================================
// FEAR & GREED
// ============================================================
async function postFearGreed(preview = false) {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=4');
    const data = await res.json();
    if (!data.data?.length) { console.log('Fear & Greed: no data'); return; }

    const current = data.data[0];
    const value = parseInt(current.value);
    const classification = current.value_classification;
    const history = data.data.slice(1, 4);

    const getColor  = v => v >= 75 ? '#15803d' : v >= 55 ? '#16a34a' : v >= 45 ? '#d97706' : v >= 25 ? '#dc2626' : '#7f1d1d';
    const getBg     = v => v >= 75 ? '#052e16' : v >= 55 ? '#14532d' : v >= 45 ? '#451a03' : v >= 25 ? '#450a0a' : '#2d0507';
    const needleAngle = -90 + (value / 100) * 180;
    const mainColor = getColor(value);

    const analysis = await claudeAI(
      'You are a market sentiment analyst. Write 2 sharp sentences about what this Fear & Greed score means for traders right now. Be direct and actionable. No filler.',
      `Fear & Greed Index: ${value}/100 — ${classification}`
    );

    const histRows = history.map(h => {
      const v = parseInt(h.value);
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#0a0d14;border-radius:10px;padding:10px 14px;border:1px solid #1e2231;">
        <div>
          <div style="font-size:11px;color:#6b7280;">${h.value_classification}</div>
        </div>
        <div style="width:36px;height:36px;border-radius:50%;background:${getBg(v)};border:2px solid ${getColor(v)};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:${getColor(v)};">${v}</div>
      </div>`;
    }).join('');

    const html = `
<div style="padding:24px;background:#0a0d14;width:760px;">
  <div style="background:#111520;border-radius:16px;padding:24px;border:1px solid #1e2231;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div>
        <div style="font-size:20px;font-weight:700;color:white;letter-spacing:-0.02em;">Fear & Greed Index</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Midday Update • ${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
      </div>
      <div style="font-size:11px;color:#374151;background:#1e2231;padding:4px 10px;border-radius:6px;">via alternative.me</div>
    </div>
    <div style="display:flex;gap:32px;align-items:center;">
      <div style="flex:1;text-align:center;">
        <svg viewBox="0 0 240 150" width="260" style="display:block;margin:0 auto;">
          <defs>
            <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#7f1d1d"/>
              <stop offset="25%" stop-color="#dc2626"/>
              <stop offset="45%" stop-color="#f97316"/>
              <stop offset="55%" stop-color="#eab308"/>
              <stop offset="75%" stop-color="#16a34a"/>
              <stop offset="100%" stop-color="#15803d"/>
            </linearGradient>
          </defs>
          <path d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke="#1e2231" stroke-width="26" stroke-linecap="round"/>
          <path d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke="url(#g)" stroke-width="20" stroke-linecap="round"/>
          <text x="16" y="138" font-size="10" fill="#4b5563" font-family="sans-serif">0</text>
          <text x="113" y="20" font-size="10" fill="#4b5563" font-family="sans-serif" text-anchor="middle">50</text>
          <text x="222" y="138" font-size="10" fill="#4b5563" font-family="sans-serif" text-anchor="end">100</text>
          <g transform="rotate(${needleAngle}, 120, 120)">
            <line x1="120" y1="120" x2="120" y2="32" stroke="white" stroke-width="3" stroke-linecap="round"/>
          </g>
          <circle cx="120" cy="120" r="8" fill="#111520" stroke="white" stroke-width="2"/>
          <text x="120" y="104" font-size="32" font-weight="bold" fill="${mainColor}" font-family="sans-serif" text-anchor="middle">${value}</text>
          <text x="120" y="142" font-size="11" fill="${mainColor}" font-family="sans-serif" text-anchor="middle" font-weight="600">${classification.toUpperCase()}</text>
        </svg>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:11px;font-weight:600;color:#4b5563;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Historical</div>
        <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Previous close</div>
        ${histRows}
      </div>
    </div>
    <div style="margin-top:18px;padding:14px 18px;background:#0a0d14;border-radius:10px;border-left:3px solid ${mainColor};border:1px solid #1e2231;border-left:3px solid ${mainColor};">
      <div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;">Analyst Take</div>
      <div style="font-size:13px;color:#d1d5db;line-height:1.7;">${analysis}</div>
    </div>
    <div style="margin-top:12px;font-size:11px;color:#374151;text-align:center;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 800, 510);
    if (!img) return;
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, 'preview-feargreed.png', '👁️ Preview: Fear & Greed');
    } else {
      await sendImage(CONFIG.CHANNELS.FEAR_GREED, img, 'fear-greed.png');
      console.log('✅ Fear & Greed posted');
    }
  } catch (e) {
    console.error('Fear & Greed error:', e.message);
  }
}

// ============================================================
// EARNINGS CALENDAR
// ============================================================
async function postEarningsCalendar(preview = false) {
  try {
    const earnings = await finnhubEarnings();
    const days = ['Mon','Tue','Wed','Thu','Fri'];
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);

    const byDay = {};
    days.forEach((d, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      byDay[d] = {
        dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        items: []
      };
    });

    for (const e of earnings) {
      const d = new Date(e.date);
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
      if (byDay[dayName]) byDay[dayName].items.push(e);
    }

    const HIGH_IMPACT = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','JPM','V','GS','MS','WMT','COST','MU','FDX','ACN','NKE','ORCL'];
    const colors = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899'];

    const getImpact = (symbol) => {
      if (HIGH_IMPACT.includes(symbol)) return { label: 'HIGH', color: '#dc2626', watch: true };
      return { label: 'LOW', color: '#16a34a', watch: false };
    };

    const dayHtml = days.map((day) => {
      const { dateStr, items } = byDay[day];
      const top = items.slice(0, 6);
      return `
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);border-radius:8px 8px 0 0;padding:8px 4px;text-align:center;">
          <div style="font-size:13px;font-weight:700;color:white;">${day}</div>
          <div style="font-size:10px;color:#bfdbfe;">${dateStr}</div>
        </div>
        ${top.length === 0
          ? `<div style="background:#111520;border-radius:4px;padding:20px 4px;text-align:center;border:1px solid #1e2231;flex:1;"><div style="font-size:10px;color:#374151;">Light day</div></div>`
          : top.map((e, i) => {
              const imp = getImpact(e.symbol);
              const col = colors[i % colors.length];
              const companyShort = (e.company || e.symbol || '').slice(0, 12);
              return `
              <div style="background:${imp.watch ? '#1a0a0a' : '#111520'};border-radius:6px;padding:8px 4px;text-align:center;border:${imp.watch ? '1px solid #7f1d1d' : '1px solid #1e2231'};display:flex;flex-direction:column;align-items:center;gap:3px;">
                ${imp.watch ? '<div style="font-size:8px;color:#ef4444;font-weight:700;">🔥 WATCH</div>' : ''}
                <div style="width:28px;height:28px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;">${(e.symbol||'??').slice(0,2)}</div>
                <div style="font-size:13px;font-weight:700;color:${col};">${e.symbol}</div>
                <div style="font-size:9px;color:#9ca3af;max-width:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${companyShort}</div>
                <div style="font-size:9px;background:${e.hour==='amc'?'#7f1d1d':'#1e3a8a'};color:white;border-radius:3px;padding:1px 6px;font-weight:600;">${e.hour==='amc'?'AMC':'BMO'}</div>
                <div style="font-size:12px;font-weight:600;color:white;">${e.epsEstimate?'$'+parseFloat(e.epsEstimate).toFixed(2):'N/A'}</div>
                <div style="font-size:8px;color:#4b5563;">Est EPS</div>
                <div style="font-size:8px;background:${imp.color};color:white;border-radius:3px;padding:1px 6px;font-weight:600;">${imp.label}</div>
              </div>`;
            }).join('')}
      </div>`;
    }).join('');

    const html = `
<div style="padding:20px;background:#0a0d14;width:880px;">
  <div style="background:#111520;border-radius:14px;padding:20px;border:1px solid #1e2231;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <div style="font-size:20px;font-weight:700;color:white;letter-spacing:-0.02em;">Earnings Calendar</div>
        <div style="font-size:12px;color:#6b7280;margin-top:3px;">Week of ${byDay['Mon'].dateStr} • Real data via Finnhub</div>
      </div>
      <div style="display:flex;gap:10px;font-size:10px;">
        <span style="color:#9ca3af;display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;background:#7f1d1d;border-radius:2px;display:inline-block;"></span>AMC</span>
        <span style="color:#9ca3af;display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;background:#1e3a8a;border-radius:2px;display:inline-block;"></span>BMO</span>
        <span style="color:#9ca3af;display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;background:#dc2626;border-radius:2px;display:inline-block;"></span>High Impact</span>
      </div>
    </div>
    <div style="display:flex;gap:6px;">${dayHtml}</div>
    <div style="margin-top:14px;font-size:10px;color:#374151;text-align:center;">⚠️ Not financial advice. Always do your own research. • earningswhispers.com/calendar</div>
  </div>
</div>`;

    const img = await generateImage(html, 900, 700);
    if (!img) return;
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, 'preview-earnings.png', '👁️ Preview: Earnings Calendar');
    } else {
      await sendImage(CONFIG.CHANNELS.EARNINGS_CALENDAR, img, 'earnings-calendar.png',
        `📊 **MoneyMatrix Earnings Calendar — Week of ${byDay['Mon'].dateStr}**`);
      console.log('✅ Earnings calendar posted');
    }
  } catch (e) {
    console.error('Earnings calendar error:', e.message);
  }
}

// ============================================================
// ECONOMIC CALENDAR
// ============================================================
async function postEconomicCalendar(preview = false) {
  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const calendarData = await claudeAI(
      `You are a macro economist. Return ONLY a JSON array of economic events for this week. Each event: {"day":"MON","time":"8:30 AM ET","event":"Durable Goods Orders","prev":"-0.1%","est":"+1.0%","impact":"HIGH","note":"Key business investment gauge"}. Impact: HIGH, MEDIUM, or LOW. Include all 5 days. HIGH events get a note, others leave note empty. No markdown, no explanation, just the JSON array.`,
      `Complete US economic calendar for week of ${today}. Include Fed speeches, CPI, PPI, jobs, GDP, PMI, housing, consumer data.`,
      true, true
    );

    let events = [];
    try {
      const clean = calendarData.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('[');
      const end = clean.lastIndexOf(']');
      events = JSON.parse(clean.slice(start, end + 1));
    } catch {
      console.error('Economic calendar JSON parse failed');
      return;
    }

    const days = ['MON','TUE','WED','THU','FRI'];
    const dayLabels = { MON:'Monday', TUE:'Tuesday', WED:'Wednesday', THU:'Thursday', FRI:'Friday' };
    const impactColor = { HIGH:'#dc2626', MEDIUM:'#d97706', LOW:'#16a34a' };
    const impactBg    = { HIGH:'#450a0a', MEDIUM:'#451a03', LOW:'#052e16' };

    const dayBlocks = days.map(d => {
      const dayEvents = events.filter(e => e.day === d);
      if (!dayEvents.length) return `
      <div style="margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;color:#6b7280;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #1e2231;">${dayLabels[d]}</div>
        <div style="font-size:11px;color:#374151;padding:8px;">Light data day</div>
      </div>`;

      const rows = dayEvents.map(e => `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #1e2231;align-items:flex-start;">
        <div style="min-width:80px;font-size:11px;color:#6b7280;padding-top:2px;">${e.time}</div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:white;">${e.event}</span>
            <span style="font-size:9px;font-weight:700;background:${impactBg[e.impact]||'#1e2231'};color:${impactColor[e.impact]||'#6b7280'};padding:2px 7px;border-radius:4px;">${e.impact}</span>
          </div>
          <div style="display:flex;gap:16px;font-size:11px;color:#6b7280;">
            ${e.prev ? `<span>Prev: <span style="color:#9ca3af;">${e.prev}</span></span>` : ''}
            ${e.est  ? `<span>Est: <span style="color:#9ca3af;">${e.est}</span></span>`  : ''}
          </div>
          ${e.note ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;padding-left:8px;border-left:2px solid ${impactColor[e.impact]||'#374151'};">→ ${e.note}</div>` : ''}
        </div>
      </div>`).join('');

      return `
      <div style="margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;color:#e5e7eb;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2a2d3e;">${dayLabels[d]}</div>
        ${rows}
      </div>`;
    }).join('');

    const weekOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const html = `
<div style="padding:24px;background:#0a0d14;width:760px;">
  <div style="background:#111520;border-radius:14px;padding:24px;border:1px solid #1e2231;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div>
        <div style="font-size:20px;font-weight:700;color:white;letter-spacing:-0.02em;">Economic Calendar</div>
        <div style="font-size:12px;color:#6b7280;margin-top:3px;">Week of ${weekOf} • All times ET</div>
      </div>
      <div style="display:flex;gap:8px;">
        <span style="font-size:10px;background:#450a0a;color:#dc2626;padding:3px 8px;border-radius:4px;font-weight:600;">HIGH</span>
        <span style="font-size:10px;background:#451a03;color:#d97706;padding:3px 8px;border-radius:4px;font-weight:600;">MED</span>
        <span style="font-size:10px;background:#052e16;color:#16a34a;padding:3px 8px;border-radius:4px;font-weight:600;">LOW</span>
      </div>
    </div>
    ${dayBlocks}
    <div style="font-size:10px;color:#374151;text-align:center;margin-top:8px;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 800, 900);
    if (!img) return;
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, 'preview-economic.png', '👁️ Preview: Economic Calendar');
    } else {
      await sendImage(CONFIG.CHANNELS.ECONOMIC_CALENDAR, img, 'economic-calendar.png',
        `🌍 **MoneyMatrix Economic Calendar — Week of ${weekOf}**`);
      console.log('✅ Economic calendar posted');
    }
  } catch (e) {
    console.error('Economic calendar error:', e.message);
  }
}

// ============================================================
// SECTOR HEATMAP — Polygon batch, 5 stocks per sector
// ============================================================
async function postSectorHeatmap(preview = false) {
  try {
    const SECTORS = [
      { etf:'XLK', name:'Technology',        stocks:['NVDA','MSFT','AAPL','AVGO','AMD'] },
      { etf:'XLY', name:'Consumer Cyclical',  stocks:['AMZN','TSLA','HD','MCD','NKE'] },
      { etf:'XLI', name:'Industrials',        stocks:['GE','CAT','RTX','HON','UPS'] },
      { etf:'XLB', name:'Materials',          stocks:['LIN','APD','ECL','NEM','FCX'] },
      { etf:'XLF', name:'Financials',         stocks:['JPM','BAC','WFC','GS','MS'] },
      { etf:'XLC', name:'Communication',      stocks:['GOOGL','META','NFLX','DIS','T'] },
      { etf:'XLRE', name:'Real Estate',       stocks:['PLD','AMT','EQIX','SPG','O'] },
      { etf:'XLP', name:'Consumer Def',       stocks:['WMT','PG','COST','KO','PEP'] },
      { etf:'XLV', name:'Healthcare',         stocks:['UNH','JNJ','LLY','ABBV','MRK'] },
      { etf:'XLE', name:'Energy',             stocks:['XOM','CVX','COP','SLB','OXY'] },
      { etf:'XLU', name:'Utilities',          stocks:['NEE','DUK','SO','D','AEP'] },
    ];

    // One batch call for ETFs + all stocks
    const allTickers = [
      ...SECTORS.map(s => s.etf),
      ...SECTORS.flatMap(s => s.stocks)
    ];
    const snap = await polygonBatch(allTickers);

    const getColor = v => v >= 2 ? '#15803d' : v >= 1 ? '#16a34a' : v >= 0.3 ? '#22c55e' : v >= 0 ? '#4ade80' : v >= -0.3 ? '#f97316' : v >= -1 ? '#ef4444' : v >= -2 ? '#dc2626' : '#7f1d1d';
    const getTextColor = v => Math.abs(v) < 0.8 ? '#d1fae5' : 'white';

    const sectorData = SECTORS.map(s => {
      const etfSnap = snap[s.etf];
      const change = etfSnap ? parseFloat((etfSnap.todaysChangePerc || 0).toFixed(2)) : 0;
      const stocks = s.stocks.map(sym => {
        const t = snap[sym];
        const pct = t ? parseFloat((t.todaysChangePerc || 0).toFixed(2)) : 0;
        return { sym, pct };
      });
      return { ...s, change, stocks };
    }).sort((a, b) => b.change - a.change);

    const topSector = sectorData[0];
    const botSector = sectorData[sectorData.length - 1];

    const sectorBlocks = sectorData.map(s => `
    <div style="background:${getColor(s.change)};border-radius:10px;padding:12px 8px;position:relative;overflow:hidden;">
      <div style="font-size:11px;font-weight:700;color:${getTextColor(s.change)};margin-bottom:2px;opacity:0.9;">${s.name}</div>
      <div style="font-size:22px;font-weight:800;color:${getTextColor(s.change)};margin-bottom:6px;">${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%</div>
      <div style="font-size:9px;color:${getTextColor(s.change)};opacity:0.6;margin-bottom:6px;">${s.etf}</div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;">
        ${s.stocks.map(st => `
        <div style="background:rgba(0,0,0,0.25);border-radius:4px;padding:3px 5px;text-align:center;">
          <div style="font-size:9px;font-weight:700;color:white;">${st.sym}</div>
          <div style="font-size:9px;color:${st.pct >= 0 ? '#bbf7d0' : '#fecaca'};">${st.pct >= 0 ? '+' : ''}${st.pct.toFixed(1)}%</div>
        </div>`).join('')}
      </div>
    </div>`).join('');

    const html = `
<div style="padding:20px;background:#0a0d14;width:880px;">
  <div style="background:#111520;border-radius:14px;padding:20px;border:1px solid #1e2231;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <div style="font-size:20px;font-weight:700;color:white;letter-spacing:-0.02em;">Sector Heatmap</div>
        <div style="font-size:12px;color:#6b7280;margin-top:3px;">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} • Live via Polygon</div>
      </div>
      <div style="display:flex;gap:8px;font-size:11px;">
        <span style="background:#052e16;color:#22c55e;padding:3px 10px;border-radius:99px;font-weight:600;">▲ ${topSector.name} ${topSector.change >= 0 ? '+' : ''}${topSector.change.toFixed(2)}%</span>
        <span style="background:#2d0a0a;color:#ef4444;padding:3px 10px;border-radius:99px;font-weight:600;">▼ ${botSector.name} ${botSector.change.toFixed(2)}%</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">${sectorBlocks}</div>
    <div style="display:flex;justify-content:center;gap:14px;font-size:10px;margin-top:14px;flex-wrap:wrap;">
      <span style="color:#9ca3af;display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#15803d;border-radius:2px;display:inline-block;"></span>Strong +2%+</span>
      <span style="color:#9ca3af;display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#22c55e;border-radius:2px;display:inline-block;"></span>Positive</span>
      <span style="color:#9ca3af;display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#f97316;border-radius:2px;display:inline-block;"></span>Negative</span>
      <span style="color:#9ca3af;display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#7f1d1d;border-radius:2px;display:inline-block;"></span>Strong -2%-</span>
    </div>
    <div style="text-align:center;font-size:11px;color:#374151;margin-top:10px;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 920, 720);
    if (!img) return;
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, 'preview-heatmap.png', '👁️ Preview: Sector Heatmap');
    } else {
      await sendImage(CONFIG.CHANNELS.WATCHLIST, img, 'sector-heatmap.png');
      console.log('✅ Sector heatmap posted');
    }
  } catch (e) {
    console.error('Heatmap error:', e.message);
  }
}

// ============================================================
// DAILY WATCHLIST
// ============================================================
async function postDailyWatchlist(forceTicker = null, preview = false) {
  try {
    const ticker = forceTicker || getNextTicker();
    console.log(`Generating watchlist for ${ticker}...`);

    // Polygon for price (primary)
    const snap = await polygonSingle(ticker);
    let price = 'N/A', change = 0, changeAbs = 0, high = 'N/A', low = 'N/A', volume = 'N/A';

    if (snap) {
      price     = (snap.day?.c || snap.lastTrade?.p || 0).toFixed(2);
      change    = parseFloat((snap.todaysChangePerc || 0).toFixed(2));
      changeAbs = parseFloat((snap.todaysChange || 0).toFixed(2));
      high      = (snap.day?.h || 0).toFixed(2);
      low       = (snap.day?.l || 0).toFixed(2);
      volume    = snap.day?.v ? (snap.day.v / 1000000).toFixed(1) + 'M' : 'N/A';
    } else {
      // Fallback: Finnhub quote
      const fq = await finnhubQuote(ticker);
      if (fq) {
        price     = (fq.c || 0).toFixed(2);
        change    = parseFloat((fq.dp || 0).toFixed(2));
        changeAbs = parseFloat((fq.d || 0).toFixed(2));
        high      = (fq.h || 0).toFixed(2);
        low       = (fq.l || 0).toFixed(2);
      }
    }

    // Finnhub for news, ratings, profile
    const [profile, ratings, news] = await Promise.all([
      finnhubProfile(ticker),
      finnhubRatings(ticker),
      finnhubNews(ticker)
    ]);

    // Twelve Data for indicators (spaced, one ticker only)
    const indicators = await twelveIndicators(ticker);
    const { rsi, ma50, macd } = indicators;

    const rsiNum   = rsi  !== 'N/A' ? parseFloat(rsi)  : null;
    const ma50Num  = ma50 !== 'N/A' ? parseFloat(ma50) : null;
    const macdNum  = macd !== 'N/A' ? parseFloat(macd) : null;
    const priceNum = parseFloat(price);

    const rsiColor    = rsiNum  ? (rsiNum > 70 ? '#ef4444' : rsiNum < 30 ? '#22c55e' : '#f59e0b') : '#6b7280';
    const ma50Color   = ma50Num ? (priceNum > ma50Num ? '#22c55e' : '#ef4444') : '#6b7280';
    const macdColor   = macdNum ? (macdNum >= 0 ? '#22c55e' : '#ef4444') : '#6b7280';
    const changeColor = change >= 0 ? '#22c55e' : '#ef4444';

    const ratingBuy   = ratings?.buy   || 0;
    const ratingHold  = ratings?.hold  || 0;
    const ratingSell  = ratings?.sell  || 0;
    const totalRatings = ratingBuy + ratingHold + ratingSell || 1;

    const analysis = await claudeAI(
      `You are an elite stock analyst for MoneyMatrix. Write a sharp professional analysis with these exact sections:
**Technical:** key levels, trend, support/resistance with specific prices
**Fundamentals:** valuation, growth metrics
**Bull Case:** specific catalyst and price target
**Bear Case:** specific risk and downside level
**The Trade:** entry zone, target, stop loss
Be specific with real numbers. Max 280 words. No filler. No repeated disclaimers.`,
      `${ticker} | ${profile?.name || ticker} | Price: $${price} | Change: ${change}% | RSI: ${rsi} | 50MA: $${ma50} | MACD: ${macd} | High: $${high} | Low: $${low} | Vol: ${volume} | Ratings: Buy:${ratingBuy} Hold:${ratingHold} Sell:${ratingSell} | Industry: ${profile?.finnhubIndustry || 'N/A'}`,
      true
    );

    const newsHtml = news.length > 0
      ? news.map(n => `
      <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #1e2231;">
        <div style="font-size:11px;color:#d1d5db;line-height:1.5;">${(n.headline||'').slice(0,80)}...</div>
        <div style="font-size:10px;color:#4b5563;margin-top:2px;">${n.source} • ${new Date(n.datetime*1000).toLocaleDateString()}</div>
      </div>`).join('')
      : '<div style="font-size:11px;color:#374151;">No recent news</div>';

    const html = `
<div style="padding:20px;background:#0a0d14;width:780px;">
  <div style="background:#111520;border-radius:14px;padding:20px;border:1px solid #1e2231;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:white;flex-shrink:0;">${ticker.slice(0,2)}</div>
        <div>
          <div style="font-size:22px;font-weight:800;color:white;letter-spacing:-0.02em;">${ticker}</div>
          <div style="font-size:13px;color:#9ca3af;">${profile?.name || ticker}</div>
          <div style="font-size:11px;color:#4b5563;">${profile?.exchange||'NASDAQ'} • ${profile?.finnhubIndustry||'Technology'}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:30px;font-weight:800;color:white;letter-spacing:-0.02em;">$${price}</div>
        <div style="font-size:15px;font-weight:600;color:${changeColor};">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}% (${change >= 0 ? '+' : ''}$${changeAbs.toFixed(2)})</div>
        <div style="font-size:10px;color:#4b5563;">${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:16px;">
      ${[
        { label:'RSI',  val:rsi,  color:rsiColor },
        { label:'50MA', val:'$'+ma50, color:ma50Color },
        { label:'MACD', val:macd, color:macdColor },
        { label:'High', val:'$'+high, color:'#22c55e' },
        { label:'Low',  val:'$'+low,  color:'#ef4444' },
        { label:'Vol',  val:volume,   color:'white' },
      ].map(m => `
      <div style="background:#0a0d14;border-radius:8px;padding:10px 6px;text-align:center;border:1px solid #1e2231;">
        <div style="font-size:9px;color:#6b7280;text-transform:uppercase;margin-bottom:3px;">${m.label}</div>
        <div style="font-size:13px;font-weight:700;color:${m.color};">${m.val}</div>
      </div>`).join('')}
    </div>
    <div style="background:#0a0d14;border-radius:10px;padding:16px;margin-bottom:14px;border:1px solid #1e2231;">
      <div style="font-size:11px;font-weight:600;color:#4b5563;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Analysis</div>
      <div style="font-size:12px;color:#d1d5db;line-height:1.8;">${analysis.replace(/\*\*(.*?)\*\*/g,'<span style="color:white;font-weight:700;">$1</span>')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      <div style="background:#0a0d14;border-radius:10px;padding:14px;border:1px solid #1e2231;">
        <div style="font-size:11px;font-weight:600;color:#4b5563;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Analyst Ratings</div>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <div style="flex:1;text-align:center;background:#052e16;border-radius:6px;padding:8px;">
            <div style="font-size:20px;font-weight:700;color:#22c55e;">${ratingBuy}</div>
            <div style="font-size:9px;color:#16a34a;font-weight:600;">BUY</div>
          </div>
          <div style="flex:1;text-align:center;background:#1e2231;border-radius:6px;padding:8px;">
            <div style="font-size:20px;font-weight:700;color:#9ca3af;">${ratingHold}</div>
            <div style="font-size:9px;color:#6b7280;font-weight:600;">HOLD</div>
          </div>
          <div style="flex:1;text-align:center;background:#2d0a0a;border-radius:6px;padding:8px;">
            <div style="font-size:20px;font-weight:700;color:#ef4444;">${ratingSell}</div>
            <div style="font-size:9px;color:#dc2626;font-weight:600;">SELL</div>
          </div>
        </div>
        <div style="height:6px;background:#1e2231;border-radius:3px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#22c55e ${(ratingBuy/totalRatings*100).toFixed(0)}%,#6b7280 ${(ratingBuy/totalRatings*100).toFixed(0)}%,#6b7280 ${((ratingBuy+ratingHold)/totalRatings*100).toFixed(0)}%,#ef4444 ${((ratingBuy+ratingHold)/totalRatings*100).toFixed(0)}%);"></div>
        </div>
      </div>
      <div style="background:#0a0d14;border-radius:10px;padding:14px;border:1px solid #1e2231;">
        <div style="font-size:11px;font-weight:600;color:#4b5563;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Latest News</div>
        ${newsHtml}
      </div>
    </div>
    <div style="background:#0d1a0d;border-radius:8px;padding:10px 14px;margin-bottom:10px;border:1px solid #1a3a1a;">
      <div style="font-size:11px;color:#22c55e;">📊 Live Chart: tradingview.com/chart/?symbol=${ticker}</div>
    </div>
    <div style="font-size:10px;color:#374151;text-align:center;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 800, 960);
    if (!img) return;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, `preview-watchlist-${ticker}.png`, `👁️ Preview: Watchlist — ${ticker}`);
    } else {
      await sendImage(CONFIG.CHANNELS.WATCHLIST, img, `watchlist-${ticker}.png`,
        `📈 **MoneyMatrix Daily Watchlist — ${today}**`);
      console.log(`✅ Watchlist posted for ${ticker}`);
    }
  } catch (e) {
    console.error('Watchlist error:', e.message);
  }
}

// ============================================================
// ETF HOLDINGS TRACKER — Rebuilt with Polygon batch
// ============================================================
async function postETFHoldings(preview = false) {
  try {
    const ETF_HOLDINGS = {
      SPY: ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','JPM','UNH'],
      QQQ: ['MSFT','AAPL','NVDA','AMZN','META','TSLA','GOOGL','AVGO','COST','AMD'],
      XLK: ['MSFT','AAPL','NVDA','AVGO','AMD','ORCL','CSCO','ADBE','CRM','QCOM'],
      IWM: ['IRTC','TGTX','PRGS','STEP','NOVT','OLED','BXMT','ICUI','SFBS','CARG'],
    };

    // One batch call for all holdings
    const allTickers = [...new Set(Object.values(ETF_HOLDINGS).flat())];
    const snap = await polygonBatch(allTickers);

    // Also get ETF prices themselves
    const etfSnap = await polygonBatch(Object.keys(ETF_HOLDINGS));

    const colors = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#a855f7'];

    const etfBlocks = Object.entries(ETF_HOLDINGS).map(([etf, holdings]) => {
      const etfData = etfSnap[etf];
      const etfChange = etfData ? parseFloat((etfData.todaysChangePerc || 0).toFixed(2)) : 0;
      const etfPrice  = etfData ? (etfData.day?.c || 0).toFixed(2) : 'N/A';
      const etfColor  = etfChange >= 0 ? '#22c55e' : '#ef4444';

      const rows = holdings.map((sym, i) => {
        const t = snap[sym];
        const pct = t ? parseFloat((t.todaysChangePerc || 0).toFixed(2)) : 0;
        const price = t ? (t.day?.c || 0).toFixed(2) : 'N/A';
        const pctColor = pct >= 0 ? '#22c55e' : '#ef4444';
        return `
        <div style="display:grid;grid-template-columns:44px 1fr 60px 60px;gap:4px;padding:5px 6px;background:#0a0d14;border-radius:5px;margin-bottom:3px;align-items:center;border:1px solid #1e2231;">
          <span style="font-size:11px;font-weight:700;color:${colors[i % colors.length]};">${sym}</span>
          <span style="font-size:10px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t ? '' : '—'}</span>
          <span style="font-size:11px;color:#9ca3af;text-align:right;">$${price}</span>
          <span style="font-size:11px;font-weight:600;color:${pctColor};text-align:right;">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>
        </div>`;
      }).join('');

      return `
      <div style="background:#111520;border-radius:10px;overflow:hidden;border:1px solid #1e2231;">
        <div style="background:linear-gradient(135deg,#1e3a8a,#1d4ed8);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:16px;font-weight:700;color:white;">${etf}</div>
            <div style="font-size:10px;color:#bfdbfe;">Top ${holdings.length} Holdings</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:14px;font-weight:700;color:white;">$${etfPrice}</div>
            <div style="font-size:12px;color:${etfColor};font-weight:600;">${etfChange >= 0 ? '+' : ''}${etfChange.toFixed(2)}%</div>
          </div>
        </div>
        <div style="padding:8px;">
          <div style="display:grid;grid-template-columns:44px 1fr 60px 60px;gap:4px;padding:4px 6px;margin-bottom:4px;font-size:9px;color:#374151;text-transform:uppercase;letter-spacing:0.04em;">
            <span>Ticker</span><span>Name</span><span style="text-align:right;">Price</span><span style="text-align:right;">Today</span>
          </div>
          ${rows}
        </div>
      </div>`;
    }).join('');

    const html = `
<div style="padding:20px;background:#0a0d14;width:880px;">
  <div style="background:#111520;border-radius:14px;padding:20px;border:1px solid #1e2231;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <div style="font-size:20px;font-weight:700;color:white;letter-spacing:-0.02em;">ETF Holdings Tracker</div>
        <div style="font-size:12px;color:#6b7280;margin-top:3px;">Weekly snapshot • ${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} • via Polygon</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">${etfBlocks}</div>
    <div style="font-size:10px;color:#374151;text-align:center;margin-top:14px;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 920, 800);
    if (!img) return;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, 'preview-etf.png', '👁️ Preview: ETF Holdings');
    } else {
      await sendImage(CONFIG.CHANNELS.ETF_HOLDINGS, img, 'etf-holdings.png',
        `📊 **MoneyMatrix ETF Holdings Tracker — ${today}**`);
      console.log('✅ ETF holdings posted');
    }
  } catch (e) {
    console.error('ETF holdings error:', e.message);
  }
}

// ============================================================
// MARKET CLOSE
// ============================================================
async function postMarketClose(preview = false) {
  try {
    const indexSnap = await polygonBatch(['SPY','QQQ','DIA','IWM']);
    const movers = await polygonMovers();

    let marketData = 'CLOSING DATA:\n';
    for (const [t, d] of Object.entries(indexSnap)) {
      const p = (d.day?.c || 0).toFixed(2);
      const pct = (d.todaysChangePerc || 0).toFixed(2);
      marketData += `${t}: $${p} (${pct}%)\n`;
    }
    if (movers.gainers.length) {
      marketData += '\nTOP GAINERS: ' + movers.gainers.map(g => `${g.ticker} +${(g.todaysChangePerc||0).toFixed(1)}%`).join(' | ');
      marketData += '\nTOP LOSERS: '  + movers.losers.map(l  => `${l.ticker} ${(l.todaysChangePerc||0).toFixed(1)}%`).join(' | ');
    }

    // Weave in Chief's morning perspective if available
    const chiefContext = Object.keys(chiefAnswers).length > 0
      ? `\n\nChief's morning outlook: ${Object.values(chiefAnswers).join(' | ')}`
      : '';

    const post = await claudeAI(
      `You are the closing bell analyst for MoneyMatrix, a premium financial Discord. Be sharp, specific, and occasionally human — if it was a brutal day you can acknowledge it like a real trader would.

Structure exactly like this (no extra headers):

📊 TODAY'S SCORECARD
[Index final numbers, overall character — risk on/off, volume, breadth]

🏆 TOP MOVERS
[Biggest gainers and losers, specific % and brief why]

🔥 WHAT DROVE THE SESSION
[2-3 key themes, news catalysts, sector rotation]

🌙 OVERNIGHT WATCH
[After hours earnings, Asian futures, key news expected]

📅 TOMORROW'S SETUP
[Specific levels, data releases, what to watch at open]

💬 CHIEF'S CLOSING NOTE
[Connect Chief's morning outlook to how the day actually played out. 2 sentences, direct.]

One disclaimer at the very end only. No repeated warnings. Specific numbers throughout.`,
      `${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} market close.\n${marketData}${chiefContext}\nSearch for today's biggest movers and session recap.`,
      true, true
    );

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const text = `🔔 **MoneyMatrix Market Close — ${today}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${post}`;

    if (preview) {
      const owner = await client.users.fetch(CONFIG.OWNER_USER_ID);
      const chunks = text.match(/[\s\S]{1,1900}/g) || [text];
      for (const chunk of chunks) {
        await owner.send(chunk);
        await sleep(600);
      }
    } else {
      await sendChunked(CONFIG.CHANNELS.DAILY_DIGEST, text);
      console.log('✅ Market close posted');
    }
  } catch (e) {
    console.error('Market close error:', e.message);
  }
}

// ============================================================
// FUTURES SNAPSHOT — Sunday 7 PM CST
// ============================================================
async function postFuturesSnapshot(preview = false) {
  try {
    // Polygon futures tickers
    const futuresSnap = await polygonBatch(['SPY','QQQ','GLD','BTC']);
    // Note: For true ES/NQ futures use I:SPX and I:NDX if on paid Polygon plan
    // Free tier uses ETF proxies which are close enough for Sunday evening direction

    const getColor = pct => pct >= 0 ? '#22c55e' : '#ef4444';
    const getBg    = pct => pct >= 0 ? '#052e16' : '#2d0a0a';

    const assets = [
      { label: 'S&P 500', sub: 'ES Futures', ticker: 'SPY' },
      { label: 'Nasdaq',  sub: 'NQ Futures', ticker: 'QQQ' },
      { label: 'Gold',    sub: 'GC Futures', ticker: 'GLD' },
      { label: 'Bitcoin', sub: 'BTC/USD',    ticker: 'BTC' },
    ].map(a => {
      const d = futuresSnap[a.ticker];
      const price = d ? (d.day?.c || d.lastTrade?.p || 0).toFixed(2) : 'N/A';
      const pct   = d ? parseFloat((d.todaysChangePerc || 0).toFixed(2)) : 0;
      return { ...a, price, pct };
    });

    const overallBullish = assets.filter(a => a.pct >= 0).length >= 3;
    const headerColor = overallBullish ? '#052e16' : '#2d0a0a';
    const headerText  = overallBullish ? '#22c55e'  : '#ef4444';
    const headerLabel = overallBullish ? '🟢 RISK ON — Futures pointing higher' : '🔴 RISK OFF — Futures under pressure';

    const html = `
<div style="padding:20px;background:#0a0d14;width:700px;">
  <div style="background:#111520;border-radius:14px;overflow:hidden;border:1px solid #1e2231;">
    <div style="background:${headerColor};padding:16px 20px;border-bottom:1px solid #1e2231;">
      <div style="font-size:13px;font-weight:700;color:${headerText};">${headerLabel}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">Sunday Futures Snapshot • ${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/Chicago'})} CST</div>
    </div>
    <div style="padding:16px 20px;">
      <div style="font-size:18px;font-weight:700;color:white;margin-bottom:14px;letter-spacing:-0.02em;">Week Ahead — Futures Watch</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        ${assets.map(a => `
        <div style="background:${getBg(a.pct)};border-radius:10px;padding:14px;border:1px solid ${a.pct >= 0 ? '#166534' : '#7f1d1d'};">
          <div style="font-size:12px;font-weight:600;color:#9ca3af;">${a.label}</div>
          <div style="font-size:10px;color:#4b5563;margin-bottom:8px;">${a.sub}</div>
          <div style="font-size:22px;font-weight:800;color:white;">$${a.price}</div>
          <div style="font-size:14px;font-weight:700;color:${getColor(a.pct)};margin-top:4px;">${a.pct >= 0 ? '▲ +' : '▼ '}${Math.abs(a.pct).toFixed(2)}%</div>
        </div>`).join('')}
      </div>
      <div style="background:#0a0d14;border-radius:8px;padding:12px;border:1px solid #1e2231;">
        <div style="font-size:11px;color:#6b7280;">Futures open Sunday 5 PM ET. Moves here set the tone for Monday's open — watch for gaps and pre-market continuation.</div>
      </div>
    </div>
    <div style="padding:10px 20px;font-size:10px;color:#374151;text-align:center;border-top:1px solid #1e2231;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 720, 560);
    if (!img) return;
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, 'preview-futures.png', '👁️ Preview: Futures Snapshot');
    } else {
      await sendImage(CONFIG.CHANNELS.WATCHLIST, img, 'futures-snapshot.png',
        `📡 **MoneyMatrix Sunday Futures — Week of ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric'})}**`);
      console.log('✅ Futures snapshot posted');
    }
  } catch (e) {
    console.error('Futures snapshot error:', e.message);
  }
}

// ============================================================
// WEEKLY PICKS — Sunday 7:10 PM CST
// ============================================================
async function postWeeklyPicks(preview = false) {
  try {
    // Claude picks 2 tickers with reasoning based on current market
    const pickData = await claudeAI(
      `You are a stock analyst. Return ONLY a JSON array of exactly 2 stock picks for the coming week. Each: {"ticker":"NVDA","company":"NVIDIA Corp","thesis":"One sharp sentence why this week","setup":"Bull/Bear/Neutral","target":"$X","risk":"$X","catalyst":"What to watch"}. No markdown, no explanation, just the JSON array.`,
      `Based on current market conditions, futures direction, and upcoming week catalysts, pick 2 stocks worth watching this week. Consider earnings, technical setups, and macro catalysts.`,
      true, true
    );

    let picks = [];
    try {
      const clean = pickData.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('[');
      const end = clean.lastIndexOf(']');
      picks = JSON.parse(clean.slice(start, end + 1));
    } catch {
      console.error('Weekly picks JSON parse failed');
      return;
    }

    // Get live price data for picked tickers
    const pickTickers = picks.map(p => p.ticker);
    const snap = await polygonBatch(pickTickers);

    const setupColor = s => s === 'Bull' ? '#22c55e' : s === 'Bear' ? '#ef4444' : '#f59e0b';
    const setupBg    = s => s === 'Bull' ? '#052e16' : s === 'Bear' ? '#2d0a0a' : '#451a03';

    const pickCards = picks.map((p, i) => {
      const d = snap[p.ticker];
      const price = d ? (d.day?.c || 0).toFixed(2) : 'N/A';
      const pct   = d ? parseFloat((d.todaysChangePerc || 0).toFixed(2)) : 0;
      const pctColor = pct >= 0 ? '#22c55e' : '#ef4444';
      const col = i === 0 ? '#3b82f6' : '#8b5cf6';

      return `
      <div style="background:#111520;border-radius:12px;padding:18px;border:1px solid #1e2231;flex:1;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:10px;background:${col};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:white;">${p.ticker.slice(0,2)}</div>
            <div>
              <div style="font-size:18px;font-weight:800;color:white;">${p.ticker}</div>
              <div style="font-size:11px;color:#6b7280;">${p.company}</div>
            </div>
          </div>
          <span style="font-size:10px;font-weight:700;background:${setupBg(p.setup)};color:${setupColor(p.setup)};padding:3px 10px;border-radius:99px;">${p.setup.toUpperCase()}</span>
        </div>
        <div style="font-size:12px;color:#d1d5db;line-height:1.6;margin-bottom:12px;">${p.thesis}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;">
          <div style="background:#0a0d14;border-radius:6px;padding:8px;border:1px solid #1e2231;">
            <div style="font-size:9px;color:#6b7280;text-transform:uppercase;">Current</div>
            <div style="font-size:14px;font-weight:700;color:white;">$${price} <span style="font-size:11px;color:${pctColor};">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span></div>
          </div>
          <div style="background:#0a0d14;border-radius:6px;padding:8px;border:1px solid #1e2231;">
            <div style="font-size:9px;color:#6b7280;text-transform:uppercase;">Target</div>
            <div style="font-size:14px;font-weight:700;color:#22c55e;">${p.target}</div>
          </div>
        </div>
        <div style="background:#0a0d14;border-radius:6px;padding:8px;border:1px solid #1e2231;margin-bottom:8px;">
          <div style="font-size:9px;color:#6b7280;text-transform:uppercase;margin-bottom:3px;">Catalyst to Watch</div>
          <div style="font-size:11px;color:#d1d5db;">${p.catalyst}</div>
        </div>
        <div style="font-size:10px;color:#4b5563;">Stop: ${p.risk}</div>
      </div>`;
    }).join('');

    const weekStr = new Date(Date.now() + 86400000).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

    const html = `
<div style="padding:20px;background:#0a0d14;width:780px;">
  <div style="background:#111520;border-radius:14px;padding:20px;border:1px solid #1e2231;">
    <div style="margin-bottom:18px;">
      <div style="font-size:20px;font-weight:700;color:white;letter-spacing:-0.02em;">Week Ahead — 2 Picks to Watch</div>
      <div style="font-size:12px;color:#6b7280;margin-top:3px;">Week of ${weekStr} • AI-selected based on setups + catalysts</div>
    </div>
    <div style="display:flex;gap:12px;">${pickCards}</div>
    <div style="font-size:10px;color:#374151;text-align:center;margin-top:14px;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 800, 520);
    if (!img) return;
    if (preview) {
      await sendImageToDM(CONFIG.OWNER_USER_ID, img, 'preview-weeklypicks.png', '👁️ Preview: Weekly Picks');
    } else {
      await sendImage(CONFIG.CHANNELS.WATCHLIST, img, 'weekly-picks.png',
        `🎯 **MoneyMatrix Week Ahead Picks — ${weekStr}**`);
      console.log('✅ Weekly picks posted');
    }
  } catch (e) {
    console.error('Weekly picks error:', e.message);
  }
}

// ============================================================
// MORNING QUESTIONS — 3 rotating weekly sets
// ============================================================
const QUESTION_SETS = {
  A: [
    { text: "🌅 **Q1 of 5 — Raw take only, no filter:**\n\nWhat's your honest read on the market right now? One sentence.", type: 'open' },
    { text: "🎯 **Q2 of 5 — Where's the smart money actually moving?**\n\nA) Large cap tech — AI cycle has legs\nB) Value & defensives — rotating out of growth\nC) Small caps — risk on, beta trade alive\nD) Commodities & energy — macro hedge", type: 'choice', options: { A:'Large cap tech', B:'Value & defensives', C:'Small caps', D:'Commodities & energy' } },
    { text: "⚡ **Q3 of 5 — Conviction level walking in today?**\n\nA) 🔥 High — best setup in weeks, sizing up\nB) 👀 Medium — selective, waiting on confirmation\nC) 🧘 Low — capital preservation mode\nD) 💰 Cash gang — sitting out until clarity", type: 'choice', options: { A:'High — sizing up', B:'Medium — selective', C:'Low — watching', D:'Cash gang' } },
    { text: "🧠 **Q4 of 5 — Finish this (open answer):**\n\n\"The one thing most traders are sleeping on right now is...\"", type: 'open' },
    { text: "🔮 **Q5 of 5 — Edge today. How are you playing it?**\n\nA) Momentum — riding what's working\nB) Contrarian — fading the crowd\nC) Options — defined risk, asymmetric play\nD) Patient — letting the trade come to me", type: 'choice', options: { A:'Momentum', B:'Contrarian', C:'Options play', D:'Patient — waiting' } }
  ],
  B: [
    { text: "🌅 **Q1 of 5 — Straight talk:**\n\nIf you had to bet real money on one direction today, what is it and why? No hedging.", type: 'open' },
    { text: "🎯 **Q2 of 5 — Biggest catalyst driving your thesis this week?**\n\nA) Fed policy — rate path is everything\nB) Earnings season — follow the numbers\nC) Macro data — CPI/jobs driving the bus\nD) Geopolitical — risk off/on in control", type: 'choice', options: { A:'Fed policy', B:'Earnings', C:'Macro data', D:'Geopolitical' } },
    { text: "⚡ **Q3 of 5 — Which sector deserves attention today?**\n\nA) 💻 Tech — AI infrastructure accelerating\nB) 🏦 Financials — rates at inflection point\nC) ⚡ Energy — supply or demand story\nD) 🛡️ Defensives — flight to safety active", type: 'choice', options: { A:'Tech', B:'Financials', C:'Energy', D:'Defensives' } },
    { text: "🧠 **Q4 of 5 — Open answer:**\n\nWhat's the setup most people haven't found yet?", type: 'open' },
    { text: "🔮 **Q5 of 5 — End of day prediction?**\n\nA) 📈 Green — buyers step in, dip bought\nB) 📉 Red — sellers in control, distribution\nC) 🔄 Flat — chop, no conviction\nD) 🎢 Whipsaw — volatile close", type: 'choice', options: { A:'Green close', B:'Red close', C:'Flat chop', D:'Volatile whipsaw' } }
  ],
  C: [
    { text: "🌅 **Q1 of 5 — Real talk:**\n\nWhat's the market getting wrong right now that you see clearly?", type: 'open' },
    { text: "🎯 **Q2 of 5 — Risk management today. How are you sizing?**\n\nA) Full size — high conviction, max exposure\nB) Half size — good setup, macro uncertainty\nC) Quarter size — testing waters, tight stops\nD) Zero — wrong environment for my style", type: 'choice', options: { A:'Full size', B:'Half size', C:'Quarter — testing', D:'Zero exposure' } },
    { text: "⚡ **Q3 of 5 — Timeframe you're focused on?**\n\nA) Intraday — scalping the range\nB) Swing — 3 to 10 day hold\nC) Position — weeks to months\nD) Mixed — depends on the setup", type: 'choice', options: { A:'Intraday', B:'Swing trade', C:'Position trade', D:'Mixed' } },
    { text: "🧠 **Q4 of 5 — No filter:**\n\nWhat would have to happen today to completely flip your outlook?", type: 'open' },
    { text: "🔮 **Q5 of 5 — The bold contrarian call:**\n\nA) Buy the most hated sector — capitulation near\nB) Short the most loved names — crowded trade\nC) Long volatility — calm before storm\nD) Buy small caps — rotation just starting", type: 'choice', options: { A:'Buy the hated', B:'Short the crowded', C:'Long volatility', D:'Buy small caps' } }
  ]
};

let chiefAnswers = {};
let questionIndex = 0;
let awaitingAnswers = false;
let currentQuestions = [];

function getWeeklyQuestions() {
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const sets = ['A', 'B', 'C'];
  return QUESTION_SETS[sets[weekNum % 3]];
}

async function startMorningQuestions(preview = false) {
  try {
    chiefAnswers = {};
    questionIndex = 0;
    awaitingAnswers = true;
    currentQuestions = getWeeklyQuestions();

    const owner = await client.users.fetch(CONFIG.OWNER_USER_ID);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    await owner.send(`☀️ **Good morning, Chief — ${today}**\n\n5 quick questions and I'll handle the rest. Reply **A/B/C/D** for choices, or just type your answer for open questions.\n\nLet's go 🔥`);
    await sleep(1500);
    await owner.send(currentQuestions[0].text);
  } catch (e) {
    console.error('Morning questions error:', e.message);
  }
}

async function postDailyDigest(preview = false) {
  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const indexSnap = await polygonBatch(['SPY','QQQ','DIA','IWM']);
    const movers = await polygonMovers();

    let marketData = 'LIVE MARKET DATA:\n';
    for (const [t, d] of Object.entries(indexSnap)) {
      const p = (d.day?.c || 0).toFixed(2);
      const pct = (d.todaysChangePerc || 0).toFixed(2);
      marketData += `${t}: $${p} (${pct}%)\n`;
    }
    if (movers.gainers.length) {
      marketData += 'TOP GAINERS: ' + movers.gainers.map(g => `${g.ticker} +${(g.todaysChangePerc||0).toFixed(1)}%`).join(' | ') + '\n';
      marketData += 'TOP LOSERS: '  + movers.losers.map(l  => `${l.ticker} ${(l.todaysChangePerc||0).toFixed(1)}%`).join(' | ');
    }

    const answersText = Object.entries(chiefAnswers).length > 0
      ? Object.entries(chiefAnswers).map(([q, a]) => `${q}: ${a}`).join('\n')
      : 'No morning answers recorded — use market context only';

    // Select branded header theme based on Chief's conviction answer
    const conviction = Object.values(chiefAnswers).join(' ').toLowerCase();
    const isBullish = conviction.includes('high') || conviction.includes('sizing') || conviction.includes('momentum') || conviction.includes('green');
    const isBearish = conviction.includes('bear') || conviction.includes('cash') || conviction.includes('red') || conviction.includes('cautious');
    const theme = isBullish ? 'bull' : isBearish ? 'bear' : 'neutral';
    const themeColors = {
      bull:    { bg: '#052e16', border: '#166534', accent: '#22c55e', label: '🟢 BULLISH BIAS' },
      bear:    { bg: '#2d0a0a', border: '#7f1d1d', accent: '#ef4444', label: '🔴 BEARISH BIAS' },
      neutral: { bg: '#1c1f2e', border: '#2a2d3e', accent: '#f59e0b', label: '🟡 NEUTRAL — WATCHING' },
    }[theme];

    const headerHtml = `
<div style="padding:16px 20px;background:#0a0d14;width:760px;">
  <div style="background:${themeColors.bg};border-radius:12px;padding:16px 20px;border:1px solid ${themeColors.border};display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:11px;font-weight:600;color:${themeColors.accent};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">MoneyMatrix Daily Briefing</div>
      <div style="font-size:18px;font-weight:800;color:white;letter-spacing:-0.02em;">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:11px;font-weight:700;background:${themeColors.border};color:${themeColors.accent};padding:4px 12px;border-radius:99px;">${themeColors.label}</div>
      <div style="font-size:10px;color:#4b5563;margin-top:6px;">Chief's Morning Stance</div>
    </div>
  </div>
</div>`;

    const headerImg = await generateImage(headerHtml, 780, 100);

    const post = await claudeAI(
      `You are the lead analyst for MoneyMatrix, a premium financial Discord. Chief has shared his morning market read. Your job is to build a premium daily briefing that combines his real perspective with sharp research.

Structure EXACTLY like this — no extra headers, no repeated disclaimers:

👤 CHIEF'S MORNING STANCE
[2-3 sharp sentences summarizing Chief's actual answers. Use his exact words from open questions.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 MARKET OVERVIEW
[Live index levels, pre-market or open action, key support/resistance with specific prices]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 SECTOR ROTATION
[What's leading, what's lagging, what institutional money is doing]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📰 WHAT'S MOVING MARKETS
[3-4 key items from today's news — Fed, earnings, macro, geopolitical]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 KEY LEVELS
[Specific prices for SPY, QQQ, and 2-3 individual names. Entry zones, targets, stops.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ WEEK AHEAD CATALYSTS
[Earnings, economic data, Fed events, expiration dates]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 THE PLAY
[1-2 specific, actionable ideas backed by data — not generic advice]

One disclaimer at the very end only. Specific numbers throughout. Premium content.`,
      `Date: ${today}\n\nChief's morning answers:\n${answersText}\n\n${marketData}\n\nSearch for today's market news and create the MoneyMatrix Daily Briefing.`,
      true, true
    );

    const fullText = `📊 **MoneyMatrix Daily Briefing — ${today}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${post}`;

    if (preview) {
      const owner = await client.users.fetch(CONFIG.OWNER_USER_ID);
      if (headerImg) {
        const att = new AttachmentBuilder(headerImg, { name: 'digest-header.png' });
        await owner.send({ files: [att] });
      }
      const chunks = fullText.match(/[\s\S]{1,1900}/g) || [fullText];
      for (const chunk of chunks) { await owner.send(chunk); await sleep(600); }
    } else {
      if (headerImg) await sendImage(CONFIG.CHANNELS.DAILY_DIGEST, headerImg, 'digest-header.png');
      await sendChunked(CONFIG.CHANNELS.DAILY_DIGEST, fullText);
      console.log('✅ Daily digest posted');
      // Confirm to Chief
      try {
        const owner = await client.users.fetch(CONFIG.OWNER_USER_ID);
        await owner.send('✅ Daily briefing is live in #daily-digest 🚀');
      } catch {}
    }

    awaitingAnswers = false;
  } catch (e) {
    console.error('Daily digest error:', e.message);
  }
}

// ============================================================
// WELCOME — New member joins
// ============================================================
client.on('guildMemberAdd', async (member) => {
  try {
    const welcomeMsg =
      `👋 **Welcome to MoneyMatrix, ${member.user.username}!**\n\n` +
      `Glad you're here. Here's where to start 👇\n\n` +
      `📋 Rules & guidelines → #rules\n` +
      `💬 Introduce yourself → #community\n` +
      `📊 Daily market intel → #daily-digest\n` +
      `📈 Watchlist & heatmap → #👀watchlist\n\n` +
      `⚠️ Nothing here is financial advice. Always do your own research. 🚀`;

    // Post in welcome channel
    const welcomeChannel = await client.channels.fetch(CONFIG.CHANNELS.WELCOME);
    await welcomeChannel.send(welcomeMsg);

    // Also DM the new member (free, no Claude call)
    try {
      await member.send(
        `👋 **Welcome to MoneyMatrix!**\n\n` +
        `You just joined one of the sharpest financial communities around.\n\n` +
        `📋 Start with #rules so you know the house\n` +
        `💬 Drop an intro in #community\n` +
        `📊 Check #daily-digest every morning for market intel\n\n` +
        `Good to have you. Let's get it. 🚀\n\n` +
        `⚠️ Nothing here is financial advice. Always do your own research.`
      );
    } catch {
      // DMs disabled by user — channel post is enough
    }
  } catch (e) {
    console.error('Welcome error:', e.message);
  }
});

// ============================================================
// @MENTION HANDLER — Admin role only
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── DM HANDLER — Owner only (morning questions + commands) ──
  if (!message.guild) {
    if (message.author.id !== CONFIG.OWNER_USER_ID) return;

    // Morning question flow
    if (awaitingAnswers) {
      const q = currentQuestions[questionIndex];
      const input = message.content.trim();

      let answer = '';
      if (q.type === 'open') {
        answer = input; // Take raw answer as-is
      } else {
        const letter = input.toUpperCase();
        if (!['A','B','C','D'].includes(letter)) {
          await message.reply('Reply with **A, B, C, or D** for this one 👆');
          return;
        }
        answer = q.options[letter];
      }

      // Store answer keyed by short question label
      const label = q.text.split('\n')[0].replace(/[*🌅🎯⚡🧠🔮]/g, '').replace(/Q\d of \d — /,'').trim();
      chiefAnswers[label] = answer;
      questionIndex++;

      if (questionIndex < currentQuestions.length) {
        await message.reply(`✅ Got it — **${answer.slice(0,60)}**`);
        await sleep(1000);
        await message.author.send(currentQuestions[questionIndex].text);
      } else {
        await message.reply(`✅ **${answer.slice(0,60)}** — all 5 locked in 🔒\n\nDigest posts at **8:30 AM** sharp.`);
        awaitingAnswers = false;
      }
      return;
    }

    // ── DM COMMANDS ──
    const cmd = message.content.trim().toLowerCase();

    if (cmd === '!help') {
      await message.reply(
        `**MoneyMatrix Data Hub — Commands**\n\n` +
        `**Preview (sends to your DMs):**\n` +
        `\`!preview feargreed\` — Fear & Greed image\n` +
        `\`!preview watchlist\` — Random watchlist card\n` +
        `\`!preview watchlist NVDA\` — Specific ticker\n` +
        `\`!preview heatmap\` — Sector heatmap\n` +
        `\`!preview earnings\` — Earnings calendar\n` +
        `\`!preview economic\` — Economic calendar\n` +
        `\`!preview etf\` — ETF holdings\n` +
        `\`!preview close\` — Market close\n` +
        `\`!preview futures\` — Futures snapshot\n` +
        `\`!preview picks\` — Weekly picks\n` +
        `\`!preview digest\` — Daily digest\n\n` +
        `**Force post to live channels:**\n` +
        `\`!post feargreed\` — Posts to live channel\n` +
        `\`!post watchlist [TICKER]\` — Posts to live channel\n\n` +
        `**Questions:**\n` +
        `\`!questions\` — Start morning questions now\n`
      );
      return;
    }

    if (cmd === '!questions') {
      await startMorningQuestions();
      return;
    }

    // Preview commands
    if (cmd.startsWith('!preview')) {
      const parts = cmd.split(' ');
      const target = parts[1];
      const extra = parts[2]?.toUpperCase();

      await message.reply(`⏳ Generating preview...`);

      if (target === 'feargreed')  await postFearGreed(true);
      if (target === 'watchlist')  await postDailyWatchlist(extra || null, true);
      if (target === 'heatmap')    await postSectorHeatmap(true);
      if (target === 'earnings')   await postEarningsCalendar(true);
      if (target === 'economic')   await postEconomicCalendar(true);
      if (target === 'etf')        await postETFHoldings(true);
      if (target === 'close')      await postMarketClose(true);
      if (target === 'futures')    await postFuturesSnapshot(true);
      if (target === 'picks')      await postWeeklyPicks(true);
      if (target === 'digest')     await postDailyDigest(true);

      await message.reply(`✅ Preview sent to your DMs!`);
      return;
    }

    // Force post commands
    if (cmd.startsWith('!post')) {
      const parts = cmd.split(' ');
      const target = parts[1];
      const extra = parts[2]?.toUpperCase();

      await message.reply(`⏳ Posting to live channel...`);

      if (target === 'feargreed')  { await postFearGreed();  markPosted('feargreed'); }
      if (target === 'watchlist')  { await postDailyWatchlist(extra || null); markPosted('watchlist'); }
      if (target === 'heatmap')    { await postSectorHeatmap(); markPosted('heatmap'); }
      if (target === 'earnings')   { await postEarningsCalendar(); markPosted('earnings'); }
      if (target === 'economic')   { await postEconomicCalendar(); markPosted('economic'); }
      if (target === 'etf')        { await postETFHoldings(); markPosted('etf'); }
      if (target === 'close')      { await postMarketClose(); markPosted('close'); }
      if (target === 'digest')     { await postDailyDigest(); markPosted('digest'); }

      await message.reply(`✅ Posted to live channel!`);
      return;
    }

    return;
  }

  // ── SERVER @MENTION HANDLER — Admin role only ──
  if (!message.mentions.has(client.user)) return;

  // Check for Admin role
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  const isAdmin = member.roles.cache.some(r => r.name === 'Admin') || message.author.id === CONFIG.OWNER_USER_ID;
  if (!isAdmin) return; // Silently ignore non-admins

  const query = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!query) {
    await message.reply('Ask me something! Example: `@MoneyMatrix Data Hub analyze NVDA`');
    return;
  }

  await message.channel.sendTyping();

  try {
    const reply = await claudeAI(
      `You are an elite financial analyst for MoneyMatrix, a premium Discord community. Always search for live data first.

For stock analysis provide:
**Executive Summary** — the key takeaway in 2 sentences
**Live Data** — current price, change, volume
**Technical Picture** — key levels, trend, momentum
**Bull Case** — specific catalyst and price target
**Bear Case** — specific risk and downside
**The Play** — actionable insight for traders

Use ** for bold. Under 1800 chars. Include TradingView link for stocks.
One disclaimer at the end only.`,
      query,
      true, true
    );

    const chunks = reply.match(/[\s\S]{1,1900}/g) || [reply];
    for (const chunk of chunks) {
      await message.channel.send(chunk);
      await sleep(500);
    }
  } catch (e) {
    console.error('@mention error:', e.message);
    await message.reply('Something went wrong — try again in a moment.');
  }
});

// ============================================================
// SCHEDULER
// ============================================================
function initScheduler() {
  // Monday only
  cron.schedule('0 7 * * 1',  async () => { if (!isMonday())    return; if (alreadyPosted('earnings'))  return; await postEarningsCalendar();  markPosted('earnings');  }, { timezone:'America/Chicago' });
  cron.schedule('30 7 * * 1', async () => { if (!isMonday())    return; if (alreadyPosted('economic'))  return; await postEconomicCalendar();  markPosted('economic');  }, { timezone:'America/Chicago' });

  // Daily weekdays
  cron.schedule('0 8 * * 1-5',  async () => { if (!isMarketOpen()) return; if (alreadyPosted('questions')) return; await startMorningQuestions(); markPosted('questions'); }, { timezone:'America/Chicago' });
  cron.schedule('30 8 * * 1-5', async () => { if (!isMarketOpen()) return; if (alreadyPosted('digest'))    return; await postDailyDigest();        markPosted('digest');    }, { timezone:'America/Chicago' });
  cron.schedule('0 10 * * 1-5', async () => { if (!isMarketOpen()) return; if (alreadyPosted('heatmap'))   return; await postSectorHeatmap();      markPosted('heatmap');   }, { timezone:'America/Chicago' });
  cron.schedule('0 11 * * 1-5', async () => { if (!isMarketOpen()) return; if (alreadyPosted('watchlist')) return; await postDailyWatchlist();     markPosted('watchlist'); }, { timezone:'America/Chicago' });
  cron.schedule('0 12 * * 1-5', async () => { if (!isMarketOpen()) return; if (alreadyPosted('feargreed')) return; await postFearGreed();          markPosted('feargreed'); }, { timezone:'America/Chicago' });
  cron.schedule('0 16 * * 1-5', async () => { if (!isMarketOpen()) return; if (alreadyPosted('close'))     return; await postMarketClose();        markPosted('close');     }, { timezone:'America/Chicago' });

  // Wednesday only
  cron.schedule('30 12 * * 3', async () => { if (!isWednesday()) return; if (alreadyPosted('etf')) return; await postETFHoldings(); markPosted('etf'); }, { timezone:'America/Chicago' });

  // Sunday
  cron.schedule('0 19 * * 0',  async () => { if (alreadyPosted('futures'))   return; await postFuturesSnapshot(); markPosted('futures');   }, { timezone:'America/Chicago' });
  cron.schedule('10 19 * * 0', async () => { if (alreadyPosted('weekpicks')) return; await postWeeklyPicks();     markPosted('weekpicks'); }, { timezone:'America/Chicago' });

  console.log('✅ Scheduler initialized — all jobs locked in');
}

// ============================================================
// STARTUP MISSED POST CHECK
// ============================================================
async function checkMissedPosts() {
  if (!isMarketOpen()) return;

  const now = new Date();
  const cstString = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const cst = new Date(cstString);
  const totalMins = cst.getHours() * 60 + cst.getMinutes();

  const jobs = [
    { key:'earnings',  mins:7*60,       fn:postEarningsCalendar,  mondayOnly:true  },
    { key:'economic',  mins:7*60+30,    fn:postEconomicCalendar,  mondayOnly:true  },
    { key:'questions', mins:8*60,       fn:startMorningQuestions, mondayOnly:false },
    { key:'digest',    mins:8*60+30,    fn:postDailyDigest,       mondayOnly:false },
    { key:'heatmap',   mins:10*60,      fn:postSectorHeatmap,     mondayOnly:false },
    { key:'watchlist', mins:11*60,      fn:postDailyWatchlist,    mondayOnly:false },
    { key:'feargreed', mins:12*60,      fn:postFearGreed,         mondayOnly:false },
    { key:'close',     mins:16*60,      fn:postMarketClose,       mondayOnly:false },
  ];

  for (const job of jobs) {
    if (job.mondayOnly && !isMonday()) continue;
    if (alreadyPosted(job.key)) continue;
    const missed = totalMins >= job.mins && totalMins <= job.mins + 30;
    if (missed) {
      console.log(`⚡ Missed post on restart: ${job.key}`);
      await job.fn();
      markPosted(job.key);
      await sleep(4000);
    }
  }
}

// ============================================================
// BOT READY
// ============================================================
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online — MoneyMatrix Data Hub v2.0 ready!`);
  initScheduler();
  await checkMissedPosts();
  try {
    const owner = await client.users.fetch(CONFIG.OWNER_USER_ID);
    await owner.send(`✅ **MoneyMatrix Data Hub v2.0 is online!**\n\nAll systems go. DM me \`!help\` to test anything. 🎯`);
  } catch (e) {
    console.error('Startup DM error:', e.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
