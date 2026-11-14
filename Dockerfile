# Build from repo root: docker build -t care-audit-api .
FROM public.ecr.aws/docker/library/node:20-bookworm-slim AS build
WORKDIR /src
COPY apps/api/package.json apps/api/
WORKDIR /src/apps/api
RUN npm install --ignore-scripts
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npx tsc -p tsconfig.json

FROM public.ecr.aws/docker/library/node:20-bookworm-slim
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /var/task
ENV PORT=8080
ENV AWS_LWA_PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/health
COPY --from=build /src/apps/api/package.json ./
COPY --from=build /src/apps/api/node_modules ./node_modules
COPY --from=build /src/apps/api/dist ./dist
COPY fixtures ./fixtures
CMD ["node", "dist/main.js"]
