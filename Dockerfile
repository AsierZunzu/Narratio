FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build


FROM node:22-alpine AS runtime

WORKDIR /app

RUN addgroup -S narratio && adduser -S narratio -G narratio

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/data/audio && chown -R narratio:narratio /app/data \
    && chmod +x docker-entrypoint.sh

USER narratio

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
