# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f deploy/Dockerfile -t notes-app .

FROM node:25-slim AS build
ENV CI=true
# better-sqlite3 falls back to a source build when no prebuilt binary matches this Node;
# the compiler stays in the build stage only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.30.2
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Self-contained server directory: dist + production dependencies only.
RUN pnpm --filter @notes/server --prod --legacy deploy /out
# tsc does not copy the SQL migrations; the server build does. Fail the image if they are missing.
RUN ls /out/dist/db/migrations/0001_accounts.sql /out/dist/cli/admin.js

FROM node:25-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DB_PATH=/db/notes.db \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out/ ./
COPY --from=build /repo/apps/web/dist ./web
RUN mkdir -p /data /db && chown -R node:node /data /db /app
USER node
EXPOSE 3000
# /data must be the storage drive carrying .notes-storage, or the server refuses to start.
# First run (the server will not start yet, so use a one-off container):
#   docker compose -f deploy/docker-compose.yml run --rm app node dist/cli/admin.js init-storage
# Admin, while it runs:
#   docker compose -f deploy/docker-compose.yml exec app node dist/cli/admin.js create-user <name> [--generate]
CMD ["node", "dist/index.js"]
