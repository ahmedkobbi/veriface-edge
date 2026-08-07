import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// SECURITY: Only log queries in development. In production, query logs
// can expose sensitive data (API key hashes, encrypted vectors, session challenges).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']  // Production: errors and warnings only
      : ['query', 'info', 'warn', 'error'],  // Development: full logging
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
