import { useCallback, useEffect, useState } from "react";
import { readJson, writeJson } from "../lib/storage";
import { invokeSafe } from "../lib/tauri";
import type {
  AuthTokens,
  ConnectionProfile,
  FileManifestItem,
  FileManifestPage,
  FileSyncOperation,
  FileSyncOperationStatus
} from "../types";

const SYNC_STATE_PREFIX = "ken.desktop.syncState.v1";

type SyncMetadata = {
  lastAppliedCursor: string | null;
  lastServerTimeUtc: string | null;
  updatedAt: string | null;
};

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function syncStateKey(profileId: string, threadId: string): string {
  return `${SYNC_STATE_PREFIX}.${profileId}.${threadId}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseManifestItem(raw: unknown): FileManifestItem {
  if (!raw || typeof raw !== "object") {
    throw new Error("Manifest item is not an object.");
  }

  const payload = raw as Record<string, unknown>;
  const path = readString(payload.path)?.trim();
  if (!path) {
    throw new Error("Manifest item missing path.");
  }

  return {
    path,
    tombstone: payload.tombstone === true || payload.deleted === true,
    cursor: readString(payload.cursor) ?? readString(payload.item_cursor)
  };
}

function parseManifestPage(raw: unknown): FileManifestPage {
  if (!raw || typeof raw !== "object") {
    throw new Error("Manifest response is invalid.");
  }
  const payload = raw as Record<string, unknown>;

  if (!Array.isArray(payload.items)) {
    throw new Error("Manifest response missing items array.");
  }
  const hasMoreValue = payload.has_more ?? payload.hasMore;
  if (typeof hasMoreValue !== "boolean") {
    throw new Error("Manifest response missing has_more boolean.");
  }

  const nextCursorRaw = payload.next_cursor ?? payload.nextCursor;
  const nextCursor = typeof nextCursorRaw === "string" && nextCursorRaw.trim() ? nextCursorRaw : undefined;
  if (hasMoreValue && !nextCursor) {
    throw new Error("Manifest response missing next_cursor while has_more=true.");
  }

  return {
    items: payload.items.map(parseManifestItem),
    hasMore: hasMoreValue,
    nextCursor,
    serverTimeUtc: readString(payload.server_time_utc) ?? readString(payload.serverTimeUtc)
  };
}

function defaultSyncMetadata(): SyncMetadata {
  return {
    lastAppliedCursor: null,
    lastServerTimeUtc: null,
    updatedAt: null
  };
}

function loadSyncMetadata(profileId: string | undefined, threadId: string): SyncMetadata {
  if (!profileId) {
    return defaultSyncMetadata();
  }
  return readJson<SyncMetadata>(syncStateKey(profileId, threadId), defaultSyncMetadata());
}

function operationErrorMessage(path: string, operation: "download" | "delete", error: unknown): string {
  const rendered = error instanceof Error ? error.message : "Unknown error";
  return `${operation === "download" ? "Download" : "Delete"} failed for ${path}: ${rendered}`;
}

export function useFileSync(profile: ConnectionProfile | undefined, threadId: string) {
  const [metadata, setMetadata] = useState<SyncMetadata>(() =>
    loadSyncMetadata(profile?.id, threadId)
  );
  const [operations, setOperations] = useState<FileSyncOperation[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setMetadata(loadSyncMetadata(profile?.id, threadId));
    setOperations([]);
    setSyncError(null);
    setIsSyncing(false);
  }, [profile?.id, threadId]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    writeJson(syncStateKey(profile.id, threadId), metadata);
  }, [metadata, profile, threadId]);

  const setOperationStatus = useCallback(
    (operationId: string, status: FileSyncOperationStatus, detail?: string) => {
      setOperations((current) =>
        current.map((operation) =>
          operation.id === operationId
            ? {
                ...operation,
                status,
                detail: detail ?? operation.detail
              }
            : operation
        )
      );
    },
    []
  );

  const syncNow = useCallback(async () => {
    if (!profile || isSyncing) {
      return;
    }

    setIsSyncing(true);
    setSyncError(null);
    setOperations([]);

    try {
      await invokeSafe("ensure_thread_workspace", { threadId });
      const tokens = await invokeSafe<AuthTokens | null>("load_auth_tokens", {
        profileId: profile.id
      });

      const headers: HeadersInit = {};
      if (tokens?.accessToken) {
        headers.Authorization = `Bearer ${tokens.accessToken}`;
      }

      let cursor = metadata.lastAppliedCursor;
      const seenCursors = new Set<string>();
      if (cursor) {
        seenCursors.add(cursor);
      }

      let hasMore = true;
      while (hasMore) {
        const manifestUrl = new URL(`${profile.baseUrl}/files/manifest`);
        manifestUrl.searchParams.set("thread_id", threadId);
        if (cursor) {
          manifestUrl.searchParams.set("cursor", cursor);
        }

        const manifestResponse = await fetch(manifestUrl.toString(), { headers });
        if (!manifestResponse.ok) {
          throw new Error(`Manifest request failed with ${manifestResponse.status}`);
        }

        const manifestPayload = (await manifestResponse.json()) as unknown;
        const page = parseManifestPage(manifestPayload);

        for (const item of page.items) {
          const operationId = createId("sync-op");
          const operationType = item.tombstone ? "delete" : "download";
          setOperations((current) => [
            ...current,
            {
              id: operationId,
              path: item.path,
              operation: operationType,
              status: "running",
              retryCount: 0
            }
          ]);

          try {
            if (item.tombstone) {
              await invokeSafe("sync_delete_thread_file", {
                threadId,
                relativePath: item.path
              });
            } else {
              const downloadUrl = new URL(`${profile.baseUrl}/files/download`);
              downloadUrl.searchParams.set("thread_id", threadId);
              downloadUrl.searchParams.set("path", item.path);

              const downloadResponse = await fetch(downloadUrl.toString(), { headers });
              if (!downloadResponse.ok) {
                throw new Error(`Download request failed with ${downloadResponse.status}`);
              }

              const binary = await downloadResponse.arrayBuffer();
              const bytes = Array.from(new Uint8Array(binary));
              await invokeSafe("sync_write_thread_file", {
                threadId,
                relativePath: item.path,
                bytes
              });
            }

            setOperationStatus(operationId, "success");

            if (item.cursor) {
              cursor = item.cursor;
              setMetadata((current) => ({
                ...current,
                lastAppliedCursor: cursor,
                lastServerTimeUtc: page.serverTimeUtc ?? current.lastServerTimeUtc,
                updatedAt: new Date().toISOString()
              }));
            }
          } catch (error) {
            const detail = operationErrorMessage(item.path, operationType, error);
            setOperationStatus(operationId, "error", detail);
            throw new Error(detail);
          }
        }

        if (page.hasMore) {
          if (!page.nextCursor || page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
            throw new Error("Manifest cursor did not advance; aborting to prevent sync loop.");
          }
          seenCursors.add(page.nextCursor);
        }

        if (page.nextCursor) {
          cursor = page.nextCursor;
        }

        setMetadata((current) => ({
          ...current,
          lastAppliedCursor: cursor ?? current.lastAppliedCursor,
          lastServerTimeUtc: page.serverTimeUtc ?? current.lastServerTimeUtc,
          updatedAt: new Date().toISOString()
        }));

        hasMore = page.hasMore;
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "File sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }, [
    isSyncing,
    metadata.lastAppliedCursor,
    profile,
    setOperationStatus,
    threadId
  ]);

  return {
    isSyncing,
    syncError,
    operations,
    lastAppliedCursor: metadata.lastAppliedCursor,
    lastServerTimeUtc: metadata.lastServerTimeUtc,
    syncNow
  };
}
