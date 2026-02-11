import { invoke } from "@tauri-apps/api/core";
import type { AuthTokens, ThreadWorkspaceInfo } from "../types";

const BROWSER_AUTH_PREFIX = "ken.desktop.browserAuth.v1";
const BROWSER_WORKSPACE_PREFIX = "ken.desktop.browserWorkspace.v1";
const BROWSER_WORKSPACE_ROOT = "~/Executive Assistant/Ken";

function isBrowserFallbackAllowed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return !("__TAURI_INTERNALS__" in window);
}

function authStorageKey(profileId: string): string {
  return `${BROWSER_AUTH_PREFIX}.${profileId}`;
}

function workspaceStorageKey(threadId: string): string {
  return `${BROWSER_WORKSPACE_PREFIX}.${threadId}`;
}

function parseAuthPayload(raw: string | null): AuthTokens | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

function normalizeThreadId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function readStringArg(args: Record<string, unknown> | undefined, field: string): string {
  const value = String(args?.[field] ?? "").trim();
  if (!value) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function browserFallbackInvoke(command: string, args: Record<string, unknown> | undefined): unknown {
  if (!isBrowserFallbackAllowed()) {
    throw new Error("Fallback invoke not allowed in this runtime.");
  }

  if (command === "load_auth_tokens") {
    const profileId = readStringArg(args, "profileId");
    const key = authStorageKey(profileId);
    return parseAuthPayload(localStorage.getItem(key));
  }

  if (command === "save_auth_tokens") {
    const profileId = readStringArg(args, "profileId");
    const key = authStorageKey(profileId);
    const accessToken = String(args?.accessToken ?? "").trim();
    const refreshToken = args?.refreshToken;
    if (!accessToken) {
      throw new Error("Access token is required.");
    }

    const payload: AuthTokens = {
      accessToken,
      refreshToken: typeof refreshToken === "string" && refreshToken.trim() ? refreshToken.trim() : null
    };
    localStorage.setItem(key, JSON.stringify(payload));
    return null;
  }

  if (command === "clear_auth_tokens") {
    const profileId = readStringArg(args, "profileId");
    const key = authStorageKey(profileId);
    localStorage.removeItem(key);
    return null;
  }

  if (command === "ensure_thread_workspace") {
    const rawThreadId = readStringArg(args, "threadId");
    const threadId = normalizeThreadId(rawThreadId);
    if (!threadId) {
      throw new Error("threadId is required.");
    }
    if (!/^[a-z0-9._-]+$/.test(threadId)) {
      throw new Error("threadId contains unsupported characters.");
    }

    const storageKey = workspaceStorageKey(threadId);
    const existed = localStorage.getItem(storageKey) === "1";
    localStorage.setItem(storageKey, "1");

    const payload: ThreadWorkspaceInfo = {
      threadId,
      rootPath: BROWSER_WORKSPACE_ROOT,
      threadPath: `${BROWSER_WORKSPACE_ROOT}/${threadId}`,
      created: !existed
    };
    return payload;
  }

  throw new Error(`Unsupported browser fallback command: ${command}`);
}

export async function invokeSafe<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (!isBrowserFallbackAllowed()) {
      throw error;
    }

    if (
      command === "load_auth_tokens" ||
      command === "save_auth_tokens" ||
      command === "clear_auth_tokens" ||
      command === "ensure_thread_workspace"
    ) {
      return browserFallbackInvoke(command, args) as T;
    }

    throw error;
  }
}
