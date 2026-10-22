import * as dji from '../sources/dji.js';
import * as flipkart from '../sources/flipkart.js';
import * as amazon from '../sources/amazon.js';

export const adapters = { dji, flipkart, amazon };

export function adapterFor(name) {
  const adapter = adapters[name];
  if (!adapter) throw new Error(`unknown retailer "${name}"`);
  return adapter;
}
