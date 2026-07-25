FROM node:22-alpine AS builder

WORKDIR /app

# better-sqlite3 v13 dropped prebuild-install, so node-gyp always builds it
# from source and needs a toolchain. Confined to this stage; see prune below.
# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
# Prune drops devDependencies but keeps the already-compiled native modules,
# so the runtime stage never needs a build toolchain.
RUN npm run build && npm prune --omit=dev


FROM node:22-alpine AS runtime

WORKDIR /app

RUN addgroup -S narratio && adduser -S narratio -G narratio

COPY package.json package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/data/audio && chown -R narratio:narratio /app/data \
    && chmod +x docker-entrypoint.sh

USER narratio

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
