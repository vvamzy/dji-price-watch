/**
 * Watermark diffing.
 *
 * A "drop" is a price strictly below the lowest price ever *observed* for that
 * retailer + product. Comparing against a watermark (instead of "the previous
 * check") is what stops a price that oscillates between two values from
 * emailing you twice a day forever.
 */

export function coin(n) {
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

export function pct(from, to) {
  if (!from || !to || from <= 0) return 0;
  return Math.round(((from - to) / from) * 1000) / 10;
}

/**
 * @returns {{ drop: boolean, from: number|null, to: number, amount: number, percent: number, firstSeen: boolean }}
 */
export function evaluate(prev, price) {
  if (!Number.isFinite(price) || price <= 0) {
    return { drop: false, from: prev?.watermark ?? null, to: price, amount: 0, percent: 0, firstSeen: false };
  }

  if (prev?.watermark == null) {
    return { drop: false, from: null, to: price, amount: 0, percent: 0, firstSeen: true };
  }

  if (price < prev.watermark) {
    return {
      drop: true,
      from: prev.watermark,
      to: price,
      amount: prev.watermark - price,
      percent: pct(prev.watermark, price),
      firstSeen: false,
    };
  }

  return { drop: false, from: prev.watermark, to: price, amount: 0, percent: 0, firstSeen: false };
}

export function cooldownActive(prev, cooldownHours, now = Date.now()) {
  if (!prev?.lastAlertAt || !cooldownHours) return false;
  return now - new Date(prev.lastAlertAt).getTime() < cooldownHours * 3600_000;
}
