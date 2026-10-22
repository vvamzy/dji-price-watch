import { fetchText } from '../lib/http.js';

/**
 * Flipkart embeds a schema.org Product block in the page. That gives us the
 * listed selling price and availability, and deliberately ignores the MRP and
 * the "with bank offer" teaser in the headline price.
 *
 * Bank/card offers are parsed separately from the `bankOfferGrid` widget, so a
 * bigger card discount is reported as its own event instead of being confused
 * with a change in the listing price.
 */
export const id = 'flipkart';

export async function fetchPrice(offer) {
  const body = await fetchText(offer.url, { retries: 2 });

  if (isBlocked(body)) {
    throw new Error('Flipkart returned a bot check page');
  }

  const bankOffers = parseBankOffers(body);
  const bestBankDiscount = bankOffers.length ? bankOffers[0].discount : 0;

  const product = parseJsonLd(body);
  if (product) {
    const price = Math.round(Number(product.price));
    if (Number.isFinite(price) && price > 0) {
      return {
        price,
        currency: 'INR',
        available: /InStock/i.test(product.availability || ''),
        compareAt: null,
        bankOffers,
        bestBankDiscount,
        title: product.name,
        variantTitle: null,
        productUrl: offer.url.split('?')[0],
      };
    }
  }

  // Fallback: the price also appears as `"finalPrice":22990` in embedded state.
  const fallback = body.match(/"finalPrice":(\d{4,7})/);
  if (fallback) {
    return {
      price: Number(fallback[1]),
      currency: 'INR',
      available: !/Sold Out|Out of Stock/i.test(body),
      compareAt: null,
      bankOffers,
      bestBankDiscount,
      title: null,
      variantTitle: null,
      productUrl: offer.url.split('?')[0],
    };
  }

  throw new Error('no price found on Flipkart page');
}

export function isBlocked(html) {
  if (html.length > 400000) return false; // real product pages are ~1.7MB
  return /Access Denied|Please verify|bot detection|Request Blocked/i.test(html);
}

export function parseJsonLd(html) {
  const blocks = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue;
    }

    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!node || (node['@type'] !== 'Product' && !node.offers)) continue;
      const offers = node.offers ? (Array.isArray(node.offers) ? node.offers : [node.offers]) : [];
      const priced = offers.find((o) => o && (o.price || o.lowPrice));
      if (!priced) continue;

      return {
        name: node.name || null,
        price: priced.price || priced.lowPrice,
        availability: priced.availability || '',
      };
    }
  }
  return null;
}

/**
 * Card/bank offers look like:
 *   "offerTitle":"HDFC" ... "discountedPriceText":"₹1,250 off"
 * Dedupe by bank, keeping the largest discount you can actually get.
 */
export function parseBankOffers(html) {
  const re = /"offerTitle":"([^"]{1,60})"[\s\S]{0,600}?"discountedPriceText":"₹\s?([\d,]+)\s*off"/g;
  const best = new Map();
  let m;

  while ((m = re.exec(html))) {
    const bank = m[1].trim();
    const discount = Number(m[2].replace(/,/g, ''));
    if (!bank || !Number.isFinite(discount) || discount <= 0) continue;

    const key = bank.toLowerCase();
    const current = best.get(key);
    if (!current || current.discount < discount) best.set(key, { bank, discount });
  }

  return [...best.values()].sort((a, b) => b.discount - a.discount || a.bank.localeCompare(b.bank));
}
