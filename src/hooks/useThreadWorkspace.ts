import { useCallback, useEffect, useMemo, useState } from "react";
import { readJson, writeJson } from "../lib/storage";
import { invokeSafe } from "../lib/tauri";
import type { ThreadWorkspaceInfo } from "../types";

const THREADS_KEY = "ken.desktop.threads.v1";
const SELECTED_THREAD_KEY = "ken.desktop.selectedThreadId.v1";
const DEFAULT_THREAD_ID = "thread-default";

function normalizeThreadId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateThreadId(raw: string): string | null {
  const normalized = normalizeThreadId(raw);
  if (!normalized) {
    return null;
  }
  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function defaultThreadList(): string[] {
  return [DEFAULT_THREAD_ID];
}

function loadThreads(): string[] {
  const loaded = readJson<string[]>(THREADS_KEY, []);
  if (loaded.length === 0) {
    return defaultThreadList();
  }

  const deduped: string[] = [];
  for (const item of loaded) {
    const id = validateThreadId(String(item));
    if (!id || deduped.includes(id)) {
      continue;
    }
    deduped.push(id);
  }
  if (deduped.length === 0) {
    return defaultThreadList();
  }
  return deduped;
}

function loadSelectedThreadId(threads: string[]): string {
  const stored = localStorage.getItem(SELECTED_THREAD_KEY);
  if (stored && threads.includes(stored)) {
    return stored;
  }
  return threads[0] ?? DEFAULT_THREAD_ID;
}

function mapWorkspaceError(threadId: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unable to create thread workspace.";
  const normalized = raw.toLowerCase();

  if (normalized.includes("permission denied") || normalized.includes("operation not permitted")) {
    return `Cannot create workspace for "${threadId}". Grant Files and Folders access to Ken Desktop in System Settings and ensure ~/Executive Assistant/Ken is writable.`;
  }

  return raw;
}

export function useThreadWorkspace() {
  const [threads, setThreads] = useState<string[]>(() => loadThreads());
  const [selectedThreadId, setSelectedThreadId] = useState<string>(() =>
    loadSelectedThreadId(loadThreads())
  );
  const [workspaceByThread, setWorkspaceByThread] = useState<Record<string, ThreadWorkspaceInfo>>({});
  const [isEnsuringWorkspace, setIsEnsuringWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    writeJson(THREADS_KEY, threads);
  }, [threads]);

  useEffect(() => {
    localStorage.setItem(SELECTED_THREAD_KEY, selectedThreadId);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!threads.includes(selectedThreadId)) {
      setSelectedThreadId(threads[0] ?? DEFAULT_THREAD_ID);
    }
  }, [selectedThreadId, threads]);

  const ensureWorkspace = useCallback(async (threadId: string) => {
    setIsEnsuringWorkspace(true);
    setWorkspaceError(null);

    try {
      const ensured = await invokeSafe<ThreadWorkspaceInfo>("ensure_thread_workspace", {
        threadId
      });
      setWorkspaceByThread((current) => ({
        ...current,
        [threadId]: ensured
      }));
    } catch (error) {
      setWorkspaceError(mapWorkspaceError(threadId, error));
    } finally {
      setIsEnsuringWorkspace(false);
    }
  }, []);

  useEffect(() => {
    void ensureWorkspace(selectedThreadId);
  }, [ensureWorkspace, selectedThreadId]);

  const addThread = useCallback(
    (rawInput: string): string | null => {
      const id = validateThreadId(rawInput);
      if (!id) {
        return "Thread ID is required and can only contain letters, numbers, '.', '_' or '-'.";
      }

      setThreads((current) => (current.includes(id) ? current : [...current, id]));
      setSelectedThreadId(id);
      return null;
    },
    []
  );

  const selectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
  }, []);

  const selectedWorkspace = useMemo(
    () => workspaceByThread[selectedThreadId] ?? null,
    [selectedThreadId, workspaceByThread]
  );

  return {
    threads,
    selectedThreadId,
    selectedWorkspace,
    isEnsuringWorkspace,
    workspaceError,
    addThread,
    selectThread
  };
}
