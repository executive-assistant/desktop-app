#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-executive-assistant/desktop-app}"
BRANCH="${2:-main}"
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

if [[ -z "${TOKEN}" ]]; then
  echo "Missing GITHUB_TOKEN (or GH_TOKEN)."
  echo "Create a token with repo admin permission and export it first."
  exit 1
fi

echo "Applying branch protection to ${REPO}:${BRANCH}"

curl --silent --show-error --fail \
  --request PUT \
  --url "https://api.github.com/repos/${REPO}/branches/${BRANCH}/protection" \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer ${TOKEN}" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  --data @- <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "web" },
      { "context": "e2e" },
      { "context": "rust" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false
}
JSON

echo "Branch protection applied."

