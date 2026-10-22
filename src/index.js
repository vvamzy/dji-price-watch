import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState } from './lib/state.js';
import { collect, commit, budget, markSent, summarise } from './lib/engine.js';
import { buildEmail } from './lib/report.js';
import { send } from './lib/mailer.js';

const argv = new Set(process.argv.slice(2));
const CHECK = argv.has('--check');
const DRY_RUN = argv.has('--dry-run') || process.env.DRY_RUN === '1';
const FORCE = argv.has('--force') || process.env.FORCE === '1';
const JSON_OUT = argv.has('--json');

// Persist state at most this often unless something actually happened.
const MAX_STATE_AGE_MINUTES = 10;

function log(msg) {
  console.log(msg);
}

async function main() {
  const started = new Date();
  const config = JSON.parse(fs.readFileSync('config/products.json', 'utf8'));
  const state = loadState();
  state.meta.createdAt ||= started.toISOString();

  log(`DJI price watch · ${started.toISOString()}${CHECK ? ' · check only' : ''}${DRY_RUN ? ' · dry run' : ''}`);

  const { observations, alerts, health, skipped } = await collect({ config, state, now: started, force: FORCE, log });
  log(summarise({ observations, alerts, health, skipped }));

  if (CHECK) return;

  const wantsEmail = alerts.length > 0 || health.length > 0;
  const b = budget(state, config, started);
  let delivered = false;
  let email = null;

  if (wantsEmail) {
    email = buildEmail({ alerts, health, state, config, now: started });

    if (!b.allowed) {
      log(`skipping email: ${b.reason}. Will retry on the next run.`);
    } else if (DRY_RUN) {
      const file = path.join(os.tmpdir(), `dji-price-watch-${Date.now()}.html`);
      fs.writeFileSync(file, email.html, 'utf8');
      delivered = true;
      log(`[dry run] would email: ${email.subject}`);
      log(`[dry run] preview: ${file}`);
    } else {
      try {
        await send(email);
        delivered = true;
        markSent(state, started);
        log(`emailed: ${email.subject}`);
      } catch (err) {
        log(`email failed: ${err.message} — watermarks not advanced, will retry`);
      }
    }
  } else {
    log('no changes worth emailing');
  }

  commit({ state, observations, alerts, health, delivered, now: started });

  const priceMoved = observations.some(
    (o) => !o.failed && (o.result.price !== o.prev.watermark || o.bankChanged || o.state.fails > 0)
  );
  const lastCommit = state.meta.lastCommitAt ? new Date(state.meta.lastCommitAt).getTime() : 0;
  const stale = started.getTime() - lastCommit > MAX_STATE_AGE_MINUTES * 60_000;
  const shouldPersist = !DRY_RUN && (priceMoved || alerts.length > 0 || health.length > 0 || stale);

  if (shouldPersist) {
    state.meta.lastRunAt = started.toISOString();
    state.meta.lastCommitAt = started.toISOString();
    saveState(state);
    log(`state saved (${priceMoved ? 'price changed' : stale ? 'cadence heartbeat' : 'event'})`);
  } else {
    log('state unchanged, not saved');
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ alerts, health, skipped: skipped.length, delivered }, null, 2));
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exitCode = 1;
});
