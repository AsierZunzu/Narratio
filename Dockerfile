FROM node:24-slim AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm ci

# Copy the rest and build
COPY . .
RUN npm run build

# Second stage: production
FROM node:24-slim

WORKDIR /app

# Ensure non-root user and correct permissions for volume
RUN mkdir -p /app/data && chown -R node:node /app/data

# Only copy what's needed for production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER node

VOLUME ["/app/data"]

ENTRYPOINT ["npm", "run", "start", "--"]
