import { fetchText } from '../lib/http.js';

/**
 * Amazon.in is the fragile source: it frequently serves a captcha page to
 * datacenter IPs such as GitHub-hosted runners. Offers using this source are
 * marked `optional: true` in config, so failures are logged but never raised
 * as a tracking-health problem.
 */
export const id = 'amazon';

export async function fetchPrice(offer) {
  const body = await fetchText(offer.url, { retries: 1, timeoutMs: 25000 });

  if (isBlocked(body)) {
    throw new Error('Amazon returned a captcha/bot page');
  }

  const price = extractPrice(body);
  if (!price) {
    if (/Currently unavailable|out of stock/i.test(body)) {
      return {
        price: null,
        currency: 'INR',
        available: false,
        compareAt: null,
        title: extractTitle(body),
        variantTitle: null,
        productUrl: offer.url.split('?')[0],
      };
    }
    throw new Error('no price found on Amazon page');
  }

  return {
    price,
    currency: 'INR',
    available: true,
    compareAt: null,
    title: extractTitle(body),
    variantTitle: null,
    productUrl: offer.url.split('?')[0],
  };
}

export function isBlocked(html) {
  if (html.length > 200000) return false;
  return /Enter the characters you see below|api-services-support@amazon|Robot Check|automated access/i.test(html);
}

export function extractPrice(html) {
  const patterns = [
    /"priceAmount"\s*:\s*([\d.]+)/,
    /id="corePrice_feature_div"[\s\S]{0,4000}?class="a-offscreen">₹\s?([\d,]+(?:\.\d+)?)/,
    /class="a-price-whole">([\d,]+)/,
    /id="priceblock_ourprice"[^>]*>₹\s?([\d,]+(?:\.\d+)?)/,
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
  const m = html.match(/id="productTitle"[^>]*>([\s\S]{1,300}?)<\/span>/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}
