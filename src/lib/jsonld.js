/**
 * Shared schema.org Product extraction for retailers that publish JSON-LD.
 *
 * Reliance Digital ships valid JSON, Croma ships JSON that is *almost* valid
 * (which is why a plain JSON.parse over every block is not enough). Both put
 * the selling price in the first Offer, so a tolerant regex fallback is used
 * when the block will not parse.
 */
export function extractProduct(html) {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];

  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue;
    }

    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const found = fromNode(node);
      if (found) return found;
    }
  }

  // Tolerant fallback for malformed-but-readable blocks (Croma).
  const priceMatch = html.match(/"@type"\s*:\s*"Offer"[\s\S]{0,500}?"price"\s*:\s*"([\d.]+)"/);
  const nameMatch = html.match(/"@type"\s*:\s*"Product"\s*,\s*"name"\s*:\s*"([^"]{5,250})"/);
  if (priceMatch) {
    return {
      name: nameMatch ? nameMatch[1] : null,
      price: Math.round(Number(priceMatch[1])),
      available: !isOutOfStock(html),
      currency: 'INR',
    };
  }

  return null;
}

function fromNode(node) {
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = fromNode(child);
      if (found) return found;
    }
    return null;
  }

  const type = node['@type'];
  const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  if (isProduct && node.offers) {
    const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
    const priced = offers.find((o) => o && (o.price != null || o.lowPrice != null));
    if (priced) {
      const price = Math.round(Number(priced.price ?? priced.lowPrice));
      if (Number.isFinite(price) && price > 0) {
        return {
          name: node.name || null,
          price,
          available: !/OutOfStock/i.test(priced.availability || ''),
          currency: priced.priceCurrency || 'INR',
        };
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = fromNode(value);
      if (found) return found;
    }
  }
  return null;
}

export function isOutOfStock(html) {
  return /Currently unavailable|Out of Stock|Sold Out|OutOfStock/i.test(html);
}
