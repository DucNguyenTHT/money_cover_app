# Web: build the React app, serve it with Caddy (HTTPS from Caddy's local CA, proxy /api and /socket.io).
# Build context = repository root:  docker build -f docker/web.Dockerfile .
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
# The web imports the API's contracts/domain source, so the api workspace's deps are needed too.
RUN pnpm install --frozen-lockfile --filter "@ketoan/web..." --ignore-scripts
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/
COPY apps/web apps/web
RUN pnpm --filter @ketoan/web build

FROM caddy:2.8-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
