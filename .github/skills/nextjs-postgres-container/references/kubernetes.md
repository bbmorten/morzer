# Kubernetes (K8s) Patterns for Next.js + PostgreSQL

This is a pragmatic checklist + patterns reference for deploying a Next.js App Router app on Kubernetes, backed by PostgreSQL.

## Decision points

1. **Postgres placement**
- Prefer **managed Postgres** for production.
- Only run Postgres in-cluster for dev/test or when you have a strong ops reason (backups, upgrades, HA, storage class, monitoring).

2. **How the app connects to Postgres**
- Keep connection counts bounded.
- Consider a pooler (PgBouncer) if:
  - you run many app replicas
  - you use serverless-like burst scaling
  - you see connection exhaustion on Postgres

3. **Migrations strategy**
- Prefer a dedicated **Job** that runs migrations once per deploy.
- Avoid “every pod runs migrations on boot” unless you serialize with a lock and accept slower/fragile rollouts.

## Required runtime configuration

- `DATABASE_URL` (Secret)
- `NODE_ENV=production`
- `PORT=3000` (or whatever you expose)
- If using Drizzle migrations in CI/CD, ensure your migration runner image has the migration code + config.

## Health checks (probes)

- **readinessProbe**: only returns success when the app can serve traffic.
- **livenessProbe**: restarts the container if it is wedged.

For Next.js:
- Prefer a lightweight health endpoint such as `GET /api/healthz`.
- Health should *not* run heavy DB queries; if you check DB connectivity, do a fast `SELECT 1` with a short timeout.

## Example manifests (minimal)

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: your-registry/your-app:TAG
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3000"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: web-secrets
                  key: databaseUrl
          readinessProbe:
            httpGet:
              path: /api/healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 2
          livenessProbe:
            httpGet:
              path: /api/healthz
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 2
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

### Ingress (example)

This varies by ingress controller. Keep it as a reference shape.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

### Secrets

Do not commit Secrets. Create them via your CD system or `kubectl`.

```bash
kubectl create secret generic web-secrets \
  --from-literal=databaseUrl='postgres://USER:PASSWORD@HOST:5432/DB?sslmode=require'
```

## Autoscaling (HPA)

HPA scales web pods; your database must be able to handle the resulting concurrency.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Migrations as a Job

Run DB migrations as a Job per deployment.

Patterns:
- Use the same image as the app (if it contains migration code).
- Or use a dedicated migrator image.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: your-registry/your-app:TAG
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: web-secrets
                  key: databaseUrl
          command: ["sh", "-lc"]
          args:
            - |
              # TODO: replace with your migration command
              # Drizzle example: drizzle-kit migrate
              npm run db:migrate
```

Operational guidance:
- Run the migration Job *before* rolling out the new Deployment.
- Make migration scripts idempotent and safe to retry.

## Money + NUMERIC + K8s

- Keep money storage rules the same:
  - Prefer `NUMERIC(20,0)` minor units.
  - Treat `NUMERIC` as strings at the JS boundary.
- Ensure migrations create constraints (currency code, non-negative checks) so correctness isn’t dependent on app instances.

## Common failure modes (fast triage)

- **CrashLoopBackOff**: missing `DATABASE_URL`, wrong env key name, or app listening on a different port.
- **Readiness never becomes ready**: health endpoint path mismatch or it depends on a slow DB call.
- **Too many DB connections**: HPA scaled out, pool not bounded, no pooler.
- **Migrations collide**: multiple deploys running migration jobs simultaneously; ensure CD serializes or uses a lock.
