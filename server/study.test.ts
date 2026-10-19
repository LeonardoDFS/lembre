import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';

const root = resolve(process.cwd(), 'tmp-test');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'study-'));
after(() => {
  const full = resolve(dir);
  if (!full.startsWith(root + sep)) throw new Error('Unsafe test cleanup path');
  rmSync(full, { recursive: true, force: true });
});

test('cartões bidirecionais, limite diário, revisão e reset', async () => {
  const db = openDatabase(dir);
  const app = await buildApp(db);
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/setup', payload: { name: 'Dono', password: 'senha-teste-123' } });
    assert.equal(setup.statusCode, 201);
    const cookie = setup.headers['set-cookie']?.toString().split(';')[0];
    assert.ok(cookie);
    const headers = { cookie };
    const language = await app.inject({ method: 'POST', url: '/api/languages', headers, payload: { name: 'Inglês' } });
    const deck = await app.inject({ method: 'POST', url: '/api/decks', headers, payload: { name: 'Vocabulário', languageId: language.json().id } });
    const deckId = deck.json().id;

    const created = await app.inject({ method: 'POST', url: '/api/cards', headers, payload: {
      deckId, prompt: 'house', answer: 'casa', example: 'This is my house.', directions: 'both'
    } });
    assert.equal(created.statusCode, 201);
    const cardId = created.json().id;
    const allCards = await app.inject({ method: 'GET', url: '/api/cards?deckId=' + deckId, headers });
    assert.equal(allCards.json().length, 1);

    const settings = await app.inject({ method: 'PATCH', url: '/api/settings', headers, payload: { newPerDay: 1, theme: 'dark' } });
    assert.equal(settings.statusCode, 200);
    const queue = await app.inject({ method: 'GET', url: '/api/study/queue', headers });
    assert.equal(queue.json().newCount, 1);
    assert.equal(queue.json().items.length, 1);
    const first = queue.json().items[0];
    assert.equal(first.prompt, 'house');

    const rated = await app.inject({ method: 'POST', url: '/api/study/' + first.unitId + '/rate', headers, payload: { rating: 3 } });
    assert.equal(rated.statusCode, 200);
    assert.ok(rated.json().nextDueAt);
    const afterRating = await app.inject({ method: 'GET', url: '/api/study/queue', headers });
    assert.equal(afterRating.json().newCount, 0);

    const activity = await app.inject({ method: 'GET', url: '/api/study/activity', headers });
    assert.equal(activity.statusCode, 200);
    assert.equal(activity.json().days.reduce((sum: number, day: { count: number }) => sum + day.count, 0), 1);

    const logs = db.prepare('SELECT COUNT(*) AS count FROM review_logs').get() as { count: number };
    assert.equal(logs.count, 1);
    const edited = await app.inject({ method: 'PATCH', url: '/api/cards/' + cardId, headers, payload: {
      prompt: 'a house', answer: 'uma casa', example: '', notes: '', tags: ['substantivo']
    } });
    assert.equal(edited.statusCode, 200);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM review_logs').get() as { count: number }).count, 1);

    const reset = await app.inject({ method: 'POST', url: '/api/cards/' + cardId + '/reset', headers, payload: { direction: 'forward' } });
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().reset, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM review_logs').get() as { count: number }).count, 0);
    const afterReset = await app.inject({ method: 'GET', url: '/api/study/queue', headers });
    assert.equal(afterReset.json().newCount, 1);

    const member = await app.inject({ method: 'POST', url: '/api/users', headers, payload: { name: 'Visitante', password: 'senha-visitante-123' } });
    assert.equal(member.statusCode, 201);
    const memberLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Visitante', password: 'senha-visitante-123' } });
    const memberCookie = memberLogin.headers['set-cookie']?.toString().split(';')[0];
    assert.ok(memberCookie);
    const memberHeaders = { cookie: memberCookie };
    const otherCards = await app.inject({ method: 'GET', url: '/api/cards?deckId=' + deckId, headers: memberHeaders });
    assert.equal(otherCards.statusCode, 404);
    const otherActivity = await app.inject({ method: 'GET', url: '/api/study/activity', headers: memberHeaders });
    assert.deepEqual(otherActivity.json().days, []);
    const otherQueue = await app.inject({ method: 'GET', url: '/api/study/queue', headers: memberHeaders });
    assert.equal(otherQueue.json().items.length, 0);
    const otherRating = await app.inject({ method: 'POST', url: '/api/study/' + first.unitId + '/rate', headers: memberHeaders, payload: { rating: 3 } });
    assert.equal(otherRating.statusCode, 404);

    const persistedTheme = await app.inject({ method: 'GET', url: '/api/settings', headers });
    assert.equal(persistedTheme.json().theme, 'dark');
  } finally {
    await app.close();
    db.close();
  }
});

