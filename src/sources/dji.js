import { fetchText, normalise } from '../lib/http.js';

/**
 * DJI India (djiindiashop.com) is a Shopify store, so we read its public
 * product JSON instead of scraping HTML. Prices are integers in paise.
 *
 * Accepts either `/products/<handle>.json` or `/products/<handle>.js`
 * and always requests the `.js` variant, which includes `available`.
 */
export const id = 'dji';

export async function fetchPrice(offer) {
  const url = normaliseJsUrl(offer.url);
  const body = await fetchText(url, { retries: 2 });
  const product = parseShopifyProduct(body);

  const variants = product.variants || [];
  if (variants.length === 0) throw new Error('no variants in Shopify payload');

  let variant;
  if (offer.variant) {
    const want = normalise(offer.variant);
    variant = variants.find((v) => normalise(v.title) === want);
    if (!variant) {
      const seen = variants.map((v) => v.title).join(', ');
      throw new Error(`variant "${offer.variant}" not found (have: ${seen})`);
    }
  } else {
    variant = variants[0];
  }

  const price = toRupees(variant.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('unparseable price');

  return {
    price,
    currency: 'INR',
    available: variant.available !== false,
    compareAt: toRupees(variant.compare_at_price) || null,
    title: product.title,
    variantTitle: variant.title === 'Default Title' ? null : variant.title,
    productUrl: url.replace(/\.js$/, ''),
  };
}

export function normaliseJsUrl(raw) {
  const u = new URL(raw);
  u.search = '';
  u.pathname = u.pathname.replace(/\.(json|js)$/, '') + '.js';
  return u.toString();
}

export function parseShopifyProduct(body) {
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('Shopify endpoint did not return JSON');
  }
  const product = json.product || json;
  if (!product || !Array.isArray(product.variants)) {
    throw new Error('unexpected Shopify payload shape');
  }
  return product;
}

export function toRupees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Shopify .js returns minor units (paise). Guard against already-decimal prices.
  return n > 100000 ? Math.round(n / 100) : Math.round(n);
}
