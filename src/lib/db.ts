import * as SQLite from "expo-sqlite";

export const localDb = SQLite.openDatabaseSync("recycledger.db");

export async function initLocalDb() {
  await localDb.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cached_rows (
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (table_name, row_id)
    );
  `);
}

export async function enqueue(table: string, operation: string, payload: unknown) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await localDb.runAsync(
    "INSERT INTO sync_queue (id, table_name, operation, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    id, table, operation, JSON.stringify(payload), new Date().toISOString()
  );
}

export async function pendingQueue() {
  return localDb.getAllAsync<{id:string;table_name:string;operation:string;payload:string}>(
    "SELECT id, table_name, operation, payload FROM sync_queue ORDER BY created_at ASC"
  );
}

export async function removeQueueItem(id: string) {
  await localDb.runAsync("DELETE FROM sync_queue WHERE id = ?", id);
}

export async function cacheRows(table: string, rows: any[]) {
  for (const row of rows) {
    if (!row?.id) continue;
    await localDb.runAsync(
      `INSERT INTO cached_rows(table_name,row_id,payload,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(table_name,row_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
      table, row.id, JSON.stringify(row), new Date().toISOString()
    );
  }
}

export async function readCachedRows(table: string) {
  const rows = await localDb.getAllAsync<{payload:string}>(
    "SELECT payload FROM cached_rows WHERE table_name=? ORDER BY updated_at DESC", table
  );
  return rows.map(r => JSON.parse(r.payload));
}
