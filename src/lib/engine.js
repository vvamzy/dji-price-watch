import crypto from 'node:crypto';
import { adapterFor } from '../sources/index.js';
import { offerState, todayIST } from './state.js';
import { evaluate, cooldownActive, coin } from './diff.js';

const iso = (d = new Date()) => d.toISOString();

export function bankHash(offers) {
  if (!Array.isArray(offers) || offers.length === 0) return 'none';
  const canonical = [...offers]
    .map((o) => `${o.bank.toLowerCase()}=${o.discount}`)
    .sort()
    .join('|');
  return crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 12);
}

/**
 * Poll every due source and turn the observations into a list of alert events.
 * Nothing is written to state here: the caller decides whether the email
 * actually went out, and only then are watermarks advanced.
 */
export async function collect({ config, state, now = new Date(), force = false, log = () => {} }) {
  const observations = [];
  const skipped = [];

  for (const product of config.products) {
    for (const offer of product.offers) {
      const st = offerState(state, product.id, offer.retailer);

      const cadence = config.polling?.[offer.retailer];
      if (!force && cadence && st.lastPolledAt) {
        const dueAt = new Date(st.lastPolledAt).getTime() + cadence * 60_000;
        if (now.getTime() < dueAt) {
          skipped.push({ product, offer, reason: `next poll in ${Math.ceil((dueAt - now.getTime()) / 60000)}m` });
          continue;
        }
      }

      const prev = {
        watermark: st.watermark,
        effectiveWatermark: st.effectiveWatermark,
        bankHash: st.bankHash,
        bankOffers: st.bankOffers || [],
        bestBankDiscount: st.bestBankDiscount || 0,
        lastAlertAt: st.lastAlertAt,
      };

      st.lastPolledAt = iso(now);

      try {
        const r = await adapterFor(offer.retailer).fetchPrice(offer);

        st.price = r.price;
        st.currency = r.currency || 'INR';
        st.available = r.available;
        st.compareAt = r.compareAt ?? null;
        st.lastSeenAt = iso(now);
        st.fails = 0;
        st.lastError = null;

        if (r.bankOffers) {
          st.bankOffers = r.bankOffers;
          st.bestBankDiscount = r.bestBankDiscount || 0;
        }

        const effective = r.price != null ? Math.max(0, r.price - (r.bestBankDiscount || 0)) : null;

        observations.push({
          product,
          offer,
          state: st,
          prev,
          result: r,
          effective,
          priceEval: r.price != null ? evaluate({ watermark: prev.watermark }, r.price) : null,
          bankChanged: Boolean(prev.bankHash) && bankHash(r.bankOffers || st.bankOffers) !== prev.bankHash,
          firstBankReading: !prev.bankHash,
        });
      } catch (err) {
        st.fails = (st.fails || 0) + 1;
        st.lastError = err.message;
        st.lastSeenAt = st.lastSeenAt || null;
        log(`  ! ${product.short} / ${offer.label}: ${err.message} (fail ${st.fails})`);

        observations.push({ product, offer, state: st, prev, error: err.message, failed: true });
      }
    }
  }

  const alerts = [];
  const health = [];

  for (const obs of observations) {
    if (obs.failed) {
      if (obs.state.fails >= 3 && !obs.offer.optional) {
        const key = `${obs.product.id}:${obs.offer.retailer}`;
        if (!state.meta.healthAlerted[key]) {
          // Marked only once the email is actually delivered (see commit()).
          health.push({ key, product: obs.product, offer: obs.offer, message: obs.error || 'unknown error' });
        }
      }
      continue;
    }

    const { product, offer, state: st, prev, result: r, effective, priceEval } = obs;

    // Recovered: allow a fresh health alert if it breaks again later.
    const healthKey = `${product.id}:${offer.retailer}`;
    if (state.meta.healthAlerted[healthKey]) delete state.meta.healthAlerted[healthKey];

    const cooling = cooldownActive({ lastAlertAt: prev.lastAlertAt }, config.alert?.cooldownHours ?? 0, now.getTime());

    if (priceEval?.drop && !cooling) {
      alerts.push({
        kind: 'price',
        product,
        offer,
        from: priceEval.from,
        to: r.price,
        amount: priceEval.amount,
        percent: priceEval.percent,
      });
    }

    const newHash = bankHash(r.bankOffers || st.bankOffers);
    if (obs.bankChanged && !cooling) {
      const before = prev.bestBankDiscount || 0;
      const after = r.bestBankDiscount || 0;
      alerts.push({
        kind: 'bank',
        product,
        offer,
        from: before,
        to: after,
        amount: after - before,
        percent: 0,
        offers: r.bankOffers || [],
        effective,
        newLow: effective != null && (prev.effectiveWatermark == null || effective < prev.effectiveWatermark),
      });
    }

    // Applied in commit() so an undelivered alert is retried next run.
    obs.newBankHash = newHash;
    st.effectivePrice = effective;
  }

  return { observations, alerts, health, skipped };
}

