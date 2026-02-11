import { useCallback, useEffect, useMemo, useState } from "react";
import { readJson, writeJson } from "../lib/storage";
import { invokeSafe } from "../lib/tauri";
import type {
  ApprovalDecision,
  AuthTokens,
  ChatMessage,
  ChatMessageStatus,
  ConnectionProfile,
  PendingApproval,
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

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringifyDetail(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function buildActionableErrorDetail(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed || undefined;
  }

  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const payload = raw as Record<string, unknown>;
  const message = asString(payload.message)?.trim();
  const code = asString(payload.code)?.trim();
  const retryable = asBoolean(payload.retryable);
  const details = stringifyDetail(payload.details);

  const parts: string[] = [];
  if (message) {
    parts.push(message);
  }
  if (code) {
    parts.push(`Code: ${code}.`);
  }
  if (retryable === true) {
    parts.push("Retryable: yes.");
  }
  if (retryable === false) {
    parts.push("Retryable: no. Not retryable without changes.");
  }
  if (details) {
    parts.push(`Details: ${details}`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function parseTimestamp(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
    return undefined;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Support either unix seconds or milliseconds.
    const asMilliseconds = raw > 10_000_000_000 ? raw : raw * 1000;
    const parsed = Date.parse(new Date(asMilliseconds).toISOString());
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return undefined;
}

function timelineCreatedAt(payload: Record<string, unknown>): string {
  const candidates = [
    payload.created_at,
    payload.createdAt,
    payload.timestamp,
    payload.updated_at,
    payload.updatedAt
  ];
  for (const candidate of candidates) {
    const parsed = parseTimestamp(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return new Date().toISOString();
}

function earliestCreatedAt(first: string, second: string): string {
  const firstParsed = Date.parse(first);
  const secondParsed = Date.parse(second);

  if (Number.isNaN(firstParsed)) {
    return second;
  }
  if (Number.isNaN(secondParsed)) {
    return first;
  }
  return firstParsed <= secondParsed ? first : second;
}

function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.event.createdAt);
      const rightTime = Date.parse(right.event.createdAt);
      const leftValid = !Number.isNaN(leftTime);
      const rightValid = !Number.isNaN(rightTime);

      if (leftValid && rightValid && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (leftValid !== rightValid) {
        return leftValid ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ event }) => event);
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
  const explicitDetail = stringifyDetail(payload.detail);
  if (explicitDetail) {
    return explicitDetail;
  }

  const nestedError = buildActionableErrorDetail(payload.error);
  if (nestedError) {
    return nestedError;
  }

  const standardError = buildActionableErrorDetail(payload);
  if (standardError) {
    return standardError;
  }

  const fallbackMessage = stringifyDetail(payload.message);
  if (fallbackMessage) {
    return fallbackMessage;
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

function normalizeHttpMethod(value: unknown): string | undefined {
  const method = asString(value)?.trim().toUpperCase();
  if (!method) {
    return undefined;
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return method;
  }
  return undefined;
}

function isApprovalSignalPayload(payload: Record<string, unknown>, eventType?: string): boolean {
  const normalizedEvent = eventType?.toLowerCase();
  if (normalizedEvent?.includes("approval")) {
    return true;
  }

  if (payload.approval_required === true || payload.requires_approval === true) {
    return true;
  }

  const type = asString(payload.type)?.toLowerCase();
  if (type === "approval" || type === "approval_required" || type === "approval_request") {
    return true;
  }

  const approvalObject = payload.approval;
  if (approvalObject && typeof approvalObject === "object") {
    return true;
  }

  return false;
}

function buildSingleApprovalRequest(
  payload: Record<string, unknown>,
  eventType?: string
): PendingApproval | null {
  if (!isApprovalSignalPayload(payload, eventType)) {
    return null;
  }

  const approvalObject =
    payload.approval && typeof payload.approval === "object"
      ? (payload.approval as Record<string, unknown>)
      : payload;

  const id =
    asString(approvalObject.approval_id) ??
    asString(payload.approval_id) ??
    asString(approvalObject.id) ??
    asString(payload.id) ??
    createId("approval");

  const action =
    asString(approvalObject.action) ??
    asString(approvalObject.name) ??
    asString(approvalObject.tool) ??
    asString(approvalObject.stage) ??
    asString(payload.action) ??
    "risky_action";

  const detailCandidates = [
    approvalObject.detail,
    approvalObject.message,
    approvalObject.reason,
    approvalObject.description,
    payload.detail,
    payload.message
  ];
  let detail: string | undefined;
  for (const candidate of detailCandidates) {
    detail = stringifyDetail(candidate);
    if (detail) {
      break;
    }
  }

  const endpoint =
    asString(approvalObject.endpoint) ??
    asString(approvalObject.approval_endpoint) ??
    asString(payload.approval_endpoint);

  const method = normalizeHttpMethod(approvalObject.method) ?? normalizeHttpMethod(payload.method);

  const contextPayload =
    approvalObject.payload && typeof approvalObject.payload === "object"
      ? (approvalObject.payload as Record<string, unknown>)
      : approvalObject.details && typeof approvalObject.details === "object"
        ? (approvalObject.details as Record<string, unknown>)
        : undefined;

  return {
    id,
    action,
    detail,
    createdAt: timelineCreatedAt(approvalObject),
    endpoint,
    method,
    payload: contextPayload
  };
}

function buildApprovalRequests(payload: Record<string, unknown>, eventType?: string): PendingApproval[] {
  const requests: PendingApproval[] = [];

  if (Array.isArray(payload.events)) {
    for (const item of payload.events) {
      if (item && typeof item === "object") {
        const request = buildSingleApprovalRequest(item as Record<string, unknown>, eventType);
        if (request) {
          requests.push(request);
        }
      }
    }
  }

  const fromRoot = buildSingleApprovalRequest(payload, eventType);
  if (fromRoot) {
    requests.push(fromRoot);
  }

  return requests;
}

function toAbsoluteEndpoint(baseUrl: string, endpoint?: string): string {
  if (!endpoint) {
    return `${baseUrl}/approval`;
  }
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  if (endpoint.startsWith("/")) {
    return `${baseUrl}${endpoint}`;
  }
  return `${baseUrl}/${endpoint}`;
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
    createdAt: timelineCreatedAt(payload),
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
  approvalRequests: PendingApproval[];
};

function parseDataLine(rawPayload: string, eventType?: string): ParsedDataLine {
  const payload = rawPayload.trim();
  if (!payload) {
    return { text: "", done: false, timelineEvents: [], approvalRequests: [] };
  }

  if (payload === "[DONE]") {
    return { text: "", done: true, timelineEvents: [], approvalRequests: [] };
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      text: readTokenField(parsed),
      done: parsed.done === true,
      timelineEvents: buildTimelineEvents(parsed, eventType),
      approvalRequests: buildApprovalRequests(parsed, eventType)
    };
  } catch {
    return { text: payload, done: false, timelineEvents: [], approvalRequests: [] };
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
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [isDecidingApproval, setIsDecidingApproval] = useState(false);
  const [hydratedProfileId, setHydratedProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) {
      setMessages([]);
      setTimeline([]);
      setPendingApproval(null);
      setIsDecidingApproval(false);
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
    setPendingApproval(null);
    setIsDecidingApproval(false);
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
            createdAt: earliestCreatedAt(existing.createdAt, event.createdAt),
            detail: event.detail ?? existing.detail
          };
        }
      }
      return sortTimelineEvents(next);
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

  const registerApprovalRequest = useCallback(
    (approval: PendingApproval) => {
      setPendingApproval((current) => {
        if (current?.id === approval.id) {
          return {
            ...current,
            ...approval,
            createdAt: earliestCreatedAt(current.createdAt, approval.createdAt),
            detail: approval.detail ?? current.detail
          };
        }
        return approval;
      });

      mergeTimelineEvents([
        {
          id: `approval-request-${approval.id}`,
          kind: "system",
          name: "approval_required",
          status: "running",
          createdAt: approval.createdAt,
          detail: `${approval.action}${approval.detail ? `: ${approval.detail}` : ""}`
        }
      ]);
    },
    [mergeTimelineEvents]
  );

  const clearConversation = useCallback(() => {
    setMessages([]);
    setTimeline([]);
    setPendingApproval(null);
    setIsDecidingApproval(false);
  }, []);

  const respondToApproval = useCallback(
    async (decision: ApprovalDecision) => {
      if (!profile || !pendingApproval || isDecidingApproval) {
        return;
      }

      setIsDecidingApproval(true);
      const now = new Date().toISOString();
      const decisionEventId = createId("approval-decision");

      mergeTimelineEvents([
        {
          id: decisionEventId,
          kind: "system",
          name: "approval_decision",
          status: "running",
          createdAt: now,
          detail: `${decision.toUpperCase()} ${pendingApproval.action} (${pendingApproval.id})`
        }
      ]);

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

        const response = await fetch(toAbsoluteEndpoint(profile.baseUrl, pendingApproval.endpoint), {
          method: pendingApproval.method ?? "POST",
          headers,
          body: JSON.stringify({
            approval_id: pendingApproval.id,
            decision,
            decided_at: now,
            user_id: resolveUserId(profile),
            payload: pendingApproval.payload ?? null
          })
        });

        if (!response.ok) {
          throw new Error(`Approval endpoint returned ${response.status}`);
        }

        updateTimelineStatus(
          `approval-request-${pendingApproval.id}`,
          "success",
          `Approval ${decision} submitted at ${now}`
        );
        updateTimelineStatus(
          decisionEventId,
          "success",
          `Decision recorded: ${decision} (${pendingApproval.id})`
        );
        setPendingApproval(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to submit approval decision.";
        updateTimelineStatus(
          decisionEventId,
          "error",
          `Approval ${decision} failed for ${pendingApproval.id}: ${message}`
        );
      } finally {
        setIsDecidingApproval(false);
      }
    },
    [isDecidingApproval, mergeTimelineEvents, pendingApproval, profile, updateTimelineStatus]
  );

  const sendMessage = useCallback(
    async (rawInput: string) => {
      if (!profile || isSending || pendingApproval || isDecidingApproval) {
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
            if (parsed.approvalRequests.length > 0) {
              for (const request of parsed.approvalRequests) {
                registerApprovalRequest(request);
              }
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
            if (parsed.approvalRequests.length > 0) {
              for (const request of parsed.approvalRequests) {
                registerApprovalRequest(request);
              }
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
    [
      isDecidingApproval,
      isSending,
      mergeTimelineEvents,
      pendingApproval,
      profile,
      registerApprovalRequest,
      updateTimelineStatus
    ]
  );

  return {
    messages,
    timeline,
    isSending,
    pendingApproval,
    isDecidingApproval,
    hasInterruptedMessages,
    respondToApproval,
    sendMessage,
    clearConversation
  };
}
