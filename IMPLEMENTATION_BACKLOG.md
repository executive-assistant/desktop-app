# Desktop App Implementation Backlog (POC -> MVP)

## Context and Assumptions

- Desktop app is already in a dedicated repo (this repo).
- Backend APIs are implemented in the separate Ken backend repo.
- This backlog keeps the plan phases but converts them into shippable stories.
- Priority labels:
  - `P0`: required for POC
  - `P1`: required for MVP
  - `P2`: post-MVP hardening

## Milestone Map

- **POC-1 (Phase 0):** Foundation + contract freeze + auth/session
- **POC-2 (Phase 1):** File sync MVP (one-way pull + explicit push)
- **MVP-1 (Phase 2):** Full bi-directional sync + conflict center
- **MVP-2 (Phases 3-4):** Data explorer + reliability + telemetry

## Backlog

### EPIC A: Foundation, Profiles, and Chat Streaming (POC-1)

**A-001 (`P0`, Owner: Desktop)**
Story: As a user, I want to configure and switch between `Remote` and `Local Dev` profiles so I can use production and local servers from one app.
Acceptance criteria:
1. User can create, edit, delete, and select a connection profile.
2. `Local Dev` defaults to `http://127.0.0.1:8000`.
3. Selected profile persists across app restarts.
4. Active profile is visible in the app chrome.
Dependencies: None.

**A-002 (`P0`, Owner: Desktop)**
Story: As a user, I want secure credential storage so tokens are not exposed in plaintext.
Acceptance criteria:
1. Access and refresh tokens are stored in macOS Keychain.
2. No tokens are written to plain config files or logs.
3. Logout clears Keychain entries.
Dependencies: A-001.

**A-003 (`P0`, Owner: Desktop)**
Story: As a user, I want streaming chat responses so the UI feels live during assistant output.
Acceptance criteria:
1. `/message` responses stream token-by-token into transcript.
2. Partial output survives UI rerender/reconnect where feasible.
3. Final assistant message is committed when stream completes.
Dependencies: A-001.

**A-004 (`P0`, Owner: Desktop)**
Story: As a user, I want stage and tool status timeline updates so I can understand what the assistant is doing.
Acceptance criteria:
1. Timeline renders stage and tool events in order.
2. Timeline items include status (`running`, `success`, `error`).
3. Errors include actionable details where available.
Dependencies: A-003.

**A-005 (`P0`, Owner: Desktop + Backend)**
Story: As a user, I want approval prompts for risky actions so destructive steps require explicit confirmation.
Acceptance criteria:
1. Backend can signal actions requiring approval.
2. Desktop blocks execution until user approves or rejects.
3. Approval decision is auditable.
Dependencies: A-004.

**A-006 (`P0`, Owner: Backend + Desktop)**
Story: As developers, we want a frozen sync API contract so desktop and backend can implement in parallel safely.
Acceptance criteria:
1. OpenAPI spec for sync endpoints is finalized and versioned.
2. Example request/response payloads are included for success and errors.
3. Error payload schema is standardized: `{ code, message, retryable, details }`.
Dependencies: None.

### EPIC B: File Sync MVP (POC-2)

**B-001 (`P0`, Owner: Desktop)**
Story: As a user, I want the local mirror folder created automatically so each thread has a predictable file workspace.
Acceptance criteria:
1. Root folder is `~/Executive Assistant/Ken/{thread_id}/`.
2. App creates thread folder on first thread selection.
3. Missing permissions produce clear remediation guidance.
Dependencies: A-001.

**B-002 (`P0`, Owner: Backend)**
Story: As a desktop client, I want a manifest API with cursor pagination so I can sync incrementally.
Acceptance criteria:
1. `GET /files/manifest` returns `items[]`, `next_cursor`, `has_more`, `server_time_utc`.
2. Cursor is monotonic per thread.
3. Tombstones are returned for deletes.
Dependencies: A-006.

**B-003 (`P0`, Owner: Desktop)**
Story: As a user, I want initial pull sync so local files match server canonical state.
Acceptance criteria:
1. First sync downloads all manifest files.
2. Local metadata DB stores `last_applied_cursor`.
3. Sync can resume after interruption.
Dependencies: B-001, B-002.

