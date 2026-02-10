import { useCallback, useEffect, useMemo, useState } from "react";
import { readJson, writeJson } from "../lib/storage";
import { invokeSafe } from "../lib/tauri";
import type {
  AuthTokens,
  ChatMessage,
  ChatMessageStatus,
  ConnectionProfile,
  TimelineEvent,
  TimelineKind,
  TimelineStatus
} from "../types";

const CHAT_STORAGE_PREFIX = "ken.desktop.chat.v1";
const TIMELINE_STORAGE_PREFIX = "ken.desktop.timeline.v1";

function storageKey(prefix: string, profileId: string): string {
  return `${prefix}.${profileId}`;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeTimelineStatus(raw: unknown): TimelineStatus | undefined {
  const value = asString(raw)?.toLowerCase();
  if (!value) {
    return undefined;
  }
  if (value === "running" || value === "in_progress" || value === "pending") {
    return "running";
  }
  if (value === "success" || value === "ok" || value === "done" || value === "completed") {
    return "success";
  }
  if (value === "error" || value === "failed" || value === "failure") {
    return "error";
  }
  return undefined;
}

function inferTimelineKind(payload: Record<string, unknown>, eventType?: string): TimelineKind | undefined {
  const loweredType = eventType?.toLowerCase();
  if (loweredType?.includes("tool")) {
    return "tool";
  }
  if (loweredType?.includes("stage")) {
    return "stage";
  }
  if (loweredType?.includes("system")) {
    return "system";
  }

  if (typeof payload.tool === "string" || typeof payload.tool_name === "string") {
    return "tool";
  }
  if (typeof payload.stage === "string" || typeof payload.stage_name === "string") {
    return "stage";
  }
  if (typeof payload.kind === "string") {
    const kind = payload.kind.toLowerCase();
    if (kind === "tool" || kind === "stage" || kind === "system") {
      return kind;
    }
  }
  if (typeof payload.type === "string") {
    const type = payload.type.toLowerCase();
    if (type === "tool" || type === "stage" || type === "system") {
      return type;
    }
  }

  return undefined;
}

function eventDetail(payload: Record<string, unknown>): string | undefined {
  const detailCandidates = [payload.detail, payload.message, payload.error];
  for (const candidate of detailCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function eventName(kind: TimelineKind, payload: Record<string, unknown>, eventType?: string): string {
  const candidates = [payload.name, payload.stage, payload.stage_name, payload.tool, payload.tool_name];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  if (eventType && eventType.trim()) {
    return eventType;
  }
  return kind === "tool" ? "tool_update" : kind === "stage" ? "stage_update" : "system_update";
}

function buildSingleTimelineEvent(
  payload: Record<string, unknown>,
  eventType?: string
): TimelineEvent | null {
  const kind = inferTimelineKind(payload, eventType);
  if (!kind) {
    return null;
  }

  const status = normalizeTimelineStatus(payload.status) ?? (payload.error ? "error" : "running");
  return {
    id: asString(payload.id) ?? createId(`${kind}-event`),
    kind,
    name: eventName(kind, payload, eventType),
    status,
    createdAt: new Date().toISOString(),
    detail: eventDetail(payload)
  };
}

function buildTimelineEvents(payload: Record<string, unknown>, eventType?: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (Array.isArray(payload.events)) {
    for (const item of payload.events) {
      if (item && typeof item === "object") {
        const event = buildSingleTimelineEvent(item as Record<string, unknown>, eventType);
        if (event) {
          events.push(event);
        }
      }
    }
    return events;
  }

  const event = buildSingleTimelineEvent(payload, eventType);
  if (event) {
    events.push(event);
  }
  return events;
}

function readTokenField(payload: Record<string, unknown>): string {
  const fields = ["delta", "token", "text", "content"];
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function markInterruptedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.status !== "streaming") {
      return message;
    }
    return {
      ...message,
      status: "interrupted",
      error: "Stream was interrupted. Partial output was recovered."
    };
  });
}

function markUnfinishedTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return events.map((event) =>
    event.status === "running"
      ? {
          ...event,
          status: "error",
          detail: event.detail ?? "Operation interrupted before completion."
        }
      : event
  );
}

type ParsedDataLine = {
  text: string;
  done: boolean;
  timelineEvents: TimelineEvent[];
};

function parseDataLine(rawPayload: string, eventType?: string): ParsedDataLine {
  const payload = rawPayload.trim();
  if (!payload) {
    return { text: "", done: false, timelineEvents: [] };
  }

  if (payload === "[DONE]") {
    return { text: "", done: true, timelineEvents: [] };
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      text: readTokenField(parsed),
      done: parsed.done === true,
      timelineEvents: buildTimelineEvents(parsed, eventType)
    };
  } catch {
    return { text: payload, done: false, timelineEvents: [] };
  }
}

function resolveUserId(profile: ConnectionProfile): string {
  try {
    const key = `ken.desktop.userId.v1.${profile.id}`;
    const stored = localStorage.getItem(key)?.trim();
    if (stored) {
      return stored;
    }
  } catch {
    // Ignore localStorage access errors and use fallback.
  }
  return `desktop-${profile.id}`;
}

