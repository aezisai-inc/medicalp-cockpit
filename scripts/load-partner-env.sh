#!/usr/bin/env bash
# Emit export lines for partner keys from SSM (eval this script).
# Usage: eval "$(bash scripts/load-partner-env.sh)"
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
for key in "${KEYS[@]}"; do
  val="$(aws ssm get-parameter \
    --name "${PREFIX}/${key}" \
    --with-decryption \
    --region "${REGION}" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true)"
  if [ -n "${val}" ] && [ "${val}" != "None" ]; then
    # shellcheck disable=SC2086
    printf 'export %s=%q\n' "${key}" "${val}"
  fi
done
