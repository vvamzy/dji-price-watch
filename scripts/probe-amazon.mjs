/**
 * Diagnostic v2: reliability of the Amazon mobile page and how to parse it.
 * Also hunts sibling ASINs from the variant dimension map.
 */
const ASINS = ['B0C783YNW7', 'B0C783J9WC', 'B0DYD56G2Y'];

const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const HEADERS = {
  'user-agent': UA_MOBILE,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-IN,en-GB;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
};

const PATTERNS = {
  priceAmount: /"priceAmount"\s*:\s*([\d.]+)/,
  aPriceWhole: /class="a-price-whole">([\d,]+)/,
  offscreen: /class="a-offscreen">\s*₹\s?([\d,]+)/,
  priceToPay: /id="priceblock_dealprice"[^>]*>\s*₹\s?([\d,]+)/,
  corePrice: /id="corePrice_feature_div"[\s\S]{0,3000}?₹\s?([\d,]+)/,
  dataPrice: /data-a-color="price"[\s\S]{0,200}?₹\s?([\d,]+)/,
};

async function get(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: HEADERS,
    signal: AbortSignal.timeout(25000),
  });
  const html = await res.text();
  return { status: res.status, html };
}

function analyse(html) {
  const blocked = /Enter the characters you see below|api-services-support@amazon|Robot Check/i.test(html);
  const hits = {};
  for (const [name, re] of Object.entries(PATTERNS)) {
    const m = html.match(re);
    if (m) hits[name] = m[1];
  }
  const title = (html.match(/id="title"[^>]*>([\s\S]{0,400}?)<\/h1>/) || [])[1];
  const alt = (html.match(/id="productTitle"[^>]*>([\s\S]{0,300}?)<\/span>/) || [])[1];
  const oos = /Currently unavailable|We don't know when or if this item will be back/i.test(html);
  const dims = html.match(/"dimensionValuesDisplayData"\s*:\s*(\{[\s\S]{0,2000}?\})\s*,\s*"/);
  return {
    blocked,
    bytes: html.length,
    hits,
    title: (title || alt || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    oos,
    dims: dims ? dims[1].slice(0, 800) : null,
  };
}

for (const asin of ASINS) {
  console.log(`\n##### ${asin}`);
  for (let i = 1; i <= 3; i++) {
    try {
      const { status, html } = await get(`https://www.amazon.in/gp/aw/d/${asin}`);
      const a = analyse(html);
      console.log(
        ` try${i}: status=${status} bytes=${a.bytes} blocked=${a.blocked} oos=${a.oos} title="${a.title}"`
      );
      console.log(`        patterns:`, JSON.stringify(a.hits));
      if (a.dims) console.log(`        variants: ${a.dims}`);
    } catch (err) {
      console.log(` try${i}: ERR ${err.message.slice(0, 60)}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}
