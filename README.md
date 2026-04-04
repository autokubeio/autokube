<p align="center">
  <a href="https://autokube.io" target="_blank">
    <img src="https://autokube.io/icon.svg" alt="AutoKube Logo" width="100">
  </a>
</p>

<h1 align="center">AutoKube</h1>

<p align="center">
  A modern, self-hosted Kubernetes management platform built with SvelteKit and Bun.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-BSL_1.1-blue.svg" alt="License">
  <img src="https://img.shields.io/docker/v/autokubeio/autokube?label=docker" alt="Docker">
  <img src="https://img.shields.io/badge/runtime-Bun-orange" alt="Bun">
  <img src="https://img.shields.io/badge/framework-SvelteKit_2_Svelte_5-red" alt="Svelte">
</p>

## Features

- **Real-time Kubernetes Management** — Watch pods, deployments, services, and more with live updates
- **Modern UI** — Built with Svelte 5, Tailwind CSS v4, and shadcn-svelte
- **Enterprise Auth** — Local auth, LDAP, OIDC (Keycloak, Google, Okta)
- **RBAC** — Fine-grained role-based access control with cluster-scoped permissions
- **Metrics & Monitoring** — CPU/memory usage, configurable alert thresholds, notifications
- **AI Assistant** — OpenAI, Anthropic, OpenRouter, or custom LLM backends for cluster help and log analysis
- **Multi-Cluster** — Manage unlimited Kubernetes clusters from a single UI
- **Cluster Provisioning** — Create K3s clusters on Hetzner, AWS, GCP, and more
- **Audit Logs** — Complete activity tracking with user, action, IP, and timestamp
- **Flexible Database** — SQLite (zero-config default) or PostgreSQL
- **Easy Deployment** — Docker, Docker Compose, or Helm

## Cluster Connection Methods

AutoKube supports three ways to connect to your clusters:

| Method | Use Case |
|--------|----------|
| **Kubeconfig** | Direct access to local or VPN-accessible clusters (minikube, kind, k3s, VPN) |
| **Bearer Token** | Fine-grained RBAC with managed clusters (EKS, GKE, AKS) via ServiceAccount token |
| **AutoKube Agent** | Private clusters behind firewalls — agent initiates an outbound connection to AutoKube; no inbound ports required |

### AutoKube Agent

The agent runs as a Helm chart inside your cluster and **connects outbound to AutoKube** over WebSocket, acting as a secure reverse proxy. Your Kubernetes API server never needs to be publicly accessible.

**How it works:**
1. Install the agent Helm chart into your cluster
2. Agent dials out to `https://your-autokube-instance/api/proxy?token=<token>`
3. AutoKube tunnels K8s API requests through the persistent WebSocket connection
4. Agent forwards them to the in-cluster API server and streams responses back

**Install the agent:**
```bash
helm repo add autokube https://helm.autokube.io
helm install autokube-agent autokube/agent \
  --namespace autokube-system \
  --create-namespace \
  --set url=https://your-autokube-instance \
  --set token=<token-generated-by-autokube>
```

The token is generated automatically in the AutoKube UI under **Settings → Clusters → Add Cluster → AutoKube Agent**.

See [docs/AGENT_SETUP.md](./docs/AGENT_SETUP.md) for full setup instructions and Helm values reference.

## Quick Start

### Docker (Recommended)

```bash
docker run -d \
  --name autokube \
  --restart unless-stopped \
  -p 8080:8080 \
  -v autokube-data:/data \
  autokubeio/autokube:latest
```

Access at **http://localhost:8080**

### Docker Compose

```bash
# Clone the repository
git clone https://github.com/autokubeio/autokube.git
cd autokube

# Start with Docker Compose
docker compose up -d

# Access at http://localhost:8080
```

### Local Development

