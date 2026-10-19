import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';

const testRoot = resolve(process.cwd(), 'tmp-test');
mkdirSync(testRoot, { recursive: true });
const dataDir = mkdtempSync(join(testRoot, 'lembre-'));
after(() => {
  const full = resolve(dataDir);
  if (!full.startsWith(testRoot + sep)) throw new Error('Unsafe test cleanup path');
  rmSync(full, { recursive: true, force: true });
});

test('contas separadas, baralhos persistidos e acesso protegido', async () => {
  const db = openDatabase(dataDir);
  const app = await buildApp(db);
  try {
    const before = await app.inject({ method: 'GET', url: '/api/setup/status' });
    assert.equal(before.json().needsSetup, true);

    const setup = await app.inject({ method: 'POST', url: '/api/setup', payload: { name: 'Dono', password: 'senha-teste-123' } });
    assert.equal(setup.statusCode, 201);
    const ownerCookie = setup.headers['set-cookie']?.toString().split(';')[0];
    assert.ok(ownerCookie);

    const setupAgain = await app.inject({ method: 'POST', url: '/api/setup', payload: { name: 'Outro', password: 'senha-teste-123' } });
    assert.equal(setupAgain.statusCode, 409);

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/decks' });
    assert.equal(unauthenticated.statusCode, 401);

    const language = await app.inject({ method: 'POST', url: '/api/languages', headers: { cookie: ownerCookie }, payload: { name: 'Inglês' } });
    assert.equal(language.statusCode, 201);
    const languageId = language.json().id;

    const deck = await app.inject({ method: 'POST', url: '/api/decks', headers: { cookie: ownerCookie }, payload: { name: 'Conversação', languageId } });
    assert.equal(deck.statusCode, 201);
    const deckId = deck.json().id;

    const member = await app.inject({ method: 'POST', url: '/api/users', headers: { cookie: ownerCookie }, payload: { name: 'Pessoa 2', password: 'outra-senha-123' } });
    assert.equal(member.statusCode, 201);

    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Pessoa 2', password: 'outra-senha-123' } });
    assert.equal(login.statusCode, 200);
    const memberCookie = login.headers['set-cookie']?.toString().split(';')[0];
    assert.ok(memberCookie);

    const memberDecks = await app.inject({ method: 'GET', url: '/api/decks', headers: { cookie: memberCookie } });
    assert.deepEqual(memberDecks.json(), []);

    const forbiddenCreate = await app.inject({ method: 'POST', url: '/api/decks', headers: { cookie: memberCookie }, payload: { name: 'Intruso', languageId } });
    assert.equal(forbiddenCreate.statusCode, 404);
    const forbiddenDelete = await app.inject({ method: 'DELETE', url: '/api/decks/' + deckId, headers: { cookie: memberCookie } });
    assert.equal(forbiddenDelete.statusCode, 404);

    const forbiddenLanguageEdit = await app.inject({ method: 'PATCH', url: '/api/languages/' + languageId,
      headers: { cookie: memberCookie }, payload: { name: 'Alterado' } });
    assert.equal(forbiddenLanguageEdit.statusCode, 404);
    const forbiddenLanguageDelete = await app.inject({ method: 'DELETE', url: '/api/languages/' + languageId,
      headers: { cookie: memberCookie } });
    assert.equal(forbiddenLanguageDelete.statusCode, 404);
    const renamed = await app.inject({ method: 'PATCH', url: '/api/languages/' + languageId,
      headers: { cookie: ownerCookie }, payload: { name: 'English' } });
    assert.equal(renamed.statusCode, 200);
    const emptyLanguage = await app.inject({ method: 'POST', url: '/api/languages',
      headers: { cookie: ownerCookie }, payload: { name: 'Japonês' } });
    const removedLanguage = await app.inject({ method: 'DELETE', url: '/api/languages/' + emptyLanguage.json().id,
      headers: { cookie: ownerCookie } });
    assert.equal(removedLanguage.statusCode, 200);
    const stillOwnerDecks = await app.inject({ method: 'GET', url: '/api/decks', headers: { cookie: ownerCookie } });
    assert.equal(stillOwnerDecks.json().length, 1);
  } finally {
    await app.close();
    db.close();
  }

  const reopened = openDatabase(dataDir);
  try {
    const rows = reopened.prepare('SELECT name FROM decks').all() as { name: string }[];
    assert.deepEqual(rows.map((row) => row.name), ['Conversação']);
  } finally {
    reopened.close();
  }
});

