# ─────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────
FROM oven/bun:1.3.6 AS builder
WORKDIR /app

# Install all deps (including devDeps needed for build)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ─────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────
FROM oven/bun:1.3.6-slim AS runner
WORKDIR /app

# Install production deps only
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy built app from builder stage
COPY --from=builder /app/build ./build
# Migrations are read at runtime from cwd()/drizzle
COPY --from=builder /app/drizzle ./drizzle

# Runtime configuration
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

EXPOSE 8080

# Persist SQLite DB and encryption key across container restarts
VOLUME ["/data"]

CMD ["bun", "./build/index.js"]
