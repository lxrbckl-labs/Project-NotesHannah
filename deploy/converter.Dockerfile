# syntax=docker/dockerfile:1
# The file-conversion worker. Build from the repository root:
#   docker build -f deploy/converter.Dockerfile -t notes-converter .
# Run it only through deploy/docker-compose.converter.yml (the lockdown flags live there).

# ---- build: compile TypeScript, then assemble a directory with production dependencies only.
FROM node:25-trixie-slim AS build
ENV CI=true
RUN npm install -g pnpm@10.30.2
WORKDIR /repo
# Manifests first so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/converter/package.json apps/converter/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/schema/package.json packages/schema/
RUN pnpm install --frozen-lockfile --filter "@notes/converter..."
COPY apps/converter apps/converter
RUN pnpm --filter @notes/converter build
RUN pnpm --filter @notes/converter --prod --legacy deploy /out

# ---- runtime: Debian trixie slim with LibreOffice Impress, poppler, libheif and the font packs.
FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress libreoffice-core libreoffice-common \
      poppler-utils \
      libheif-examples libheif-plugin-libde265 \
      util-linux \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-noto-core fonts-dejavu-core \
 && apt-get clean && rm -rf /var/lib/apt/lists/* /usr/share/man /usr/share/info \
 && find /usr/share/doc -type f ! -name copyright -delete && find /usr/share/doc -xtype l -delete \
 && rm -rf /usr/share/locale/* /usr/lib/libreoffice/share/gallery /usr/lib/libreoffice/help \
 && fc-cache -f \
 && useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin converter
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /opt/converter
COPY --from=build /out/ ./
ENV NODE_ENV=production DATA_DIR=/data HOME=/tmp
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/node", "/opt/converter/dist/index.js"]
