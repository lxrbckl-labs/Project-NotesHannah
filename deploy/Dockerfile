# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f deploy/Dockerfile -t notes-app .

FROM node:25-slim AS build
ENV CI=true
RUN npm install -g pnpm@10.30.2
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Self-contained server directory: dist + production dependencies only.
RUN pnpm --filter @notes/server --prod --legacy deploy /out

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
CMD ["node", "dist/index.js"]
