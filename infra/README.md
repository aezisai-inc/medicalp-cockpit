# infra — CloudFront + S3 + LWA

- **Amplify 禁止**
- default behavior → S3 (SvelteKit static)
- `/api/*` → Nest on Lambda Web Adapter (Function URL)
- API origin `readTimeout` = 60s（Daytona create/run/delete 用）
- `npx cdk synth` after `pnpm install` in this package

Ship gate: CF URL Scan→家族切替→dual→destroy (AC-09).

## Partner keys（SSM → deploy）

Path prefix: `/poc-aria-care-audit/partners/<KEY>`（SecureString · `ap-northeast-1`）

### Human SOP（キー取得）

| Partner | 取得先 | env |
|---|---|---|
| Tavily | [app.tavily.com](https://app.tavily.com/) → API Keys | `TAVILY_API_KEY` |
| Daytona | [app.daytona.io](https://app.daytona.io/) → Keys（Sandboxes manage で可） | `DAYTONA_API_KEY` / `DAYTONA_API_URL=https://app.daytona.io/api` |
| CodeAF | 当日 Control Plane URL+token **または** OpenRouter/OpenAI 互換 URL+key | `CODEAF_API_KEY` / `CODEAF_API_URL` |
| Nosana | 当日 Vision `/v1/chat/completions` URL（キー不要時はダミー可） | `NOSANA_VISION_URL` / `NOSANA_API_KEY` |

### 投入 → CDK

```bash
export TAVILY_API_KEY="tvly-..."
export DAYTONA_API_KEY="dtn_..."
export DAYTONA_API_URL="https://app.daytona.io/api"
# optional:
# export CODEAF_API_KEY="..." CODEAF_API_URL="https://openrouter.ai/api/v1/chat/completions"
# export NOSANA_VISION_URL="https://.../v1/chat/completions" NOSANA_API_KEY="nosana-live"

bash scripts/put-partner-ssm.sh
eval "$(bash scripts/load-partner-env.sh)"
echo "TAVILY=${TAVILY_API_KEY:+set} DAYTONA=${DAYTONA_API_KEY:+set}"

cd apps/api && pnpm run build
bash scripts/package-lwa.sh
cd infra && pnpm cdk deploy PocAriaCareAuditStack
```

`PARTNER_MODE=auto`（既定）= 鍵があれば live。`live-required` = 非 live で 503。
