# GitHub Actions Workflows

## Docker Publish Workflow

This workflow automatically builds and publishes Docker images for AutoKube, and updates the Helm chart repository.

### Triggers

- **Push to `main`/`master`**: Builds and tags with `latest` and version from `package.json`
- **Git tags** (`v*.*.*`): Builds and tags with semantic version tags
- **Pull requests**: Builds only (no push)

### What it does

1. **Build Docker Image**
   - Extracts version from `package.json`
   - Builds multi-platform images (linux/amd64, linux/arm64)
   - Pushes to Docker Hub and GitHub Container Registry
   - Tags: `latest`, version number, branch name, commit SHA

2. **Update Helm Chart** (on main/master or tags only)
   - Clones the `autokubeio/autokube-charts` repository
   - Updates `values.yaml` with new image tag
   - Updates `Chart.yaml` with new `appVersion` and `version`
   - Commits and pushes changes

### Required Secrets

Configure these secrets in your GitHub repository settings:

| Secret | Description | Where to get it |
|---|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub username | Your Docker Hub account |
| `DOCKERHUB_TOKEN` | Docker Hub access token | Docker Hub → Account Settings → Security → New Access Token |
| `CHART_PAT` | GitHub Personal Access Token with `repo` scope | GitHub → Settings → Developer settings → Personal access tokens → Generate new token (classic) with `repo` permission |

### Registry URLs

- **Docker Hub**: `docker.io/autokubeio/autokube`
- **GHCR**: `ghcr.io/autokubeio/autokube`

### Manual Trigger (optional enhancement)

To allow manual workflow dispatch, add this to the `on:` section:

```yaml
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to tag (leave empty to use package.json)'
        required: false
        type: string
```

### Local testing

Test Docker build locally:

```bash
# Build for current architecture
bun run docker:build

# Multi-platform build (requires buildx)
docker buildx build --platform linux/amd64,linux/arm64 -t autokube:test .
```
