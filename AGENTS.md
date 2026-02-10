# AGENTS.md

## Mandatory Engineering Policy

### TDD (Required)

- Use `RED -> GREEN -> REFACTOR` for every behavior change.
- Start with a failing test when feasible before production code changes.
- Every behavior change must include or update automated tests.
- If test-first is not feasible (for example platform-level integration constraints), document why in the PR.
- No task is considered done unless all project checks pass locally and in CI.

### PR and Branch Discipline

- Use feature branches only; never commit directly to `main`.
- Keep PRs small and focused (single objective).
- Link work items to backlog IDs (for example `A-005`, `B-003`).
- Require at least one review for code touching sync, auth, or security-sensitive logic.

### Quality Gates (CI)

- Frontend: `npm run lint`, `npm run test:ci`, and `npm run build` must pass.
- End-to-end: `npm run test:e2e` critical path suite must pass.
- Rust: `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`, and `cargo check` in `src-tauri` must pass.
- Coverage thresholds are enforced by test configuration.

### Test Pyramid

- Unit tests: pure functions and hooks/components with stable logic.
- Integration tests: API interaction paths, stream parsing, sync queue semantics.
- E2E tests: desktop critical path flows (profile select, auth save/logout, chat streaming, sync actions).

### Security and Reliability Baselines

- No secrets/tokens in plaintext files or logs.
- Validate and sanitize all profile and endpoint inputs.
- Prefer explicit error states over silent fallback in sync and auth flows.
- Add tests for failure modes (timeouts, retries, malformed payloads, interrupted streams).

### API and Contract Practices

- Keep API contracts versioned and backward-compatible where possible.
- Add contract tests for endpoint payload shape changes.
- Publish examples for success and error payloads with each contract update.

### Observability Practices

- Emit structured logs for key workflows with correlation/request IDs.
- Record and monitor error rates for chat/sync/auth paths.
- Add actionable error messages in UI for recoverable failures.
