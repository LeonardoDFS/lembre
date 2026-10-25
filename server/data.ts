import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';
import { createBackup, dataDirectory } from './backup.js';
import { availableBackups, restoreFullBackup } from './restore.js';

type User = { id: string; name: string; role: 'owner' | 'member' };
type Auth = (db: Db, request: FastifyRequest, reply: FastifyReply) => User | null;
type Row = Record<string, unknown>;
type Document = {
  format: 'lembre-export'; version: 1; exportedAt: string;
  settings: Row; languages: Row[]; decks: Row[]; cards: Row[]; units: Row[]; logs: Row[]; audio?: Row[];
};
function rows(db: Db, sql: string, userId: string): Row[] {
  return db.prepare(sql).all(userId) as Row[];
}
function exportDocument(db: Db, userId: string): Document {
  return {
    format: 'lembre-export', version: 1, exportedAt: new Date().toISOString(),
    settings: db.prepare('SELECT new_per_day, daily_goal, timezone, theme FROM settings WHERE user_id = ?').get(userId) as Row,
    languages: rows(db, 'SELECT id, name, code, created_at FROM languages WHERE user_id = ?', userId),
    decks: rows(db, 'SELECT d.id, d.language_id, d.name, d.description, d.created_at, d.updated_at FROM decks d JOIN languages l ON l.id = d.language_id WHERE l.user_id = ?', userId),
    cards: rows(db, 'SELECT c.* FROM cards c JOIN decks d ON d.id = c.deck_id JOIN languages l ON l.id = d.language_id WHERE l.user_id = ?', userId),
    units: rows(db, 'SELECT u.* FROM review_units u JOIN cards c ON c.id = u.card_id JOIN decks d ON d.id = c.deck_id JOIN languages l ON l.id = d.language_id WHERE l.user_id = ?', userId),
    logs: rows(db, 'SELECT r.* FROM review_logs r JOIN review_units u ON u.id = r.unit_id JOIN cards c ON c.id = u.card_id JOIN decks d ON d.id = c.deck_id JOIN languages l ON l.id = d.language_id WHERE l.user_id = ?', userId),
    audio: (db.prepare('SELECT a.card_id, a.name, a.mime, a.bytes FROM card_audio a JOIN cards c ON c.id = a.card_id JOIN decks d ON d.id = c.deck_id JOIN languages l ON l.id = d.language_id WHERE l.user_id = ?').all(userId) as { card_id: string; name: string; mime: string; bytes: Buffer }[]).map(({ card_id, name, mime, bytes }) => ({ card_id, name, mime, data: bytes.toString('base64') }))
  };
}
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Arquivo inválido.');
  return value as Row;
}
function string(row: Row, key: string, max: number, nullable = false, allowEmpty = false): string | null {
  const value = row[key];
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > max || (!nullable && !allowEmpty && !value)) throw new Error('Campo inválido: ' + key);
  return value;
}
function json(row: Row, key: string): string {
  const value = string(row, key, 10000);
  try { JSON.parse(value!); } catch { throw new Error('JSON inválido: ' + key); }
  return value!;
}
function list(source: Row, key: string, max: number): Row[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length > max) throw new Error('Lista inválida: ' + key);
  return value.map(record);
}
function validate(value: unknown): Document {
  const data = record(value);
  if (data.format !== 'lembre-export' || data.version !== 1) throw new Error('Formato de exportação não reconhecido.');
  const settings = record(data.settings);
  const limit = settings.new_per_day;
  const dailyGoal = settings.daily_goal ?? 10;
  if (!Number.isInteger(limit) || Number(limit) < 0 || Number(limit) > 100 ||
      !Number.isInteger(dailyGoal) || Number(dailyGoal) < 1 || Number(dailyGoal) > 100 ||
      !['light', 'dark'].includes(String(settings.theme))) throw new Error('Ajustes inválidos.');
  settings.daily_goal = dailyGoal;
  const timezone = string(settings, 'timezone', 80)!;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { throw new Error('Fuso horário inválido.'); }
  const languages = list(data, 'languages', 100);
  const decks = list(data, 'decks', 1000);
  const cards = list(data, 'cards', 100000);
  const units = list(data, 'units', 200000);
  const logs = list(data, 'logs', 500000);
  const audio = data.audio === undefined ? [] : list(data, 'audio', 100000);
  const unique = (items: Row[], kind: string) => {
    const ids = new Set<string>();
    for (const row of items) {
      const id = string(row, 'id', 80)!;
      if (ids.has(id)) throw new Error('IDs duplicados em ' + kind);
      ids.add(id);
    }
    return ids;
  };
  const languagesIds = unique(languages, 'idiomas');
  const deckIds = unique(decks, 'baralhos');
  const cardIds = unique(cards, 'cartões');
  const unitIds = unique(units, 'revisões');
  unique(logs, 'histórico');
  const audioCards = new Set<string>();
  for (const row of audio) {
    const cardId = string(row, 'card_id', 80)!;
    if (!cardIds.has(cardId) || audioCards.has(cardId)) throw new Error('Áudio sem cartão ou duplicado.');
    audioCards.add(cardId);
    string(row, 'name', 120);
    if (!['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'].includes(String(row.mime))) throw new Error('Formato de áudio inválido.');
    const encoded = string(row, 'data', 7 * 1024 * 1024)!;
    if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded) || Buffer.from(encoded, 'base64').length > 5 * 1024 * 1024) throw new Error('Áudio inválido.');
  }
  for (const row of languages) {
    string(row, 'name', 80); string(row, 'code', 16, true); string(row, 'created_at', 40);
  }
  for (const row of decks) {
    if (!languagesIds.has(row.language_id as string)) throw new Error('Baralho sem idioma.');
    string(row, 'name', 100); string(row, 'description', 500, false, true); string(row, 'created_at', 40); string(row, 'updated_at', 40);
  }
  for (const row of cards) {
    if (!deckIds.has(row.deck_id as string)) throw new Error('Cartão sem baralho.');
    string(row, 'prompt', 1000); string(row, 'answer', 1000);
    string(row, 'example', 2000, false, true); string(row, 'notes', 2000, false, true); json(row, 'tags_json');
    if (!['forward', 'reverse', 'both'].includes(String(row.directions))) throw new Error('Sentido inválido.');
    string(row, 'created_at', 40); string(row, 'updated_at', 40);
  }
  for (const row of units) {
    if (!cardIds.has(row.card_id as string)) throw new Error('Revisão sem cartão.');
    if (!['forward', 'reverse'].includes(String(row.direction))) throw new Error('Sentido de revisão inválido.');
    json(row, 'fsrs_json'); string(row, 'due_at', 40); string(row, 'introduced_day', 10, true); string(row, 'created_at', 40);
  }
  for (const row of logs) {
    if (!unitIds.has(row.unit_id as string)) throw new Error('Histórico sem revisão.');
    if (![1, 2, 3, 4].includes(row.rating as number)) throw new Error('Avaliação inválida.');
    string(row, 'reviewed_at', 40); json(row, 'previous_state_json'); json(row, 'next_state_json');
    if (!Number.isInteger(row.elapsed_ms) || Number(row.elapsed_ms) < 0 || Number(row.elapsed_ms) > 600000) throw new Error('Tempo inválido.');
    string(row, 'reviewed_day', 10, true);
  }
  return data as Document;
}
function importDocument(db: Db, userId: string, data: Document): void {
  db.transaction(() => {
    db.prepare('DELETE FROM languages WHERE user_id = ?').run(userId);
    const languageIds = new Map<string, string>();
    const deckIds = new Map<string, string>();
    const cardIds = new Map<string, string>();
    const unitIds = new Map<string, string>();
    for (const row of data.languages) {
      const id = randomUUID(); languageIds.set(row.id as string, id);
      db.prepare('INSERT INTO languages(id, user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, userId, row.name, row.code, row.created_at);
    }
    for (const row of data.decks) {
      const id = randomUUID(); deckIds.set(row.id as string, id);
      db.prepare('INSERT INTO decks(id, language_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, languageIds.get(row.language_id as string), row.name, row.description, row.created_at, row.updated_at);
    }
    for (const row of data.cards) {
      const id = randomUUID(); cardIds.set(row.id as string, id);
      db.prepare('INSERT INTO cards(id, deck_id, prompt, answer, example, notes, tags_json, directions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, deckIds.get(row.deck_id as string), row.prompt, row.answer, row.example, row.notes, row.tags_json, row.directions, row.created_at, row.updated_at);
    }
    for (const row of data.audio ?? []) {
      db.prepare('INSERT INTO card_audio(card_id, name, mime, bytes) VALUES (?, ?, ?, ?)')
        .run(cardIds.get(row.card_id as string), row.name, row.mime, Buffer.from(row.data as string, 'base64'));
    }
    for (const row of data.units) {
      const id = randomUUID(); unitIds.set(row.id as string, id);
      db.prepare('INSERT INTO review_units(id, card_id, direction, fsrs_json, due_at, introduced_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, cardIds.get(row.card_id as string), row.direction, row.fsrs_json, row.due_at, row.introduced_day, row.created_at);
    }
    for (const row of data.logs) {
      db.prepare('INSERT INTO review_logs(id, unit_id, rating, reviewed_at, previous_state_json, next_state_json, elapsed_ms, reviewed_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), unitIds.get(row.unit_id as string), row.rating, row.reviewed_at, row.previous_state_json, row.next_state_json, row.elapsed_ms, row.reviewed_day);
    }
    db.prepare('UPDATE settings SET new_per_day = ?, daily_goal = ?, timezone = ?, theme = ? WHERE user_id = ?')
      .run(data.settings.new_per_day, data.settings.daily_goal ?? 10, data.settings.timezone, data.settings.theme, userId);
  })();
}

export function registerDataRoutes(app: FastifyInstance, db: Db, authenticate: Auth): void {
  app.post('/api/data/export', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const dir = join(dataDirectory(db), 'exports');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'lembre-' + user.name.replace(/[^a-zA-Z0-9_-]/g, '_') +
      '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    const document = exportDocument(db, user.id);
    writeFileSync(file, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx' });
    return { path: file, counts: { languages: document.languages.length, decks: document.decks.length,
      cards: document.cards.length, reviews: document.logs.length } };
  });

  app.post('/api/data/import', { bodyLimit: 100 * 1024 * 1024 }, async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    let data: Document;
    try { data = validate(record(request.body).data); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Arquivo inválido.' }); }
    const backupPath = await createBackup(db, 'pre-import');
    try { importDocument(db, user.id, data); }
    catch { return reply.code(400).send({ error: 'Não foi possível restaurar o arquivo. Seus dados anteriores foram preservados.' }); }
    return { ok: true, backupPath, counts: { languages: data.languages.length, decks: data.decks.length,
      cards: data.cards.length, reviews: data.logs.length } };
  });

  app.get('/api/data/backups', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode ver os backups completos.' });
    return availableBackups(db);
  });

  app.post('/api/data/restore-backup', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode restaurar o banco completo.' });
    let body: Row;
    try { body = record(request.body); }
    catch { return reply.code(400).send({ error: 'Pedido inválido.' }); }
    const name = body.name;
    const password = body.currentPassword;
    if (body.confirmation !== 'RESTAURAR' || typeof name !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Selecione um backup, informe sua senha e confirme a restauração.' });
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!bcrypt.compareSync(password, row.password_hash)) return reply.code(403).send({ error: 'Senha atual incorreta.' });
    try {
      const safetyCopy = await restoreFullBackup(db, name);
      reply.header('Set-Cookie', 'lembre_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return { ok: true, safetyCopy };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Não foi possível restaurar.' });
    }
  });

  app.post('/api/data/backup', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode copiar o banco completo.' });
    return { path: await createBackup(db, 'manual') };
  });
}

