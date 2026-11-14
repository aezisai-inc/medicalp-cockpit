#!/usr/bin/env bash
# Upload source zip to Pipeline S3 bucket and start CodePipeline (G8 traceable ship).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${CARE_AUDIT_STACK:-PocAriaCareAuditStack}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-northeast-1}}"
OBJECT_KEY="${PIPELINE_SOURCE_OBJECT_KEY:-source/care-audit.zip}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

get_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
    --output text
}

BUCKET="$(get_output PipelineSourceBucket)"
PIPELINE="$(get_output ShipPipelineName)"
if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  echo "PipelineSourceBucket output missing on stack ${STACK}. Run cdk deploy first." >&2
  exit 1
fi
if [[ -z "$PIPELINE" || "$PIPELINE" == "None" ]]; then
  echo "ShipPipelineName output missing on stack ${STACK}." >&2
  exit 1
fi

ZIP_PATH="$TMP/care-audit.zip"
cd "$ROOT"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # Trailing `.` keeps zip paths relative to this repo root (not monorepo parent).
  git archive --format=zip -o "$ZIP_PATH" HEAD .
else
  zip -qr "$ZIP_PATH" . \
    -x '*/node_modules/*' -x 'node_modules/*' -x '*/.git/*' \
    -x 'infra/cdk.out/*' -x '.lwa-package/*'
fi

aws s3 cp "$ZIP_PATH" "s3://${BUCKET}/${OBJECT_KEY}" --region "$REGION"
EXEC_ID="$(
  aws codepipeline start-pipeline-execution \
    --name "$PIPELINE" \
    --region "$REGION" \
    --query 'pipelineExecutionId' \
    --output text
)"
echo "Uploaded s3://${BUCKET}/${OBJECT_KEY}"
echo "Started pipeline ${PIPELINE} (execution ${EXEC_ID})"
