# Testing and TDD Workflow

## Goal

Make tests the default path for every change in desktop and Tauri layers.

## Daily Workflow

1. Write or update a failing test for the behavior change (`RED`).
2. Implement the minimum code to make the test pass (`GREEN`).
3. Refactor while keeping tests green (`REFACTOR`).
4. Run full checks before push.

## Commands

- Install dependencies: `npm install`
- Run lint checks: `npm run lint`
- Run interactive web tests: `npm test`
- Run CI-style web tests with coverage: `npm run test:ci`
- Run E2E critical path tests: `npm run test:e2e`
- Run real localhost integration E2E: `npm run test:e2e:local`
- Note: this uses a Vite `/api` proxy profile in browser mode to avoid CORS while still hitting `http://127.0.0.1:8000`.
- CI optional localhost job: set repo variable `LOCALHOST_E2E_ENABLED=true`.
- Optional CI overrides:
  - `LOCALHOST_E2E_HEALTH_URL` (default: `http://127.0.0.1:8000/health`)
  - `LOCALHOST_E2E_PROFILE_BASE_URL` (default: `http://127.0.0.1:4173/api`)
  - Secret `LOCALHOST_E2E_BACKEND_START_CMD` to bootstrap backend in CI before test run.
- Build web app: `npm run build`
- Run Rust format check: `npm run fmt:rust:check`
- Format Rust code: `npm run fmt:rust`
- Run clippy with warnings denied: `npm run clippy`
- Run Rust tests: `npm run test:rust`
- Full check: `npm run check`
- Install pre-push hook: `npm run hooks:install`

## Required CI Gates

- Lint passes with zero warnings.
- Web tests + coverage pass.
- Web build passes.
- E2E critical path suite passes.
- Rust format check passes.
- Rust clippy passes with warnings denied.
- Rust tests pass.
- Rust compile checks pass.

## Test Scope

- Unit tests for pure helpers (`src/lib` and hook parsing/normalization logic).
- Hook tests for profile state, chat streaming, and timeline behavior.
- Rust unit tests for deterministic token/account normalization.
