#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if grep -RinE 'uaStealth|mode-stealth|SetMode\s*\(' \
  proxy app.go frontend/src frontend/index.html README.md; then
  echo "Stealth mode must not return; Ghoster is permanently PhantomOS." >&2
  exit 1
fi

grep -q 'jsEnabled: false' frontend/src/main.js
grep -q 'r.URL.Query().Get("js") == "1"' proxy/browse.go
grep -q 'script-src.*nonce-' proxy/browse.go
grep -q 'icon-ui.png' frontend/src/main.js

unformatted="$(gofmt -l -- app.go main.go proxy search)"
if [[ -n "$unformatted" ]]; then
  echo "Go files need gofmt:" >&2
  echo "$unformatted" >&2
  exit 1
fi

echo "Ghoster policy checks passed."
