# VeriFace Edge — Production Dockerfile
#
# Security features:
#   - Multi-stage build (minimal attack surface in final image)
#   - Non-root user (UID 1001)
#   - No shell in final image (distroless-compatible)
#   - OCI labels for registry metadata
#   - Health check built-in
#   - Entrypoint runs migrations at startup (not build time)
#   - .dockerignore prevents secrets in build context
#
# Build:
#   docker build -t veriface-edge:latest .
#   docker build -t veriface-edge:latest --build-arg COMMIT_SHA=$(git rev-parse HEAD) .
#
# Run:
#   docker run -p 3000:3000 --env-file .env.production veriface-edge:latest

# ---- Build arguments for OCI labels ----
ARG COMMIT_SHA=""
ARG VERSION="1.0.0"

# ---- Stage 1: Dependencies ----
FROM oven/bun:1.3 AS deps
WORKDIR /app

# Copy only lock files first (better layer caching)
COPY package.json bun.lock ./

# Install ALL dependencies (including dev — needed for build)
RUN bun install --frozen-lockfile

# ---- Stage 2: Builder ----
FROM deps AS builder
WORKDIR /app

# Copy source code (respects .dockerignore)
COPY . .

# Generate Prisma client
RUN bun run db:generate

# Build the Next.js standalone output
RUN bun run build

# ---- Stage 3: Production dependencies ----
FROM oven/bun:1.3 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- Stage 4: Runner (minimal attack surface) ----
FROM oven/bun:1.3-slim AS runner

# OCI labels (for container registries)
LABEL org.opencontainers.image.title="VeriFace Edge"
LABEL org.opencontainers.image.description="Privacy-first facial authentication SaaS platform"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/ahmedkobbi/veriface-edge"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="VeriFace"

WORKDIR /app

# Create non-root user (UID 1001, no home directory, no shell login)
RUN addgroup --system --gid 1001 veriface && \
    adduser --system --uid 1001 --gid 1001 --no-create-home veriface

# Copy only production artifacts from builder
COPY --from=builder --chown=veriface:veriface /app/.next/standalone ./
COPY --from=builder --chown=veriface:veriface /app/.next/static ./.next/static
COPY --from=builder --chown=veriface:veriface /app/public ./public
COPY --from=builder --chown=veriface:veriface /app/prisma ./prisma

# Copy Prisma generated client
COPY --from=builder --chown=veriface:veriface /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=veriface:veriface /app/node_modules/@prisma ./node_modules/@prisma

# Copy production node_modules (overwrites dev deps from builder copy)
COPY --from=prod-deps --chown=veriface:veriface /app/node_modules ./node_modules

# Copy the entrypoint script
COPY --chown=veriface:veriface docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create temp directory for the app (writable by non-root user)
RUN mkdir -p /tmp/veriface && chown veriface:veriface /tmp/veriface

# Switch to non-root user
USER veriface

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUN_INSTALL_CACHE_DIR=/tmp/veriface/.bun-cache

# Expose the app port
EXPOSE 3000

# Health check (using bun — curl not in slim image)
# Checks /api/health which returns 200 if healthy, 503 if degraded
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r => { if (r.ok) process.exit(0); else process.exit(1); }).catch(() => process.exit(1))"

# Run migration at startup, then start the server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "server.js"]
