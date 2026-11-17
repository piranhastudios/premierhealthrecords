# Production Readiness Audit & Checklist

> Audit of `hetzner-prod` (sf-prod-1, Ubuntu 26.04 LTS) performed 2026-11-17,
> covering the Premier Health Records stack (`phr-*` containers) and its
> development workflow. This document is both a record of the current state and
> the checklist that gates forward development.

## Current state (what's already good)

- **Network security**: ufw allows only 22/80/443; the entire `phr-*` stack
  publishes no ports and is reached by Traefik over the proxy network
  (`docker-compose.yml` explicitly notes the old box leaked Postgres publicly).
- **SSH**: root login disabled, password auth disabled, key-only, fail2ban
  active (its bans are visible in the journal).
- **Containers**: all 13 `phr-*`/`phrtest-*` containers healthy with
  `restart: unless-stopped`, per-service `mem_limit`s, healthchecks, and JSON
  log rotation (3 files x 10 MB).
- **TLS**: Let's Encrypt via Traefik ACME HTTP challenge; cert for
  `app.premierhealthcentres.com` renews automatically (acme.json refreshed).
- **Resources**: 75 GB disk at 51%, 15 GB RAM with ~11 GB available, 8 cores,
  load ~0.5. Postgres volume 441 MB. PG activity is a handful of connections.
- **Isolation**: a full staging copy (`phrtest-*`) runs on the same box.
- **OS**: Ubuntu 26.04 LTS with unattended-upgrades and chrony NTP.

## Gaps found (prioritized)

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Critical** | **No database backups.** No pg_dump cron, no `.sql.gz` dumps anywhere, no off-site backup target. For an EHR holding PHI this is the single biggest production risk. |
| 2 | **High** | **No monitoring or alerting.** No uptime monitor, no node_exporter/Grafana, nothing notifies us if `phr-server` dies, the disk fills, or TLS expires. |
| 3 | **High** | **Single point of failure.** Everything runs on one box with no DR plan or documented restore procedure. Backups (item 1) are the foundation, but a runbook is needed too. |
| 4 | **Medium** | **55 pending security updates** and "Expanded Security Maintenance for Applications is not enabled". |
| 5 | **Medium** | **Hand-managed deployment.** `service.json` deliberately carries no `repoUrl`, so redeploys are manual `docker` operations; there is no CI/CD promotion path from `phrtest-*` to `phr-*` and no documented rollback. |
| 6 | **Low** | **No swap** (0B). With per-service mem limits this is tolerable, but OOM-kill of a container is a harder failure than swapping. |
| 7 | **Low** | **Telehealth TURN verification.** `phr-coturn` runs on host networking (ports 3478 + 49160–49200), but ufw only allows 22/80/443. If video calls work today they may be going via Tailscale/fallback — verify and either open the UDP range or document the path. |
| 8 | **Low** | Redis/Postgres persistence settings are password-protected but unverified (appendonly/save not confirmed through auth). |

## Production-ready checklist

Complete each item before calling the platform production-ready. Items are
grouped so work can proceed in parallel. When an item is done, check it off in
the PR with a link to the evidence (script, config, or doc commit).

### 1. Backups & disaster recovery (critical)
- [ ] Nightly `pg_dump` of `phr-postgres` (and `phrtest-postgres` at lower
      frequency) via a systemd timer, encrypted with age/gpg.
- [ ] Off-site copy: push dumps to Hetzner Storage Box / S3-compatible bucket
      with 30-day retention and, if possible, object-lock (immutability).
- [ ] Quarterly-restore test documented and actually performed once
      (`docs/` runbook: "restore into a throwaway container, verify patient
      data, record time taken").
- [ ] Redis (`phr-redis`) persistence verified (AOF or RDB snapshot enabled).
- [ ] Backup monitoring: a dead-man's-switch (e.g. Healthchecks.io ping)
      alerts when a backup run fails or stops firing.

### 2. Monitoring & alerting (high)
- [ ] External uptime monitor (or self-hosted Uptime Kuma) watching
      `https://app.premierhealthcentres.com`, the admin host, and `/health`
      endpoints of `phr-server`, alerting via the team's phone/chat.
- [ ] Disk-usage alert at 80% (df via cron or node_exporter + rule).
- [ ] Container health alert: notify when any `phr-*` container becomes
      unhealthy or restarts unexpectedly.
- [ ] Backup-failure and TLS-expiry alerts (TLS < 14 days remaining).
- [ ] A lightweight dashboard or `docker stats` snapshot reviewed weekly.

### 3. Deployment & rollback discipline (medium-high)
- [ ] Document the promotion path in `docs/environments.md`: `dev` -> staging
      (`phrtest-*`) -> prod (`phr-*`), including how the Medplum server image
      tag is bumped and how the provider/app static assets deploy.
- [ ] Tag every deployed image with the git SHA (currently
      `cbb7ad8a0` — record which commit that maps to) so rollback =
      redeploy of the previous tag.
- [ ] Write a rollback runbook (`docs/`): previous image tag + database
      compatibility note (Medplum migrations are forward-only; note how to
      handle that on rollback).
- [ ] Smoke-test script run after every deploy (login, search a patient,
      create+cancel an appointment) — manual checklist is acceptable to start.

### 4. OS & dependency hardening (medium)
- [ ] Apply the 55 pending updates at a low-traffic window; evaluate enabling
      Ubuntu Pro ESM for app-layer packages.
- [ ] Add a small swapfile (2–4 GB) with a modest swappiness so memory
      pressure degrades gracefully.
- [ ] Confirm cron `apt` unattended-upgrades covers kernel reboot policy
      (document whether reboots are manual).

### 5. Telehealth TURN path (medium)
- [ ] Verify whether video calls currently relay via `phr-coturn` or a
      fallback; from an external network, check UDP 3478 and the
      49160–49200 relay range reachability.
- [ ] Either open the required UDP range in ufw (restricted to what coturn
      needs) or remove coturn and document the fallback relay being used.

### 6. Forward-development guardrails (ongoing)
- [ ] PRs touching `docker-compose.yml` or anything under `/opt/storefactory`
      equivalents must include a deployment note in the PR body.
- [ ] Migrations to the Medplum data model run against `phrtest-*` first,
      with the `phr-postgres` backup verified fresh immediately before the
      prod run.
- [ ] New secrets go into the hand-managed `.env` only via secure channel —
      never in repo files; `SECURITY.md` stays the reference.
- [ ] Before any change that reduces isolation (new published ports, new
      networks), re-check that Docker port publishing bypasses ufw — the
      reason the stack publishes no ports at all.

## Re-audit cadence

Re-run this audit (same SSH checks) monthly and after every major deploy.
Keep the table above updated with dated evidence links.
