<!--
  Thanks for contributing to AutoKube. Keep the PR small, focused, and linked to an issue.
  If you opted into agent-assisted mode on the issue, mirror the results below.
-->

## Summary

<!-- 1–3 bullets on what changed and why. Explain the "why", not the "what" (diff shows what). -->

-
-

## Linked issue

Closes #

## Type of change

<!-- Check all that apply. -->

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor (no behavior change)
- [ ] Docs
- [ ] Build / CI / tooling
- [ ] Breaking change

## Areas touched

- [ ] UI / SvelteKit routes
- [ ] Kubernetes services (`src/lib/server/services/kubernetes`)
- [ ] SSE watch layer / client hooks
- [ ] AI service
- [ ] Background services (notifications, metrics, scans)
- [ ] RBAC / auth
- [ ] Database schema / migrations
- [ ] Agent (in-cluster reverse proxy)
- [ ] DevOps / Docker / CI

## How to test

<!-- Steps a reviewer can follow locally. Mention commands, routes, cluster auth types (kubeconfig / bearer-token / agent). -->

1.
2.
3.

## Screenshots / recordings

<!-- Required for UI changes. Before/after where relevant. -->

## Checklist

- [ ] `bun run check` passes (TypeScript + Svelte).
- [ ] `bun run lint` passes (Prettier + ESLint).
- [ ] No `export let`, `$:`, or legacy store APIs — Svelte 5 runes only.
- [ ] DB schema changes updated in **both** `schema-sqlite.ts` and `schema-postgres.ts`; `bun run db:generate` if migration needed.
- [ ] New env vars documented in `.env.example`.
- [ ] RBAC considered — new endpoints/resources gated via `authorize.ts`.
- [ ] Tested against all relevant `authType`s (kubeconfig / bearer-token / agent) where applicable.
- [ ] Manually exercised the golden path in a browser for UI changes.

## Agent-assisted mode (opt-in)

<!--
  Mirrors the agent pipeline offered on the issue template. Tick only the phases you actually ran
  using the local agents in `~/.claude/agents`. Paste links or short summaries of their output where useful.
-->

- [ ] **Analyst** run — ambiguities resolved before coding.
- [ ] **Researcher** run — context doc linked below.
- [ ] **Planner** run — plan linked below; implementation follows it.
- [ ] **Designer** run — UI spec linked below (if UI change).
- [ ] **Coder** run — this PR is the output.
- [ ] **code-reviewer** run — report addressed below.
- [ ] **Orchestrator** drove the full pipeline.

### Agent output links / notes

<!-- Paste links to plan docs, review reports, or inline summaries. Omit sections that didn't run. -->

- Plan:
- Design spec:
- Review report:
- Follow-ups deferred to a future PR:
