# VeriFace Edge — Kubernetes Deployment Guide

This directory contains production-ready Kubernetes manifests for deploying
VeriFace Edge with high availability, auto-scaling, and security best practices.

## Prerequisites

1. **Kubernetes cluster** (EKS, GKE, AKS, or self-managed)
2. **ingress-nginx** controller: `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml`
3. **cert-manager** for TLS: `kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml`
4. **Container registry** (ECR, GCR, Docker Hub) with the VeriFace Edge image

## Quick Deploy

```bash
# 1. Build and push the Docker image
docker build -t your-registry/veriface-edge:1.0.0 .
docker push your-registry/veriface-edge:1.0.0

# 2. Create namespace
kubectl apply -f k8s/namespace.yaml

# 3. Create secrets (EDIT FIRST — replace CHANGE_ME with real values)
kubectl apply -f k8s/secrets.yaml

# 4. Deploy PostgreSQL + Redis
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml

# 5. Wait for DB + Redis to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=postgres -n veriface --timeout=120s
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=redis -n veriface --timeout=60s

# 6. Run database migration (init container)
kubectl apply -f k8s/migration-job.yaml
kubectl wait --for=condition=complete job/veriface-migrate -n veriface --timeout=300s

# 7. Deploy the app
kubectl apply -f k8s/app.yaml

# 8. Deploy the ingress (TLS + routing)
kubectl apply -f k8s/ingress.yaml

# 9. Verify
kubectl get pods -n veriface
kubectl get ingress -n veriface
```

## Architecture

```
                    Internet
                       │
                  ┌────┴────┐
                  │ Ingress │  (nginx + cert-manager TLS)
                  └────┬────┘
            ┌──────────┼──────────┐
            │          │          │
       ┌────┴───┐ ┌───┴────┐ ┌───┴────┐
       │ App #1 │ │ App #2 │ │ App #3 │  (3 replicas, HPA 3-10)
       └────┬───┘ └───┬────┘ └───┬────┘
            │         │          │
            └─────────┼──────────┘
                      │
               ┌──────┴──────┐
               │             │
          ┌────┴────┐  ┌────┴────┐
          │Postgres │  │  Redis  │
          │(20Gi PV)│  │ (cache) │
          └─────────┘  └─────────┘
```

## Files

| File | Description |
|------|-------------|
| `namespace.yaml` | Creates the `veriface` namespace |
| `secrets.yaml` | Kubernetes secrets (EDIT BEFORE DEPLOYING) |
| `postgres.yaml` | PostgreSQL StatefulSet with persistent volume |
| `redis.yaml` | Redis Deployment (cache + rate limiting) |
| `migration-job.yaml` | Init container that runs Prisma migrations |
| `app.yaml` | App Deployment (3 replicas) + Service + HPA + PDB |
| `ingress.yaml` | Ingress with TLS, security headers, rate limiting |

## Security Features

- **Non-root containers** (UID 1001 for app, 999 for postgres/redis)
- **No privilege escalation** (`allowPrivilegeEscalation: false`)
- **All capabilities dropped** (`capabilities.drop: [ALL]`)
- **Seccomp profile** (`RuntimeDefault`)
- **Pod Disruption Budget** (ensures 2 replicas during node drains)
- **Resource limits** on all containers
- **TLS via cert-manager** (automatic Let's Encrypt certificates)
- **Strict security headers** in ingress (CSP, HSTS, X-Frame-Options, etc.)
- **Rate limiting** at the ingress layer (50 rps, 100 burst)
- **Read-only root filesystem** (where possible)
- **Secrets via Kubernetes Secrets** (use External Secrets Operator in prod)

## Scaling

The HorizontalPodAutoscaler (HPA) scales the app based on CPU/memory:
- **Min replicas:** 3 (always available)
- **Max replicas:** 10 (scales up under load)
- **Scale up trigger:** CPU > 70% or memory > 80%

Manual scaling:
```bash
kubectl scale deployment veriface-app -n veriface --replicas=5
```

## Rolling Updates

```bash
# Update the image
kubectl set image deployment/veriface-app app=your-registry/veriface-edge:1.1.0 -n veriface

# Watch the rollout
kubectl rollout status deployment/veriface-app -n veriface

# Rollback if needed
kubectl rollout undo deployment/veriface-app -n veriface
```

## Monitoring

```bash
# Pod status
kubectl get pods -n veriface -w

# Logs
kubectl logs -f deployment/veriface-app -n veriface

# Resource usage
kubectl top pods -n veriface

# Events
kubectl get events -n veriface --sort-by='.lastTimestamp'
```

## Backup

PostgreSQL data is on a persistent volume. For backups:
```bash
# Manual backup
kubectl exec -n veriface postgres-0 -- pg_dump -U veriface veriface > backup.sql

# Restore
kubectl exec -i -n veriface postgres-0 -- psql -U veriface veriface < backup.sql
```

For automated backups, use a CronJob with pg_dump + S3 upload.
