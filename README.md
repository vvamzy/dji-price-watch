# dji-price-watch

Watches DJI **Osmo Action 4** and **Osmo Nano** prices in India and emails you the moment
something gets cheaper — either the listed price or the bank/card offer stacked on top of it.

Runs on GitHub Actions every 5 minutes. No server, no database, no paid APIs.

---

## What it tracks

| SKU | DJI India | Flipkart | Amazon.in |
|---|---|---|---|
| Osmo Action 4 Standard Combo | — | ✅ | ⚠️ optional |
| Osmo Action 4 Adventure Combo | ✅ | ✅ | ⚠️ optional |
| Osmo Nano 64GB | ✅ | ✅ | — |
| Osmo Nano 128GB | ✅ | ✅ | ⚠️ optional |

- **DJI India** (`djiindiashop.com`, the official importer) is a Shopify store, so prices come from
  its public product JSON. Most reliable source.
- **Flipkart** pages carry a schema.org price block. Stable, but blocks datacenter IPs occasionally.
- **Amazon.in** is best-effort only. GitHub runner IPs get captchas and HTTP 503 fairly often, so
  these sources are marked `optional` and never raise a "tracker broken" email.

---

## How it decides to email you

Two independent triggers:

1. **Price drop** — the listed price falls below the **lowest price ever recorded** for that
   store + product. Not "lower than five minutes ago". This is what stops a price bouncing between
   ₹33,990 and ₹34,809 from emailing you twice a day forever.
2. **Card offer change** — the set of bank offers changes, e.g. HDFC goes from ₹1,250 to ₹2,271 off.
   The email lists every current card offer and the resulting effective price.

Guard rails:

- One combined email per run, never one per product.
- 1-hour cooldown per store + product.
- Hard cap of 12 emails/day (protects your Gmail account from ever being flagged).
- If sending fails, watermarks are **not** advanced, so the same drop is retried next run.
- Three consecutive scrape failures on a required source triggers a single "tracker broken" email.
- A failed parse never overwrites a good price.

---

## Setup (two minutes)

The workflow is already in the repo. It only needs three secrets.

### 1. Create a Gmail app password

1. Go to <https://myaccount.google.com/security> and turn on **2-Step Verification** if it is off.
2. Open <https://myaccount.google.com/apppasswords>.
3. Name it `dji-price-watch` → **Create**.
4. Copy the 16-character password. **Do not paste it into a chat or a file.**

> App passwords are unavailable on some Google Workspace accounts. If the page is missing,
> use a personal Gmail account for sending, or swap in Resend/Brevo later.

### 2. Add the secrets

In the browser: **repo → Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `GMAIL_USER` | the Gmail address that sends the mail, e.g. `you@gmail.com` |
| `GMAIL_APP_PASSWORD` | the 16-character app password (spaces are ignored) |
| `ALERT_TO` | where alerts go; can be the same address |

Or with the CLI:

```bash
gh secret set GMAIL_USER --repo vvamzy/dji-price-watch
gh secret set GMAIL_APP_PASSWORD --repo vvamzy/dji-price-watch
gh secret set ALERT_TO --repo vvamzy/dji-price-watch
```

### 3. First run

**Actions → price-check → Run workflow**, leave `dry_run` checked, press **Run**.
It will scrape real prices, build the email, print the subject, and skip sending.

To confirm Gmail works, run again with `dry_run` **unchecked** and `test_email` **checked**.
You should get one `✅ DJI price watch — Gmail/SMTP test` email. If it fails, the log shows the
SMTP error code (usually a bad app password, or 2FA not enabled).

Then the 5-minute schedule takes over. It records baselines on the first real run and stays silent
until something actually drops.

---

## Updating values

Everything tunable lives in **`config/products.json`**. Edit it on GitHub (pencil icon → commit)
or locally, then push. The next run picks it up immediately; no redeploy step.

### Alert behaviour

```json
"alert": {
  "mode": "watermark",
  "cooldownHours": 1,
  "dailyEmailCap": 12,
  "minSecondsBetweenEmails": 60
}
```

