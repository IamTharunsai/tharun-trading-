// Explicit isolated-paper launch; never modifies the user's .env.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const config = JSON.parse(await readFile(new URL('../.local-paper/connection.json', import.meta.url), 'utf8'));
assert.equal(config.host, '127.0.0.1');
assert.equal(config.port, 55432);
assert.equal(config.user, 'apex_local');
assert.equal(config.database, 'apex_paper_local');
process.env.DATABASE_URL = `postgresql://${config.user}:${encodeURIComponent(config.password)}@127.0.0.1:55432/apex_paper_local`;
process.env.TRADING_MODE = 'paper';
process.env.ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.HOST = '127.0.0.1';
process.env.PORT = '4100';
console.log('Isolated paper API: http://127.0.0.1:4100. Background jobs disabled.');
createRequire(import.meta.url)('../dist/index.js');
