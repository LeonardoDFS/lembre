import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { Db } from './db.js';
import { registerStudyRoutes } from './study.js';
import { registerDataRoutes } from './data.js';

type User = { id: string; name: string; role: 'owner' | 'member' };
type ErrorBody = { error: string };
const cookieName = 'lembre_session';
const thirtyDays = 30 * 24 * 60 * 60 * 1000;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function cookieValue(request: FastifyRequest): string | undefined {
  const entry = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(cookieName + '='));
  return entry?.slice(cookieName.length + 1);
}
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function setSession(db: Db, userId: string, reply: FastifyReply): void {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + thirtyDays).toISOString();
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expiresAt);
  reply.header('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${thirtyDays / 1000}`);
}
function currentUser(db: Db, request: FastifyRequest): User | null {
  const token = cookieValue(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (db.prepare(`SELECT u.id, u.name, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`)
    .get(tokenHash(token), new Date().toISOString()) as User | undefined) ?? null;
}
function requireUser(db: Db, request: FastifyRequest, reply: FastifyReply): User | null {
  const user = currentUser(db, request);
  if (!user) reply.code(401).send({ error: 'Faça login para continuar.' } satisfies ErrorBody);
  return user;
}
function bodyObject(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown> : {};
}
function localRequest(request: FastifyRequest): boolean {
  const ip = request.ip.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return Object.values(networkInterfaces()).some((entries) => entries?.some((entry) => entry.address === ip));
}

export function registerShutdownRoute(app: FastifyInstance, db: Db, stop: () => Promise<void>): void {
  let stopping = false;
  app.post('/api/shutdown', async (request, reply) => {
    if (!localRequest(request) || request.headers.origin !== 'http://' + request.headers.host) {
      return reply.code(403).send({ error: 'Desligue o app pelo navegador deste PC.' });
    }
    const user = currentUser(db, request);
    if (!user) return reply.code(401).send({ error: 'Faça login para continuar.' });
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode desligar o app.' });
    if (stopping) return { ok: true };
    stopping = true;
    reply.raw.once('finish', () => setTimeout(() => {
      void stop().catch((error) => app.log.error(error));
    }, 100));
    return { ok: true };
  });
}

export async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });

  app.get('/api/setup/status', async () => ({
    needsSetup: (db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }).total === 0
  }));

  app.post('/api/setup', async (request, reply) => {
    if (!localRequest(request)) return reply.code(403).send({ error: 'Crie a conta principal no PC.' });
    const body = bodyObject(request);
    const name = text(body.name, 80);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name || password.length < 10) return reply.code(400).send({ error: 'Informe um nome e uma senha com pelo menos 10 caracteres.' });
    const userId = randomUUID();
    try {
      db.transaction(() => {
        const total = (db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }).total;
        if (total > 0) throw new Error('already_setup');
        db.prepare('INSERT INTO users(id, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(userId, name, bcrypt.hashSync(password, 12), 'owner', new Date().toISOString());
        db.prepare('INSERT INTO settings(user_id) VALUES (?)').run(userId);
      })();
    } catch (error) {
      if (error instanceof Error && error.message === 'already_setup') return reply.code(409).send({ error: 'A conta principal já existe.' });
      throw error;
    }
    setSession(db, userId, reply);
    return reply.code(201).send({ id: userId, name, role: 'owner' });
  });

  app.post('/api/login', async (request, reply) => {
    const body = bodyObject(request);
    const name = text(body.name, 80);
    const password = typeof body.password === 'string' ? body.password : '';
    const row = db.prepare('SELECT id, name, role, password_hash FROM users WHERE name = ? AND active = 1')
      .get(name) as (User & { password_hash: string }) | undefined;
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return reply.code(401).send({ error: 'Nome ou senha incorretos.' });
    }
    setSession(db, row.id, reply);
    return { id: row.id, name: row.name, role: row.role };
  });

  app.post('/api/logout', async (request, reply) => {
    const token = cookieValue(request);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    reply.header('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

  app.get('/api/me', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (user) return user;
  });

  app.get('/api/users', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode gerenciar usuários.' });
    return db.prepare('SELECT id, name, role, active, created_at FROM users ORDER BY created_at').all();
  });

  app.post('/api/users', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode criar usuários.' });
    const body = bodyObject(request);
    const name = text(body.name, 80);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name || password.length < 10) return reply.code(400).send({ error: 'Informe um nome e uma senha com pelo menos 10 caracteres.' });
    const id = randomUUID();
    try {
      db.transaction(() => {
        db.prepare('INSERT INTO users(id, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, name, bcrypt.hashSync(password, 12), 'member', new Date().toISOString());
        db.prepare('INSERT INTO settings(user_id) VALUES (?)').run(id);
      })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) return reply.code(409).send({ error: 'Esse nome já está em uso.' });
      throw error;
    }
    return reply.code(201).send({ id, name, role: 'member' });
  });

  app.post('/api/me/password', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    const body = bodyObject(request);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 10) return reply.code(400).send({ error: 'A nova senha precisa ter pelo menos 10 caracteres.' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!bcrypt.compareSync(currentPassword, row.password_hash)) return reply.code(403).send({ error: 'Senha atual incorreta.' });
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    })();
    reply.header('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

  app.patch('/api/users/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode gerenciar usuários.' });
    const id = (request.params as { id: string }).id;
    const active = bodyObject(request).active;
    if (typeof active !== 'boolean') return reply.code(400).send({ error: 'Estado inválido.' });
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(id, 'member');
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    db.transaction(() => {
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
      if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    })();
    return { id, active };
  });

  app.post('/api/users/:id/password', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    if (user.role !== 'owner') return reply.code(403).send({ error: 'Apenas a conta principal pode gerenciar usuários.' });
    const id = (request.params as { id: string }).id;
    const password = bodyObject(request).password;
    if (typeof password !== 'string' || password.length < 10) return reply.code(400).send({ error: 'A nova senha precisa ter pelo menos 10 caracteres.' });
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(id, 'member');
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    })();
    return { ok: true };
  });

  app.get('/api/languages', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    return db.prepare('SELECT id, name, code, created_at FROM languages WHERE user_id = ? ORDER BY name').all(user.id);
  });

  app.post('/api/languages', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    const body = bodyObject(request);
    const name = text(body.name, 80);
    const code = text(body.code, 16) || null;
    if (!name) return reply.code(400).send({ error: 'Informe o nome do idioma.' });
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO languages(id, user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, user.id, name, code, new Date().toISOString());
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) return reply.code(409).send({ error: 'Esse idioma já existe.' });
      throw error;
    }
    return reply.code(201).send({ id, name, code });
  });

  app.patch('/api/languages/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    const name = text(bodyObject(request).name, 80);
    if (!name) return reply.code(400).send({ error: 'Informe o nome do idioma.' });
    try {
      const result = db.prepare('UPDATE languages SET name = ? WHERE id = ? AND user_id = ?').run(name, id, user.id);
      if (!result.changes) return reply.code(404).send({ error: 'Idioma não encontrado.' });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) return reply.code(409).send({ error: 'Esse idioma já existe.' });
      throw error;
    }
    return { id, name };
  });

  app.delete('/api/languages/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    const result = db.prepare('DELETE FROM languages WHERE id = ? AND user_id = ?').run(id, user.id);
    if (!result.changes) return reply.code(404).send({ error: 'Idioma não encontrado.' });
    return { ok: true };
  });

  app.get('/api/decks', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    return db.prepare(`SELECT d.id, d.name, d.description, d.language_id AS languageId, l.name AS languageName,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cardCount
      FROM decks d JOIN languages l ON l.id = d.language_id
      WHERE l.user_id = ? ORDER BY l.name, d.name`).all(user.id);
  });

  app.post('/api/decks', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    const body = bodyObject(request);
    const name = text(body.name, 100);
    const description = text(body.description, 500);
    const languageId = text(body.languageId, 40);
    if (!name || !languageId) return reply.code(400).send({ error: 'Informe o nome e o idioma do baralho.' });
    const language = db.prepare('SELECT id FROM languages WHERE id = ? AND user_id = ?').get(languageId, user.id);
    if (!language) return reply.code(404).send({ error: 'Idioma não encontrado.' });
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO decks(id, language_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, languageId, name, description, now, now);
    return reply.code(201).send({ id, name, description, languageId });
  });

  app.patch('/api/decks/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    const body = bodyObject(request);
    const name = text(body.name, 100);
    const description = text(body.description, 500);
    if (!name) return reply.code(400).send({ error: 'Informe o nome do baralho.' });
    const result = db.prepare(`UPDATE decks SET name = ?, description = ?, updated_at = ?
      WHERE id = ? AND language_id IN (SELECT id FROM languages WHERE user_id = ?)`)
      .run(name, description, new Date().toISOString(), id, user.id);
    if (!result.changes) return reply.code(404).send({ error: 'Baralho não encontrado.' });
    return { id, name, description };
  });

  app.delete('/api/decks/:id', async (request, reply) => {
    const user = requireUser(db, request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    const result = db.prepare(`DELETE FROM decks WHERE id = ?
      AND language_id IN (SELECT id FROM languages WHERE user_id = ?)`).run(id, user.id);
    if (!result.changes) return reply.code(404).send({ error: 'Baralho não encontrado.' });
    return { ok: true };
  });

  registerStudyRoutes(app, db, requireUser);
  registerDataRoutes(app, db, requireUser);

  const webDist = resolve(process.cwd(), 'web', 'dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Rota não encontrada.' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}

