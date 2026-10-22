/**
 * Diagnostic v3:
 *  1) how many mobile attempts until success (sizes the retry budget)
 *  2) find the Osmo Nano 64GB ASIN from mobile search
 */
const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const HEADERS = {
  'user-agent': UA_MOBILE,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-IN,en-GB;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
};

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: HEADERS, signal: AbortSignal.timeout(25000) });
  return { status: res.status, html: await res.text() };
}

console.log('--- retry sizing: 6 attempts on B0C783J9WC ---');
let firstSuccess = null;
for (let i = 1; i <= 6; i++) {
  const { status, html } = await get('https://www.amazon.in/gp/aw/d/B0C783J9WC');
  const blocked = /Enter the characters you see below|Robot Check/i.test(html);
  const price = (html.match(/"priceAmount"\s*:\s*([\d.]+)/) || [])[1];
  console.log(`  attempt ${i}: status=${status} bytes=${html.length} blocked=${blocked} price=${price || '-'}`);
  if (price && !firstSuccess) firstSuccess = i;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`  first success on attempt: ${firstSuccess ?? 'none'}`);

console.log('\n--- mobile search: dji osmo nano ---');
for (const q of ['dji osmo nano 64gb', 'dji osmo nano standard combo']) {
  try {
    const { status, html } = await get(`https://www.amazon.in/s?k=${encodeURIComponent(q)}`);
    console.log(`\n query "${q}" status=${status} bytes=${html.length} blocked=${/Enter the characters/i.test(html)}`);
    const re = /data-asin="(B0[A-Z0-9]{8})"[\s\S]{0,3000}?<h2[^>]*>([\s\S]{0,200}?)<\/h2>/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(html))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
      if (/nano|action/i.test(title)) console.log(`  ${m[1]}  ${title}`);
    }
  } catch (err) {
    console.log('  ERR', err.message.slice(0, 60));
  }
  await new Promise((r) => setTimeout(r, 1500));
}
