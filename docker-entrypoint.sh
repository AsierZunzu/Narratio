#!/bin/sh
set -e

if [ "${FORCE_RESET}" = "true" ]; then
  node dist/worker/index.js --force-reset
fi

node dist/server/index.js &
SERVER_PID=$!

node dist/worker/index.js &
WORKER_PID=$!

# Forward SIGTERM/SIGINT to both child processes
trap 'kill "$SERVER_PID" "$WORKER_PID" 2>/dev/null' TERM INT

# Exit when either child exits
wait "$SERVER_PID" "$WORKER_PID"
