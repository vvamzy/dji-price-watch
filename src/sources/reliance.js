import { fetchText } from '../lib/http.js';
import { extractProduct, isOutOfStock } from '../lib/jsonld.js';

/**
 * Reliance Digital (reliancedigital.in) publishes a clean schema.org Product
 * block with the selling price and availability, so no browser is needed.
 *
 * Bank offers are not exposed as structured data on this store, so none are
 * reported rather than guessing at a percentage teaser.
 */
export const id = 'reliance';

export async function fetchPrice(offer) {
  const body = await fetchText(offer.url, { retries: 2 });

  if (isBlocked(body)) throw new Error('Reliance Digital returned a bot check page');

  const product = extractProduct(body);
  if (!product || !product.price) throw new Error('no price found on Reliance Digital page');

  return {
    price: product.price,
    currency: product.currency || 'INR',
    available: product.available,
    compareAt: null,
    bankOffers: [],
    bestBankDiscount: 0,
    title: product.name,
    variantTitle: null,
    productUrl: offer.url.split('?')[0],
  };
}

export function isBlocked(html) {
  if (html.length < 40_000) return true;
  return /<title>\s*Access Denied|are you a robot|verify you are human/i.test(html);
}

export { isOutOfStock };
