import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../types";
import { useFileSync } from "./useFileSync";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

const profile: ConnectionProfile = {
  id: "local-dev",
  name: "Local Dev",
  baseUrl: "http://127.0.0.1:8000",
  kind: "local_dev",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function binaryResponse(bytes: number[], status = 200): Response {
  return new Response(new Uint8Array(bytes), { status });
}

function installDefaultInvokeMock() {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "load_auth_tokens") {
      return null;
    }
    if (command === "ensure_thread_workspace") {
      const threadId = String(args?.threadId ?? "thread-default");
      return {
        threadId,
        rootPath: "~/Executive Assistant/Ken",
        threadPath: `~/Executive Assistant/Ken/${threadId}`,
        created: true
      };
    }
    if (command === "sync_write_thread_file" || command === "sync_delete_thread_file") {
      return null;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe("useFileSync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    installDefaultInvokeMock();
  });

  it("downloads all manifest files on initial pull and stores last_applied_cursor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/files/manifest") {
        return jsonResponse({
          items: [
            { path: "docs/a.txt", cursor: "cursor-1" },
            { path: "docs/b.txt", cursor: "cursor-2" }
          ],
          next_cursor: "cursor-2",
          has_more: false,
          server_time_utc: "2026-02-11T00:00:00.000Z"
        });
      }

      if (url.pathname === "/files/download") {
        return binaryResponse([65, 66, 67]);
      }

      return jsonResponse({ error: "unknown route" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFileSync(profile, "thread-default"));

    await act(async () => {
      await result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.syncError).toBeNull();
      expect(result.current.lastAppliedCursor).toBe("cursor-2");
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "sync_write_thread_file",
      expect.objectContaining({ threadId: "thread-default", relativePath: "docs/a.txt" })
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "sync_write_thread_file",
      expect.objectContaining({ threadId: "thread-default", relativePath: "docs/b.txt" })
    );

    const saved = JSON.parse(
      localStorage.getItem("ken.desktop.syncState.v1.local-dev.thread-default") ?? "{}"
    ) as Record<string, unknown>;
    expect(saved.lastAppliedCursor).toBe("cursor-2");
  });

  it("resumes from the persisted cursor after interruption", async () => {
    let failSecondDownload = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/files/manifest") {
        const cursor = url.searchParams.get("cursor");
        if (cursor === "cursor-1") {
          return jsonResponse({
            items: [{ path: "docs/b.txt", cursor: "cursor-2" }],
            next_cursor: "cursor-2",
            has_more: false,
            server_time_utc: "2026-02-11T00:00:02.000Z"
          });
        }
        return jsonResponse({
          items: [
            { path: "docs/a.txt", cursor: "cursor-1" },
            { path: "docs/b.txt", cursor: "cursor-2" }
          ],
          next_cursor: "cursor-2",
          has_more: false,
          server_time_utc: "2026-02-11T00:00:01.000Z"
        });
      }

      if (url.pathname === "/files/download") {
        const path = url.searchParams.get("path");
        if (path === "docs/b.txt" && failSecondDownload) {
          failSecondDownload = false;
          return jsonResponse({ error: "temporary failure" }, 500);
        }
        return binaryResponse([1, 2, 3]);
      }

      return jsonResponse({ error: "unknown route" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFileSync(profile, "thread-default"));

    await act(async () => {
      await result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncError).toContain("docs/b.txt");
      expect(result.current.lastAppliedCursor).toBe("cursor-1");
    });

    await act(async () => {
      await result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncError).toBeNull();
      expect(result.current.lastAppliedCursor).toBe("cursor-2");
    });

    const manifestCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/files/manifest"));
    expect(manifestCalls.some((url) => url.includes("cursor=cursor-1"))).toBe(true);
  });

  it("applies tombstones via delete command", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/files/manifest") {
        return jsonResponse({
          items: [{ path: "docs/old.txt", tombstone: true, cursor: "cursor-3" }],
          next_cursor: "cursor-3",
          has_more: false,
          server_time_utc: "2026-02-11T00:00:03.000Z"
        });
      }
      return jsonResponse({ error: "unexpected download" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFileSync(profile, "thread-default"));

    await act(async () => {
      await result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncError).toBeNull();
      expect(result.current.lastAppliedCursor).toBe("cursor-3");
    });

    expect(invokeMock).toHaveBeenCalledWith("sync_delete_thread_file", {
      threadId: "thread-default",
      relativePath: "docs/old.txt"
    });
  });

  it("fails fast when manifest cursor does not advance on has_more page", async () => {
    localStorage.setItem(
      "ken.desktop.syncState.v1.local-dev.thread-default",
      JSON.stringify({
        lastAppliedCursor: "cursor-1",
        lastServerTimeUtc: "2026-02-11T00:00:00.000Z",
        updatedAt: "2026-02-11T00:00:00.000Z"
      })
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/files/manifest") {
        return jsonResponse({
          items: [],
          next_cursor: "cursor-1",
          has_more: true,
          server_time_utc: "2026-02-11T00:00:04.000Z"
        });
      }
      return jsonResponse({ error: "unexpected route" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFileSync(profile, "thread-default"));

    await act(async () => {
      await result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncError).toContain("cursor did not advance");
    });
  });
});
