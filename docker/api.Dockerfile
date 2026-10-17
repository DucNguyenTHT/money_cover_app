# API image. Build context = repository root:  docker build -f docker/api.Dockerfile .
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app

# Dependencies first (cached while only source changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@ketoan/api..."

COPY apps/api apps/api
RUN pnpm --filter @ketoan/api build

ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh PORT=4000
EXPOSE 4000
WORKDIR /app/apps/api
CMD ["sh", "/app/apps/api/docker-entrypoint.sh"]
