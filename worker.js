// Gold Analyzer (lite) - یک فایل، بدون نصب کتابخانه
// KV رایگان: ۱۰۰۰ نوشتن در روز => فقط یک کلید ("state") و هر ۵ دقیقه یک بار می‌نویسیم (~۲۸۸/روز)

/* ---------- اندیکاتورها ---------- */
const sma = (v, p) => { const o = Array(v.length).fill(null); let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };

function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let n = 0, sum = 0, prev = null;
  for (let i = 0; i < v.length; i++) { if (v[i] == null) continue;
    if (prev === null) { n++; sum += v[i]; if (n === p) { prev = sum / p; o[i] = prev; } }
    else { prev = v[i] * k + prev * (1 - k); o[i] = prev; } } return o; }

function rsi(c, p = 14) { const o = Array(c.length).fill(null); if (c.length <= p) return o; let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; } g /= p; l /= p;
  o[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1];
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p; l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; }

function macdHist(c) { const f = ema(c, 12), s = ema(c, 26);
  const line = c.map((_, i) => f[i] != null && s[i] != null ? f[i] - s[i] : null);
  const sig = ema(line, 9); return line.map((x, i) => x != null && sig[i] != null ? x - sig[i] : null); }

function atr(cs, p = 14) { const o = Array(cs.length).fill(null); if (cs.length <= p) return o;
  const tr = i => Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i - 1].c), Math.abs(cs[i].l - cs[i - 1].c));
  let a = 0; for (let i = 1; i <= p; i++) a += tr(i); a /= p; o[p] = a;
  for (let i = p + 1; i < cs.length; i++) { a = (a * (p - 1) + tr(i)) / p; o[i] = a; } return o; }

function bb(v, p = 20, m = 2) { const mid = sma(v, p), up = [], lo = [];
  for (let i = 0; i < v.length; i++) { if (mid[i] == null) { up.push(null); lo.push(null); continue; }
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / p); up.push(mid[i] + m * sd); lo.push(mid[i] - m * sd); }
  return { mid, up, lo }; }

const last = a => a[a.length - 1];

