// Isolated local PostgreSQL for paper integration work. Never reads the cloud URL.
import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = path.join(backend, '.local-paper');
const configFile = path.join(stateDir, 'connection.json');
await mkdir(stateDir, { recursive: true });
let config;
try { config = JSON.parse(await readFile(configFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  config = { host: '127.0.0.1', port: 55432, user: 'apex_local', password: randomBytes(24).toString('hex'), database: 'apex_paper_local' };
  await writeFile(configFile, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
}
if (config.host !== '127.0.0.1' || config.port !== 55432 || config.database !== 'apex_paper_local' || config.user !== 'apex_local') {
  throw new Error('Refusing nonlocal or unexpected paper database configuration');
}
const databaseDir = path.join(stateDir, 'postgres');
const pg = new EmbeddedPostgres({ databaseDir, port: config.port, user: config.user, password: config.password,
  persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'],
  onLog: message => console.log(String(message).trim()), onError: message => console.error(String(message)),
});
try { await access(path.join(databaseDir, 'PG_VERSION')); }
catch { await pg.initialise(); }
await pg.start();

let stopping = false;
const keepAlive = setInterval(() => {}, 30_000);
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  // pg.stop() uses taskkill on Windows, which can orphan PostgreSQL workers.
  // Ask PostgreSQL itself to shut down and preserve the persistent data directory.
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const child = spawn(path.join(backend, 'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),
        ['stop', '-D', databaseDir, '-m', 'fast', '-w'], { windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Local PostgreSQL shutdown failed')));
    });
  } else await pg.stop();
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });

try {
  const client = pg.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.database]);
  if (!existing.rowCount) await client.query('CREATE DATABASE apex_paper_local');
  await client.end();
  const databaseUrl = `postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/${config.database}`;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(backend, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
      cwd: backend, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(output.replaceAll(databaseUrl, '[local database]'))));
  });
  console.log('Local paper database ready: 127.0.0.1:55432 / apex_paper_local. Schema synchronized. Cloud configuration unchanged.');
} catch (error) {
  await stop();
  throw error;
}
