# Desktop App Plan (MacOS First)

## 1) Scope and Product Goals

Build a desktop app similar to Codex App / Claude Cowork UX while keeping Ken hosted remotely.

Required goals:
- Ken remains hosted on remote VM in Docker for production use.
- Desktop app can also connect to `http://127.0.0.1:8000` for local development.
- User files are mirrored like iCloud/Dropbox.
- Canonical user file storage remains `data/users/{thread_id}/files` on server.
- Local mirror root is fixed to `~/Executive Assistant/Ken/`.

Out of scope (v1):
- Full local execution runtime for agent logic.
- Local canonical storage for TDB/ADB/VDB/memory pillars.

---

## 2) Core Architecture

### 2.1 Runtime Topology

- Desktop app: Mac native shell + chat UI + sync UI.
- Remote Ken API: existing HTTP channel + new file sync endpoints/events.
- Remote storage (canonical):
  - Files: `data/users/{thread_id}/files`
  - TDB: thread-scoped SQLite on server
  - ADB: thread-scoped DuckDB on server
  - VDB: thread-scoped vector namespace/collections on server

### 2.2 Connection Profiles

The desktop app supports two server profiles:
- `Remote`: VM endpoint over HTTPS.
- `Local Dev`: `http://127.0.0.1:8000`.

Profile switching should be first-class in UI and persisted locally.

---

## 3) Storage and Sync Strategy

## 3.1 Files (Bi-directional Sync)

Files are the only storage class mirrored locally in v1.

- Local path:
  - `~/Executive Assistant/Ken/{thread_id}/`
- Remote canonical path:
  - `data/users/{thread_id}/files`

Sync behavior:
- Initial pull when profile/thread is selected.
- Incremental push/pull with hash + mtime checks.
- Tombstones for delete propagation.
- Queue + retry + resumable transfer for large files.
- Conflict-safe behavior (never silent overwrite).

Sync protocol invariants (must hold in all phases):
- Server owns a per-thread monotonic `cursor` used by both manifest pagination and SSE events.
- Every file mutation emits a stable `revision_id` and includes: `path`, `kind` (`file` or `delete`), `size`, `sha256`, `mtime_utc`, `updated_at`.
- Client local state DB tracks `last_applied_cursor`, per-path `last_synced_revision_id`, local `sha256`, local `mtime_utc`, and pending operations.
- Upload/commit/delete operations are idempotent via `Idempotency-Key`.
- `commit` and `delete` support optimistic concurrency using `if_match_revision_id` to prevent silent overwrite.
- v1 rename/move is modeled as `delete(old_path)` + `create(new_path)`; no dedicated move primitive required.
- Even with SSE, client runs periodic reconciliation (`manifest` from last cursor) to recover missed events.

Conflict policy (v1):
- If same file changed both sides since last sync:
  - keep both versions using deterministic suffix:
    - `{filename} (conflict {device_name} {yyyy-mm-dd hhmmss}).{ext}`
  - raise conflict event and mark status `pending_resolution`
  - do not block other file sync operations
  - user resolves in conflict center (pick local, pick remote, or keep both)

## 3.2 TDB / ADB / VDB / Memory Pillars

Keep remote-only canonical in v1.

Rationale:
- Avoid DB file sync complexity (locking, conflict, partial-write corruption).
- Keep agent state deterministic (UI and agent see same source of truth).
- Easier operational support and auditing.

Desktop will provide data explorers and query actions over API instead of local DB sync.

---

## 4) Chat and Interaction Model

Chat UX runs over existing HTTP channel.

- Send messages via `/message`.
- Prefer streaming responses for live UX.
- Render stages/tool status updates in timeline.
- Support approval prompts for risky actions when backend requires confirmation.

Suggested UI panels:
- Conversation threads
- Chat transcript with streaming tokens
- Tool/status timeline
- Files sync + conflicts
- Data explorer (TDB/ADB/VDB remote views)

---

## 5) API Additions (Server)

Existing:
- `/message` (chat)
- `/health`

New file sync endpoints:
- `GET /files/manifest?thread_id&cursor=...`
- `GET /files/download?thread_id&path=...`
- `POST /files/upload-chunk`
- `POST /files/commit`
- `DELETE /files?thread_id&path=...`
- `GET /files/events` (SSE change feed)

File sync contract details:
- `GET /files/manifest` returns:
  - `items[]` with metadata and tombstones
  - `next_cursor` (monotonic), `has_more`, `server_time_utc`
- `GET /files/download` supports:
  - `ETag`/`If-None-Match` for cache validation
  - `Range` for resumable download
- `POST /files/upload-chunk` requires:
  - `upload_id`, `thread_id`, `path`, `chunk_index`, `total_chunks`, `chunk_sha256`
  - `Idempotency-Key` header
