import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Db = Database.Database;

export function openDatabase(dataDir = process.env.LEMBRE_DATA_DIR ?? resolve(process.cwd(), '..', 'lembre-data')): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'lembre.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS languages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, name)
    );
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      language_id TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      example TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      directions TEXT NOT NULL DEFAULT 'forward',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_units (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('forward', 'reverse')),
      fsrs_json TEXT NOT NULL,
      due_at TEXT NOT NULL,
      introduced_day TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(card_id, direction)
    );
    CREATE TABLE IF NOT EXISTS review_logs (
      id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL REFERENCES review_units(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      reviewed_at TEXT NOT NULL,
      previous_state_json TEXT NOT NULL,
      next_state_json TEXT NOT NULL,
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      reviewed_day TEXT
    );
    CREATE TABLE IF NOT EXISTS card_audio (
      card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      new_per_day INTEGER NOT NULL DEFAULT 10,
      review_per_session INTEGER NOT NULL DEFAULT 10,
      timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      theme TEXT NOT NULL DEFAULT 'light'
    );
    CREATE INDEX IF NOT EXISTS idx_languages_user ON languages(user_id);
    CREATE INDEX IF NOT EXISTS idx_decks_language ON decks(language_id);
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_due ON review_units(due_at);
  `);
  const unitColumns = db.pragma('table_info(review_units)') as { name: string }[];
  if (!unitColumns.some((column) => column.name === 'introduced_day')) {
    db.exec('ALTER TABLE review_units ADD COLUMN introduced_day TEXT');
  }
  const settingsColumns = db.pragma('table_info(settings)') as { name: string }[];
  if (!settingsColumns.some((column) => column.name === 'review_per_session')) {
    db.exec('ALTER TABLE settings ADD COLUMN review_per_session INTEGER NOT NULL DEFAULT 10');
  }
  if (!settingsColumns.some((column) => column.name === 'theme')) {
    db.exec("ALTER TABLE settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'light'");
  }
  const logColumns = db.pragma('table_info(review_logs)') as { name: string }[];
  if (!logColumns.some((column) => column.name === 'elapsed_ms')) {
    db.exec('ALTER TABLE review_logs ADD COLUMN elapsed_ms INTEGER NOT NULL DEFAULT 0');
  }
  if (!logColumns.some((column) => column.name === 'reviewed_day')) {
    db.exec('ALTER TABLE review_logs ADD COLUMN reviewed_day TEXT');
  }
  return db;
}



