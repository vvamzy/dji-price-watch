/**
 * Diagnostic: how well does each Amazon.in fetch strategy survive
 * datacenter IPs? Prints a success matrix. Run from GitHub Actions where
 * the egress IP matches the real workflow.
 */
const ASINS = ['B0C783YNW7', 'B0C783J9WC', 'B0DYD56G2Y'];

const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const BROWSER_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-IN,en-GB;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

function priceFrom(html) {
  const pats = [
    /"priceAmount"\s*:\s*([\d.]+)/,
    /class="a-price-whole">([\d,]+)/,
    /id="priceblock_ourprice"[^>]*>\s*₹\s?([\d,]+)/,
    /class="a-offscreen">₹\s?([\d,]+)/,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}

function verdict(status, html) {
  if (status !== 200) return `HTTP ${status}`;
  if (/Enter the characters you see below|api-services-support@amazon|Robot Check/i.test(html)) return 'CAPTCHA';
  if (html.length < 5000) return `SHORT ${html.length}`;
  const p = priceFrom(html);
  return p ? `OK ₹${p}` : 'NO PRICE';
}

async function attempt(name, asin, url, headers, cookieJar = null) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA_DESKTOP, ...BROWSER_HEADERS, ...headers, ...(cookieJar ? { cookie: cookieJar } : {}) },
      signal: AbortSignal.timeout(25000),
    });
    const html = await res.text();
    return { name, asin, result: verdict(res.status, html), bytes: html.length };
  } catch (err) {
    return { name, asin, result: `ERR ${err.message.slice(0, 40)}`, bytes: 0 };
  }
}

async function warmCookies(asin) {
  try {
    const res = await fetch(`https://www.amazon.in/dp/${asin}`, {
      headers: { 'user-agent': UA_DESKTOP, ...BROWSER_HEADERS },
      signal: AbortSignal.timeout(25000),
    });
    await res.text();
    const cookies = res.headers.getSetCookie?.() || [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  } catch {
    return '';
  }
}

const results = [];

for (const asin of ASINS) {
  const cookieJar = await warmCookies(asin);
  results.push({ name: 'cookie-warm', asin, result: cookieJar ? `cookies=${cookieJar.split(';').length}` : 'no cookies', bytes: 0 });
  results.push(await attempt('plain-dp', asin, `https://www.amazon.in/dp/${asin}`, {}));
  results.push(await attempt('dp-warm', asin, `https://www.amazon.in/dp/${asin}`, {}, cookieJar));
  results.push(await attempt('dp-sponsor', asin, `https://www.amazon.in/dp/${asin}?th=1&psc=1`, {}));
  results.push(await attempt('mobile-aw', asin, `https://www.amazon.in/gp/aw/d/${asin}`, { 'user-agent': UA_MOBILE, 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"' }));
  results.push(await attempt('gp-product', asin, `https://www.amazon.in/gp/product/${asin}`, {}));
  results.push(await attempt('ajax-offers', asin, `https://www.amazon.in/gp/product/ajax/ref=dp_aod_NEW_mbc?asin=${asin}&pc=dp`, { 'x-requested-with': 'XMLHttpRequest' }));
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('strategy', 14) + pad('asin', 12) + pad('result', 26) + 'bytes');
for (const r of results) {
  console.log(pad(r.name, 14) + pad(r.asin, 12) + pad(r.result, 26) + r.bytes);
}

const byStrategy = {};
for (const r of results) {
  byStrategy[r.name] ||= { ok: 0, total: 0 };
  byStrategy[r.name].total++;
  if (r.result.startsWith('OK')) byStrategy[r.name].ok++;
}
console.log('\n--- success rate ---');
for (const [k, v] of Object.entries(byStrategy)) console.log(`${pad(k, 14)} ${v.ok}/${v.total}`);
