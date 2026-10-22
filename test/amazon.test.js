import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPrice, asinFromUrl } from '../src/sources/amazon.js';

// Shape of the mobile product page: the embedded priceAmount is the real
// selling price, while .a-offscreen holds the MRP.
const MOBILE_PAGE = `
  <span class="a-price aok-align-center"><span class="a-offscreen">₹44,990</span>
  <span aria-hidden="true"><span class="a-price-symbol">₹</span><span class="a-price-whole">22,990</span></span></span>
  <script>{"buyingPrice":22990.00,"priceAmount":22990.00,"currencyCode":"INR"}</script>
`;

test('amazon: prefers priceAmount over the MRP in .a-offscreen', () => {
  assert.equal(extractPrice(MOBILE_PAGE), 22990);
});

test('amazon: never falls back to the MRP', () => {
  const mrpOnly = '<span class="a-offscreen">₹44,990</span>';
  assert.equal(extractPrice(mrpOnly), null);
});

test('amazon: falls back to a-price-whole when priceAmount is absent', () => {
  const html = '<span class="a-price-whole">31,990</span>';
  assert.equal(extractPrice(html), 31990);
});

test('amazon: extracts ASIN from every supported url shape', () => {
  assert.equal(asinFromUrl('https://www.amazon.in/dp/B0C783YNW7'), 'B0C783YNW7');
  assert.equal(asinFromUrl('https://www.amazon.in/gp/product/B0C783J9WC?th=1'), 'B0C783J9WC');
  assert.equal(asinFromUrl('https://www.amazon.in/gp/aw/d/B0DYD56G2Y/ref=x'), 'B0DYD56G2Y');
  assert.throws(() => asinFromUrl('https://www.amazon.in/s?k=nano'), /no ASIN/);
});

test('amazon: rejects non-numeric junk', () => {
  assert.equal(extractPrice('<script>"priceAmount":null</script>'), null);
  assert.equal(extractPrice('<script>"priceAmount":0</script>'), null);
});