/* ---------- دریافت داده (Twelve Data) ---------- */
async function td(env, interval, n) {
  if (!env.TWELVE_API_KEY) throw new Error("TWELVE_API_KEY تنظیم نشده");
  const u = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${n}&timezone=UTC&apikey=${env.TWELVE_API_KEY}`;
  const j = await (await fetch(u)).json();
  if (j.status === "error" || !j.values) throw new Error(j.message || "پاسخ نامعتبر");
  return j.values.map(x => {
    const d = x.datetime.length === 10 ? x.datetime + "T00:00:00Z" : x.datetime.replace(" ", "T") + "Z";
    return { t: Date.parse(d), o: +x.open, h: +x.high, l: +x.low, c: +x.close };
  }).reverse(); // قدیمی -> جدید
}

/* ---------- موتور سیگنال ---------- */
function pivots(c, k = 2) { const hi = [], lo = [];
  for (let i = k; i < c.length - k; i++) { let H = true, L = true;
    for (let j = 1; j <= k; j++) {
      if (c[i].h <= c[i - j].h || c[i].h <= c[i + j].h) H = false;
      if (c[i].l >= c[i - j].l || c[i].l >= c[i + j].l) L = false; }
    if (H) hi.push(c[i].h); if (L) lo.push(c[i].l); }
  return { hi, lo }; }

const NO = (bias, risk, why, now) => ({ side: "NONE", label: "NO TRADE – WAITING FOR ALIGNMENT", bias, highEventRisk: risk, confidence: 0, reasons: why, ts: now });

function makeSignal({ c5, c15, c1d, eventRisk, now }) {
  // لایه ۱: روند روزانه
  const d = c1d.map(x => x.c), s50 = last(sma(d, 50)), s200 = last(sma(d, 200)), price = last(d);
  let bias = "NEUTRAL";
  if (s50 && s200) { if (price > s50 && s50 > s200) bias = "BULLISH"; else if (price < s50 && s50 < s200) bias = "BEARISH"; }
  if (bias === "NEUTRAL") return NO(bias, eventRisk, [s200 ? "روند روزانه خنثی" : "داده روزانه کافی نیست (۲۰۰ کندل لازم است)"], now);

  // لایه ۲: تأیید 15m
  const r15 = last(rsi(c15.map(x => x.c))), h15 = last(macdHist(c15.map(x => x.c)));
  if (r15 == null || h15 == null) return NO(bias, eventRisk, ["اندیکاتور 15m آماده نیست"], now);
  const long = bias === "BULLISH" && r15 >= 40 && r15 <= 70 && h15 > 0;
  const short = bias === "BEARISH" && r15 >= 30 && r15 <= 60 && h15 < 0;
  if (!long && !short) return NO(bias, eventRisk, [`15m تأیید نمی‌کند (RSI ${r15.toFixed(1)}, MACD hist ${h15.toFixed(3)})`], now);
  const reasons = [`Daily ${bias}`, `15m RSI ${r15.toFixed(1)}, MACD hist ${h15.toFixed(3)}`];

  // لایه ۳: ورود 5m
  const cl5 = c5.map(x => x.c), s20 = last(sma(cl5, 20)), mid = last(bb(cl5).mid), a = last(atr(c5)), k = last(c5);
  if (s20 == null || a == null) return NO(bias, eventRisk, ["اندیکاتور 5m آماده نیست"], now);
  const body = Math.abs(k.c - k.o) || 1e-9, lw = Math.min(k.o, k.c) - k.l, uw = k.h - Math.max(k.o, k.c);
  const touch = v => v != null && k.l <= v && k.h >= v;
  const rej = long ? (k.c > k.o && lw >= body) : (k.c < k.o && uw >= body);
  if (!(touch(s20) || touch(mid)) || !rej) return NO(bias, eventRisk, ["تأیید شده، ولی هنوز پولبک + کندل برگشتی در 5m نیست"], now);
  reasons.push("5m: پولبک به SMA20/میانه بولینگر + کندل برگشتی");

  const entry = k.c, rec = c5.slice(-10);
  const sl = long ? Math.max(Math.min(...rec.map(x => x.l)), entry - 1.5 * a)   // «تنگ‌تر» = نزدیک‌تر به ورود
                  : Math.min(Math.max(...rec.map(x => x.h)), entry + 1.5 * a);
  const risk = Math.abs(entry - sl); if (risk <= 0) return NO(bias, eventRisk, ["فاصله ریسک نامعتبر"], now);
  let tp = long ? entry + 2 * risk : entry - 2 * risk;
  const { hi, lo } = pivots(c15.slice(-96));
  if (long) { const r = hi.filter(x => x > entry).sort((x, y) => x - y)[0]; if (r && tp > r) { tp = r - 0.1 * a; reasons.push("TP قبل از مقاومت 15m کوتاه شد"); } }
  else { const s = lo.filter(x => x < entry).sort((x, y) => y - x)[0]; if (s && tp < s) { tp = s + 0.1 * a; reasons.push("TP قبل از حمایت 15m کوتاه شد"); } }
  const rr = Math.abs(tp - entry) / risk;
  if (rr < 1) return NO(bias, eventRisk, [`ریسک به ریوارد ${rr.toFixed(2)} (کمتر از ۱)`], now);

  let conf = 60 + Math.min(15, Math.abs(r15 - 50) / 2) + Math.min(15, (rr - 1) * 7.5);
  if (eventRisk) { conf -= 25; reasons.push("HIGH EVENT RISK: رویداد مهم دلار کمتر از ۲۴ ساعت دیگر"); }
  const R = x => Math.round(x * 100) / 100;
  return { side: long ? "LONG" : "SHORT", label: long ? "LONG" : "SHORT", bias, highEventRisk: eventRisk,
    entry: R(entry), sl: R(sl), tp: R(tp), rr: R(rr), confidence: Math.max(0, Math.min(100, Math.round(conf))), reasons, ts: now };
}

/* ---------- نمودار ---------- */
function chartData(c, n = 120) {
  const cl = c.map(x => x.c), b = bb(cl), s = sma(cl, 20), from = Math.max(0, c.length - n);
  const cut = a => a.slice(from).map(v => v == null ? null : Math.round(v * 100) / 100);
  return { c: c.slice(from).map(x => [Math.floor(x.t / 1000), x.o, x.h, x.l, x.c]), sma: cut(s), bu: cut(b.up), bl: cut(b.lo) };
}

/* ---------- Cron ---------- */
async function run(env, when) {
  const minute = new Date(when).getUTCMinutes(), now = Date.now();
  const prev = (await env.GOLD_KV.get("state", "json")) || {};
  const errors = []; let { c5, c15, c1d } = prev;
  try { c5 = await td(env, "5min", 200); } catch (e) { errors.push("5m: " + e.message); }
  if (!c15 || minute % 15 === 0) { try { c15 = await td(env, "15min", 200); } catch (e) { errors.push("15m: " + e.message); } }
  if (!c1d || minute === 0)      { try { c1d = await td(env, "1day", 260); }  catch (e) { errors.push("1d: " + e.message); } }

  const state = { updatedAt: now, errors, c5, c15, c1d, signal: prev.signal, charts: prev.charts };
  if (c5 && c15 && c1d) {
    const ev = (env.HIGH_EVENTS || "").split(",").map(s => Date.parse(s.trim())).filter(Boolean);
    const eventRisk = ev.some(t => t >= now && t - now <= 24 * 3600e3);
    state.signal = makeSignal({ c5, c15, c1d, eventRisk, now });
    state.charts = { "5m": chartData(c5), "15m": chartData(c15) };
  }
  await env.GOLD_KV.put("state", JSON.stringify(state));
}

/* ---------- ورودی Worker ---------- */
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/api/state") {
      const s = (await env.GOLD_KV.get("state", "json")) || null;
      const out = s ? { updatedAt: s.updatedAt, errors: s.errors, signal: s.signal, charts: s.charts } : { empty: true };
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env, event.scheduledTime)); },
};
