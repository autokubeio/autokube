# Changelog

All notable changes to AutoKube will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-03-23

First stable release of AutoKube — a self-hosted Kubernetes management platform.

### Core Platform

- Self-hosted Kubernetes management UI built with SvelteKit 2 + Svelte 5 and Bun runtime
- Support for SQLite (zero-config default) and PostgreSQL databases
- Docker, Docker Compose, and Helm deployment options
- Auto-configured encryption (AES-256-GCM) and environment defaults

### Multi-Cluster Management

- Connect and manage unlimited Kubernetes clusters
- Three connection methods: Kubeconfig, Bearer Token + API URL, AutoKube Agent (WebSocket reverse proxy)
- Agent-based connectivity for private clusters behind firewalls
- Cluster health monitoring with configurable alert thresholds
- Drag-and-drop customizable dashboard with CPU/memory metrics

### Kubernetes Resources (35+)

- **Workload**: Pods, Deployments, DaemonSets, StatefulSets, ReplicaSets, Jobs, CronJobs, HPAs, Nodes, Namespaces, Events
- **Network & Routing**: Services, Endpoints, Endpoint Slices, Ingresses, Ingress Classes, Network Policies
- **Configuration**: ConfigMaps, Secrets, Resource Quotas, Limit Ranges
- **Storage**: PVCs, Persistent Volumes, Storage Classes
- **Access Control**: Service Accounts, Roles, Cluster Roles, Role Bindings, Cluster Role Bindings
- **Extensions**: Custom Resources (CRDs), Helm Releases

### Real-Time Operations

- Live resource watching via WebSocket/SSE event streaming
- Web terminal for interactive container shell access (xterm.js)
- Real-time pod log viewer with search
- YAML editor with syntax highlighting (CodeMirror 6)
- Resource Map for visual topology of cluster resources
- Events Timeline view

### AI-Powered Assistance

- Context-aware AI chat for cluster troubleshooting
- Intelligent pod log analysis for error detection
- Multi-provider support: OpenAI, Anthropic, OpenRouter, custom LLM backends

### Security & Authentication

- Local auth with password hashing
- LDAP / Active Directory integration
- OIDC support (Keycloak, Google, Okta)
- TOTP-based MFA with QR code setup and backup codes
- Fine-grained RBAC with cluster-scoped permissions
- AES-256-GCM encryption for all sensitive fields at rest
- Full audit logging (user, action, entity, IP, timestamp)

### Notifications

- SMTP email notifications via Nodemailer
- Apprise integration for multi-channel alerts

### Cluster Provisioning

- Create K3s clusters on cloud providers (Hetzner, AWS, GCP)
- SSH key management with encrypted private key storage

### Performance

- Batched pod state updates for large cluster optimization
- Efficient rendering with optimized update model

### UI/UX

- Namespace selection with built-in search
- Command palette for quick navigation
- Responsive layout with mobile-friendly breadcrumb navigation
- Dark/light theme support

---

## [0.0.3] — 2026-02-25

### Added

- TOTP-based MFA (QR setup + backup codes)
- MFA verification during login
- Secure MFA disable flow with password validation
- New MFA API endpoints (setup, verify, enable, disable)

## [0.0.2] — 2026-02-20

### Changed

- Replaced legacy Select component with NamespaceSelect across multiple pages
- Introduced NamespaceSelect component with built-in search and full namespace listing

### Fixed

- Pod loading optimization with batched addition events
- Reduced state updates during initial load for large clusters
- Improved UI responsiveness (O(n²) → batched update model)

### Removed

- Deprecated Select component

## [0.0.1] — 2026-02-15

### Added

- Initial release of AutoKube
- Self-hosted Kubernetes management UI (SvelteKit + Bun)
- SQLite and PostgreSQL database support
- Multi-cluster management with Kubeconfig, Bearer Token, and Agent connections
- Real-time Kubernetes resource monitoring (35+ resource types)
- Web terminal, pod log viewer, YAML editor
- AI-powered chat and log analysis
- Drag-and-drop dashboard
- RBAC, authentication (Local, LDAP, OIDC)
- Notification system (SMTP / Apprise)
- Full audit logging
