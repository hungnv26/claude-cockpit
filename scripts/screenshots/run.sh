#!/bin/sh
# Regenerates docs/ipad.PNG and docs/iphone.PNG from a throwaway demo instance:
# neutral sample sessions and a usage fixture, never the live board — the
# screenshots go in a public README. Needs Google Chrome (or CHROME=<path>),
# and `pnpm build` first so the demo serves the current UI.
set -e
cd "$(cd "$(dirname "$0")/../.." && pwd)"
HERE=scripts/screenshots
PORT=${COCKPIT_DEMO_PORT:-5299}
TMP=$(mktemp -d)
URL="http://127.0.0.1:$PORT/?t=demo"

node $HERE/make-demo.mjs "$TMP"

NODE_ENV=production COCKPIT_PORT=$PORT COCKPIT_TOKEN=demo \
  CLAUDE_COCKPIT_DIR="$TMP/claude" COCKPIT_USAGE_FIXTURE="$TMP/usage.json" \
  node_modules/.bin/tsx server/index.ts >"$TMP/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$TMP"' EXIT

until curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; do sleep 1; done
# Wait until all three sessions have their context breakdown (one CLI probe each).
i=0
until [ "$(curl -s "http://127.0.0.1:$PORT/api/sessions?t=demo" | grep -o '"autocompact"' | wc -l | tr -d ' ')" = 3 ]; do
  i=$((i + 1)); [ $i -gt 90 ] && { echo "context probes didn't finish; see $TMP/server.log"; exit 1; }
  sleep 1
done

node $HERE/cdp-shot.mjs docs/ipad.PNG 1024 768 "$URL"
node $HERE/cdp-shot.mjs docs/iphone.PNG 375 812 "$URL"
