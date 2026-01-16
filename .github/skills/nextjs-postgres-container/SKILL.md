---
name: nextjs-postgres-container
description: Next.js (App Router) + PostgreSQL developer workflow for production-ready, containerized apps (Docker/Compose), including safe money handling using Postgres NUMERIC and Dinero.js ("deniro.js") patterns.
---

# Next.js + PostgreSQL + Containerized App

## Overview

Build and maintain production-grade Next.js applications backed by PostgreSQL, shipped as Docker images (and optionally via Docker Compose).

Priorities:
- Correctness for money/decimal math (no floats)
- Safe DB access (pooling, migrations, transactions)
- Reproducible container builds (multi-stage, minimal runtime image)

## Version targets (verified 2026-01-16)

- **Next.js**: 16.1.x (latest stable observed: 16.1.2)
- **PostgreSQL**: 18.x (current minor observed: 18.1)

Guidance:
- Prefer staying on the latest **minor** for your chosen Postgres major.
- Treat Next.js security advisories as “upgrade now” events.

## Workflow Decision Tree

1. Data access approach
	- **Drizzle (preferred)**: SQL-first, TypeScript-friendly, good migration story.
	- **Prisma**: alternative when you want an ORM-first workflow and Prisma’s schema/migrations.
	- **Kysely / Knex**: alternatives when you want a query-builder-first approach.

2. Deployment shape
	- **Single container** (Next.js + external managed Postgres): typical production.
	- **Compose stack** (Next.js + Postgres): local dev / integration tests / simple hosting.
	- **Kubernetes**: production clusters with Ingress, autoscaling, and secret management.

3. Money representation (required: Postgres `NUMERIC` + Dinero.js)
	- **Recommended**: store minor units as `NUMERIC(20,0)` (integer semantics, no rounding).
	- If you must store decimals (e.g., `NUMERIC(20,2)`), treat values as strings in JS and convert explicitly (see references).

If you need detailed money/numeric rules and conversion patterns, read `references/money-and-numeric.md`.

If you need Kubernetes deployment patterns (Ingress, probes, HPA, migrations), read `references/kubernetes.md`.

## Standard Build Workflow

### 1) Database schema (Postgres)

- Use `NUMERIC` for money/decimals.
- Prefer explicit constraints:
	- `CHECK (amount_minor >= 0)` if negatives aren’t allowed
	- `currency_code CHAR(3)` with ISO-4217 validation (or reference table)
- Index common query patterns (user_id + created_at, status, etc.).

### 2) Next.js (App Router) structure

- Keep side effects (DB writes, payments) in **server actions** or **route handlers**.
- Validate inputs at the boundary (zod/valibot) before hitting the DB.
- Never trust client values for money amounts; recompute on server.

### 3) DB connection management

- Prefer a pooled connection string (or pooler like PgBouncer in transaction pooling mode, depending on your ORM).
- In dev with hot reload, ensure you don’t create a new pool per reload.
- Keep transactions short; avoid holding locks across network calls.

### 4) Migrations

- Migrations must run before the app serves traffic.
- For container deploys:
	- Option A: run migrations as a one-off job/container.
	- Option B: app container runs migrations on startup (acceptable for small deployments; ensure idempotency and lock).

### 5) Containerization (Docker)

Best practices:
- Multi-stage build: deps → build → runtime.
- Non-root runtime user.
- Use Next.js standalone output when possible.
- Keep secrets out of images; pass via env/secret manager.

### 6) Local dev with Compose

- Use a Postgres service with a named volume.
- Provide healthchecks and wait-for-DB behavior.
- Keep a separate `DATABASE_URL` for local dev.

### 7) Kubernetes (K8s) deployment

Keep K8s guidance simple and production-oriented:

- Prefer **managed Postgres** (RDS/Cloud SQL/Azure) vs running Postgres inside the cluster.
- Use **one-off migration jobs** (or a controlled init step) instead of running migrations on every pod start.
- Wire **health probes** correctly (readiness gates traffic; liveness restarts unhealthy pods).
- Handle secrets via **Kubernetes Secrets** or an external secret manager (don’t commit `.env`).
- Plan scaling: Next.js pods scale horizontally, but DB connections must be pooled and bounded.

For concrete manifest patterns and checklists, read `references/kubernetes.md`.

## Money Handling (Dinero.js / “deniro.js”) Rules

Hard rules:
- Never use JS `number` for money arithmetic.
- Treat DB `NUMERIC` as **string** (or a Decimal type) at the JS boundary.
- Prefer storing **minor units** in DB:
	- Example column: `amount_minor NUMERIC(20,0) NOT NULL`
	- Example usage: Dinero amount = `BigInt(amount_minor)`

Operational rules:
- Always store currency explicitly.
- Round only at well-defined boundaries (pricing, invoicing), not “whenever.”

## Pitfalls Checklist (Fast)

- **Rounding drift**: happens if you convert `NUMERIC(20,2)` → float → back.
- **Timezone bugs**: store timestamps as `timestamptz`, always.
- **Connection storms**: serverless + naive pooling can exhaust Postgres.
- **Leaky secrets**: never bake `.env` into the Docker image.

## References (Load On Demand)

- `references/money-and-numeric.md`: Postgres NUMERIC column choices + JS mapping + Dinero conversion recipes.
- `references/kubernetes.md`: K8s deployment patterns for Next.js + Postgres (Ingress, probes, autoscaling, migrations, secrets).
