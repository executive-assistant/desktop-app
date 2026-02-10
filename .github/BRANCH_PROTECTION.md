# Branch Protection

This repo includes a helper script to apply branch protection by API.

## Prerequisites

- A GitHub token with admin permissions on the repository.
- Export token as `GITHUB_TOKEN` (or `GH_TOKEN`).

## Apply protection

```bash
export GITHUB_TOKEN=your_token_here
./scripts/apply_branch_protection.sh executive-assistant/desktop-app main
```

The script configures:

- Required checks: `web`, `e2e`, `rust`
- Optional check: `e2e-localhost` can be enabled in CI via `LOCALHOST_E2E_ENABLED=true` and is not required by default.
- Code owner reviews required
- At least 1 approving review
- Stale review dismissal
- Conversation resolution required
- Force pushes and branch deletions blocked

## Notes

- If your check run contexts differ (for example `ci / web`), update the script payload.
- Re-run the script when workflow/job names change.
