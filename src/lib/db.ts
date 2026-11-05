import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

let sqliteDb: any = null;

function getSqliteDb(): any {
  if (Platform.OS === "web") return null;
  if (!sqliteDb) {
    try {
      // Lazy load expo-sqlite only on native platforms (iOS/Android)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SQLite = require("expo-sqlite");
      sqliteDb = SQLite.openDatabaseSync("recycledger.db");
    } catch (e) {
      console.warn("SQLite not available:", e);
    }
  }
  return sqliteDb;
}

export const localDb = Platform.OS === "web" ? null : getSqliteDb();

export async function initLocalDb() {
  if (Platform.OS === "web") return;
  const db = getSqliteDb();
  if (!db) return;
  try {
    await db.execAsync(`
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
  } catch (e) {
    console.warn("Failed to init SQLite:", e);
  }
}

export async function enqueue(table: string, operation: string, payload: unknown) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item = {
    id,
    table_name: table,
    operation,
    payload: JSON.stringify(payload),
    created_at: new Date().toISOString(),
  };

  const db = getSqliteDb();
  if (Platform.OS === "web" || !db) {
    try {
      const raw = await AsyncStorage.getItem("recycledger_sync_queue");
      const list = raw ? JSON.parse(raw) : [];
      list.push(item);
      await AsyncStorage.setItem("recycledger_sync_queue", JSON.stringify(list));
    } catch (e) {
      console.warn("Failed to enqueue in AsyncStorage:", e);
    }
    return;
  }

  await db.runAsync(
    "INSERT INTO sync_queue (id, table_name, operation, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    id, table, operation, item.payload, item.created_at
  );
}

export async function pendingQueue(): Promise<Array<{ id: string; table_name: string; operation: string; payload: string }>> {
  const db = getSqliteDb();
  if (Platform.OS === "web" || !db) {
    try {
      const raw = await AsyncStorage.getItem("recycledger_sync_queue");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  const rows = await db.getAllAsync(
    "SELECT id, table_name, operation, payload FROM sync_queue ORDER BY created_at ASC"
  );
  return rows as Array<{ id: string; table_name: string; operation: string; payload: string }>;
}

export async function removeQueueItem(id: string) {
  const db = getSqliteDb();
  if (Platform.OS === "web" || !db) {
    try {
      const raw = await AsyncStorage.getItem("recycledger_sync_queue");
      if (!raw) return;
      const list = JSON.parse(raw).filter((item: any) => item.id !== id);
      await AsyncStorage.setItem("recycledger_sync_queue", JSON.stringify(list));
    } catch (e) {
      console.warn("Failed to removeQueueItem from AsyncStorage:", e);
    }
    return;
  }
  await db.runAsync("DELETE FROM sync_queue WHERE id = ?", id);
}

export async function cacheRows(table: string, rows: any[]) {
  const db = getSqliteDb();
  if (Platform.OS === "web" || !db) {
    try {
      const raw = await AsyncStorage.getItem(`recycledger_cache_${table}`);
      const map: Record<string, any> = raw ? JSON.parse(raw) : {};
      for (const row of rows) {
        if (!row?.id) continue;
        map[row.id] = row;
      }
      await AsyncStorage.setItem(`recycledger_cache_${table}`, JSON.stringify(map));
    } catch (e) {
      console.warn("Failed to cacheRows in AsyncStorage:", e);
    }
    return;
  }

  for (const row of rows) {
    if (!row?.id) continue;
    await db.runAsync(
      `INSERT INTO cached_rows(table_name,row_id,payload,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(table_name,row_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
      table, row.id, JSON.stringify(row), new Date().toISOString()
    );
  }
}

export async function readCachedRows(table: string): Promise<any[]> {
  const db = getSqliteDb();
  if (Platform.OS === "web" || !db) {
    try {
      const raw = await AsyncStorage.getItem(`recycledger_cache_${table}`);
      if (!raw) return [];
      const map = JSON.parse(raw);
      return Object.values(map);
    } catch {
      return [];
    }
  }

  const rows = await db.getAllAsync(
    "SELECT payload FROM cached_rows WHERE table_name=? ORDER BY updated_at DESC", table
  );
  return (rows as Array<{ payload: string }>).map((r: any) => JSON.parse(r.payload));
}
