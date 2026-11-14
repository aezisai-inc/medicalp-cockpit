#!/usr/bin/env bash
# Bundle Nest + production deps (incl. @daytonaio/sdk) for Lambda Web Adapter.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/.lwa-package"
mkdir -p "$ROOT/.lwa-package"
cd "$ROOT/apps/api"
pnpm exec tsc -p tsconfig.json
cp package.json run.sh "$ROOT/.lwa-package/"
cp -R dist "$ROOT/.lwa-package/"
cp -R "$ROOT/fixtures" "$ROOT/.lwa-package/fixtures"
cd "$ROOT/.lwa-package"
npm install --omit=dev --ignore-scripts
# Fail closed if Daytona SDK missing from production bundle
node -e "require.resolve('@daytonaio/sdk')"
chmod +x run.sh
echo "LWA package ready at .lwa-package (daytonaio/sdk bundled)"
