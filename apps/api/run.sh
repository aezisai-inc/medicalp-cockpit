#!/bin/bash
# Lambda Web Adapter entry (ZIP/custom runtime alternative to container)
set -euo pipefail
export PORT="${PORT:-8080}"
exec node dist/main.js
