# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AutoKube is a self-hosted Kubernetes management platform built with SvelteKit + Bun. It provides a web UI for managing multiple Kubernetes clusters via direct kubeconfig, bearer token, or a reverse-proxy agent deployed inside the cluster.

## Commands

```bash
# Development
bun run dev          # Start dev server (Vite, port 5173)
bun run check        # TypeScript + Svelte type checking
bun run check:watch  # Type checking in watch mode
bun run lint         # Prettier + ESLint validation
bun run format       # Auto-format code

# Build & Run
bun run build        # Production build
bun run start        # Run production build

# Database
bun run db:push      # Push schema changes without migrations (use during dev)
bun run db:generate  # Generate migration SQL
bun run db:migrate   # Run pending migrations
bun run db:studio    # Open Drizzle Studio UI

# Docker
bun run docker:up    # Start Docker Compose (PostgreSQL + AutoKube)
bun run docker:down  # Stop Docker Compose
bun run docker:logs  # Stream logs
```

## Architecture

### Tech Stack

- **Runtime:** Bun 1.3+
- **Framework:** SvelteKit 2 + Svelte 5 (Runes — not the legacy store API)
- **Styling:** Tailwind CSS v4, shadcn-svelte, bits-ui
- **Database:** Drizzle ORM supporting SQLite (default) or PostgreSQL (detected via `DATABASE_URL` prefix)
- **Tables:** TanStack Table v8
- **Auth:** Local, LDAP (ldapts), OIDC

### Directory Layout

```
src/
  hooks.server.ts          # App init: DB migrations, background services, WebSocket upgrade, auth middleware
  routes/
    (app)/                 # Authenticated app pages (layout validates session)
    api/                   # API endpoints (auth, clusters, k8s resources, ai, agent)
  lib/
    stores/                # Svelte 5 rune-based state (*.svelte.ts files)
    hooks/                 # Custom Svelte hooks for real-time watching and metrics
    components/            # Reusable UI components
    server/
      db/                  # Schema definitions (schema-sqlite.ts, schema-postgres.ts) and DB init
      queries/             # Database operations per domain (clusters, users, sessions, etc.)
      services/
        kubernetes/        # All K8s resource interactions (22 files)
        ai-service.ts      # Unified AI provider (OpenAI/Anthropic/OpenRouter)
        notification-monitor.ts  # Background cluster health monitoring
        metrics-collector.ts     # Background CPU/memory sampling
        scan-scheduler.ts        # Cron-based image vulnerability scans
        agent-connection.ts      # WebSocket handler for in-cluster agents
        authorize.ts             # RBAC validation
```

### Kubernetes Connection Flow

Three `authType` values are supported, all routed through `src/lib/server/services/kubernetes/utils.ts`:

- **`kubeconfig`** — kubeconfig file + context name
- **`bearer-token`** — `apiServer` URL + `bearerToken` + optional TLS settings
- **`agent`** — Reverse proxy via an in-cluster agent at `agentUrl` + `agentToken` over WebSocket (`/api/agent/ws`)

The `k8sRequest()` / `makeClusterRequest()` functions handle routing transparently.

### Real-Time Updates (SSE)

Kubernetes resource watches use **Server-Sent Events**, not WebSocket:

- Endpoint: `GET /api/watch/:clusterId/:resource`
- Client-side hooks in `src/lib/hooks/`: `use-batch-watch.svelte.ts`, `use-resource-watch.svelte.ts`, `use-metrics-watch.svelte.ts`
- The `kubernetes-watch.ts` store manages singleton EventSource connections

### State Management

All stores use **Svelte 5 runes** (`$state`, `$derived`, `$effect`) in `.svelte.ts` files — never the legacy `writable()`/`readable()` pattern. Key stores:

- `cluster.svelte.ts` — active cluster selection
- `clusters.svelte.ts` — all clusters list
- `dashboard.svelte.ts` — dashboard grid layout
- `kubernetes-watch.ts` — SSE connection pool

### Database

- SQLite is the default (`./data/db/autokube.db`)
- PostgreSQL is used when `DATABASE_URL` starts with `postgres://`
- Schema files: `src/lib/server/db/schema-sqlite.ts` and `schema-postgres.ts`
- Migrations run automatically on startup in `hooks.server.ts`
- Use `db:push` during development to avoid writing migration files

### Background Services

Started in `hooks.server.ts` on app init:

1. **Notification Monitor** — polls cluster health and license expiry
2. **Scan Scheduler** — runs image vulnerability scans on a cron
3. **Metrics Collector** — samples CPU/memory for host metrics

### API Structure

All API routes live under `src/routes/api/`. Key areas:

- `auth/` — login, logout, MFA, OIDC callback
- `clusters/` — CRUD + connection testing
- `watch/:clusterId/:resource` — SSE stream
- `k8s/` — YAML view/apply
- `ai/` — chat and log analysis
- `agent/` — status + WebSocket upgrade
- `image-scans/`, `audit/`, `notifications/`, `helm-releases/`

### RBAC

`src/lib/server/services/authorize.ts` validates permissions. Roles and permissions are stored in `roles` and `rolePermissions` tables.

## Environment

Key variables (see `.env.example`):

- `DATABASE_URL` — SQLite path or PostgreSQL connection string
- `DATA_DIR` — Directory for data storage
- TLS settings for HTTPS termination
