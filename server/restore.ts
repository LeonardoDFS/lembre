import Database from 'better-sqlite3';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';
import { createBackup, dataDirectory } from './backup.js';

const tables = ['users', 'settings', 'languages', 'decks', 'cards', 'card_audio', 'review_units', 'review_logs'] as const;
const backupName = /^lembre-(?:auto|manual|pre-import|pre-restore)-[0-9TZ-]+\.sqlite$/;

export function availableBackups(db: Db): { name: string; bytes: number; modifiedAt: string }[] {
  const dir = join(dataDirectory(db), 'backups');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => backupName.test(name)).map((name) => {
    const stat = statSync(join(dir, name));
    return { name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

function columns(db: Db, table: string): string[] {
  return (db.pragma('table_info(' + table + ')') as { name: string }[]).map((column) => column.name);
}

export async function restoreFullBackup(db: Db, name: string): Promise<string> {
  if (!backupName.test(name) || !availableBackups(db).some((backup) => backup.name === name)) {
    throw new Error('Backup não encontrado.');
  }
  const source = new Database(join(dataDirectory(db), 'backups', name), { readonly: true, fileMustExist: true });
  try {
    const integrity = source.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('O arquivo de backup está danificado.');
    for (const table of tables) {
      const expected = columns(db, table);
      const found = columns(source, table);
      if (!expected.length || expected.length !== found.length || expected.some((column) => !found.includes(column))) {
        throw new Error('Este backup usa uma versão incompatível do banco.');
      }
    }
    const owner = source.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND active = 1")
      .get() as { count: number };
    if (!owner.count) throw new Error('O backup não contém uma conta principal ativa.');
    const safetyCopy = await createBackup(db, 'pre-restore');
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM sessions').run();
        db.prepare('DELETE FROM users').run();
        for (const table of tables) {
          const names = columns(db, table);
          const placeholders = names.map(() => '?').join(', ');
          const insert = db.prepare('INSERT INTO ' + table + ' (' + names.join(', ') + ') VALUES (' + placeholders + ')');
          for (const row of source.prepare('SELECT * FROM ' + table).iterate() as Iterable<Record<string, unknown>>) {
            insert.run(...names.map((column) => row[column] ?? null));
          }
        }
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length) throw new Error('O backup tem referências inválidas.');
      })();
    } catch {
      throw new Error('Não foi possível restaurar. O banco atual foi preservado.');
    }
    return safetyCopy;
  } finally {
    source.close();
  }
}

