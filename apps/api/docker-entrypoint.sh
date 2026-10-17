#!/bin/sh
# Production start: apply migrations, generate the typed SQL client against the live DB
# (TypedSQL needs a database to read query types), make sure base data exists, then start.
set -e
cd /app/apps/api
npx prisma migrate deploy
npx prisma generate --sql
# Idempotent: creates the branch, settings and the first admin (temporary password printed once in the logs).
npx tsx prisma/seed/index.ts
exec node dist/main.js
