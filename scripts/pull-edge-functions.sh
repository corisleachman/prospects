#!/usr/bin/env bash
# Pulls the six live edge functions into supabase/functions/ so the repo holds
# the server code. Downloads only: it never deploys.
# Needs: Supabase CLI, plus `supabase login` or SUPABASE_ACCESS_TOKEN in the environment.
# Normally run by .github/workflows/pull-edge-functions.yml (token kept as a GitHub secret).
set -euo pipefail
PROJECT_REF="paprxejgeepvtbqmfgvt"
FUNCTIONS=(prospect-signal-scan find-people enrich-company save-prospect suggest-reply notify-enquiry)
cd "$(dirname "$0")/.."

for fn in "${FUNCTIONS[@]}"; do
  echo "→ downloading $fn"
  supabase functions download "$fn" --project-ref "$PROJECT_REF" --use-api
done

# save-prospect has its shared secret written into the source. Replace it with
# an environment variable so the value never enters git.
SP="supabase/functions/save-prospect/index.ts"
if grep -qE '^const SHARED_SECRET = "[^"]+";' "$SP"; then
  sed -i.bak -E 's/^const SHARED_SECRET = "[^"]+";/const SHARED_SECRET = Deno.env.get("EXTENSION_SHARED_SECRET") ?? "";/' "$SP"
  rm -f "$SP.bak"
  echo "✓ save-prospect: secret literal replaced with EXTENSION_SHARED_SECRET"
fi

# Refuse to continue if anything still looks like a hard-coded secret.
echo "→ scanning for secret-looking literals"
if grep -rnE '"[A-Za-z0-9_\-]{32,}"|'"'"'[A-Za-z0-9_\-]{32,}'"'"'|(secret|token|api[_-]?key)\s*[:=]\s*["'"'"'][^"'"'"']{12,}' supabase/functions; then
  echo "✗ Possible secret found above. Replace it with Deno.env.get(...) before committing." >&2
  exit 1
fi
echo "✓ No secret literals found. Review, then commit supabase/functions/."
echo "  Deploying save-prospect later needs: supabase secrets set EXTENSION_SHARED_SECRET=<current value>"