export function useChat(profile: ConnectionProfile | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [hydratedProfileId, setHydratedProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setMessages([]);
      setTimeline([]);
      setHydratedProfileId(null);
      return;
    }

    const storedMessages = readJson<ChatMessage[]>(storageKey(CHAT_STORAGE_PREFIX, profile.id), []);
    const storedTimeline = readJson<TimelineEvent[]>(
      storageKey(TIMELINE_STORAGE_PREFIX, profile.id),
      []
    );

    setMessages(markInterruptedMessages(storedMessages));
    setTimeline(markUnfinishedTimeline(storedTimeline));
    setHydratedProfileId(profile.id);
  }, [profile]);

  useEffect(() => {
    if (!profile || hydratedProfileId !== profile.id) {
      return;
    }
    writeJson(storageKey(CHAT_STORAGE_PREFIX, profile.id), messages);
  }, [hydratedProfileId, messages, profile]);

  useEffect(() => {
    if (!profile || hydratedProfileId !== profile.id) {
      return;
    }
    writeJson(storageKey(TIMELINE_STORAGE_PREFIX, profile.id), timeline);
  }, [hydratedProfileId, profile, timeline]);

  const hasInterruptedMessages = useMemo(
    () => messages.some((message) => message.status === "interrupted"),
    [messages]
  );

  const mergeTimelineEvents = useCallback((incoming: TimelineEvent[]) => {
    if (incoming.length === 0) {
      return;
    }

    setTimeline((current) => {
      const next = [...current];
      for (const event of incoming) {
        const existingIndex = next.findIndex((item) => item.id === event.id);
        if (existingIndex === -1) {
          next.push(event);
        } else {
          const existing = next[existingIndex];
          next[existingIndex] = {
            ...existing,
            ...event,
            createdAt: existing.createdAt
          };
        }
      }
      return next;
    });
  }, []);

  const updateTimelineStatus = useCallback((id: string, status: TimelineStatus, detail?: string) => {
    setTimeline((current) =>
      current.map((event) =>
        event.id === id
          ? {
              ...event,
              status,
              detail: detail ?? event.detail
            }
          : event
      )
    );
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setTimeline([]);
  }, []);

  const sendMessage = useCallback(
    async (rawInput: string) => {
      if (!profile || isSending) {
        return;
      }

      const input = rawInput.trim();
      if (!input) {
        return;
      }

      const now = new Date().toISOString();
      const requestEventId = createId("stage-request");
      mergeTimelineEvents([
        {
          id: requestEventId,
          kind: "stage",
          name: "request_message",
          status: "running",
          createdAt: now,
          detail: `POST ${profile.baseUrl}/message`
        }
      ]);

      const userMessage: ChatMessage = {
        id: createId("user"),
        role: "user",
        content: input,
        createdAt: now,
        status: "done"
      };
      const assistantId = createId("assistant");
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: now,
        status: "streaming"
      };

      setMessages((current) => [...current, userMessage, assistantMessage]);
      setIsSending(true);

      const appendToAssistant = (delta: string) => {
        if (!delta) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: `${message.content}${delta}` } : message
          )
        );
      };

      const finalizeAssistant = (status: ChatMessageStatus, error?: string) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  status,
                  error
                }
              : message
          )
        );
      };

      try {
        const tokens = await invokeSafe<AuthTokens | null>("load_auth_tokens", {
          profileId: profile.id
        });
        const headers: HeadersInit = {
          "Content-Type": "application/json"
        };
        if (tokens?.accessToken) {
          headers.Authorization = `Bearer ${tokens.accessToken}`;
        }

        const response = await fetch(`${profile.baseUrl}/message`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            content: input,
            user_id: resolveUserId(profile)
          })
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        if (!response.body) {
          const finalText = await response.text();
          appendToAssistant(finalText);
          finalizeAssistant("done");
          updateTimelineStatus(requestEventId, "success");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let doneFromMarker = false;
        let activeEventType: string | undefined;

        while (!doneFromMarker) {
          const read = await reader.read();
          if (read.done) {
            break;
          }

          buffer += decoder.decode(read.value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith(":") || line.startsWith("id:")) {
              continue;
            }

            if (line.startsWith("event:")) {
              activeEventType = line.slice("event:".length).trim();
              continue;
            }

            if (!line.startsWith("data:")) {
              appendToAssistant(`${rawLine}\n`);
              continue;
            }

            const parsed = parseDataLine(line.slice("data:".length), activeEventType);
            if (parsed.timelineEvents.length > 0) {
              mergeTimelineEvents(parsed.timelineEvents);
            }
            appendToAssistant(parsed.text);

            if (parsed.done) {
              doneFromMarker = true;
              break;
            }

            activeEventType = undefined;
          }
        }

        if (!doneFromMarker) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            const parsed = parseDataLine(buffer, activeEventType);
            if (parsed.timelineEvents.length > 0) {
              mergeTimelineEvents(parsed.timelineEvents);
            }
            appendToAssistant(parsed.text);
          }
        }

        finalizeAssistant("done");
        updateTimelineStatus(requestEventId, "success");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to stream response.";
        finalizeAssistant("error", message);
        updateTimelineStatus(requestEventId, "error", message);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, mergeTimelineEvents, profile, updateTimelineStatus]
  );

  return {
    messages,
    timeline,
    isSending,
    hasInterruptedMessages,
    sendMessage,
    clearConversation
  };
}
