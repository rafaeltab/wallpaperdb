# Secrets Management for Production

> **Status:** Planned  
> **Priority:** Medium (critical before production)  
> **Estimated Effort:** 2-3 days  

## Overview

Replace hardcoded Docker Compose secrets with proper secrets management.

## Current Issues (Development Only)

```yaml
# These are DEVELOPMENT defaults only
POSTGRES_PASSWORD: wallpaperdb
MINIO_ROOT_PASSWORD: minioadmin
GRAFANA_ADMIN_PASSWORD: admin
DISABLE_SECURITY_PLUGIN: "true"
```

## Solution

### 1. Local Development

```bash
# infra/scripts/setup-local-secrets.sh
cat > .env.local <<EOF
POSTGRES_PASSWORD=$(openssl rand -base64 32)
MINIO_ROOT_PASSWORD=$(openssl rand -base64 32)
CURSOR_SECRET=$(openssl rand -hex 32)
EOF
```

### 2. Kubernetes Secrets

```yaml
# k8s/secrets/postgres.yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
stringData:
  password: <generated>
```

### 3. External Secrets (Production)

```yaml
# Use AWS Secrets Manager
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: postgres-credentials
spec:
  secretStoreRef:
    name: aws-secrets-manager
  data:
    - secretKey: password
      remoteRef:
        key: wallpaperdb/postgres
```

## Acceptance Criteria

- [ ] .env.local for development (gitignored)
- [ ] Kubernetes secrets for production
- [ ] External Secrets Operator integrated
- [ ] Secret rotation procedures documented
- [ ] OpenSearch security enabled