**B-004 (`P0`, Owner: Backend)**
Story: As a desktop client, I want chunked uploads and commit semantics so large files can be pushed safely.
Acceptance criteria:
1. `POST /files/upload-chunk` supports `upload_id`, chunk metadata, `Idempotency-Key`.
2. `POST /files/commit` validates `final_sha256`, returns `revision_id`.
3. Duplicate idempotency requests are safe and non-destructive.
Dependencies: A-006.

**B-005 (`P0`, Owner: Desktop)**
Story: As a user, I want explicit push for selected local files so I control when local changes go remote during MVP.
Acceptance criteria:
1. User can choose files/folders to push.
2. Upload uses chunk flow and verifies checksums.
3. Push errors remain in retry queue with visible status.
Dependencies: B-004.

**B-006 (`P0`, Owner: Backend + Desktop)**
Story: As a user, I want optimistic concurrency checks so sync never silently overwrites newer remote data.
Acceptance criteria:
1. `commit` and `delete` accept `if_match_revision_id`.
2. Conflicting writes return `409` with conflict metadata.
3. Desktop surfaces conflict state to user.
Dependencies: B-004.

**B-007 (`P0`, Owner: Desktop)**
Story: As a user, I want a manual "Reconcile now" action so I can recover from network misses.
Acceptance criteria:
1. Action replays manifest from `last_applied_cursor`.
2. Reconciliation is idempotent.
3. UI shows reconcile progress and summary.
Dependencies: B-003.

**B-008 (`P0`, Owner: Desktop)**
Story: As a user, I want a sync status panel so I can see in-progress, failed, and completed file operations.
Acceptance criteria:
1. Queue shows operation type, path, status, and retry count.
2. Failures include retry button.
3. Panel can filter by thread and status.
Dependencies: B-003, B-005.

**B-009 (`P0`, Owner: Desktop + Backend)**
Story: As a user, I want resumable downloads/uploads so transient failures do not restart large transfers from zero.
Acceptance criteria:
1. Downloads support `Range`.
2. Desktop resumes partial files after reconnect.
3. Upload resumes from next missing chunk.
Dependencies: B-004.

### EPIC C: Bi-directional Sync and Conflict Center (MVP-1)

**C-001 (`P1`, Owner: Desktop)**
Story: As a user, I want local filesystem watching so file edits auto-queue for sync.
Acceptance criteria:
1. FSEvents (`notify`) watches thread folder recursively.
2. Create/modify/delete events enqueue sync ops.
3. Event storms are debounced/coalesced.
Dependencies: B-005.

**C-002 (`P1`, Owner: Backend)**
Story: As a desktop client, I want SSE file events so remote changes arrive quickly without frequent full polls.
Acceptance criteria:
1. `GET /files/events` emits `file_changed`, `file_deleted`, `sync_conflict`, `heartbeat`.
2. Events include `cursor`, `thread_id`, `path`, `revision_id`, `updated_at`.
3. Endpoint supports `Last-Event-ID`.
Dependencies: B-002.

**C-003 (`P1`, Owner: Desktop)**
Story: As a user, I want robust SSE reconnect behavior so sync remains consistent across disconnects.
Acceptance criteria:
1. Client reconnects with `Last-Event-ID`.
2. On reconnect failure or gap detection, client triggers manifest reconciliation.
3. Reconnect backoff is bounded and observable.
Dependencies: C-002, B-007.

**C-004 (`P1`, Owner: Desktop + Backend)**
Story: As a user, I want deterministic conflict handling so both local and remote edits are preserved.
Acceptance criteria:
1. Concurrent edits produce deterministic conflict filename suffix.
2. Conflict item is marked `pending_resolution`.
3. Non-conflicting files continue syncing.
Dependencies: B-006, C-001, C-003.

**C-005 (`P1`, Owner: Desktop)**
Story: As a user, I want a conflict center so I can resolve file conflicts intentionally.
Acceptance criteria:
1. Conflict center lists unresolved conflicts with timestamps and origin.
2. Actions supported: `pick local`, `pick remote`, `keep both`.
3. Resolution action updates queue and clears pending state.
Dependencies: C-004.

