-- VeriFace Edge — Initial Migration
-- Created: 2026-08-07
--
-- This migration creates the initial schema. Subsequent migrations
-- should be created via `bun run db:migrate -- --name <descriptive_name>`.

-- Tenant table — enterprise clients
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "signingPubKey" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "kmsKeyId" TEXT NOT NULL,
    "livenessThreshold" REAL,
    "maxSessionAgeSec" INTEGER NOT NULL DEFAULT 60,
    "webhookUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 60,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "Tenant_active_idx" ON "Tenant"("active");

-- API keys for tenant authentication
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '*',
    "lastFour" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_tenantId_active_idx" ON "ApiKey"("tenantId", "active");

-- User table (no PII — only external ID + revocation token)
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "revocationToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "User_tenantId_externalUserId_key" ON "User"("tenantId", "externalUserId");
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- Biometric template (encrypted, never plaintext)
CREATE TABLE "BiometricTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "encryptedVector" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "norm" REAL NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'standard',
    "modelVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BiometricTemplate_tenantId_userId_key" ON "BiometricTemplate"("tenantId", "userId");
CREATE INDEX "BiometricTemplate_tenantId_idx" ON "BiometricTemplate"("tenantId");

-- Session table (ephemeral)
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "backendPubKey" TEXT NOT NULL,
    "sdkPubKey" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "flow" TEXT NOT NULL,
    "targetUserId" TEXT,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Session_tenantId_state_idx" ON "Session"("tenantId", "state");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- Hash-chained audit log (append-only)
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "thisHash" TEXT NOT NULL,
    "chainIndex" INTEGER NOT NULL,
    "actorIp" TEXT,
    "apiKeyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_tenantId_chainIndex_idx" ON "AuditLog"("tenantId", "chainIndex");
CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");

-- Webhook delivery queue
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" DATETIME,
    "lastResponseCode" INTEGER,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WebhookDelivery_tenantId_state_idx" ON "WebhookDelivery"("tenantId", "state");
CREATE INDEX "WebhookDelivery_nextRetryAt_idx" ON "WebhookDelivery"("nextRetryAt");

-- JWT revocation list
CREATE TABLE "RevokedToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jti" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revokedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "RevokedToken_jti_key" ON "RevokedToken"("jti");
CREATE INDEX "RevokedToken_tenantId_idx" ON "RevokedToken"("tenantId");
CREATE INDEX "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");

-- WebAuthn credentials (FIDO2 hybrid flow)
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT NOT NULL,
    "aaguid" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'roaming',
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");
CREATE INDEX "WebAuthnCredential_tenantId_userId_idx" ON "WebAuthnCredential"("tenantId", "userId");

-- Rate limit buckets
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bucketKey" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "RateLimitBucket_bucketKey_key" ON "RateLimitBucket"("bucketKey");
CREATE INDEX "RateLimitBucket_bucketKey_windowStart_idx" ON "RateLimitBucket"("bucketKey", "windowStart");
