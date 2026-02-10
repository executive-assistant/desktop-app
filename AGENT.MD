# AGENT.MD

## Working Agreement

- Always create a feature branch before making changes.
- Never commit directly to `main`.
- Keep changes mapped to backlog story IDs in branch names and PR titles.
- Follow mandatory engineering and TDD policy in `AGENTS.md`.

## Current Priorities

- `A-005`: approval prompts for risky actions.
- `A-006`: freeze and version sync API contract with backend.

## Completed in This Branch

- `A-001`: connection profile management and persistence.
- `A-002`: Keychain-backed token storage and logout clearing.
- `A-003`: streaming chat over `/message` with persisted partial output.
- `A-004`: stage/tool timeline rendering with `running`, `success`, `error` statuses.

## Local Commands

- Install dependencies: `npm install`
- Lint: `npm run lint`
- Frontend build: `npm run build`
- Web tests with coverage: `npm run test:ci`
- E2E tests: `npm run test:e2e`
- Rust format check: `npm run fmt:rust:check`
- Rust clippy: `npm run clippy`
- Tauri check: `cd src-tauri && cargo check`

## Notes

- Desktop profile config can be stored locally.
- Auth tokens must never be persisted in plaintext files or logs.
- For remote profiles, prefer HTTPS endpoints.
