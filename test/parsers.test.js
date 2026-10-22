import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseJsonLd, parseBankOffers } from '../src/sources/flipkart.js';
import { parseShopifyProduct, normaliseJsUrl, toRupees } from '../src/sources/dji.js';
import { evaluate } from '../src/lib/diff.js';
import { bankHash } from '../src/lib/engine.js';

const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

test('flipkart: reads selling price from JSON-LD, not MRP', () => {
  const p = parseJsonLd(fixture('flipkart-product.html'));
  assert.equal(p.price, 22990);
  assert.match(p.availability, /InStock/);
  assert.match(p.name, /Action 4 Standard Combo/);
});

test('flipkart: parses bank offers and keeps the best card per bank', () => {
  const offers = parseBankOffers(fixture('flipkart-product.html'));
  assert.deepEqual(offers, [
    { bank: 'HDFC', discount: 1250 },
    { bank: 'Flipkart Axis', discount: 1150 },
    { bank: 'Flipkart SBI', discount: 1150 },
  ]);
});

test('flipkart: bank offer hash is order independent', () => {
  const a = [{ bank: 'HDFC', discount: 1250 }, { bank: 'SBI', discount: 500 }];
  const b = [{ bank: 'SBI', discount: 500 }, { bank: 'HDFC', discount: 1250 }];
  assert.equal(bankHash(a), bankHash(b));
  assert.notEqual(bankHash(a), bankHash([{ bank: 'HDFC', discount: 1500 }]));
});

test('shopify: converts paise to rupees and keeps variants apart', () => {
  const product = parseShopifyProduct(fixture('shopify-nano.json'));
  assert.equal(product.variants.length, 2);
  assert.equal(toRupees(product.variants[0].price), 34990);
  assert.equal(toRupees(product.variants[1].price), 29990);
});

test('shopify: normalises .json urls to .js', () => {
  assert.equal(
    normaliseJsUrl('https://djiindiashop.com/products/osmo-nano.json'),
    'https://djiindiashop.com/products/osmo-nano.js'
  );
  assert.equal(
    normaliseJsUrl('https://djiindiashop.com/products/osmo-nano.js?utm=x'),
    'https://djiindiashop.com/products/osmo-nano.js'
  );
});

test('diff: first reading sets a baseline without alerting', () => {
  const r = evaluate(undefined, 21990);
  assert.equal(r.firstSeen, true);
  assert.equal(r.drop, false);
});

test('diff: a drop alerts, and a rebound does not re-alert the same price', () => {
  const first = evaluate({ watermark: 22990 }, 21990);
  assert.equal(first.drop, true);
  assert.equal(first.amount, 1000);

  const afterRebound = evaluate({ watermark: 21990 }, 22990);
  assert.equal(afterRebound.drop, false);
});

test('diff: ignores junk prices', () => {
  assert.equal(evaluate({ watermark: 20000 }, 0).drop, false);
  assert.equal(evaluate({ watermark: 20000 }, NaN).drop, false);
});
