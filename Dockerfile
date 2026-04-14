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

RUN mkdir -p /app/data/audio && chown -R narratio:narratio /app/data

USER narratio

EXPOSE 3000
