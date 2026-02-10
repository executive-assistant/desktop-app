import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProfiles } from "./useProfiles";

describe("useProfiles", () => {
  it("initializes with Local Dev profile selected", () => {
    const { result } = renderHook(() => useProfiles());

    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.selectedProfile?.id).toBe("local-dev");
    expect(result.current.selectedProfile?.baseUrl).toBe("http://127.0.0.1:8000");
    expect(result.current.selectedProfile?.kind).toBe("local_dev");
  });

  it("creates a remote profile and persists selection", () => {
    const { result, unmount } = renderHook(() => useProfiles());

    act(() => {
      result.current.createProfile({
        name: "Remote Prod",
        baseUrl: "https://ken.example.com/",
        kind: "remote"
      });
    });

    const selectedId = result.current.selectedProfile?.id;
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.selectedProfile?.name).toBe("Remote Prod");
    expect(result.current.selectedProfile?.baseUrl).toBe("https://ken.example.com");
    expect(selectedId).toBeDefined();

    unmount();

    const { result: reloaded } = renderHook(() => useProfiles());
    expect(reloaded.current.selectedProfile?.id).toBe(selectedId);
    expect(reloaded.current.profiles.some((profile) => profile.name === "Remote Prod")).toBe(true);
  });

  it("moves selection to remaining profile when active profile is deleted", () => {
    const { result } = renderHook(() => useProfiles());

    act(() => {
      result.current.createProfile({
        name: "Remote Prod",
        baseUrl: "https://ken.example.com",
        kind: "remote"
      });
    });

    const remoteId = result.current.selectedProfileId;

    act(() => {
      result.current.deleteProfile(remoteId);
    });

    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.selectedProfile?.id).toBe("local-dev");
  });
});

