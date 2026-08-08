# VeriFace Edge — Branch Protection & CI/CD Setup Guide

This document describes the required GitHub repository settings for the
CI/CD pipeline to function correctly.

## Branch Protection Rules

Configure these in GitHub: **Settings → Branches → Add rule**.

### `main` branch (production)

| Setting | Value |
|---------|-------|
| Branch name pattern | `main` |
| Require a pull request before merging | ✅ Enabled |
|   Required approvals | 2 |
|   Dismiss stale approvals on new push | ✅ |
|   Require review from Code Owners | ✅ |
| Require status checks to pass | ✅ Enabled |
|   Require branches to be up to date | ✅ |
|   Required status checks | `Lint & Type Check`, `Tests`, `Security`, `Docker Build` |
| Require conversation resolution before merging | ✅ |
| Do not allow bypassing the above settings | ✅ |
| Restrict who can push to matching branches | Admins only |

### `develop` branch (integration)

| Setting | Value |
|---------|-------|
| Branch name pattern | `develop` |
| Require a pull request before merging | ✅ Enabled |
|   Required approvals | 1 |
| Require status checks to pass | ✅ Enabled |
|   Required status checks | `Lint & Type Check`, `Tests` |

## GitHub Environments

Configure in **Settings → Environments**.

### `staging`
- **Required reviewers:** (none — auto-deploy on main push)
- **Deployment branch:** `main`
- **Environment URL:** `https://staging.veriface.io`
- **Environment secrets:**
  - `STAGING_HOST` — SSH host for staging server
  - `STAGING_USER` — SSH username
  - `STAGING_SSH_KEY` — SSH private key
  - `SLACK_WEBHOOK_URL` — Slack webhook for deploy notifications

### `production`
- **Required reviewers:** 2 (manual approval required)
- **Deployment branch:** `main`
- **Environment URL:** `https://veriface.io`
- **Wait timer:** 5 minutes (cooling-off period after approval)
- **Environment secrets:**
  - `PROD_KUBECONFIG` — Kubernetes config for production cluster
  - `SLACK_WEBHOOK_URL` — Slack webhook for deploy notifications

## Required Repository Secrets

Configure in **Settings → Secrets and Variables → Actions**.

| Secret | Used by | Description |
|--------|---------|-------------|
| `STAGING_HOST` | CD (staging) | SSH host for staging server |
| `STAGING_USER` | CD (staging) | SSH username |
| `STAGING_SSH_KEY` | CD (staging) | SSH private key (ed25519) |
| `PROD_KUBECONFIG` | CD (production) | Kubernetes config (base64) |
| `SLACK_WEBHOOK_URL` | CD (both) | Slack webhook for notifications |

**Note:** `GITHUB_TOKEN` is automatically provided — no secret needed for GHCR.

## CI/CD Pipeline Flow

```
  Developer                GitHub Actions              Deployment
  ─────────                ──────────────              ──────────
      │                          │                          │
      │  Push to feature branch  │                          │
      │ ───────────────────────► │                          │
      │                          │  CI: lint + test +       │
      │                          │  security + docker-build │
      │                          │                          │
      │  Open PR to main         │                          │
      │ ───────────────────────► │                          │
      │                          │  CI re-runs on PR        │
      │                          │  Code review (2 approvals)│
      │                          │                          │
      │  Merge to main           │                          │
      │ ───────────────────────► │                          │
      │                          │  CI runs again           │
      │                          │  CD: build + push image  │
      │                          │  CD: deploy to staging   │
      │                          │ ───────────────────────► │
      │                          │                          │  Staging live
      │                          │                          │
      │  Manual: Run CD workflow │                          │
      │  with environment=prod   │                          │
      │ ───────────────────────► │                          │
      │                          │  CD: verify scan + sig   │
      │                          │  2 reviewers approve     │
      │                          │  5-min wait timer        │
      │                          │  CD: deploy to prod      │
      │                          │ ───────────────────────► │
      │                          │                          │  Production live
      │                          │                          │  Auto-rollback on fail
```

## Code Owners

Create a `.github/CODEOWNERS` file to enforce review requirements:

```
# Default: require review from the security team
*                           @ahmedkobbi

# Security-critical files require additional review
/src/lib/crypto-server.ts   @ahmedkobbi
/src/lib/auth.ts            @ahmedkobbi
/src/lib/audit.ts           @ahmedkobbi
/src/lib/billing.ts         @ahmedkobbi
/src/lib/session.ts         @ahmedkobbi
/src/lib/tenant.ts          @ahmedkobbi
/src/middleware.ts          @ahmedkobbi
/Dockerfile                 @ahmedkobbi
/docker-compose.yml         @ahmedkobbi
/k8s/                       @ahmedkobbi
/.github/workflows/         @ahmedkobbi
/prisma/schema.prisma       @ahmedkobbi
```

## Release Process

```bash
# 1. Create a release branch
git checkout -b release/v1.0.0

# 2. Update version in package.json
# (or use npm version)
npm version 1.0.0 --no-git-tag-version

# 3. Commit + push
git add -A
git commit -m "release: v1.0.0"
git push origin release/v1.0.0

# 4. Create PR to main, merge

# 5. After merge, tag the release
git tag v1.0.0
git push origin v1.0.0

# 6. The Release workflow triggers automatically:
#    - Builds + signs Docker image
#    - Creates GitHub Release with changelog
#    - Attaches SBOM
```

## Rollback

### Docker Compose
```bash
# List available image tags
docker images ghcr.io/ahmedkobbi/veriface-edge

# Update .env.production with the previous version
VERSION=0.9.5  # previous version

# Redeploy
docker compose --env-file .env.production up -d
```

### Kubernetes
```bash
# Rollback to previous deployment
kubectl rollout undo deployment/veriface-app -n veriface

# Or specify a specific revision
kubectl rollout undo deployment/veriface-app --to-revision=3 -n veriface

# Check rollout history
kubectl rollout history deployment/veriface-app -n veriface
```

## Monitoring CI/CD

- **CI status:** GitHub → Actions → CI
- **CD status:** GitHub → Actions → CD
- **Image registry:** https://github.com/ahmedkobbi/veriface-edge/pkgs/container/veriface-edge
- **Security scans:** GitHub → Security → Code scanning alerts
- **Dependency advisories:** GitHub → Security → Dependabot alerts
