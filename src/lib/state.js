import fs from 'node:fs';
import path from 'node:path';

export const STATE_PATH = process.env.STATE_PATH || 'state/prices.json';

const EMPTY = {
  version: 1,
  products: {},
  meta: {
    createdAt: null,
    lastRunAt: null,
    lastCommitAt: null,
    sent: { date: null, count: 0, lastSentAt: null },
    healthAlerted: {},
  },
};

export function loadState(file = STATE_PATH) {
  if (!fs.existsSync(file)) return structuredClone(EMPTY);

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...structuredClone(EMPTY),
      ...parsed,
      meta: { ...structuredClone(EMPTY.meta), ...(parsed.meta || {}) },
    };
  } catch (err) {
    throw new Error(`state file ${file} is not valid JSON: ${err.message}`);
  }
}

export function saveState(state, file = STATE_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function todayIST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function offerState(state, productId, retailer) {
  state.products[productId] ||= { offers: {} };
  state.products[productId].offers ||= {};
  state.products[productId].offers[retailer] ||= {
    price: null,
    compareAt: null,
    currency: 'INR',
    available: null,
    watermark: null,
    lowestEver: null,
    lastSeenAt: null,
    lastPolledAt: null,
    lastAlertAt: null,
    fails: 0,
    lastError: null,
  };
  return state.products[productId].offers[retailer];
}
