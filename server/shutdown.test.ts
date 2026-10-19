import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDatabase } from './db.js';
import { buildApp, registerShutdownRoute } from './app.js';

test('desligamento exige dono no próprio PC e origem correta', async () => {
  const base = resolve(process.cwd(), 'tmp-test');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'shutdown-'));
  const db = openDatabase(dir);
  const app = await buildApp(db);
  let stopped = false;
  registerShutdownRoute(app, db, async () => { stopped = true; });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/setup', payload: { name: 'Dono', password: 'senha-teste-123' } });
    const cookie = setup.headers['set-cookie']?.toString().split(';')[0];
    assert.ok(cookie);
    const url = '/api/shutdown';
    const origin = 'http://127.0.0.1:4173';
    assert.equal((await app.inject({ method: 'POST', url })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url, headers: { cookie, origin: 'http://evil.example', host: '127.0.0.1:4173' } })).statusCode, 403);
    const accepted = await app.inject({ method: 'POST', url, headers: { cookie, origin, host: '127.0.0.1:4173' } });
    assert.equal(accepted.statusCode, 200);
    await new Promise((done) => setTimeout(done, 150));
    assert.equal(stopped, true);
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