**C-006 (`P1`, Owner: Desktop)**
Story: As a user, I want `.kenignore` support so temporary/noisy files are excluded from sync.
Acceptance criteria:
1. Default ignores include `.DS_Store` and temporary cache patterns.
2. User-defined `.kenignore` is loaded from thread root.
3. Ignored files are excluded from watcher and upload queue.
Dependencies: C-001.

**C-007 (`P1`, Owner: Desktop)**
Story: As a user, I want rename/move to sync correctly so path changes are reflected remotely.
Acceptance criteria:
1. Local rename/move is translated to `delete(old_path)` + `create(new_path)`.
2. No dedicated move API is required.
3. Queue processing keeps operation order for same path family.
Dependencies: C-001, B-006.

### EPIC D: Data Explorer (MVP-2)

**D-001 (`P1`, Owner: Backend)**
Story: As a desktop client, I want read endpoints for TDB/ADB/VDB so I can browse remote state.
Acceptance criteria:
1. Endpoints implemented: `/tdb/tables`, `/tdb/schema`, `/tdb/query`, `/adb/tables`, `/adb/query`, `/vdb/collections`, `/vdb/search`.
2. Thread authorization enforced on all endpoints.
3. Query execution has timeout and row limits.
Dependencies: A-006.

**D-002 (`P1`, Owner: Desktop)**
Story: As a user, I want a data explorer UI so I can inspect thread data without direct DB access.
Acceptance criteria:
1. Explorer supports table/collection listing and query execution.
2. Results render with pagination for large result sets.
3. Errors are shown with request correlation ID.
Dependencies: D-001.

**D-003 (`P1`, Owner: Backend + Desktop)**
Story: As an admin, I want explicit write actions gated by confirmation so dangerous mutations are deliberate.
Acceptance criteria:
1. Non-admin users are read-only.
2. Admin write actions require confirmation dialog.
3. Writes are audited with actor and thread metadata.
Dependencies: D-001, A-005.

### EPIC E: Reliability, Quotas, and Observability (MVP-2 / P2)

**E-001 (`P1`, Owner: Backend)**
Story: As an operator, I want quota and rate limiting policies so one thread cannot starve system resources.
Acceptance criteria:
1. Default quotas: `200MB` single file, `2GB` mirrored files per thread.
2. Rate limits return structured `429` with retry guidance.
3. Quota violations are auditable.
Dependencies: B-004.

**E-002 (`P1`, Owner: Desktop)**
Story: As a user, I want clear quota/rate-limit feedback so I know how to recover from blocked operations.
Acceptance criteria:
1. UI maps `429` and quota errors to actionable messaging.
2. Retry behavior follows server `retryable` hint.
3. User can requeue after adjusting files.
Dependencies: E-001, B-008.

**E-003 (`P1`, Owner: Desktop + Backend)**
Story: As engineers, we want sync reliability tests so regressions are caught before release.
Acceptance criteria:
1. Test cases cover network drops, duplicate events, out-of-order events, and partial transfer resume.
2. Tests run in CI for desktop and backend integration.
3. POC/MVP release requires passing reliability suite.
Dependencies: C-003, B-009.

**E-004 (`P2`, Owner: Desktop + Backend)**
Story: As operators, we want sync observability so production issues are detectable early.
Acceptance criteria:
1. Metrics emitted: sync lag, conflict rate, failed ops, retry depth.
2. Logs include request IDs and redact sensitive fields.
3. Basic dashboard and alert thresholds are documented.
Dependencies: B-008, C-005.

## POC Exit Criteria

1. User can authenticate, select profile, and run streaming chat end-to-end.
2. One-way file sync works with initial pull and explicit push for at least one thread.
3. Idempotent chunked upload/commit and optimistic concurrency are enforced.
4. Interrupted transfers resume successfully.
5. Manual reconciliation restores consistency from last cursor.

## MVP Exit Criteria

1. Local changes auto-sync via watcher; remote changes ingest via SSE + reconciliation fallback.
2. Conflict center supports `pick local`, `pick remote`, and `keep both`.
3. Data explorer is usable in read-only mode for non-admin users.
4. Quotas/rate limits are enforced and surfaced cleanly in UI.
5. Reliability tests pass for disconnect, duplicate, and ordering edge cases.

