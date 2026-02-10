export type ProfileKind = "remote" | "local_dev";

export interface ConnectionProfile {
  id: string;
  name: string;
  baseUrl: string;
  kind: ProfileKind;
  createdAt: string;
  updatedAt: string;
}

export interface NewProfileInput {
  name: string;
  baseUrl: string;
  kind: ProfileKind;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string | null;
}

export type ChatRole = "user" | "assistant";
export type ChatMessageStatus = "done" | "streaming" | "error" | "interrupted";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  error?: string;
}

export type TimelineKind = "stage" | "tool" | "system";
export type TimelineStatus = "running" | "success" | "error";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  name: string;
  status: TimelineStatus;
  createdAt: string;
  detail?: string;
}
