// Cache local. Deux tables seulement : `outbox` (envois différés) et `kv` (instantané des
// panes, préférences, compteurs). Un utilisateur, un instantané : pas de schéma relationnel.
//
// Le jeton d'appairage ne passe JAMAIS par ici : il vit dans expo-secure-store.
//
// `expo-sqlite` est importé PARESSEUSEMENT, à la première ouverture : ce module est
// importé par l'outbox, dont la logique est testée sous Node, où le module natif n'existe
// pas. Importer le natif à la première ligne rendait toute la couche `db` intestable.
import type { SQLiteDatabase } from 'expo-sqlite';

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function open(): Promise<SQLiteDatabase> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync('kovalink.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      nonce TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      pane_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

export function db(): Promise<SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

// --- kv ---------------------------------------------------------------------

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const row = await (await db()).getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      key,
    );
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  } catch {
    // Le cache est un confort, jamais un chemin critique.
  }
}

export async function kvDel(key: string): Promise<void> {
  try {
    await (await db()).runAsync('DELETE FROM kv WHERE key = ?', key);
  } catch {
    // Idem : un cache qui ne se vide pas n'est pas une panne.
  }
}

export async function kvClear(): Promise<void> {
  try {
    await (await db()).execAsync('DELETE FROM kv; DELETE FROM outbox;');
  } catch {
    /* rien */
  }
}
