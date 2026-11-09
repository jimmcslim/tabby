# Capture sidecar. Build context is the repo root (it bundles lib/capture/guards.ts):
#   docker compose --profile capture build capture-sidecar
# Keep PLAYWRIGHT_VERSION in sync between the image tag and the npm package.
ARG PLAYWRIGHT_VERSION=1.58.2

FROM oven/bun:1 AS build
WORKDIR /src
COPY lib/capture ./lib/capture
COPY sidecar ./sidecar
RUN bun build sidecar/server.ts --target=node --external playwright-core --outfile /out/server.mjs

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION
WORKDIR /app
ENV NODE_ENV=production
RUN npm install --no-save --no-audit --no-fund playwright-core@${PLAYWRIGHT_VERSION}
COPY --from=build /out/server.mjs ./server.mjs
# Unprivileged user; Chromium runs with --no-sandbox, so isolation is the container (see docker-compose.yml).
USER pwuser
EXPOSE 3002
CMD ["node", "server.mjs"]