- `POST /files/commit` requires:
  - `upload_id`, `thread_id`, `path`, `final_sha256`, `size`, `mtime_utc`
  - optional `if_match_revision_id`
  - returns new `revision_id`
- `DELETE /files` supports optional `if_match_revision_id` and uses `Idempotency-Key`.
- `GET /files/events` SSE:
  - supports `Last-Event-ID`
  - emits `file_changed`, `file_deleted`, `sync_conflict`, `heartbeat`
  - each event includes `cursor`, `thread_id`, `path`, `revision_id`, `updated_at`
- Standardized error payload for all sync endpoints:
  - `{ code, message, retryable, details }`
  - include retry guidance for `429`, `409`, `5xx`

Data explorer endpoints (read-first):
- `GET /tdb/tables`
- `GET /tdb/schema?table=...`
- `POST /tdb/query`
- `GET /adb/tables`
- `POST /adb/query`
- `GET /vdb/collections`
- `POST /vdb/search`

---

## 6) Tech Stack Recommendation

Desktop app:
- Tauri 2
- React + TypeScript
- Native backend in Rust

Local sync engine:
- Rust in Tauri backend
- File watch via `notify` (FSEvents on macOS)
- Local state DB: SQLite for sync cursor/op queue/conflicts

Server:
- Existing FastAPI service
- SSE for near-real-time file change feed

Infra:
- Docker compose services as today
- Persistent volume for `data/`
- TLS reverse proxy for remote profile

---

## 7) Security Model

- Token auth scoped to user/thread.
- Server-side path validation to enforce thread root.
- Reject traversal and invalid filenames.
- Enforce max file size and upload quotas server-side.
- Audit log for upload/delete/sync conflict/approval events.
- Optional `.kenignore` support and default ignores (`.DS_Store`, temp/cache files).
- Desktop stores tokens in macOS Keychain (never plaintext config files).
- Access tokens are short-lived; refresh token rotation and revocation supported.
- Thread-level authorization checks on every file/data explorer endpoint.
- TLS required for remote profile; reject non-HTTPS remote endpoints in production mode.
- Redact sensitive paths and auth headers from client/server logs.

---

## 8) Delivery Phases

Phase 0: Foundations
- Add connection profiles (`Remote`, `Local Dev`)
- Add streaming chat UI over existing `/message`
- Freeze sync API contract (`OpenAPI` + error codes + examples)
- Implement desktop auth session plumbing (Keychain storage + token refresh)

Phase 1: File Sync MVP
- Manifest/download/upload/delete APIs
- Local mirror at `~/Executive Assistant/Ken/{thread_id}/`
- One-way pull + explicit push
- Idempotent uploads + optimistic concurrency (`if_match_revision_id`)
- Resumable transfer for interrupted uploads/downloads
- Manual "Reconcile now" action to replay manifest from last cursor

Phase 2: Full Bi-directional Sync
- Watch local changes and auto-push
- SSE for remote changes + periodic reconciliation fallback
- Conflict detection and conflict center UI
- Deterministic conflict naming and resolution actions (pick local/remote/keep both)

Phase 3: Data Explorer
- Remote TDB/ADB/VDB browsing/querying UI
- Read-only by default, explicit write actions

Phase 4: Hardening
- Retry/resume improvements
- Rate limiting and quotas
- Better diagnostics, logs, and telemetry
- Sync reliability testing (network drops, duplicate events, out-of-order events)
- Observability dashboards: sync lag, conflict rate, failed ops, retry depth

---

## 9) Repository Strategy

Current state: desktop is already split into a dedicated repo.

- Repo A: `ken` backend and API contracts.
- Repo B (this repo): desktop app and local sync engine.

Why this stays the right structure:
- Different release cadence (backend vs desktop packaging/signing).
- Cleaner CI/CD and dependency boundaries.
- Lower risk of desktop changes destabilizing agent backend.

Coordination model:
- Keep API contracts versioned and published from backend repo.
- Track cross-repo integration using shared milestone labels (`POC-1`, `POC-2`, `MVP-1`, `MVP-2`).

---

## 10) Open Decisions

Decisions to lock before Phase 1 implementation:
- Remote auth in MVP: API token flow now; OIDC deferred until desktop shell and callback UX are stable.
- Remote change transport: SSE + periodic reconciliation (do not ship SSE-only).
- Conflict UX in MVP: auto-rename + conflict center actions; no inline merge editor in v1.
- Quotas in MVP defaults:
  - max single file upload: `200MB`
  - max total mirrored files per thread: `2GB`
- Data explorer permissions in MVP:
  - non-admin: read-only
  - admin: explicit write actions gated by confirmation
