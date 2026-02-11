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

  it("captures approval requests and blocks new sends while approval is pending", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createStreamingResponse([
        "event: approval_required\n",
        'data: {"approval_required":true,"approval_id":"apr-1","action":"delete_file","detail":"Delete README.md?"}\n',
        "data: [DONE]\n"
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChat(profile));

    await act(async () => {
      await result.current.sendMessage("please delete");
    });

    await waitFor(() => {
      expect(result.current.pendingApproval?.id).toBe("apr-1");
      expect(result.current.pendingApproval?.action).toBe("delete_file");
    });

    await act(async () => {
      await result.current.sendMessage("this should be blocked");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const approvalEvent = result.current.timeline.find((event) => event.id === "approval-request-apr-1");
    expect(approvalEvent?.status).toBe("running");
  });

  it("submits approval decision and records an auditable timeline event", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createStreamingResponse([
          "event: approval_required\n",
          'data: {"approval_required":true,"approval_id":"apr-2","action":"delete_file","detail":"Delete notes.md?"}\n',
          "data: [DONE]\n"
        ])
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChat(profile));

    await act(async () => {
      await result.current.sendMessage("approve test");
    });

    await waitFor(() => {
      expect(result.current.pendingApproval?.id).toBe("apr-2");
    });

    await act(async () => {
      await result.current.respondToApproval("approve");
    });

    await waitFor(() => {
      expect(result.current.pendingApproval).toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const decisionCallUrl = fetchMock.mock.calls[1]?.[0];
    expect(decisionCallUrl).toBe("http://127.0.0.1:8000/approval");
    const decisionRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(decisionRequest.method).toBe("POST");
    const decisionBody = JSON.parse(String(decisionRequest.body));
    expect(decisionBody).toMatchObject({
      approval_id: "apr-2",
      decision: "approve",
      user_id: "desktop-local-dev"
    });

    const approvalRequestEvent = result.current.timeline.find((event) => event.id === "approval-request-apr-2");
    expect(approvalRequestEvent?.status).toBe("success");
    const decisionEvent = result.current.timeline.find((event) => event.name === "approval_decision");
    expect(decisionEvent?.status).toBe("success");
    expect(decisionEvent?.detail).toContain("Decision recorded: approve");
  });

  it("orders stage/tool events by timestamp and shows actionable error details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createStreamingResponse([
        'event: stage_update\n',
        'data: {"id":"stage-1","kind":"stage","name":"planning","status":"running","created_at":"2026-02-10T00:00:03.000Z"}\n',
        'event: tool_update\n',
        'data: {"id":"tool-1","kind":"tool","name":"search_docs","status":"running","created_at":"2026-02-10T00:00:01.000Z"}\n',
        'event: tool_update\n',
        'data: {"id":"tool-1","kind":"tool","name":"search_docs","status":"success","created_at":"2026-02-10T00:00:01.000Z"}\n',
        'event: tool_update\n',
        'data: {"id":"tool-2","kind":"tool","name":"write_index","status":"error","created_at":"2026-02-10T00:00:02.000Z","error":{"code":"quota_exceeded","message":"Write failed","retryable":false,"details":"Delete files and retry."}}\n',
        'event: stage_update\n',
        'data: {"id":"stage-1","kind":"stage","name":"planning","status":"success","created_at":"2026-02-10T00:00:03.000Z"}\n',
        'data: {"delta":"done"}\n',
        "data: [DONE]\n"
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChat(profile));

    await act(async () => {
      await result.current.sendMessage("Hi");
    });

    await waitFor(() => {
      const byId = new Map(result.current.timeline.map((event) => [event.id, event]));
      expect(byId.get("tool-1")?.status).toBe("success");
      expect(byId.get("tool-2")?.status).toBe("error");
      expect(byId.get("stage-1")?.status).toBe("success");
    });

    const ordered = result.current.timeline
      .filter((event) => event.id === "tool-1" || event.id === "tool-2" || event.id === "stage-1")
      .map((event) => event.id);
    expect(ordered).toEqual(["tool-1", "tool-2", "stage-1"]);

    const failedTool = result.current.timeline.find((event) => event.id === "tool-2");
    expect(failedTool?.detail).toContain("Write failed");
    expect(failedTool?.detail).toContain("Code: quota_exceeded");
    expect(failedTool?.detail).toContain("Not retryable");
    expect(failedTool?.detail).toContain("Delete files and retry.");
  });
});
