import { coin } from './diff.js';

function istTime(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const priceAlerts = (alerts) => alerts.filter((a) => a.kind === 'price');
const bankAlerts = (alerts) => alerts.filter((a) => a.kind === 'bank');

export function buildSubject(alerts, health) {
  const drops = priceAlerts(alerts);
  const banks = bankAlerts(alerts);

  if (drops.length === 1 && banks.length === 0) {
    const d = drops[0];
    return `🔻 ${coin(d.amount)} drop — ${d.product.short} (${d.offer.label}) now ${coin(d.to)}`;
  }
  if (drops.length === 0 && banks.length >= 1) {
    const b = banks[0];
    const amounts = banks.map((x) => coin(x.to)).join(', ');
    return `💳 Bank offer updated — ${b.product.short} (${b.offer.label}): ${amounts} off`;
  }
  if (drops.length >= 1 && banks.length >= 1) {
    return `🔻 ${drops.length} drop${drops.length > 1 ? 's' : ''} + 💳 ${banks.length} card offer change — DJI price watch`;
  }
  if (drops.length > 1) {
    return `🔻 ${drops.length} price drops — ${[...new Set(drops.map((d) => d.product.short))].join(', ')}`;
  }
  return `⚠️ Price tracker: ${health.length} source${health.length === 1 ? '' : 's'} failing`;
}

function priceCard(a) {
  return `
    <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:10px;padding:14px 16px;margin:0 0 10px">
      <div style="font-size:12px;color:#991b1b;text-transform:uppercase;letter-spacing:.05em;font-weight:700">
        Price drop · ${esc(a.offer.label)}
      </div>
      <div style="font-size:15px;font-weight:600;margin:4px 0 2px">${esc(a.product.name)}</div>
      <div style="font-size:22px;font-weight:700;margin:6px 0 2px">
        <span style="color:#9ca3af;text-decoration:line-through;font-size:15px;font-weight:400">${coin(a.from)}</span>
        &nbsp;→&nbsp; ${coin(a.to)}
      </div>
      <div style="font-size:14px;color:#b91c1c">down ${coin(a.amount)} (${a.percent}%)</div>
      <div style="margin-top:10px">
        <a href="${esc(a.offer.url)}" style="display:inline-block;background:#b91c1c;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:14px">
          Buy on ${esc(a.offer.label)}
        </a>
      </div>
    </div>`;
}

function bankCard(a) {
  const delta = a.amount;
  const headline =
    delta > 0
      ? `<span style="color:#047857">₹${delta.toLocaleString('en-IN')} more off</span>`
      : delta < 0
        ? `<span style="color:#b91c1c">₹${Math.abs(delta).toLocaleString('en-IN')} less off</span>`
        : 'Same best discount, different cards';

  const list = a.offers
    .map(
      (o) =>
        `<li style="margin:2px 0">${esc(o.bank)} — <strong>${coin(o.discount)} off</strong></li>`
    )
    .join('');

  return `
    <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:14px 16px;margin:0 0 10px">
      <div style="font-size:12px;color:#1e40af;text-transform:uppercase;letter-spacing:.05em;font-weight:700">
        Card offer change · ${esc(a.offer.label)}
      </div>
      <div style="font-size:15px;font-weight:600;margin:4px 0 2px">${esc(a.product.name)}</div>
      <div style="font-size:14px;margin:6px 0">${headline}${a.newLow ? ' · <strong>lowest effective price so far</strong>' : ''}</div>
      <ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:#1f2937">${list}</ul>
      ${a.effective != null ? `<div style="font-size:13px;color:#1e40af;margin-top:6px">Effective price with best offer: <strong>${coin(a.effective)}</strong></div>` : ''}
      <div style="margin-top:10px">
        <a href="${esc(a.offer.url)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:14px">
          Check offers on ${esc(a.offer.label)}
        </a>
      </div>
    </div>`;
}

export function buildEmail({ alerts, health, state, config, now = new Date() }) {
  const subject = buildSubject(alerts, health);
  const rows = [];

  for (const product of config.products) {
    const offerStates = state.products[product.id]?.offers || {};
    for (const offer of product.offers) {
      const s = offerStates[offer.retailer];
      if (!s) continue;

      const hot = alerts.some((a) => a.product.id === product.id && a.offer.retailer === offer.retailer);
      const effective = s.price != null ? Math.max(0, s.price - (s.bestBankDiscount || 0)) : null;

      rows.push(`
        <tr${hot ? ' style="background:#fff7ed"' : ''}>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600">${esc(product.short)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee">${esc(offer.label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:${hot ? 700 : 400}">
            ${s.price == null ? '—' : coin(s.price)}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;color:#1d4ed8">
            ${s.bestBankDiscount ? coin(s.bestBankDiscount) : '—'}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">
            ${effective == null ? '—' : coin(effective)}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;color:#555">
            ${s.lowestEver != null ? coin(s.lowestEver) : '—'}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">
            ${s.available === false ? '<span style="color:#b91c1c">Out of stock</span>' : s.available ? 'In stock' : '—'}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">
            <a href="${esc(offer.url)}" style="color:#1d4ed8;text-decoration:none">open ↗</a>
          </td>
        </tr>`);
    }
  }

  const healthBlock = health.length
    ? `
    <div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;padding:12px 16px;margin:16px 0 0">
      <div style="font-weight:700;color:#92400e;margin-bottom:6px">Tracker health</div>
      <ul style="margin:0;padding-left:18px;color:#78350f;font-size:14px">
        ${health.map((h) => `<li>${esc(h.product.name)} — ${esc(h.offer.label)}: ${esc(h.message)}</li>`).join('')}
      </ul>
      <div style="color:#92400e;font-size:12px;margin-top:6px">
        Three consecutive failures. No price was overwritten, so earlier readings stay intact.
      </div>
    </div>`
    : '';

  const cards = [...alerts.filter((a) => a.kind === 'price').map(priceCard), ...alerts.filter((a) => a.kind === 'bank').map(bankCard)].join('');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="padding:18px 20px;border-bottom:1px solid #eee">
      <div style="font-size:16px;font-weight:700">DJI price watch</div>
      <div style="font-size:13px;color:#6b7280">Action 4 · Osmo Nano · India · ${istTime(now)} IST</div>
    </div>
    <div style="padding:18px 20px">
      ${cards || '<div style="color:#374151">No price changes in this check.</div>'}
      ${healthBlock}
      <div style="margin-top:24px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700">All tracked prices</div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
        <thead>
          <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em">
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb">Product</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb">Store</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">Listed</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">Card offer</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">Effective</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">Lowest</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">Stock</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb"></th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div style="margin-top:16px;font-size:12px;color:#9ca3af;line-height:1.5">
        Alerts fire when a listed price falls below its all-time low, or when the set of bank/card offers changes.
        "Effective" is listed price minus the best single card offer. EMI and exchange offers are not included.
      </div>
    </div>
  </div>
</body></html>`;

  const text = [
    `DJI price watch — ${istTime(now)} IST`,
    '',
    ...(alerts.length
      ? alerts.map((a) =>
          a.kind === 'price'
            ? `PRICE DROP: ${a.product.name} @ ${a.offer.label}\n  ${coin(a.from)} -> ${coin(a.to)} (-${coin(a.amount)}, ${a.percent}%)\n  ${a.offer.url}`
            : `CARD OFFER CHANGE: ${a.product.name} @ ${a.offer.label}\n  best offer ${coin(a.from)} -> ${coin(a.to)}\n  ${a.offers.map((o) => `${o.bank}: ${coin(o.discount)} off`).join(', ')}\n  ${a.offer.url}`
        )
      : ['No price changes in this check.']),
    ...(health.length ? ['', 'Tracker health:', ...health.map((h) => `  ${h.product.name} / ${h.offer.label}: ${h.message}`)] : []),
    '',
    'Current prices:',
    ...Object.entries(state.products).flatMap(([pid, p]) =>
      Object.entries(p.offers || {}).map(([retailer, s]) => {
        const effective = s.price != null ? Math.max(0, s.price - (s.bestBankDiscount || 0)) : null;
        return `  ${pid} @ ${retailer}: listed ${s.price == null ? 'n/a' : coin(s.price)}, card ${s.bestBankDiscount ? coin(s.bestBankDiscount) : 'none'}, effective ${effective == null ? 'n/a' : coin(effective)}`;
      })
    ),
  ].join('\n');

  return { subject, html, text };
}
