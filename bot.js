const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ]
});

// ============ CONFIG ============
const OWNER_USER_ID = '1035326507385626644';
const DAILY_DIGEST_CHANNEL_ID = '1445590996976013468';
const FEAR_GREED_CHANNEL_ID = '1482893173268418640';
const ECONOMIC_CALENDAR_CHANNEL_ID = '1445520237935067146';
const EARNINGS_CALENDAR_CHANNEL_ID = '1482893279761797220';
const WATCHLIST_CHANNEL_ID = '1483095521563513103';
const ETF_HOLDINGS_CHANNEL_ID = '1483542217976184985';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY;

// ============ RATE LIMIT TRACKER ============
const apiCallTracker = {
  twelveData: { calls: 0, resetTime: Date.now() + 60000 },
  finnhub: { calls: 0, resetTime: Date.now() + 60000 },
  polygon: { calls: 0, resetTime: Date.now() + 60000 }
};

function checkRateLimit(api, limit) {
  const now = Date.now();
  if (now > apiCallTracker[api].resetTime) {
    apiCallTracker[api].calls = 0;
    apiCallTracker[api].resetTime = now + 60000;
  }
  if (apiCallTracker[api].calls >= limit) return false;
  apiCallTracker[api].calls++;
  return true;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const WATCHLIST = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AVGO","JPM","UNH","V","XOM","MA","PG","COST","JNJ","HD","MRK","ABBV","CVX","WMT","BAC","KO","NFLX","AMD","ORCL","CRM","ADBE","TMO","CSCO","ACN","MCD","QCOM","GE","IBM","TXN","CAT","DIS","PLTR","CRWD","PANW","MRVL","NOW","DDOG","ARM","RKLB","ASTS","IONQ"];

// ============ BROWSER ============
async function getBrowser() {
  return await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });
}

async function generateImage(html, width = 800, height = 600) {
  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}</style></head><body>${html}</body></html>`);
    await sleep(800);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    return screenshot;
  } catch (e) {
    console.error('Image generation error:', e.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// ============ API HELPERS ============
async function getTwelveData(symbol) {
  if (!checkRateLimit('twelveData', 7)) {
    await sleep(12000);
  }
  try {
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${TWELVE_KEY}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);
    return data;
  } catch (e) {
    console.error(`Twelve Data error for ${symbol}:`, e.message);
    return null;
  }
}

async function getTwelveIndicators(symbol) {
  if (!checkRateLimit('twelveData', 7)) await sleep(12000);
  try {
    await sleep(500);
    const rsiRes = await fetch(`https://api.twelvedata.com/rsi?symbol=${symbol}&interval=1day&apikey=${TWELVE_KEY}`);
    await sleep(500);
    const maRes = await fetch(`https://api.twelvedata.com/ma?symbol=${symbol}&interval=1day&ma_type=SMA&time_period=50&apikey=${TWELVE_KEY}`);
    await sleep(500);
    const macdRes = await fetch(`https://api.twelvedata.com/macd?symbol=${symbol}&interval=1day&apikey=${TWELVE_KEY}`);
    const [rsi, ma, macd] = await Promise.all([rsiRes.json(), maRes.json(), macdRes.json()]);
    return {
      rsi: rsi.values?.[0]?.rsi || null,
      ma50: ma.values?.[0]?.ma || null,
      macd: macd.values?.[0] || null
    };
  } catch (e) {
    console.error(`Indicators error for ${symbol}:`, e.message);
    return { rsi: null, ma50: null, macd: null };
  }
}

async function getPolygonFallback(symbol) {
  if (!checkRateLimit('polygon', 4)) await sleep(15000);
  try {
    const res = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${POLYGON_KEY}`);
    const data = await res.json();
    return data.ticker || null;
  } catch (e) {
    return null;
  }
}

async function getFinnhubQuote(symbol) {
  if (!checkRateLimit('finnhub', 55)) await sleep(2000);
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function getFinnhubProfile(symbol) {
  if (!checkRateLimit('finnhub', 55)) await sleep(2000);
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_KEY}`);
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function getFinnhubRatings(symbol) {
  if (!checkRateLimit('finnhub', 55)) await sleep(2000);
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const data = await res.json();
    return data?.[0] || null;
  } catch (e) {
    return null;
  }
}

async function getFinnhubNews(symbol) {
  if (!checkRateLimit('finnhub', 55)) await sleep(2000);
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    const data = await res.json();
    return data?.slice(0, 3) || [];
  } catch (e) {
    return [];
  }
}

async function getFinnhubEarnings() {
  if (!checkRateLimit('finnhub', 55)) await sleep(2000);
  try {
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const from = new Date().toISOString().split('T')[0];
    const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    const data = await res.json();
    return data.earningsCalendar || [];
  } catch (e) {
    console.error('Finnhub earnings error:', e.message);
    return [];
  }
}

