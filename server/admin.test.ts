import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';

const root = resolve(process.cwd(), 'tmp-test');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'admin-'));
after(() => {
  const full = resolve(dir);
  if (!full.startsWith(root + sep)) throw new Error('Unsafe test cleanup path');
  rmSync(full, { recursive: true, force: true });
});

test('senhas, desativação e restauração completa preservam o banco em falhas', async () => {
  const db = openDatabase(dir);
  const app = await buildApp(db);
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/setup', payload: { name: 'Dono', password: 'senha-dono-antiga' } });
    const owner = { cookie: setup.headers['set-cookie']!.toString().split(';')[0] };
    const member = await app.inject({ method: 'POST', url: '/api/users', headers: owner,
      payload: { name: 'Pessoa', password: 'senha-pessoa-antiga' } });
    assert.equal(member.statusCode, 201);
    const memberId = member.json().id;
    const memberLogin = await app.inject({ method: 'POST', url: '/api/login',
      payload: { name: 'Pessoa', password: 'senha-pessoa-antiga' } });
    const other = { cookie: memberLogin.headers['set-cookie']!.toString().split(';')[0] };
    const forbidden = await app.inject({ method: 'PATCH', url: '/api/users/' + memberId, headers: other, payload: { active: false } });
    assert.equal(forbidden.statusCode, 403);
    const selfDisable = await app.inject({ method: 'PATCH', url: '/api/users/' + setup.json().id, headers: owner, payload: { active: false } });
    assert.equal(selfDisable.statusCode, 404);
    const language = await app.inject({ method: 'POST', url: '/api/languages', headers: owner, payload: { name: 'Inglês' } });
    assert.equal(language.statusCode, 201);

    const manual = await app.inject({ method: 'POST', url: '/api/data/backup', headers: owner });
    assert.equal(manual.statusCode, 200);
    assert.ok(existsSync(manual.json().path));
    const backups = await app.inject({ method: 'GET', url: '/api/data/backups', headers: owner });
    assert.ok(backups.json().some((item: { name: string }) => item.name === manual.json().path.split(/[\\/]/).at(-1)));
    const memberBackups = await app.inject({ method: 'GET', url: '/api/data/backups', headers: other });
    assert.equal(memberBackups.statusCode, 403);

    await app.inject({ method: 'POST', url: '/api/languages', headers: owner, payload: { name: 'Japonês' } });
    const changed = await app.inject({ method: 'POST', url: '/api/users/' + memberId + '/password',
      headers: owner, payload: { password: 'senha-pessoa-nova' } });
    assert.equal(changed.statusCode, 200);
    const oldSession = await app.inject({ method: 'GET', url: '/api/me', headers: other });
    assert.equal(oldSession.statusCode, 401);
    const deactivated = await app.inject({ method: 'PATCH', url: '/api/users/' + memberId, headers: owner, payload: { active: false } });
    assert.equal(deactivated.statusCode, 200);
    const noLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Pessoa', password: 'senha-pessoa-nova' } });
    assert.equal(noLogin.statusCode, 401);
    const reactivated = await app.inject({ method: 'PATCH', url: '/api/users/' + memberId, headers: owner, payload: { active: true } });
    assert.equal(reactivated.statusCode, 200);

    const name = manual.json().path.split(/[\\/]/).at(-1);
    const wrongPassword = await app.inject({ method: 'POST', url: '/api/data/restore-backup', headers: owner,
      payload: { name, currentPassword: 'incorreta', confirmation: 'RESTAURAR' } });
    assert.equal(wrongPassword.statusCode, 403);
    const corruptName = 'lembre-manual-2026-10-14T00-00-00-000Z.sqlite';
    writeFileSync(join(dir, 'backups', corruptName), 'broken');
    const corrupt = await app.inject({ method: 'POST', url: '/api/data/restore-backup', headers: owner,
      payload: { name: corruptName, currentPassword: 'senha-dono-antiga', confirmation: 'RESTAURAR' } });
    assert.equal(corrupt.statusCode, 400);
    const stillThere = await app.inject({ method: 'GET', url: '/api/languages', headers: owner });
    assert.equal(stillThere.json().length, 2);

    const restored = await app.inject({ method: 'POST', url: '/api/data/restore-backup', headers: owner,
      payload: { name, currentPassword: 'senha-dono-antiga', confirmation: 'RESTAURAR' } });
    assert.equal(restored.statusCode, 200, JSON.stringify(restored.json()));
    assert.ok(existsSync(restored.json().safetyCopy));
    const invalidSession = await app.inject({ method: 'GET', url: '/api/me', headers: owner });
    assert.equal(invalidSession.statusCode, 401);
    const newOwnerLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Dono', password: 'senha-dono-antiga' } });
    const ownerAgain = { cookie: newOwnerLogin.headers['set-cookie']!.toString().split(';')[0] };
    const languages = await app.inject({ method: 'GET', url: '/api/languages', headers: ownerAgain });
    assert.deepEqual(languages.json().map((item: { name: string }) => item.name), ['Inglês']);
    const memberAfterRestore = await app.inject({ method: 'POST', url: '/api/login',
      payload: { name: 'Pessoa', password: 'senha-pessoa-antiga' } });
    assert.equal(memberAfterRestore.statusCode, 200);
    const ownChange = await app.inject({ method: 'POST', url: '/api/me/password', headers: ownerAgain,
      payload: { currentPassword: 'senha-dono-antiga', newPassword: 'senha-dono-nova' } });
    assert.equal(ownChange.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: ownerAgain })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/login',
      payload: { name: 'Dono', password: 'senha-dono-antiga' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/login',
      payload: { name: 'Dono', password: 'senha-dono-nova' } })).statusCode, 200);
  } finally {
    await app.close();
    db.close();
  }
});

