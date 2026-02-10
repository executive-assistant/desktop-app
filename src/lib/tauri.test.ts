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
});

