# VeriFace Edge — Production Dockerfile
# Multi-stage build for minimal attack surface.

# ---- Stage 1: Dependencies ----
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- Stage 2: Builder ----
FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run db:generate
RUN bun run build

# ---- Stage 3: Runner (minimal) ----
FROM oven/bun:1.3-slim AS runner
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only production artifacts
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules ./node_modules

# Create data directory for SQLite (in production, use external DB)
RUN mkdir -p /app/db && chown nextjs:nodejs /app/db

# SECURITY FIX (Infra-03): Removed `RUN bunx prisma migrate deploy` from build time.
# Previously, the migration ran during Docker BUILD — baking the DB schema into the
# image. This is wrong for PostgreSQL (production DB is external and needs migration
# at container STARTUP, not build time). The migration now runs via an entrypoint
# script when the container starts, connecting to the production DB.
COPY --from=builder /app/prisma ./prisma

# Copy the entrypoint script
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# Health check (using bun, not curl — curl not in slim image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# SECURITY FIX (Infra-03): Run migration at startup, then start the server.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "server.js"]