| Field | What it does |
|---|---|
| `cooldownHours` | minimum gap before the same store+product can alert again |
| `dailyEmailCap` | maximum emails per day, hard stop |
| `minSecondsBetweenEmails` | two emails are never sent closer than this |

Set `cooldownHours` to `0` to be notified on every downward move (noisier, but allowed).

### How often each store is polled

```json
"polling": {
  "dji": 5,
  "flipkart": 15,
  "amazon": 30
}
```

The workflow wakes every 5 minutes; this map decides which stores actually get fetched.
Raise Flipkart to `30` if you ever start seeing bot-check failures in the logs.

### Adding a product

Append to the `products` array:

```json
{
  "id": "action5-pro",
  "name": "DJI Osmo Action 5 Pro Standard Combo",
  "short": "Action 5 Pro",
  "offers": [
    {
      "retailer": "dji",
      "label": "DJI India",
      "url": "https://djiindiashop.com/products/osmo-action-5-pro-standard-combo.js"
    },
    {
      "retailer": "flipkart",
      "label": "Flipkart",
      "url": "https://www.flipkart.com/dji-osmo-action-5-pro-standard-combo-sports-action-camera/p/itmXXXX"
    }
  ]
}
```

- `id` must be unique — it is the key in the state file. Renaming it resets that product's history.
- `retailer` must be `dji`, `flipkart` or `amazon`.
- `variant` (optional) picks a Shopify variant by its title, e.g. `"64 GB"`.
- `optional: true` means failures are logged but never emailed as a health problem.
- `label` is the text shown in the email.

### Removing a source

Delete its object from `offers`. Stale entries stay in `state/prices.json` harmlessly; the email
table only renders offers still present in the config.

### Changing who gets the email

Update the `ALERT_TO` secret. Settings → Secrets and variables → Actions → click it → **Update**.

### Do not edit `state/prices.json`

That file is written by the workflow on every change. Editing it by hand changes what counts as
"the lowest price so far". To deliberately reset history:

```bash
git rm state/prices.json && git commit -m "reset price history" && git push
```

The next run recreates it.

---

## Running it by hand

**From GitHub:** Actions → price-check → Run workflow.

- `dry_run` checked → scrape, build the email, print it, send nothing, write nothing.
- `dry_run` unchecked → real run, real email.

**Locally:**

```bash
npm install
npm test          # parser + diff unit tests, no network
npm run check     # scrape live and print prices, no email
npm run dry       # full logic against a temp copy of state, writes an HTML preview
npm run test-email # send one test email (needs the three env vars below)
```

`npm run dry` prints a path to the rendered email so you can check the design before trusting the cron.

To send a real email locally, set `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `ALERT_TO` in your shell
first. Never commit them.

---

## Files

```
config/products.json          what to track, how often, alert rules
src/index.js                  entry point, CLI flags, email/budget orchestration
src/lib/engine.js             polling, cadence, alert detection, state commits
src/lib/diff.js               watermark logic
src/lib/report.js             HTML/text email builder
src/lib/mailer.js             Gmail SMTP transport
src/lib/state.js              state load/save helpers
src/sources/dji.js            Shopify JSON adapter
src/sources/flipkart.js       JSON-LD + bankOfferGrid adapter
src/sources/amazon.js         best-effort ASIN adapter
state/prices.json             persisted prices, watermarks, email budget
.github/workflows/price-check.yml   the 5-minute cron
```

---

## Known limits

- **Timing.** GitHub's minimum cron is 5 minutes, and scheduled runs are queued best-effort.
  Expect drops to arrive 5–12 minutes after they happen, sometimes longer at peak times.
- **Amazon.** Genuinely unreliable from GitHub IPs. Treat it as a bonus, not a guarantee.
  If you want it solid, a Keepa API key (~€19/year) replaces that adapter with real price history.
- **Flipkart.** The listed price is tracked, not EMI, exchange, or coupon discounts. Bank/card
  offers are tracked separately because they are the ones that reliably stack.
- **Public repo.** Prices and state commits are public. Credentials are not — they live only in
  Actions secrets and are masked in logs.
- **Gmail.** App passwords require 2FA. The 12/day cap exists because sending from constantly
  changing datacenter IPs is exactly what Google's abuse detection watches for.
