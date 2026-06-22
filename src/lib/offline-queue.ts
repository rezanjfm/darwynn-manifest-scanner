"use client";

import { openDB, DBSchema, IDBPDatabase } from "idb";
import { QueuedScan } from "@/types";

interface ManifestDB extends DBSchema {
  scans: {
    key: string;
    value: QueuedScan;
    indexes: { by_manifest: string; by_synced: boolean };
  };
}

let dbPromise: Promise<IDBPDatabase<ManifestDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ManifestDB>("darwynn-scanner", 1, {
      upgrade(db) {
        const store = db.createObjectStore("scans", { keyPath: "id" });
        store.createIndex("by_manifest", "manifest_id");
        store.createIndex("by_synced", "synced");
      },
    });
  }
  return dbPromise;
}

export async function queueScan(scan: QueuedScan): Promise<void> {
  const db = await getDB();
  await db.put("scans", scan);
}

export async function getPendingScans(manifestId?: string): Promise<QueuedScan[]> {
  const db = await getDB();
  const all = manifestId
    ? await db.getAllFromIndex("scans", "by_manifest", manifestId)
    : await db.getAll("scans");
  return all.filter((s) => !s.synced);
}

export async function markScanSynced(id: string): Promise<void> {
  const db = await getDB();
  const scan = await db.get("scans", id);
  if (scan) {
    scan.synced = true;
    await db.put("scans", scan);
  }
}

export async function getLocalTrackingNumbers(manifestId: string): Promise<Set<string>> {
  const db = await getDB();
  const scans = await db.getAllFromIndex("scans", "by_manifest", manifestId);
  return new Set(scans.map((s) => s.tracking_number));
}

export async function clearSyncedScans(): Promise<void> {
  const db = await getDB();
  const synced = await db.getAllFromIndex("scans", "by_synced", true as unknown as boolean);
  const tx = db.transaction("scans", "readwrite");
  await Promise.all(synced.map((s) => tx.store.delete(s.id)));
  await tx.done;
}
