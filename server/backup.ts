import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from './db.js';

export function dataDirectory(db: Db): string {
  return dirname(db.name);
}

export async function createBackup(db: Db, kind: 'auto' | 'pre-import' | 'pre-restore' | 'manual'): Promise<string> {
  const dir = join(dataDirectory(db), 'backups');
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const name = kind === 'auto' ? 'lembre-auto-' + day + '.sqlite'
    : 'lembre-' + kind + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite';
  const target = join(dir, name);
  if (kind === 'auto' && existsSync(target)) return target;
  const temp = target + '.tmp';
  try {
    await db.backup(temp);
    renameSync(temp, target);
  } catch (error) {
    if (existsSync(temp)) rmSync(temp);
    throw error;
  }
  if (kind === 'auto') {
    const files = readdirSync(dir).filter((file) => /^lembre-auto-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file)).sort().reverse();
    for (const old of files.slice(7)) rmSync(join(dir, old));
  }
  return target;
}

