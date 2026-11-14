#!/usr/bin/env bash
# Put partner API keys from env into SSM SecureString.
# Usage: export TAVILY_API_KEY=... DAYTONA_API_KEY=...; bash scripts/put-partner-ssm.sh
set -euo pipefail
REGION="${AWS_REGION:-ap-northeast-1}"
PREFIX="/poc-aria-care-audit/partners"
KEYS=(
  TAVILY_API_KEY
  DAYTONA_API_KEY
  DAYTONA_API_URL
  CODEAF_API_KEY
  CODEAF_API_URL
  NOSANA_API_KEY
  NOSANA_VISION_URL
)
written=0
for key in "${KEYS[@]}"; do
  val="${!key-}"
  if [ -z "${val}" ]; then
    echo "skip ${key} (unset)"
    continue
  fi
  aws ssm put-parameter \
    --name "${PREFIX}/${key}" \
    --value "${val}" \
    --type SecureString \
    --overwrite \
    --region "${REGION}" \
    >/dev/null
  echo "wrote ${PREFIX}/${key}"
  written=$((written + 1))
done
if [ "${written}" -eq 0 ]; then
  echo "ERROR: no partner env vars set; export keys then re-run" >&2
  exit 1
fi
echo "put-partner-ssm: ${written} parameter(s) written in ${REGION}"
