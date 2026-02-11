import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadWorkspace } from "./useThreadWorkspace";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

describe("useThreadWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    invokeMock.mockRejectedValue(new Error("Tauri unavailable"));
  });

  afterEach(() => {
    if ("__TAURI_INTERNALS__" in window) {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it("ensures workspace for default thread on first selection", async () => {
    const { result } = renderHook(() => useThreadWorkspace());

    await waitFor(() => {
      expect(result.current.selectedThreadId).toBe("thread-default");
      expect(result.current.selectedWorkspace?.threadPath).toBe(
        "~/Executive Assistant/Ken/thread-default"
      );
    });
  });

  it("creates and selects a new thread, then ensures workspace", async () => {
    const { result } = renderHook(() => useThreadWorkspace());

    await act(async () => {
      const error = result.current.addThread("Invoices 2026");
      expect(error).toBeNull();
    });

    await waitFor(() => {
      expect(result.current.selectedThreadId).toBe("invoices-2026");
      expect(result.current.selectedWorkspace?.threadPath).toBe(
        "~/Executive Assistant/Ken/invoices-2026"
      );
    });
  });

  it("shows remediation guidance when workspace creation fails due to permissions", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockRejectedValue(new Error("Permission denied: cannot create directory"));

    const { result } = renderHook(() => useThreadWorkspace());

    await waitFor(() => {
      expect(result.current.workspaceError).toContain("Grant Files and Folders access");
    });
  });
});