**Prerequisites**: [Bun](https://bun.sh) 1.3+

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Access at http://localhost:5173
```

## Configuration

All configuration is optional — AutoKube works out of the box with sensible defaults.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | SQLite at `./data/db/autokube.db` | Postgres URI (`postgres://…`) to switch backend |
| `DATA_DIR` | `./data` | Base directory for SQLite DB and encryption key |
| `ENCRYPTION_KEY` | Auto-generated | Base64-encoded 32-byte AES-256 key |
| `NODE_TLS_REJECT_UNAUTHORIZED` | — | Set `0` to disable TLS verification (self-signed certs) |

No `.env` file is required — all defaults are configured automatically on first startup.

## Documentation

- **[Kubernetes Service & Auth](./docs/README.md)** — Connection methods and Kubernetes service architecture
- **[Agent Setup](./docs/AGENT_SETUP.md)** — In-cluster agent installation and configuration
- **[Real-time Watch](./docs/REALTIME_WATCH_GUIDE.md)** — WebSocket/SSE event streaming guide
- **[Implementation](./docs/IMPLEMENTATION.md)** — Architecture, API design, and internals
- **[Formatters](./docs/formatters.README.md)** — Data formatting utilities reference

## Technology Stack

| Category | Technology |
|----------|-----------|
| **Runtime** | [Bun](https://bun.sh) |
| **Framework** | [SvelteKit 2](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev) (Runes) |
| **Database ORM** | [Drizzle ORM](https://orm.drizzle.team) — SQLite & PostgreSQL |
| **UI** | [Tailwind CSS v4](https://tailwindcss.com), [shadcn-svelte](https://shadcn-svelte.com), [bits-ui](https://bits-ui.com) |
| **Tables** | [TanStack Table v8](https://tanstack.com/table) |
| **Terminal** | [xterm.js](https://xtermjs.org) |
| **Editor** | [CodeMirror 6](https://codemirror.net) |
| **Charts** | [LayerChart](https://layerchart.com) |
| **Auth** | Local, LDAP (`ldapts`), OIDC |
| **Email** | [Nodemailer](https://nodemailer.com) |

## Development Commands

```bash
bun run dev          # Start development server (port 5173)
bun run build        # Production build
bun run start        # Run production build
bun run check        # TypeScript + Svelte type checking
bun run lint         # Prettier + ESLint check
bun run format       # Auto-format code

bun run db:push      # Push schema changes (dev, no migration files)
bun run db:generate  # Generate migration SQL files
bun run db:migrate   # Run pending migrations
bun run db:studio    # Open Drizzle Studio

bun run docker:build # Build Docker image
bun run docker:up    # Start via Docker Compose
bun run docker:down  # Stop via Docker Compose
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

AutoKube is licensed under the **[Business Source License 1.1](./LICENSE)** (BSL 1.1).

- **Free to use** for personal, internal, and non-competing production use
- **Source available** — read, modify, and self-host freely
- **Converts to Apache 2.0** four years after each version's public release
- Commercial use that competes with AutoKube's hosted offering requires a separate license

## Support

- **Issues**: [GitHub Issues](https://github.com/autokubeio/autokube/issues)
- **Discussions**: [GitHub Discussions](https://github.com/autokubeio/autokube/discussions)
- **Professional**: support@autokube.io (48-hour response)
- **Enterprise**: Dedicated Slack channel

<a href="https://buymeacoffee.com/autokube" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
       alt="Buy Me A Coffee"
       height="40">
</a>

## Security

Found a security vulnerability? Please email security@autokube.io (PGP key available).

See [autokube.io/privacy](https://autokube.io/privacy) for our security practices.

## Roadmap

- [x] Kubernetes Events timeline view
- [ ] Cluster provisioning (EKS, GKE, AKS, DigitalOcean, Vultr)
- [ ] Cost optimization insights
- [ ] Custom resource dashboards
- [ ] GitOps integration (ArgoCD, Flux)
- [ ] Mobile app (iOS/Android)
- [ ] Backup/restore automation

Vote on features: [GitHub Discussions](https://github.com/autokubeio/autokube/discussions/categories/feature-requests)

## Acknowledgments

Built with amazing open source projects:
- [Svelte](https://svelte.dev) for the reactive framework
- [Bun](https://bun.sh) for blazing-fast runtime
- [Tailwind CSS](https://tailwindcss.com) for styling
- [Drizzle ORM](https://orm.drizzle.team) for type-safe database queries
- [shadcn-svelte](https://shadcn-svelte.com) for beautiful components

---

**Made with ❤️ by the AutoKube team**  
[Website](https://autokube.io) · [Docs](https://docs.autokube.io) · [GitHub](https://github.com/autokubeio/autokube)

