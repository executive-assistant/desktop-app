import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeSafe } from "./tauri";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

describe("invokeSafe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("falls back to browser storage for auth commands when tauri invoke fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await invokeSafe("save_auth_tokens", {
      profileId: "profile-1",
      accessToken: "token-1",
      refreshToken: "refresh-1"
    });

    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    const loaded = await invokeSafe<{ accessToken: string; refreshToken?: string | null } | null>(
      "load_auth_tokens",
      {
        profileId: "profile-1"
      }
    );

    expect(loaded).toEqual({
      accessToken: "token-1",
      refreshToken: "refresh-1"
    });

    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await invokeSafe("clear_auth_tokens", {
      profileId: "profile-1"
    });

    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    const afterClear = await invokeSafe("load_auth_tokens", {
      profileId: "profile-1"
    });
    expect(afterClear).toBeNull();
  });

  it("throws when auth fallback is missing required profileId", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await expect(
      invokeSafe("save_auth_tokens", {
        accessToken: "token-1"
      })
    ).rejects.toThrow("profileId is required");
  });

  it("rethrows unsupported fallback commands", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await expect(
      invokeSafe("unknown_command", {
        profileId: "profile-1"
      })
    ).rejects.toThrow("Tauri unavailable");
  });

  it("falls back to browser mode for ensure_thread_workspace and marks first create", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    const first = await invokeSafe<{
      threadId: string;
      rootPath: string;
      threadPath: string;
      created: boolean;
    }>("ensure_thread_workspace", {
      threadId: "thread-1"
    });

    expect(first).toEqual({
      threadId: "thread-1",
      rootPath: "~/Executive Assistant/Ken",
      threadPath: "~/Executive Assistant/Ken/thread-1",
      created: true
    });

    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    const second = await invokeSafe<{
      threadId: string;
      rootPath: string;
      threadPath: string;
      created: boolean;
    }>("ensure_thread_workspace", {
      threadId: "thread-1"
    });
    expect(second.created).toBe(false);
  });

  it("throws when ensure_thread_workspace fallback is missing threadId", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await expect(invokeSafe("ensure_thread_workspace", {})).rejects.toThrow("threadId is required");
  });

  it("falls back to browser mode for sync file write/delete commands", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await invokeSafe("sync_write_thread_file", {
      threadId: "thread-1",
      relativePath: "docs/readme.txt",
      bytes: [65, 66, 67]
    });

    const key = "ken.desktop.browserFile.v1.thread-1.docs%2Freadme.txt";
    expect(localStorage.getItem(key)).toBe("[65,66,67]");

    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await invokeSafe("sync_delete_thread_file", {
      threadId: "thread-1",
      relativePath: "docs/readme.txt"
    });

    expect(localStorage.getItem(key)).toBeNull();
  });

  it("rejects unsafe relative paths for sync file fallback commands", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Tauri unavailable"));
    await expect(
      invokeSafe("sync_write_thread_file", {
        threadId: "thread-1",
        relativePath: "../secrets.txt",
        bytes: [1]
      })
    ).rejects.toThrow("Parent directory navigation is not allowed");
  });
});
