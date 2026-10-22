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

      if (price == null) {
        // A full product page with no price is genuinely unavailable, not a
        // transport failure — report it instead of burning more attempts.
        return {
          price: null,
          currency: 'INR',
          available: false,
          compareAt: null,
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