/**
 * Advance watermarks. Called only after we know whether the alert was
 * delivered, so a failed send is retried on the next run instead of being
 * silently swallowed.
 */
export function commit({ state, observations, alerts = [], health = [], delivered, now = new Date() }) {
  if (delivered) {
    for (const h of health) {
      if (h.key) state.meta.healthAlerted[h.key] = iso(now);
    }
  }

  for (const obs of observations) {
    if (obs.failed) continue;
    const { state: st, prev, result: r } = obs;

    if (obs.newBankHash && (!obs.bankChanged || delivered)) st.bankHash = obs.newBankHash;
    if (r.price == null) continue;

    const isDrop = Boolean(obs.priceEval?.drop);
    const undelivered = (isDrop || obs.bankChanged) && !delivered;

    const wasAlerted =
      delivered &&
      alerts.some((a) => a.product.id === obs.product.id && a.offer.retailer === obs.offer.retailer);
    if (wasAlerted) st.lastAlertAt = iso(now);

    if (!undelivered) {
      st.watermark = prev.watermark == null ? r.price : Math.min(prev.watermark, r.price);
      st.lowestEver = st.lowestEver == null ? r.price : Math.min(st.lowestEver, r.price);
    }
    if (st.watermark == null) st.watermark = r.price;
    if (st.lowestEver == null) st.lowestEver = r.price;

    const effective = obs.effective;
    if (effective != null && !undelivered) {
      st.effectiveWatermark =
        prev.effectiveWatermark == null ? effective : Math.min(prev.effectiveWatermark, effective);
      st.effectiveLow = st.effectiveWatermark;
    }
  }
}

export function budget(state, config, now = new Date()) {
  const today = todayIST(now);
  const sent = state.meta.sent || {};
  const count = sent.date === today ? sent.count || 0 : 0;
  const cap = config.alert?.dailyEmailCap ?? 12;
  const minGap = (config.alert?.minSecondsBetweenEmails ?? 60) * 1000;

  let reason = null;
  if (count >= cap) reason = `daily email cap reached (${count}/${cap})`;
  else if (sent.lastSentAt && now.getTime() - new Date(sent.lastSentAt).getTime() < minGap) {
    reason = 'email sent less than a minute ago';
  }

  return { today, count, cap, allowed: !reason, reason };
}

export function markSent(state, now = new Date()) {
  const today = todayIST(now);
  state.meta.sent = state.meta.sent || { date: null, count: 0, lastSentAt: null };
  if (state.meta.sent.date !== today) {
    state.meta.sent.date = today;
    state.meta.sent.count = 0;
  }
  state.meta.sent.count += 1;
  state.meta.sent.lastSentAt = iso(now);
}

export function summarise({ observations, alerts, health, skipped }) {
  const lines = [];
  for (const obs of observations) {
    if (obs.failed) {
      lines.push(`✗ ${obs.product.short} / ${obs.offer.label}: ${obs.error}`);
      continue;
    }
    const { result: r, effective, state: st } = obs;
    const bank = r.bankOffers?.length
      ? ` [best card offer ${coin(r.bestBankDiscount)} → effective ${effective == null ? 'n/a' : coin(effective)}]`
      : '';
    const flag = st.available === false ? ' (out of stock)' : '';
    lines.push(`✓ ${obs.product.short} / ${obs.offer.label}: ${r.price == null ? 'n/a' : coin(r.price)}${flag}${bank}`);
  }
  for (const s of skipped) lines.push(`· skipped ${s.product.short} / ${s.offer.label} (${s.reason})`);
  for (const a of alerts) {
    lines.push(
      a.kind === 'price'
        ? `🔻 ${a.product.short} / ${a.offer.label}: ${coin(a.from)} → ${coin(a.to)} (-${coin(a.amount)}, ${a.percent}%)`
        : `💳 ${a.product.short} / ${a.offer.label}: best card offer ${coin(a.from)} → ${coin(a.to)}`
    );
  }
  for (const h of health) lines.push(`⚠️ health: ${h.product.short} / ${h.offer.label}: ${h.message}`);
  return lines.join('\n');
}
