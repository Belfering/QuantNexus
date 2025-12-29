# ============================================
# QuantNexus Docker Image
# Multi-stage build for production deployment
# ============================================
# Note: Build context is repo root, so paths use System.app/

# ============================================
# Stage 1: Build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 py3-pip g++ make

# Copy package files from System.app
COPY System.app/package*.json ./

# Install ALL dependencies (including dev)
RUN npm ci

# Copy source files from System.app
COPY System.app/ .

# Build the frontend (Vite)
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install Python and glibc compatibility (DuckDB requires glibc, not musl)
RUN apk add --no-cache python3 py3-pip libc6-compat

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server code
COPY --from=builder /app/server ./server

# Copy ticker-data Python scripts (for data downloads)
COPY --from=builder /app/ticker-data/*.py ./ticker-data/

# Copy package files and install production deps only
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production

# Copy entrypoint script
COPY --from=builder /app/docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

# Create data directories
RUN mkdir -p ./server/data ./ticker-data/data/ticker_data_parquet

# Note: Running as root for Railway volume compatibility
# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-8787}/api/status || exit 1

# Expose port (Railway will set PORT env var)
EXPOSE 8787

# Environment variables
ENV NODE_ENV=production
ENV PORT=8787

# Start via entrypoint script (creates dirs after volume mount)
ENTRYPOINT ["./docker-entrypoint.sh"]
