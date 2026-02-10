import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../types";
import { useChat } from "./useChat";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

function createStreamingResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream"
    }
  });
}

const profile: ConnectionProfile = {
  id: "local-dev",
  name: "Local Dev",
  baseUrl: "http://127.0.0.1:8000",
  kind: "local_dev",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("useChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invokeMock.mockResolvedValue(null);
  });

  it("streams assistant message and marks request timeline as success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createStreamingResponse([
        'data: {"delta":"Hello"}\n',
        'data: {"delta":" world"}\n',
        "data: [DONE]\n"
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChat(profile));

    await act(async () => {
      await result.current.sendMessage("Hi");
    });

    await waitFor(() => {
      const assistant = result.current.messages.find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("done");
      expect(assistant?.content).toBe("Hello world");
    });

    const stageEvent = result.current.timeline.find((event) => event.name === "request_message");
    expect(stageEvent?.status).toBe("success");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/message",
      expect.objectContaining({
        method: "POST"
      })
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const parsedBody = JSON.parse(String(requestInit.body));
    expect(parsedBody).toEqual({
      content: "Hi",
      user_id: "desktop-local-dev"
    });
  });

  it("marks assistant message and timeline as error when request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Connection lost"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChat(profile));

    await act(async () => {
      await result.current.sendMessage("Hi");
    });

    await waitFor(() => {
      const assistant = result.current.messages.find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("error");
      expect(assistant?.error).toContain("Connection lost");
    });

    const stageEvent = result.current.timeline.find((event) => event.name === "request_message");
    expect(stageEvent?.status).toBe("error");
  });
});
