import { supabase } from "./supabase";
import { pendingQueue, removeQueueItem } from "./db";

export async function syncPending(): Promise<{ synced: number; failed: number }> {
  const queue = await pendingQueue();
  let synced = 0, failed = 0;
  for (const item of queue) {
    try {
      const payload = JSON.parse(item.payload);
      if (item.operation === "insert") {
        const { error } = await supabase.from(item.table_name).insert(payload);
        if (error) throw error;
      } else if (item.operation === "upsert") {
        const { error } = await supabase.from(item.table_name).upsert(payload, { onConflict: "id" });
        if (error) throw error;
      } else if (item.operation === "delete") {
        const { error } = await supabase.from(item.table_name).delete().eq("id", payload.id);
        if (error) throw error;
      }
      await removeQueueItem(item.id);
      synced++;
    } catch {
      failed++;
      // Keep failed rows for retry. A unique constraint prevents duplicate business references.
    }
  }
  return { synced, failed };
}
