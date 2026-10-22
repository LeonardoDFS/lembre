import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createEmptyCard, fsrs, Rating, type CardInput, type Grade } from 'ts-fsrs';
import { randomInt, randomUUID } from 'node:crypto';
import type { Db } from './db.js';

type User = { id: string; name: string; role: 'owner' | 'member' };
type Auth = (db: Db, request: FastifyRequest, reply: FastifyReply) => User | null;
type Row = {
  unitId: string; direction: 'forward' | 'reverse'; dueAt: string; introducedDay: string | null;
  fsrsJson: string; cardId: string; prompt: string; answer: string; example: string; notes: string;
  deckId: string; deckName: string; languageName: string; createdAt: string; hasAudio: number;
};
const scheduler = fsrs();

function object(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown> : {};
}
function field(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function localDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function ownerDeck(db: Db, deckId: string, userId: string): boolean {
  return !!db.prepare('SELECT d.id FROM decks d JOIN languages l ON l.id = d.language_id WHERE d.id = ? AND l.user_id = ?').get(deckId, userId);
}
function ownerCard(db: Db, cardId: string, userId: string): boolean {
  return !!db.prepare(`SELECT c.id FROM cards c JOIN decks d ON d.id = c.deck_id
    JOIN languages l ON l.id = d.language_id WHERE c.id = ? AND l.user_id = ?`).get(cardId, userId);
}
function getTimezone(db: Db, userId: string): string {
  return (db.prepare('SELECT timezone FROM settings WHERE user_id = ?').get(userId) as { timezone: string } | undefined)?.timezone ?? 'America/Sao_Paulo';
}
function unitsFor(directions: string): ('forward' | 'reverse')[] {
  return directions === 'both' ? ['forward', 'reverse'] : directions === 'reverse' ? ['reverse'] : ['forward'];
}
function ownedRows(db: Db, userId: string, deckId: string | null): Row[] {
  return db.prepare(`SELECT u.id AS unitId, u.direction, u.due_at AS dueAt, u.introduced_day AS introducedDay,
      u.fsrs_json AS fsrsJson, c.id AS cardId, c.prompt, c.answer, c.example, c.notes,
      d.id AS deckId, d.name AS deckName, l.name AS languageName, u.created_at AS createdAt,
      EXISTS(SELECT 1 FROM card_audio a WHERE a.card_id = c.id) AS hasAudio
    FROM review_units u JOIN cards c ON c.id = u.card_id
    JOIN decks d ON d.id = c.deck_id JOIN languages l ON l.id = d.language_id
    WHERE l.user_id = ? AND (? IS NULL OR d.id = ?)
    ORDER BY u.due_at, u.created_at`).all(userId, deckId, deckId) as Row[];
}
function shuffle<T>(items: T[]): T[] {
  const mixed = [...items];
  for (let index = mixed.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [mixed[index], mixed[other]] = [mixed[other], mixed[index]];
  }
  return mixed;
}

function makeQueue(db: Db, userId: string, deckId: string | null, mode: 'all' | 'new' | 'due' = 'all', reviewLimit = 0) {
  const now = new Date();
  const today = localDay(now, getTimezone(db, userId));
  const introducedToday = (db.prepare(`SELECT COUNT(*) AS count FROM review_units u
    JOIN cards c ON c.id = u.card_id JOIN decks d ON d.id = c.deck_id
    JOIN languages l ON l.id = d.language_id WHERE l.user_id = ? AND u.introduced_day = ?`)
    .get(userId, today) as { count: number }).count;
  const limit = (db.prepare('SELECT new_per_day FROM settings WHERE user_id = ?').get(userId) as { new_per_day: number } | undefined)?.new_per_day ?? 10;
  const rows = ownedRows(db, userId, deckId);
  const due = shuffle(rows.filter((row) => row.introducedDay !== null && row.dueAt <= now.toISOString()));
  const fresh = shuffle(rows.filter((row) => row.introducedDay === null));
  const availableNew = Math.max(0, limit - introducedToday);
  const dueForSession = mode === 'new' ? [] : due;
  const newForSession = mode === 'due' ? [] : fresh.slice(0, availableNew);
  const dueWithinLimit = reviewLimit > 0 ? dueForSession.slice(0, reviewLimit) : dueForSession;
  const chosen = [...newForSession, ...dueWithinLimit];
  return {
    dueCount: due.length,
    newCount: Math.min(fresh.length, availableNew),
    items: chosen.map((row, index) => ({
      unitId: row.unitId, cardId: row.cardId, deckId: row.deckId, deckName: row.deckName,
      languageName: row.languageName, direction: row.direction, isNew: row.introducedDay === null,
      prompt: row.direction === 'forward' ? row.prompt : row.answer,
      answer: row.direction === 'forward' ? row.answer : row.prompt,
      example: row.example, notes: row.notes, hasAudio: !!row.hasAudio,
      intervals: index === 0 ? [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]
        .map((rating) => intervalLabel(scheduler.next(cardInput(row.fsrsJson), now, rating as Grade).card.due, now)) : undefined
    }))
  };
}
function intervalLabel(due: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return minutes + ' min';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' h';
  const days = Math.round(minutes / 1440);
  if (days < 30) return days + (days === 1 ? ' dia' : ' dias');
  const months = Math.round(days / 30);
  if (months < 12) return months + (months === 1 ? ' mês' : ' meses');
  const years = Math.round(days / 365);
  return years + (years === 1 ? ' ano' : ' anos');
}
function cardInput(value: string): CardInput {
  return JSON.parse(value) as CardInput;
}

export function registerStudyRoutes(app: FastifyInstance, db: Db, authenticate: Auth): void {
  app.get('/api/settings', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    return db.prepare('SELECT new_per_day AS newPerDay, review_per_session AS reviewPerSession, timezone, theme FROM settings WHERE user_id = ?').get(user.id);
  });

  app.patch('/api/settings', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const body = object(request);
    const current = db.prepare('SELECT new_per_day AS newPerDay, review_per_session AS reviewPerSession, theme FROM settings WHERE user_id = ?')
      .get(user.id) as { newPerDay: number; reviewPerSession: number; theme: string };
    const theme = body.theme === undefined ? current.theme : body.theme;
    const limit = body.newPerDay === undefined ? current.newPerDay : body.newPerDay;
    const reviewLimit = body.reviewPerSession === undefined ? current.reviewPerSession : body.reviewPerSession;
    if (!['light', 'dark'].includes(String(theme)) || !Number.isInteger(limit) || Number(limit) < 0 || Number(limit) > 100
      || !Number.isInteger(reviewLimit) || Number(reviewLimit) < 0 || Number(reviewLimit) > 100) {
      return reply.code(400).send({ error: 'Preferência inválida.' });
    }
    db.prepare('UPDATE settings SET theme = ?, new_per_day = ?, review_per_session = ? WHERE user_id = ?')
      .run(theme, limit, reviewLimit, user.id);
    return { theme, newPerDay: limit, reviewPerSession: reviewLimit };
  });

  app.get('/api/study/stats', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const today = localDay(new Date(), getTimezone(db, user.id));
    const stats = db.prepare(`SELECT COUNT(*) AS totalReviews,
      SUM(CASE WHEN r.reviewed_day = ? THEN 1 ELSE 0 END) AS reviewedToday,
      SUM(CASE WHEN r.reviewed_day = ? THEN r.elapsed_ms ELSE 0 END) AS timeTodayMs
      FROM review_logs r JOIN review_units u ON u.id = r.unit_id
      JOIN cards c ON c.id = u.card_id JOIN decks d ON d.id = c.deck_id
      JOIN languages l ON l.id = d.language_id WHERE l.user_id = ?`)
      .get(today, today, user.id) as { totalReviews: number; reviewedToday: number; timeTodayMs: number };
    const days = db.prepare(`SELECT DISTINCT r.reviewed_day AS day FROM review_logs r
      JOIN review_units u ON u.id = r.unit_id JOIN cards c ON c.id = u.card_id
      JOIN decks d ON d.id = c.deck_id JOIN languages l ON l.id = d.language_id
      WHERE l.user_id = ? AND r.reviewed_day IS NOT NULL ORDER BY r.reviewed_day DESC`)
      .all(user.id) as { day: string }[];
    const daySet = new Set(days.map((row) => row.day));
    let streakDays = 0;
    let cursor = new Date(today + 'T12:00:00Z');
    if (!daySet.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (daySet.has(cursor.toISOString().slice(0, 10))) {
      streakDays++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return { totalReviews: stats.totalReviews, reviewedToday: stats.reviewedToday ?? 0,
      timeTodayMs: stats.timeTodayMs ?? 0, streakDays };
  });

  app.get('/api/study/activity', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const today = localDay(new Date(), getTimezone(db, user.id));
    const start = new Date(today + 'T12:00:00Z');
    start.setUTCDate(start.getUTCDate() - 364);
    const firstDay = start.toISOString().slice(0, 10);
    const rows = db.prepare(`SELECT r.reviewed_day AS day, COUNT(*) AS count
      FROM review_logs r JOIN review_units u ON u.id = r.unit_id
      JOIN cards c ON c.id = u.card_id JOIN decks d ON d.id = c.deck_id
      JOIN languages l ON l.id = d.language_id
      WHERE l.user_id = ? AND r.reviewed_day BETWEEN ? AND ?
      GROUP BY r.reviewed_day ORDER BY r.reviewed_day`)
      .all(user.id, firstDay, today) as { day: string; count: number }[];
    return { today, days: rows };
  });

  app.get('/api/cards', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const deckId = field((request.query as { deckId?: string }).deckId, 40);
    if (!deckId || !ownerDeck(db, deckId, user.id)) return reply.code(404).send({ error: 'Baralho não encontrado.' });
    const cards = db.prepare(`SELECT c.id, c.deck_id AS deckId, c.prompt, c.answer, c.example, c.notes,
      c.tags_json AS tagsJson, c.directions, c.created_at AS createdAt,
      EXISTS(SELECT 1 FROM card_audio a WHERE a.card_id = c.id) AS hasAudio
      FROM cards c WHERE c.deck_id = ? ORDER BY c.created_at DESC`).all(deckId) as Record<string, unknown>[];
    return cards.map(({ tagsJson, ...card }) => ({ ...card, tags: JSON.parse(tagsJson as string) }));
  });

  app.get('/api/cards/:id/audio', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!ownerCard(db, id, user.id)) return reply.code(404).send({ error: 'Cartão não encontrado.' });
    const audio = db.prepare('SELECT name, mime, bytes FROM card_audio WHERE card_id = ?')
      .get(id) as { name: string; mime: string; bytes: Buffer } | undefined;
    if (!audio) return reply.code(404).send({ error: 'Áudio não encontrado.' });
    return reply.header('Content-Type', audio.mime).header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', 'inline').send(audio.bytes);
  });

  app.post('/api/cards/:id/audio', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!ownerCard(db, id, user.id)) return reply.code(404).send({ error: 'Cartão não encontrado.' });
    const body = object(request);
    const name = field(body.name, 120);
    const data = body.data;
    if (!name || typeof data !== 'string' || !/^[a-zA-Z0-9+/]+={0,2}$/.test(data)) {
      return reply.code(400).send({ error: 'Arquivo de áudio inválido.' });
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length < 12 || bytes.length > 5 * 1024 * 1024) return reply.code(400).send({ error: 'O áudio deve ter até 5 MB.' });
    const mime = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE' ? 'audio/wav'
      : bytes.subarray(0, 4).toString() === 'OggS' ? 'audio/ogg'
      : bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ? 'audio/mpeg'
      : bytes.subarray(4, 8).toString() === 'ftyp' ? 'audio/mp4'
      : bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 ? 'audio/webm'
      : null;
    if (!mime) return reply.code(400).send({ error: 'Use MP3, WAV, OGG, M4A ou WebM.' });
    db.prepare('INSERT INTO card_audio(card_id, name, mime, bytes) VALUES (?, ?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET name = excluded.name, mime = excluded.mime, bytes = excluded.bytes')
      .run(id, name, mime, bytes);
    return { ok: true, name, mime };
  });

  app.delete('/api/cards/:id/audio', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!ownerCard(db, id, user.id)) return reply.code(404).send({ error: 'Cartão não encontrado.' });
    db.prepare('DELETE FROM card_audio WHERE card_id = ?').run(id);
    return { ok: true };
  });

  app.post('/api/cards', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const body = object(request);
    const deckId = field(body.deckId, 40);
    const prompt = field(body.prompt, 1000);
    const answer = field(body.answer, 1000);
    const example = field(body.example, 2000);
    const notes = field(body.notes, 2000);
    const directions = body.directions ?? 'forward';
    const tags = Array.isArray(body.tags) ? body.tags.map((tag) => field(tag, 30)).filter(Boolean).slice(0, 10) : [];
    if (!ownerDeck(db, deckId, user.id)) return reply.code(404).send({ error: 'Baralho não encontrado.' });
    if (!prompt || !answer || !['forward', 'reverse', 'both'].includes(String(directions))) {
      return reply.code(400).send({ error: 'Preencha pergunta e resposta e escolha um sentido válido.' });
    }
    const id = randomUUID();
    const now = new Date();
    db.transaction(() => {
      db.prepare(`INSERT INTO cards(id, deck_id, prompt, answer, example, notes, tags_json, directions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, deckId, prompt, answer, example, notes, JSON.stringify(tags), directions, now.toISOString(), now.toISOString());
      for (const direction of unitsFor(String(directions))) {
        const empty = createEmptyCard(now);
        db.prepare(`INSERT INTO review_units(id, card_id, direction, fsrs_json, due_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), id, direction, JSON.stringify(empty), empty.due.toISOString(), now.toISOString());
      }
    })();
    return reply.code(201).send({ id, deckId, prompt, answer, example, notes, tags, directions });
  });

  app.patch('/api/cards/:id', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!ownerCard(db, id, user.id)) return reply.code(404).send({ error: 'Cartão não encontrado.' });
    const body = object(request);
    const prompt = field(body.prompt, 1000);
    const answer = field(body.answer, 1000);
    const example = field(body.example, 2000);
    const notes = field(body.notes, 2000);
    const tags = Array.isArray(body.tags) ? body.tags.map((tag) => field(tag, 30)).filter(Boolean).slice(0, 10) : [];
    if (!prompt || !answer) return reply.code(400).send({ error: 'Preencha pergunta e resposta.' });
    db.prepare(`UPDATE cards SET prompt = ?, answer = ?, example = ?, notes = ?, tags_json = ?, updated_at = ? WHERE id = ?`)
      .run(prompt, answer, example, notes, JSON.stringify(tags), new Date().toISOString(), id);
    return { id, prompt, answer, example, notes, tags };
  });

  app.delete('/api/cards/:id', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!ownerCard(db, id, user.id)) return reply.code(404).send({ error: 'Cartão não encontrado.' });
    db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    return { ok: true };
  });

  app.post('/api/cards/:id/reset', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    if (!ownerCard(db, id, user.id)) return reply.code(404).send({ error: 'Cartão não encontrado.' });
    const direction = object(request).direction;
    if (direction !== 'all' && direction !== 'forward' && direction !== 'reverse') {
      return reply.code(400).send({ error: 'Escolha o sentido para reiniciar.' });
    }
    const units = db.prepare('SELECT id, direction FROM review_units WHERE card_id = ?').all(id) as { id: string; direction: string }[];
    const selected = units.filter((unit) => direction === 'all' || unit.direction === direction);
    const now = new Date();
    db.transaction(() => {
      for (const unit of selected) {
        const empty = createEmptyCard(now);
        db.prepare('DELETE FROM review_logs WHERE unit_id = ?').run(unit.id);
        db.prepare('UPDATE review_units SET fsrs_json = ?, due_at = ?, introduced_day = NULL WHERE id = ?')
          .run(JSON.stringify(empty), empty.due.toISOString(), unit.id);
      }
    })();
    return { reset: selected.length };
  });

  app.get('/api/study/practice', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const deckId = field((request.query as { deckId?: string }).deckId, 40) || null;
    if (deckId && !ownerDeck(db, deckId, user.id)) return reply.code(404).send({ error: 'Baralho não encontrado.' });
    const practiced = shuffle(ownedRows(db, user.id, deckId)
      .filter((row) => row.introducedDay !== null));
    return { dueCount: 0, newCount: 0, items: practiced.map((row) => ({
      unitId: row.unitId, cardId: row.cardId, deckId: row.deckId, deckName: row.deckName,
      languageName: row.languageName, direction: row.direction, isNew: false,
      prompt: row.direction === 'forward' ? row.prompt : row.answer,
      answer: row.direction === 'forward' ? row.answer : row.prompt,
      example: row.example, notes: row.notes, hasAudio: !!row.hasAudio
    })) };
  });

  app.get('/api/study/queue', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const deckId = field((request.query as { deckId?: string }).deckId, 40) || null;
    if (deckId && !ownerDeck(db, deckId, user.id)) return reply.code(404).send({ error: 'Baralho não encontrado.' });
    const query = request.query as { mode?: string; reviewLimit?: string };
    const mode = query.mode ?? 'all';
    const reviewLimit = query.reviewLimit === undefined ? 0 : Number(query.reviewLimit);
    if (!['all', 'new', 'due'].includes(mode) || !Number.isInteger(reviewLimit) || reviewLimit < 0 || reviewLimit > 100) {
      return reply.code(400).send({ error: 'Tipo de sessão ou limite inválido.' });
    }
    return makeQueue(db, user.id, deckId, mode as 'all' | 'new' | 'due', reviewLimit);
  });

  app.post('/api/study/:unitId/rate', async (request, reply) => {
    const user = authenticate(db, request, reply);
    if (!user) return;
    const unitId = (request.params as { unitId: string }).unitId;
    const body = object(request);
    const rating = body.rating;
    const elapsedMs = typeof body.elapsedMs === 'number' && Number.isFinite(body.elapsedMs)
      ? Math.max(0, Math.min(600000, Math.round(body.elapsedMs))) : 0;
    if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(rating as Rating)) {
      return reply.code(400).send({ error: 'Avaliação inválida.' });
    }
    const row = db.prepare(`SELECT u.id, u.fsrs_json AS fsrsJson, u.due_at AS dueAt, u.introduced_day AS introducedDay
      FROM review_units u JOIN cards c ON c.id = u.card_id JOIN decks d ON d.id = c.deck_id
      JOIN languages l ON l.id = d.language_id WHERE u.id = ? AND l.user_id = ?`)
      .get(unitId, user.id) as { id: string; fsrsJson: string; dueAt: string; introducedDay: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'Revisão não encontrada.' });
    const now = new Date();
    if (row.dueAt > now.toISOString()) return reply.code(409).send({ error: 'Este cartão ainda não está disponível para revisão.' });
    const next = scheduler.next(cardInput(row.fsrsJson), now, rating as Grade);
    const introducedDay = row.introducedDay ?? localDay(now, getTimezone(db, user.id));
    const updated = db.transaction(() => {
      const result = db.prepare(`UPDATE review_units SET fsrs_json = ?, due_at = ?, introduced_day = ?
        WHERE id = ? AND fsrs_json = ?`)
        .run(JSON.stringify(next.card), next.card.due.toISOString(), introducedDay, unitId, row.fsrsJson);
      if (!result.changes) return false;
      db.prepare(`INSERT INTO review_logs(id, unit_id, rating, reviewed_at, previous_state_json, next_state_json, elapsed_ms, reviewed_day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), unitId, rating, now.toISOString(), row.fsrsJson, JSON.stringify(next.card),
          elapsedMs, localDay(now, getTimezone(db, user.id)));
      return true;
    })();
    if (!updated) return reply.code(409).send({ error: 'Este cartão já foi avaliado. Atualize a sessão.' });
    return { nextDueAt: next.card.due.toISOString(), queue: makeQueue(db, user.id, null) };
  });
}