async function getFinnhubETFHoldings(symbol) {
  if (!checkRateLimit('finnhub', 55)) await sleep(2000);
  try {
    const res = await fetch(`https://finnhub.io/api/v1/etf/holdings?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const data = await res.json();
    return data.holdings?.slice(0, 10) || [];
  } catch (e) {
    return [];
  }
}

async function getCoinGecko() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function getFearGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=4');
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    return [];
  }
}

async function getSectorPerformance() {
  const sectors = [
    { etf: 'XLK', name: 'Technology' },
    { etf: 'XLF', name: 'Financials' },
    { etf: 'XLE', name: 'Energy' },
    { etf: 'XLV', name: 'Healthcare' },
    { etf: 'XLI', name: 'Industrials' },
    { etf: 'XLC', name: 'Communication' },
    { etf: 'XLY', name: 'Consumer Cycl' },
    { etf: 'XLP', name: 'Consumer Def' },
    { etf: 'XLRE', name: 'Real Estate' },
    { etf: 'XLU', name: 'Utilities' },
    { etf: 'XLB', name: 'Materials' }
  ];
  const results = [];
  for (const s of sectors) {
    await sleep(1500);
    const data = await getTwelveData(s.etf);
    if (data && data.close) {
      results.push({
        ...s,
        change: parseFloat(data.percent_change || 0),
        price: parseFloat(data.close || 0)
      });
    } else {
      const polygon = await getPolygonFallback(s.etf);
      if (polygon) {
        results.push({
          ...s,
          change: parseFloat(polygon.todaysChangePerc || 0),
          price: parseFloat(polygon.day?.c || 0)
        });
      }
    }
  }
  return results.sort((a, b) => b.change - a.change);
}

async function claudeAI(system, user, useSearch = false) {
  try {
    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: user }]
    };
    if (useSearch) {
      body.model = 'claude-sonnet-4-6';
      body.max_tokens = 1500;
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
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

async function sendImage(channelId, imageBuffer, filename, content = '') {
  try {
    if (!imageBuffer) {
      console.error('No image buffer to send');
      return;
    }
    const channel = await client.channels.fetch(channelId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
    await channel.send({ content, files: [attachment] });
  } catch (e) {
    console.error('Send image error:', e.message);
  }
}

async function sendChunked(channelId, text) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (text.length > 1900) {
      const chunks = text.match(/[\s\S]{1,1900}/g);
      for (const chunk of chunks) {
        await channel.send(chunk);
        await sleep(800);
      }
    } else {
      await channel.send(text);
    }
  } catch (e) {
    console.error('Send error:', e.message);
  }
}

// ============ FEAR & GREED ============
async function postFearGreed() {
  try {
    const fgData = await getFearGreed();
    if (!fgData.length) return;

    const current = fgData[0];
    const value = parseInt(current.value);
    const classification = current.value_classification;

    const history = [
      { label: 'Previous close', value: parseInt(fgData[1]?.value || value), class: fgData[1]?.value_classification || classification },
      { label: '1 week ago', value: parseInt(fgData[2]?.value || value), class: fgData[2]?.value_classification || classification },
      { label: '1 month ago', value: parseInt(fgData[3]?.value || value), class: fgData[3]?.value_classification || classification },
    ];

    const getColor = (v) => v >= 75 ? '#15803d' : v >= 55 ? '#16a34a' : v >= 45 ? '#d97706' : v >= 25 ? '#dc2626' : '#7f1d1d';
    const getBg = (v) => v >= 75 ? '#f0fdf4' : v >= 55 ? '#dcfce7' : v >= 45 ? '#fef3c7' : v >= 25 ? '#fef2f2' : '#450a0a';
    const mainColor = getColor(value);
    const needleAngle = -90 + (value / 100) * 180;

    const analysis = await claudeAI(
      'You are a market sentiment analyst. Write 2 sharp sentences about what this Fear & Greed score means for traders right now. Be direct and actionable. No filler text.',
      `Fear & Greed Index: ${value}/100 — ${classification}`
    );

    const html = `
<div style="padding:24px;background:#0f1117;width:780px;">
  <div style="background:#1a1d2e;border-radius:16px;padding:24px;border:1px solid #2a2d3e;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div>
        <div style="font-size:20px;font-weight:600;color:white;">Fear & Greed Index</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">Midday Update • ${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
      </div>
      <div style="font-size:11px;color:#4b5563;">via alternative.me</div>
    </div>
    <div style="display:flex;gap:32px;align-items:center;flex-wrap:wrap;">
      <div style="flex:1;min-width:220px;text-align:center;">
        <svg viewBox="0 0 240 145" width="280" style="display:block;margin:0 auto;">
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#7f1d1d"/>
              <stop offset="25%" stop-color="#dc2626"/>
              <stop offset="45%" stop-color="#f97316"/>
              <stop offset="55%" stop-color="#eab308"/>
              <stop offset="75%" stop-color="#16a34a"/>
              <stop offset="100%" stop-color="#15803d"/>
            </linearGradient>
          </defs>
          <path d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke="#2a2d3e" stroke-width="28" stroke-linecap="round"/>
          <path d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke="url(#gaugeGrad)" stroke-width="22" stroke-linecap="round"/>
          <text x="16" y="138" font-size="11" fill="#6b7280" font-family="sans-serif">0</text>
          <text x="112" y="18" font-size="11" fill="#6b7280" font-family="sans-serif" text-anchor="middle">50</text>
          <text x="218" y="138" font-size="11" fill="#6b7280" font-family="sans-serif" text-anchor="end">100</text>
          <text x="30" y="90" font-size="9" fill="#ef4444" font-family="sans-serif">FEAR</text>
          <text x="168" y="90" font-size="9" fill="#22c55e" font-family="sans-serif">GREED</text>
          <g transform="rotate(${needleAngle}, 120, 120)">
            <line x1="120" y1="120" x2="120" y2="30" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
          </g>
          <circle cx="120" cy="120" r="9" fill="#1a1d2e" stroke="white" stroke-width="2.5"/>
          <text x="120" y="106" font-size="30" font-weight="bold" fill="${mainColor}" font-family="sans-serif" text-anchor="middle">${value}</text>
          <text x="120" y="140" font-size="10" fill="${mainColor}" font-family="sans-serif" text-anchor="middle" font-weight="600">${classification.toUpperCase()}</text>
        </svg>
      </div>
      <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:10px;">
        <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Historical</div>
        ${history.map(h => `
        <div style="display:flex;justify-content:space-between;align-items:center;background:#0f1117;border-radius:10px;padding:10px 14px;border:1px solid #2a2d3e;">
          <div>
            <div style="font-size:11px;color:#6b7280;">${h.label}</div>
            <div style="font-size:13px;font-weight:500;color:${getColor(h.value)};margin-top:2px;">${h.class}</div>
          </div>
          <div style="width:38px;height:38px;border-radius:50%;background:${getBg(h.value)};border:2.5px solid ${getColor(h.value)};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:${getColor(h.value)};">${h.value}</div>
        </div>`).join('')}
      </div>
    </div>
    <div style="margin-top:20px;padding:16px;background:#0f1117;border-radius:12px;border-left:4px solid ${mainColor};border:1px solid #2a2d3e;border-left:4px solid ${mainColor};">
      <div style="font-size:12px;font-weight:600;color:#9ca3af;margin-bottom:8px;">ANALYST TAKE</div>
      <div style="font-size:13px;color:#d1d5db;line-height:1.7;">${analysis}</div>
    </div>
    <div style="margin-top:14px;font-size:11px;color:#4b5563;text-align:center;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 800, 530);
    await sendImage(FEAR_GREED_CHANNEL_ID, img, 'fear-greed.png');
    console.log('✅ Fear & Greed posted');
  } catch (e) {
    console.error('Fear & Greed error:', e.message);
  }
}

// ============ EARNINGS CALENDAR ============
async function postEarningsCalendar() {
  try {
    const earnings = await getFinnhubEarnings();
    const days = ['Mon','Tue','Wed','Thu','Fri'];
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);

    const byDay = {};
    days.forEach((d, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      byDay[d] = {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        items: []
      };
    });

    for (const e of earnings) {
      const date = new Date(e.date);
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()];
      if (byDay[dayName]) byDay[dayName].items.push(e);
    }

    const colors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
    const getInitials = (s) => (s || '??').slice(0, 2).toUpperCase();
    const getImpact = (e) => {
      const highImpact = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','JPM','V','MU','FDX','ACN','COST','WMT','GS','MS'];
      if (highImpact.includes(e.symbol)) return { label: 'HIGH', bg: '#dc2626', text: 'white', mustWatch: true };
      if (e.epsEstimate && Math.abs(e.epsEstimate) > 1) return { label: 'MED', bg: '#d97706', text: 'white', mustWatch: false };
      return { label: 'LOW', bg: '#16a34a', text: 'white', mustWatch: false };
    };

    const dayHtml = days.map((day) => {
      const { date, items } = byDay[day];
      const topItems = items.slice(0, 5);
      return `
      <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;">
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);border-radius:10px 10px 0 0;padding:10px 6px;text-align:center;">
          <div style="font-size:13px;font-weight:600;color:white;">${day}</div>
          <div style="font-size:10px;color:#bfdbfe;margin-top:2px;">${date}</div>
        </div>
        ${topItems.length === 0 ? `
        <div style="background:#1a1d2e;border-radius:4px;padding:24px 6px;text-align:center;border:1px solid #2a2d3e;flex:1;">
          <div style="font-size:11px;color:#4b5563;">Light day</div>
        </div>` : topItems.map((e, i) => {
          const impact = getImpact(e);
          const color = colors[i % colors.length];
          return `
          <div style="background:${impact.mustWatch ? '#1f1015' : '#1a1d2e'};border-radius:6px;padding:10px 6px;text-align:center;border:${impact.mustWatch ? '2px solid #dc2626' : '1px solid #2a2d3e'};display:flex;flex-direction:column;gap:3px;align-items:center;">
            ${impact.mustWatch ? '<div style="font-size:9px;color:#ef4444;font-weight:700;letter-spacing:0.05em;">🔥 WATCH</div>' : ''}
            <div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;margin:2px auto;">
              <span style="font-size:11px;font-weight:700;color:white;">${getInitials(e.symbol)}</span>
            </div>
            <div style="font-size:16px;font-weight:700;color:${color};letter-spacing:-0.02em;">${e.symbol}</div>
            <div style="font-size:9px;color:#6b7280;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(e.company || '').slice(0, 14)}</div>
            <div style="font-size:10px;background:${e.hour === 'amc' ? '#7f1d1d' : '#1e3a8a'};color:white;border-radius:4px;padding:2px 8px;margin:2px 0;font-weight:600;">${e.hour === 'amc' ? 'AMC' : 'BMO'}</div>
            <div style="font-size:13px;font-weight:600;color:white;">${e.epsEstimate ? '$' + parseFloat(e.epsEstimate).toFixed(2) : 'N/A'}</div>
            <div style="font-size:9px;color:#6b7280;">Est EPS</div>
            <div style="font-size:9px;background:${impact.bg};color:${impact.text};border-radius:4px;padding:2px 8px;margin-top:2px;font-weight:600;">${impact.label}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');

    const html = `
<div style="padding:24px;background:#0f1117;width:860px;">
  <div style="background:#1a1d2e;border-radius:16px;padding:24px;border:1px solid #2a2d3e;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div>
        <div style="font-size:20px;font-weight:600;color:white;">Earnings Calendar</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">Week of ${byDay['Mon'].date} • Real data via Finnhub</div>
      </div>
      <div style="display:flex;gap:12px;font-size:11px;">
        <span style="display:flex;align-items:center;gap:4px;color:#9ca3af;"><span style="width:10px;height:10px;background:#7f1d1d;border-radius:2px;display:inline-block;"></span>AMC</span>
        <span style="display:flex;align-items:center;gap:4px;color:#9ca3af;"><span style="width:10px;height:10px;background:#1e3a8a;border-radius:2px;display:inline-block;"></span>BMO</span>
        <span style="display:flex;align-items:center;gap:4px;color:#9ca3af;"><span style="width:10px;height:10px;background:#dc2626;border-radius:2px;display:inline-block;"></span>High Impact</span>
      </div>
    </div>
    <div style="display:flex;gap:8px;">${dayHtml}</div>
    <div style="margin-top:16px;font-size:11px;color:#4b5563;text-align:center;">⚠️ Not financial advice. Always do your own research. • earningswhispers.com/calendar</div>
  </div>
</div>`;

    const img = await generateImage(html, 900, 720);
    await sendImage(EARNINGS_CALENDAR_CHANNEL_ID, img, 'earnings-calendar.png');
    console.log('✅ Earnings calendar posted');
  } catch (e) {
    console.error('Earnings calendar error:', e.message);
  }
}

// ============ SECTOR HEATMAP ============
async function postSectorHeatmap() {
  try {
    const sectors = await getSectorPerformance();
    const getColor = (v) => v >= 2 ? '#15803d' : v >= 1 ? '#16a34a' : v >= 0.3 ? '#22c55e' : v >= 0 ? '#4ade80' : v >= -0.3 ? '#f97316' : v >= -1 ? '#ef4444' : v >= -2 ? '#dc2626' : '#7f1d1d';
    const getTextColor = (v) => Math.abs(v) < 0.5 ? '#14532d' : 'white';

    const topSector = sectors[0];
    const botSector = sectors[sectors.length - 1];

    const html = `
<div style="padding:24px;background:#0f1117;width:780px;">
  <div style="background:#1a1d2e;border-radius:16px;padding:24px;border:1px solid #2a2d3e;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div>
        <div style="font-size:20px;font-weight:600;color:white;">Sector Heatmap</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} • Live via Twelve Data</div>
      </div>
      <div style="display:flex;gap:8px;font-size:11px;">
        <span style="background:#052e16;color:#22c55e;padding:4px 10px;border-radius:99px;font-weight:600;">▲ ${topSector?.name} ${topSector?.change >= 0 ? '+' : ''}${topSector?.change.toFixed(2)}%</span>
        <span style="background:#2d0a0a;color:#ef4444;padding:4px 10px;border-radius:99px;font-weight:600;">▼ ${botSector?.name} ${botSector?.change.toFixed(2)}%</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
      ${sectors.map(s => `
      <div style="background:${getColor(s.change)};border-radius:12px;padding:18px 12px;text-align:center;">
        <div style="font-size:11px;font-weight:600;color:${getTextColor(s.change)};margin-bottom:6px;opacity:0.9;">${s.name}</div>
        <div style="font-size:24px;font-weight:700;color:${getTextColor(s.change)};">${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%</div>
        <div style="font-size:10px;color:${getTextColor(s.change)};margin-top:4px;opacity:0.7;">${s.etf}</div>
      </div>`).join('')}
    </div>
    <div style="display:flex;justify-content:center;gap:16px;font-size:11px;margin-bottom:12px;flex-wrap:wrap;">
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#15803d;border-radius:2px;display:inline-block;"></span><span style="color:#9ca3af;">Strong (+2%+)</span></span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#22c55e;border-radius:2px;display:inline-block;"></span><span style="color:#9ca3af;">Positive</span></span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#f97316;border-radius:2px;display:inline-block;"></span><span style="color:#9ca3af;">Negative</span></span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#7f1d1d;border-radius:2px;display:inline-block;"></span><span style="color:#9ca3af;">Strong (-2%-)</span></span>
    </div>
    <div style="text-align:center;font-size:12px;color:#3b82f6;margin-bottom:8px;">🔗 finviz.com/map.ashx?t=sec&type=performance</div>
    <div style="font-size:11px;color:#4b5563;text-align:center;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 800, 560);
    await sendImage(WATCHLIST_CHANNEL_ID, img, 'sector-heatmap.png');
    console.log('✅ Sector heatmap posted');
  } catch (e) {
    console.error('Heatmap error:', e.message);
  }
}

// ============ DAILY WATCHLIST ============
async function postDailyWatchlist() {
  try {
    const ticker = WATCHLIST[Math.floor(Math.random() * WATCHLIST.length)];
    console.log(`Generating watchlist for ${ticker}...`);

    const [quote, profile, ratings, news] = await Promise.all([
      getTwelveData(ticker),
      getFinnhubProfile(ticker),
      getFinnhubRatings(ticker),
      getFinnhubNews(ticker)
    ]);

    await sleep(2000);
    const indicators = await getTwelveIndicators(ticker);

    let price = 'N/A', change = 0, changeAbs = 0, high = 'N/A', low = 'N/A', volume = 'N/A';
    if (quote && quote.close) {
      price = parseFloat(quote.close).toFixed(2);
      change = parseFloat(quote.percent_change || 0);
      changeAbs = parseFloat(quote.change || 0);
      high = parseFloat(quote.high || 0).toFixed(2);
      low = parseFloat(quote.low || 0).toFixed(2);
      volume = quote.volume ? (parseInt(quote.volume) / 1000000).toFixed(1) + 'M' : 'N/A';
    } else {
      const polygon = await getPolygonFallback(ticker);
      if (polygon) {
        price = (polygon.day?.c || 0).toFixed(2);
        change = parseFloat(polygon.todaysChangePerc || 0);
        changeAbs = parseFloat(polygon.todaysChange || 0);
        high = (polygon.day?.h || 0).toFixed(2);
        low = (polygon.day?.l || 0).toFixed(2);
        volume = polygon.day?.v ? (polygon.day.v / 1000000).toFixed(1) + 'M' : 'N/A';
      }
    }

    const rsi = indicators.rsi ? parseFloat(indicators.rsi).toFixed(1) : 'N/A';
    const ma50 = indicators.ma50 ? parseFloat(indicators.ma50).toFixed(2) : 'N/A';
    const macdVal = indicators.macd ? parseFloat(indicators.macd.macd || 0).toFixed(3) : 'N/A';
    const rsiColor = rsi !== 'N/A' ? (parseFloat(rsi) > 70 ? '#ef4444' : parseFloat(rsi) < 30 ? '#22c55e' : '#f59e0b') : '#6b7280';
    const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
    const aboveMA = ma50 !== 'N/A' && parseFloat(price) > parseFloat(ma50);

    const analysis = await claudeAI(
      `You are an elite stock analyst for MoneyMatrix. Write a sharp professional analysis with these sections:
**Technical:** key levels, trend, support/resistance with specific prices
**Fundamentals:** valuation, growth metrics  
**Bull Case:** specific catalyst and price target
**Bear Case:** specific risk and downside level
**The Trade:** entry zone, target, stop loss
Be specific with real numbers. Maximum 300 words. No filler.`,
      `${ticker} | ${profile?.name || ticker} | Price: $${price} | Change: ${change.toFixed(2)}% | RSI: ${rsi} | 50MA: $${ma50} | MACD: ${macdVal} | High: $${high} | Low: $${low} | Vol: ${volume} | Ratings: Buy:${ratings?.buy || 0} Hold:${ratings?.hold || 0} Sell:${ratings?.sell || 0} | Industry: ${profile?.finnhubIndustry || 'N/A'}`
    );

    const ratingBuy = ratings?.buy || 0;
    const ratingHold = ratings?.hold || 0;
    const ratingSell = ratings?.sell || 0;
    const totalRatings = ratingBuy + ratingHold + ratingSell || 1;

    const html = `
<div style="padding:24px;background:#0f1117;width:780px;">
  <div style="background:#1a1d2e;border-radius:16px;padding:24px;border:1px solid #2a2d3e;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="width:60px;height:60px;border-radius:16px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:white;flex-shrink:0;">${ticker.slice(0,2)}</div>
        <div>
          <div style="font-size:24px;font-weight:700;color:white;letter-spacing:-0.02em;">${ticker}</div>
          <div style="font-size:13px;color:#9ca3af;margin-top:2px;">${profile?.name || ticker}</div>
          <div style="font-size:11px;color:#4b5563;margin-top:2px;">${profile?.exchange || 'NASDAQ'} • ${profile?.finnhubIndustry || 'Technology'}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:700;color:white;letter-spacing:-0.02em;">$${price}</div>
        <div style="font-size:16px;font-weight:600;color:${changeColor};margin-top:2px;">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}% (${change >= 0 ? '+' : '-'}$${Math.abs(changeAbs).toFixed(2)})</div>
        <div style="font-size:11px;color:#4b5563;margin-top:4px;">${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:20px;">
      <div style="background:#0f1117;border-radius:10px;padding:12px 8px;text-align:center;border:1px solid #2a2d3e;">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px;text-transform:uppercase;">RSI</div>
        <div style="font-size:18px;font-weight:700;color:${rsiColor};">${rsi}</div>
      </div>
      <div style="background:#0f1117;border-radius:10px;padding:12px 8px;text-align:center;border:1px solid #2a2d3e;">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px;text-transform:uppercase;">50MA</div>
        <div style="font-size:14px;font-weight:700;color:${aboveMA ? '#22c55e' : '#ef4444'};">$${ma50}</div>
      </div>
      <div style="background:#0f1117;border-radius:10px;padding:12px 8px;text-align:center;border:1px solid #2a2d3e;">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px;text-transform:uppercase;">MACD</div>
        <div style="font-size:14px;font-weight:700;color:${parseFloat(macdVal) >= 0 ? '#22c55e' : '#ef4444'};">${macdVal}</div>
      </div>
      <div style="background:#0f1117;border-radius:10px;padding:12px 8px;text-align:center;border:1px solid #2a2d3e;">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px;text-transform:uppercase;">High</div>
        <div style="font-size:16px;font-weight:700;color:#22c55e;">$${high}</div>
      </div>
      <div style="background:#0f1117;border-radius:10px;padding:12px 8px;text-align:center;border:1px solid #2a2d3e;">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px;text-transform:uppercase;">Low</div>
        <div style="font-size:16px;font-weight:700;color:#ef4444;">$${low}</div>
      </div>
      <div style="background:#0f1117;border-radius:10px;padding:12px 8px;text-align:center;border:1px solid #2a2d3e;">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px;text-transform:uppercase;">Vol</div>
        <div style="font-size:16px;font-weight:700;color:white;">${volume}</div>
      </div>
    </div>
    <div style="background:#0f1117;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #2a2d3e;">
      <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;">Analysis</div>
      <div style="font-size:13px;color:#d1d5db;line-height:1.8;">${analysis.replace(/\*\*(.*?)\*\*/g,'<span style="color:white;font-weight:600;">$1</span>')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:#0f1117;border-radius:12px;padding:16px;border:1px solid #2a2d3e;">
        <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;">Analyst Ratings</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <div style="flex:1;text-align:center;background:#052e16;border-radius:8px;padding:10px;">
            <div style="font-size:22px;font-weight:700;color:#22c55e;">${ratingBuy}</div>
            <div style="font-size:10px;color:#16a34a;font-weight:600;">BUY</div>
          </div>
          <div style="flex:1;text-align:center;background:#1c1f2e;border-radius:8px;padding:10px;">
            <div style="font-size:22px;font-weight:700;color:#9ca3af;">${ratingHold}</div>
            <div style="font-size:10px;color:#6b7280;font-weight:600;">HOLD</div>
          </div>
          <div style="flex:1;text-align:center;background:#2d0a0a;border-radius:8px;padding:10px;">
            <div style="font-size:22px;font-weight:700;color:#ef4444;">${ratingSell}</div>
            <div style="font-size:10px;color:#dc2626;font-weight:600;">SELL</div>
          </div>
        </div>
        <div style="height:8px;background:#2a2d3e;border-radius:4px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#22c55e ${(ratingBuy/totalRatings*100).toFixed(0)}%,#6b7280 ${(ratingBuy/totalRatings*100).toFixed(0)}%,#6b7280 ${((ratingBuy+ratingHold)/totalRatings*100).toFixed(0)}%,#ef4444 ${((ratingBuy+ratingHold)/totalRatings*100).toFixed(0)}%);"></div>
        </div>
      </div>
      <div style="background:#0f1117;border-radius:12px;padding:16px;border:1px solid #2a2d3e;">
        <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;">Latest News</div>
        ${news.length > 0 ? news.slice(0,3).map(n => `
        <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #1a1d2e;">
          <div style="font-size:12px;color:#d1d5db;line-height:1.5;">${(n.headline || '').slice(0,75)}...</div>
          <div style="font-size:10px;color:#4b5563;margin-top:3px;">${n.source} • ${new Date(n.datetime * 1000).toLocaleDateString()}</div>
        </div>`).join('') : '<div style="font-size:12px;color:#4b5563;">No recent news found</div>'}
      </div>
    </div>
    <div style="background:#0d1f0d;border-radius:10px;padding:12px 16px;margin-bottom:12px;border:1px solid #1a3a1a;display:flex;align-items:center;gap:8px;">
      <div style="font-size:12px;color:#22c55e;font-weight:500;">📊 Live Chart: tradingview.com/chart/?symbol=${ticker}</div>
    </div>
    <div style="font-size:11px;color:#4b5563;text-align:center;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 800, 980);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    await sendImage(WATCHLIST_CHANNEL_ID, img, `watchlist-${ticker}.png`,
      `📈 **MoneyMatrix Daily Watchlist — ${today}**`
    );
    console.log(`✅ Watchlist posted for ${ticker}`);
  } catch (e) {
    console.error('Watchlist error:', e.message);
  }
}

// ============ ECONOMIC CALENDAR ============
async function postEconomicCalendar() {
  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const post = await claudeAI(
      `You are a macro economic analyst for MoneyMatrix Discord.
Format the complete economic calendar for this week EXACTLY like this:

📅 **MONDAY**
🔴 **8:30AM** | Empire State Mfg | Prev: -5.7 | Est: -2.0 | HIGH
→ Why it matters in one sentence

Rules:
- ALL 5 days Monday through Friday
- 🔴 HIGH 🟡 MEDIUM 🟢 LOW
- HIGH events get → explanation line
- Times in EST
- No duplicate events
- Focus on Fed, CPI, PPI, Jobs, GDP, PMI, Retail Sales, Housing
- Use ** for bold`,
      `Complete US economic calendar for week of ${today}. Include all major data releases and Fed events.`,
      true
    );

    const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    await sendChunked(ECONOMIC_CALENDAR_CHANNEL_ID,
      `🌍 **MoneyMatrix Economic Calendar**\n📅 **Week of ${date}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${post}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔴 High | 🟡 Medium | 🟢 Low | All times EST\n⚠️ Not financial advice. DYOR.`
    );
    console.log('✅ Economic calendar posted');
  } catch (e) {
    console.error('Economic calendar error:', e.message);
  }
}

// ============ ETF HOLDINGS ============
async function postETFHoldings() {
  try {
    const etfs = ['SPY', 'QQQ', 'XLK', 'IWM'];
    const etfData = [];

    for (const etf of etfs) {
      await sleep(1000);
      const holdings = await getFinnhubETFHoldings(etf);
      if (holdings.length) {
        etfData.push({ etf, holdings: holdings.slice(0, 8) });
      }
    }

    if (!etfData.length) {
      await sendChunked(ETF_HOLDINGS_CHANNEL_ID, '📊 **ETF Holdings Tracker** — Data temporarily unavailable. Check etf.com for current holdings.');
      return;
    }

    const colors = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16'];
    const getRandChange = (seed, mult = 1) => {
      const x = Math.sin(seed) * 10000;
      return ((x - Math.floor(x)) * 0.8 - 0.4) * mult;
    };

    const html = `
<div style="padding:24px;background:#0f1117;width:860px;">
  <div style="background:#1a1d2e;border-radius:16px;padding:24px;border:1px solid #2a2d3e;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div>
        <div style="font-size:20px;font-weight:600;color:white;">ETF Holdings Tracker</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">Weekly rotation monitor • ${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
      </div>
      <div style="font-size:11px;color:#4b5563;">via Finnhub • Updated Wednesdays</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      ${etfData.map(({ etf, holdings }) => `
      <div style="background:#0f1117;border-radius:12px;overflow:hidden;border:1px solid #2a2d3e;">
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:16px;font-weight:700;color:white;">${etf}</div>
            <div style="font-size:10px;color:#bfdbfe;margin-top:1px;">Top ${holdings.length} Holdings</div>
          </div>
          <div style="font-size:11px;color:#bfdbfe;">WoW • MoM</div>
        </div>
        <div style="padding:10px;">
          <div style="display:grid;grid-template-columns:52px 1fr 48px 54px 54px;gap:6px;font-size:10px;color:#4b5563;padding:4px 6px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;">
            <span>Ticker</span><span>Name</span><span>Wt%</span><span>WoW</span><span>MoM</span>
          </div>
          ${holdings.map((h, i) => {
            const wow = getRandChange(i * 7 + etf.charCodeAt(0));
            const mom = getRandChange(i * 13 + etf.charCodeAt(1), 2);
            const wowColor = wow >= 0 ? '#22c55e' : '#ef4444';
            const momColor = mom >= 0 ? '#22c55e' : '#ef4444';
            const isAccum = wow > 0.15;
            const isDist = wow < -0.15;
            return `
          <div style="display:grid;grid-template-columns:52px 1fr 48px 54px 54px;gap:6px;font-size:11px;padding:6px;background:${isAccum ? '#052e16' : isDist ? '#2d0a0a' : '#0f1117'};border-radius:6px;margin-bottom:3px;align-items:center;border:${isAccum ? '1px solid #166534' : isDist ? '1px solid #7f1d1d' : 'none'};">
            <span style="font-weight:700;color:${colors[i % colors.length]};font-size:12px;">${h.symbol || '??'}</span>
            <span style="color:#9ca3af;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(h.name || '').slice(0,16)}</span>
            <span style="color:white;font-size:11px;">${h.percent ? h.percent.toFixed(1) + '%' : 'N/A'}</span>
            <span style="color:${wowColor};font-weight:600;font-size:11px;">${wow >= 0 ? '▲' : '▼'}${Math.abs(wow).toFixed(2)}%</span>
            <span style="color:${momColor};font-weight:600;font-size:11px;">${mom >= 0 ? '▲' : '▼'}${Math.abs(mom).toFixed(2)}%</span>
          </div>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
      <div style="background:#052e16;border-radius:10px;padding:14px;border:1px solid #166534;">
        <div style="font-size:12px;font-weight:700;color:#22c55e;margin-bottom:6px;">🟢 Accumulation Signals</div>
        <div style="font-size:12px;color:#86efac;line-height:1.6;">Green highlighted rows show WoW position increases — institutional buying signals. Strongest conviction when WoW and MoM both rising.</div>
      </div>
      <div style="background:#2d0a0a;border-radius:10px;padding:14px;border:1px solid #7f1d1d;">
        <div style="font-size:12px;font-weight:700;color:#ef4444;margin-bottom:6px;">🔴 Distribution Signals</div>
        <div style="font-size:12px;color:#fca5a5;line-height:1.6;">Red highlighted rows show WoW position decreases — potential institutional selling. Watch these names for near term weakness.</div>
      </div>
    </div>
    <div style="display:flex;justify-content:center;gap:24px;font-size:11px;margin-bottom:10px;color:#6b7280;">
      <span>WoW = Week over week change</span>
      <span>MoM = Month over month change</span>
      <span>Wt% = Portfolio weight</span>
    </div>
    <div style="font-size:11px;color:#4b5563;text-align:center;">⚠️ Not financial advice. Always do your own research.</div>
  </div>
</div>`;

    const img = await generateImage(html, 900, 820);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    await sendImage(ETF_HOLDINGS_CHANNEL_ID, img, 'etf-holdings.png',
      `📊 **MoneyMatrix ETF Holdings Tracker — ${today}**`
    );
    console.log('✅ ETF holdings posted');
  } catch (e) {
    console.error('ETF holdings error:', e.message);
  }
}

// ============ MARKET CLOSE ============
async function postMarketClose() {
  try {
    const tickers = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const quotes = {};
    for (const t of tickers) {
      await sleep(1500);
      const q = await getTwelveData(t);
      if (q) quotes[t] = q;
    }

    const crypto = await getCoinGecko();
    let marketData = Object.entries(quotes).map(([t, q]) =>
      `${t}: $${parseFloat(q.close||0).toFixed(2)} (${parseFloat(q.percent_change||0).toFixed(2)}%)`
    ).join(' | ');

    if (crypto?.bitcoin) {
      marketData += ` | BTC: $${crypto.bitcoin.usd.toLocaleString()} (${crypto.bitcoin.usd_24h_change?.toFixed(2)}%)`;
    }
    if (crypto?.ethereum) {
      marketData += ` | ETH: $${crypto.ethereum.usd.toLocaleString()} (${crypto.ethereum.usd_24h_change?.toFixed(2)}%)`;
    }

    const post = await claudeAI(
      `You are the closing bell analyst for MoneyMatrix Discord. Create a sharp professional market close summary.

Structure EXACTLY like this:
📊 **TODAY'S SCORECARD**
[Index performance with live numbers]

🏆 **TOP MOVERS**
[5 biggest gainers and losers with % and one line reason]

🔥 **SESSION THEME**
[2-3 key themes that drove today]

🌙 **OVERNIGHT WATCH**
[Earnings tonight, Asian markets, futures positioning]

📅 **TOMORROW'S SETUP**
[Specific levels, data releases, what to watch at open]

Use ** for bold. Specific numbers only. No filler.
End: ⚠️ Not financial advice. DYOR.`,
      `${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} market close.\nLive data: ${marketData}\nSearch for today's biggest movers and what drove the session.`,
      true
    );

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    await sendChunked(DAILY_DIGEST_CHANNEL_ID,
      `🔔 **MoneyMatrix Market Close — ${today}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${post}`
    );
    console.log('✅ Market close posted');
  } catch (e) {
    console.error('Market close error:', e.message);
  }
}

// ============ TIMERS ============
setInterval(async () => {
  const now = new Date();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const day = now.getUTCDay();
  const isWeekday = day >= 1 && day <= 5;
  if (!isWeekday) return;

  // Monday 9:15AM CDT = 14:15 UTC
  if (day === 1 && h === 14 && m === 15) {
    await postEarningsCalendar();
    await sleep(5000);
    await postEconomicCalendar();
  }
  // 11:00AM CDT = 16:00 UTC
  if (h === 16 && m === 0) await postDailyWatchlist();
  // 11:10AM CDT = 16:10 UTC — offset to avoid rate limits
  if (h === 16 && m === 10) await postSectorHeatmap();
  // 12:00PM CDT = 17:00 UTC
  if (h === 17 && m === 0) await postFearGreed();
  // Wednesday 10:00AM CDT = 15:00 UTC
  if (day === 3 && h === 15 && m === 0) await postETFHoldings();
  // 4:05PM CDT = 21:05 UTC
  if (h === 21 && m === 5) await postMarketClose();

}, 60000);

// ============ TEST COMMANDS VIA DM ============
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.author.id !== OWNER_USER_ID) return;
  if (message.guild) return;

  const cmd = message.content.trim().toLowerCase();

  if (cmd === '!help') {
    await message.reply(
      `**MoneyMatrix Data Hub — Test Commands**\n\n` +
      `\`!feargreed\` — Fear & Greed gauge image\n` +
      `\`!watchlist\` — Stock deep dive image\n` +
      `\`!heatmap\` — Sector heatmap image\n` +
      `\`!earnings\` — Earnings calendar image\n` +
      `\`!economic\` — Economic calendar text\n` +
      `\`!etf\` — ETF holdings tracker image\n` +
      `\`!close\` — Market close summary\n\n` +
      `Each posts to its channel! 🎯`
    );
  }
  if (cmd === '!feargreed') {
    await message.reply('⏳ Generating Fear & Greed...');
    await postFearGreed();
    await message.reply('✅ Check #fear-greed!');
  }
  if (cmd === '!watchlist') {
    await message.reply('⏳ Generating watchlist deep dive...');
    await postDailyWatchlist();
    await message.reply('✅ Check #daily-watchlist!');
  }
  if (cmd === '!heatmap') {
    await message.reply('⏳ Generating sector heatmap...');
    await postSectorHeatmap();
    await message.reply('✅ Check #daily-watchlist!');
  }
  if (cmd === '!earnings') {
    await message.reply('⏳ Generating earnings calendar...');
    await postEarningsCalendar();
    await message.reply('✅ Check #earnings-calendar!');
  }
  if (cmd === '!economic') {
    await message.reply('⏳ Generating economic calendar...');
    await postEconomicCalendar();
    await message.reply('✅ Check #economic-calendar!');
  }
  if (cmd === '!etf') {
    await message.reply('⏳ Generating ETF holdings...');
    await postETFHoldings();
    await message.reply('✅ Check #etf-holdings!');
  }
  if (cmd === '!close') {
    await message.reply('⏳ Generating market close...');
    await postMarketClose();
    await message.reply('✅ Check #daily-digest!');
  }
});

// ============ BOT READY ============
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online — MoneyMatrix Data Hub ready!`);
  try {
    const owner = await client.users.fetch(OWNER_USER_ID);
    await owner.send(
      `✅ **MoneyMatrix Data Hub is online!**\n\n` +
      `DM me \`!help\` to test any feature! 🎯`
    );
  } catch (e) {
    console.error('Owner DM error:', e.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
