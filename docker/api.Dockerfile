# API image. Build context = repository root:  docker build -f docker/api.Dockerfile .
FROM node:24-bookworm-slim
# pg_dump for the nightly backup must match the server (postgres:16); Debian ships 15, so use the PostgreSQL repo.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
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
