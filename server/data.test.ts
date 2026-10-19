import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';
import { createBackup } from './backup.js';

const root = resolve(process.cwd(), 'tmp-test');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'data-'));
after(() => {
  const full = resolve(dir);
  if (!full.startsWith(root + sep)) throw new Error('Unsafe test cleanup path');
  rmSync(full, { recursive: true, force: true });
});

test('exportação, restauração, áudio, estatísticas e isolamento por conta', async () => {
  const db = openDatabase(dir);
  const app = await buildApp(db);
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/setup', payload: { name: 'Dono', password: 'senha-teste-123' } });
    const owner = { cookie: setup.headers['set-cookie']!.toString().split(';')[0] };
    const language = await app.inject({ method: 'POST', url: '/api/languages', headers: owner, payload: { name: 'Inglês' } });
    const deck = await app.inject({ method: 'POST', url: '/api/decks', headers: owner, payload: { name: 'Frases', languageId: language.json().id } });
    const card = await app.inject({ method: 'POST', url: '/api/cards', headers: owner,
      payload: { deckId: deck.json().id, prompt: '**Good** morning', answer: 'Bom ==dia==', directions: 'forward' } });
    const cardId = card.json().id;
    const audioBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(20)]);
    const upload = await app.inject({ method: 'POST', url: '/api/cards/' + cardId + '/audio', headers: owner,
      payload: { name: 'fala.wav', data: audioBytes.toString('base64') } });
    assert.equal(upload.statusCode, 200);
    const heard = await app.inject({ method: 'GET', url: '/api/cards/' + cardId + '/audio', headers: owner });
    assert.equal(heard.statusCode, 200);
    assert.deepEqual(heard.rawPayload, audioBytes);

    const queue = await app.inject({ method: 'GET', url: '/api/study/queue', headers: owner });
    assert.equal(queue.json().items[0].hasAudio, true);
    assert.equal(queue.json().items[0].intervals.length, 4);
    const rated = await app.inject({ method: 'POST', url: '/api/study/' + queue.json().items[0].unitId + '/rate',
      headers: owner, payload: { rating: 3, elapsedMs: 32000 } });
    assert.equal(rated.statusCode, 200);
    const stats = await app.inject({ method: 'GET', url: '/api/study/stats', headers: owner });
    assert.equal(stats.json().reviewedToday, 1);
    assert.equal(stats.json().timeTodayMs, 32000);
    assert.equal(stats.json().streakDays, 1);

    const member = await app.inject({ method: 'POST', url: '/api/users', headers: owner, payload: { name: 'Outra', password: 'senha-outra-123' } });
    assert.equal(member.statusCode, 201);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Outra', password: 'senha-outra-123' } });
    const other = { cookie: login.headers['set-cookie']!.toString().split(';')[0] };
    const privateAudio = await app.inject({ method: 'GET', url: '/api/cards/' + cardId + '/audio', headers: other });
    assert.equal(privateAudio.statusCode, 404);
    const otherLanguage = await app.inject({ method: 'POST', url: '/api/languages', headers: other, payload: { name: 'Japonês' } });
    assert.equal(otherLanguage.statusCode, 201);

    const exported = await app.inject({ method: 'POST', url: '/api/data/export', headers: owner });
    assert.equal(exported.statusCode, 200);
    assert.ok(existsSync(exported.json().path));
    const document = JSON.parse(readFileSync(exported.json().path, 'utf8'));
    assert.equal(document.audio.length, 1);
    assert.equal(document.logs.length, 1);
    const deleted = await app.inject({ method: 'DELETE', url: '/api/cards/' + cardId, headers: owner });
    assert.equal(deleted.statusCode, 200);
    const restored = await app.inject({ method: 'POST', url: '/api/data/import', headers: owner, payload: { data: document } });
    assert.equal(restored.statusCode, 200, JSON.stringify(restored.json()));
    assert.ok(existsSync(restored.json().backupPath));
    const after = await app.inject({ method: 'GET', url: '/api/decks', headers: owner });
    assert.equal(after.json()[0].cardCount, 1);
    const cards = await app.inject({ method: 'GET', url: '/api/cards?deckId=' + after.json()[0].id, headers: owner });
    assert.equal(cards.json()[0].hasAudio, 1);
    const restoredAudio = await app.inject({ method: 'GET', url: '/api/cards/' + cards.json()[0].id + '/audio', headers: owner });
    assert.deepEqual(restoredAudio.rawPayload, audioBytes);
    const restoredStats = await app.inject({ method: 'GET', url: '/api/study/stats', headers: owner });
    assert.equal(restoredStats.json().totalReviews, 1);
    const otherLanguages = await app.inject({ method: 'GET', url: '/api/languages', headers: other });
    assert.equal(otherLanguages.json().length, 1);
    assert.equal(otherLanguages.json()[0].name, 'Japonês');

    const invalid = await app.inject({ method: 'POST', url: '/api/data/import', headers: owner, payload: { data: { ...document, format: 'wrong' } } });
    assert.equal(invalid.statusCode, 400);
    const stillThere = await app.inject({ method: 'GET', url: '/api/decks', headers: owner });
    assert.equal(stillThere.json()[0].cardCount, 1);
    const auto = await createBackup(db, 'auto');
    assert.ok(existsSync(auto));
    assert.equal(await createBackup(db, 'auto'), auto);
  } finally {
    await app.close();
    db.close();
  }
});

