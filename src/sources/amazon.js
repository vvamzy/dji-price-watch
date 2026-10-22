import { fetchText } from '../lib/http.js';

/**
 * Amazon.in scrapes badly from datacenter IPs — but the *mobile* product page
 * (/gp/aw/d/ASIN) sits behind a much weaker check than the desktop page.
 *
 * Measured from GitHub-hosted runners: desktop /dp/ 0/3, mobile /gp/aw/d/ 5/9
 * per attempt. With five attempts the failure rate drops below 1%, so the
 * retry budget here is deliberate, not cargo cult.
 *
 * The price comes from the embedded `"priceAmount"` JSON. Do NOT fall back to
 * `.a-offscreen` — on these pages that element holds the MRP (₹44,990),
 * which would look like a permanent price increase.
 */
export const id = 'amazon';

const MAX_ATTEMPTS = 5;

const MOBILE_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function asinFromUrl(url) {
  const m = String(url).match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/);
  if (!m) throw new Error(`no ASIN found in ${url}`);
  return m[1];
}

export async function fetchPrice(offer) {
  const asin = asinFromUrl(offer.url);
  const url = `https://www.amazon.in/gp/aw/d/${asin}`;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const body = await fetchText(url, { retries: 0, timeoutMs: 25000, headers: MOBILE_HEADERS });

      // Bot pages are small (~3.8 KB) and contain no product data.
      if (body.length < 50000) throw new Error('Amazon bot-check page');

      const price = extractPrice(body);
      const { bankOffers, bestBankDiscount } = extractOffers(body);

      if (price == null) {
        // A full product page with no price is genuinely unavailable, not a
        // transport failure — report it instead of burning more attempts.
        return {
          price: null,
          currency: 'INR',
          available: false,
          compareAt: null,
          bankOffers,
          bestBankDiscount,
          title: extractTitle(body),
          variantTitle: null,
          productUrl: `https://www.amazon.in/dp/${asin}`,
        };
      }

      return {
        price,
        currency: 'INR',
        available: true,
        compareAt: null,
        bankOffers,
        bestBankDiscount,
        title: extractTitle(body),
        variantTitle: null,
        productUrl: `https://www.amazon.in/dp/${asin}`,
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await sleep(600 + Math.random() * 1200);
    }
  }

  throw new Error(`${lastError.message} (after ${MAX_ATTEMPTS} attempts)`);
}

export function extractPrice(html) {
  const patterns = [
    /"priceAmount"\s*:\s*([\d.]+)/,
    /class="a-price-whole">([\d,]+)/,
    /id="priceblock_dealprice"[^>]*>\s*₹\s?([\d,]+)/,
    /id="corePrice_feature_div"[\s\S]{0,3000}?₹\s?([\d,]+)/,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const value = Math.round(Number(m[1].replace(/,/g, '')));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function extractTitle(html) {
  const m =
    html.match(/id="title"[^>]*>([\s\S]{0,400}?)<\/h1>/) ||
    html.match(/id="productTitle"[^>]*>([\s\S]{0,300}?)<\/span>/);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * Immediate payment offers from the buybox ("smx") widget.
 *
 * Amazon does not place a bank-offer list in the HTML the way Flipkart does.
 * What it does embed is the best *full-payment* card and its guaranteed
 * discount, shaped like:
 *
 *   "Amazon Pay ICICI Bank Credit Card" ... "-₹658" ... "Plus ₹670 cashback"
 *
 * Everything else on the offers screen is EMI, which is not a discount, so it
 * is deliberately not treated as one. Cashback is reported as a note but never
 * subtracted from the effective price, because it is not applied at checkout.
 */
export function extractOffers(html) {
  const best = new Map();
  const re =
    /<span class="a-size-small">\s*([^<]{3,70}?)\s*<\/span>\s*<\/div>\s*<div class="a-section cardification-combo-header-money">\s*-?₹\s?([\d,]+)\s*<\/div>([\s\S]{0,1200}?)(?=<div class="a-section cardification-combo-header-money|<\/li>|<\/ol>|$)/g;

  let m;
  while ((m = re.exec(html))) {
    const bank = m[1].trim();
    const discount = Number(m[2].replace(/,/g, ''));
    if (!bank || !Number.isFinite(discount) || discount <= 0) continue;
    if (/^(plus\b|emi\b)/i.test(bank)) continue;

    const cash = m[3].match(/Plus\s*₹\s?([\d,]+)\s*cashback/i);
    const note = cash ? `+ ₹${Number(cash[1].replace(/,/g, '')).toLocaleString('en-IN')} cashback` : '';

    const key = bank.toLowerCase();
    const current = best.get(key);
    if (!current || current.discount < discount) best.set(key, { bank, discount, note });
  }

  const bankOffers = [...best.values()].sort((a, b) => b.discount - a.discount || a.bank.localeCompare(b.bank));
  return { bankOffers, bestBankDiscount: bankOffers.length ? bankOffers[0].discount : 0 };
}
