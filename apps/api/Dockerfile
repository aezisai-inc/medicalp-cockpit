# Nest + AWS Lambda Web Adapter
FROM public.ecr.aws/docker/library/node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM public.ecr.aws/docker/library/node:20-bookworm-slim
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /var/task
ENV PORT=8080
ENV AWS_LWA_PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/health
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/../../fixtures /var/task/fixtures
# fixtures copied in CI build context from monorepo root — see infra README
CMD ["node", "dist/main.js"]
