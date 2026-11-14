# 1105 Care-Audit demo story ship evidence

date: 2026-11-05
repo: aezisai-inc/poc-aria-care-audit

## Gitflow
- feature PR → develop: https://github.com/aezisai-inc/poc-aria-care-audit/pull/14 (merged)
- develop → staging: https://github.com/aezisai-inc/poc-aria-care-audit/pull/15 (merged)
- promote-stg → main PR (OPEN, human merge): https://github.com/aezisai-inc/poc-aria-care-audit/pull/16
- staging tip: `43848ed`

## Deploy
- CDK: `PocAriaCareAuditStack` SUCCEED (ap-northeast-1)
- CF: https://dgcdk3euel458.cloudfront.net/
- S3 sync + invalidation completed

## Smoke (staging CF)
- `/api/health` → ok
- `/api/audit/run` Trace: Vision/Mask/Tavily/CodeAF/Daytona.destroy = live-cache (not fixture)
- status: PHI EXTERNAL TRANSFER: 0 BYTE · Daytona Sandbox: Destroyed (sbx-pitch-seed-001)
- metrics: fallRisk 88→18 · costDelta 68400 · assistDelta 1095
- `/api/docs/dual` → form2 present
- `/` → 200

## Partner keys
- SSM empty at deploy → seeded live-cache pitch path
- Later: `eval "$(bash scripts/load-partner-env.sh)"` then redeploy

## Tests
- test:all PASS · test:live PASS
