# syntax=docker/dockerfile:1
# Build stage: compile TypeScript, install production dependencies (sharp prebuilt linux-arm64).
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && npm cache clean --force

# Runtime stage: Debian trixie slim + LibreOffice Impress + poppler + libheif (HEVC via libde265) + fonts.
FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress libreoffice-core libreoffice-common \
      poppler-utils \
      libheif-examples libheif-plugin-libde265 \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-noto-core fonts-dejavu-core \
 && apt-get clean && rm -rf /var/lib/apt/lists/* /usr/share/man /usr/share/info \
 && find /usr/share/doc -type f ! -name copyright -delete && find /usr/share/doc -xtype l -delete \
 && rm -rf /usr/share/locale/* /usr/lib/libreoffice/share/gallery /usr/lib/libreoffice/help \
 && fc-cache -f \
 && useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin converter
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /opt/converter
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN printf '#!/bin/sh\nexec /usr/local/bin/node /opt/converter/dist/index.js "$@"\n' > /usr/local/bin/convert && chmod 755 /usr/local/bin/convert
USER 10001:10001
ENV HOME=/tmp/home
ENTRYPOINT ["/usr/local/bin/convert"]
