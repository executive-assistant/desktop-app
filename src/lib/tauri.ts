import { invoke } from "@tauri-apps/api/core";
import type { AuthTokens } from "../types";

const BROWSER_AUTH_PREFIX = "ken.desktop.browserAuth.v1";

function isBrowserFallbackAllowed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return !("__TAURI_INTERNALS__" in window);
}

function authStorageKey(profileId: string): string {
  return `${BROWSER_AUTH_PREFIX}.${profileId}`;
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

function browserFallbackInvoke(command: string, args: Record<string, unknown> | undefined): unknown {
  if (!isBrowserFallbackAllowed()) {
    throw new Error("Fallback invoke not allowed in this runtime.");
  }

  const profileId = String(args?.profileId ?? "");
  if (!profileId) {
    throw new Error("profileId is required.");
  }

  const key = authStorageKey(profileId);

  if (command === "load_auth_tokens") {
    return parseAuthPayload(localStorage.getItem(key));
  }

  if (command === "save_auth_tokens") {
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
    localStorage.removeItem(key);
    return null;
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

    if (command === "load_auth_tokens" || command === "save_auth_tokens" || command === "clear_auth_tokens") {
      return browserFallbackInvoke(command, args) as T;
    }

    throw error;
  }
}

