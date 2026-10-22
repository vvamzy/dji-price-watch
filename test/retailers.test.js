import test from 'node:test';
import assert from 'node:assert/strict';

import { extractProduct, isOutOfStock } from '../src/lib/jsonld.js';
import { isBlocked as relianceBlocked } from '../src/sources/reliance.js';
import { isBlocked as cromaBlocked } from '../src/sources/croma.js';

const relianceHtml = `
<html><head>
<script type="application/ld+json">
{ "@context": "http://schema.org", "@type": "Product", "name": "DJI Osmo Action 4 Standard Combo Action Camera, Black",
  "offers": { "@type": "Offer", "priceCurrency": "INR", "price": "24990", "availability": "http://schema.org/InStock" } }
</script></head><body>InStock</body></html>`;

// Croma ships JSON-LD with a trailing comma / unquoted bits, so it will not
// parse. The fallback still has to find the first Offer price.
const cromaHtml = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "DJI Osmo Action 4 Standard Combo 4K and 10MP 240 FPS Waterproof Action Camera",
  "offers": { "@type": "Offer", "priceCurrency": "INR", "price": "22990.00", },
}</script></head><body>Add to cart</body></html>`;

const outOfStockHtml = `
<script type="application/ld+json">
{ "@type": "Product", "name": "DJI Osmo Nano 128GB",
  "offers": { "@type": "Offer", "price": "34990", "availability": "http://schema.org/OutOfStock" } }
</script>`;

test('jsonld: parses a clean Reliance product block', () => {
  assert.deepEqual(extractProduct(relianceHtml), {
    name: 'DJI Osmo Action 4 Standard Combo Action Camera, Black',
    price: 24990,
    available: true,
    currency: 'INR',
  });
});

test('jsonld: falls back to regex when the Croma block is not valid JSON', () => {
  const product = extractProduct(cromaHtml);
  assert.equal(product.price, 22990);
  assert.equal(product.available, true);
  assert.match(product.name, /Osmo Action 4/);
});

test('jsonld: reports out of stock from schema.org availability', () => {
  const product = extractProduct(outOfStockHtml);
  assert.equal(product.price, 34990);
  assert.equal(product.available, false);
});

test('jsonld: returns null when there is no product block', () => {
  assert.equal(extractProduct('<html><body>nothing</body></html>'), null);
});

test('jsonld: detects unavailable wording in page text', () => {
  assert.equal(isOutOfStock('<p>Currently unavailable online</p>'), true);
  assert.equal(isOutOfStock('<p>Add to cart</p>'), false);
});

test('retailers: tiny or blocked pages are rejected', () => {
  assert.equal(relianceBlocked('<html>Access Denied</html>'), true);
  assert.equal(cromaBlocked('<html><title>Access Denied</title></html>'), true);
  assert.equal(cromaBlocked('x'.repeat(50_000)), false);
  assert.equal(relianceBlocked('x'.repeat(50_000)), false);
});
