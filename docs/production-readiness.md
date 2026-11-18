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
- [x] Nightly `pg_dump` of `phr-postgres` (and `phrtest-postgres` weekly) via
      systemd timers — `deploy/bin/phr-backup`, `phr-backup@{prod,dev}.timer`,
      live since 2026-11-18 (first prod dump: 1012 tables, 25 MB, 28 s). Also
      covers the binary volume (uploaded documents), which the audit missed, and
      runs before every prod deploy that changes the server.
- [ ] Encryption with age — **supported, needs a key**: generate a keypair off the
      box, put the public key in `AGE_RECIPIENT` in `/etc/phr/backup.env`.
- [ ] Off-site copy — **supported, needs a target**: create a Hetzner Storage Box
      (or S3 bucket with object lock), `rclone config --config /etc/phr/rclone.conf`,
      set `RCLONE_REMOTE`. The script refuses to ship unencrypted dumps off-site.
- [x] Restore test documented and performed once — `docs/runbooks/restore.md`;
      2026-11-18 drill: 35 s, Patient/Practitioner/Appointment/Project/Binary
      counts identical to live. Repeat quarterly.
- [x] Redis persistence verified: RDB snapshots were already on
      (`save 3600 1 300 100 60 10000`, `/data` on a volume); AOF added in
      `deploy/compose/stack.yml`, switched on live first because a plain restart
      with `--appendonly yes` starts Redis empty (reproduced on the box).
- [ ] Backup dead-man's-switch — **supported, needs URLs**: create two
      healthchecks.io checks and set `HC_PING_URL_PROD` / `HC_PING_URL_DEV`.
      Meanwhile `phr-monitor` alerts when the newest prod backup is > 26 h old.

### 2. Monitoring & alerting (high)
`deploy/bin/phr-monitor` runs every 5 minutes (`phr-monitor.timer`, live since
2026-11-18) and checks everything below. **It only logs to the journal until an
alert destination is set** in `/etc/phr/monitor.env` (`ALERT_WEBHOOK_URL` and/or
`NTFY_URL`).
- [ ] External uptime monitor — set `HC_PING_URL_MONITOR` (healthchecks.io,
      5 min period) so a dead box pages someone, and/or point UptimeRobot at
      `https://app.premierhealthcentres.com/api/healthcheck`.
- [x] Disk-usage alert at 80%.
- [x] Container health alert: missing / not running / unhealthy / restarted
      outside a deploy (with OOM flag), for every `phr-*` and `phrtest-*` container.
- [x] Backup-age and TLS-expiry (< 14 days) alerts; public endpoint checks of
      the provider, admin and API.
- [ ] A lightweight dashboard or `docker stats` snapshot reviewed weekly.

### 3. Deployment & rollback discipline (medium-high)
- [x] Promotion path automated and documented (`docs/environments.md`): feature
      PR → preview on dev's DB → `dev` (`phrtest-*`) → `main` (`phr-*`), via
      `.github/workflows/hetzner-{deploy,preview}.yml` and `deploy/bin/phr-deploy`.
- [x] Every image is tagged `phr/medplum-<component>:<sha12>` and labelled with
      the commit. The pre-pipeline prod images map to: server `cbb7ad8a0`
      (2026-09-16, "$book was discarding the visit type"), provider `d9d1b2fb6`
      (2026-09-15), admin `b0c47e91d` (2026-09-07) — all on `main`.
- [x] Rollback: automatic on a failed smoke test; manual via the Deploy
      workflow or `phr-deploy rollback <env>`; forward-only migration note and
      restore path in `docs/environments.md#rollback` and `docs/runbooks/restore.md`.
- [x] Smoke test after every deploy and preview (`deploy/bin/phr-smoke`): API
      health incl. postgres/redis, both UIs.
- [ ] Deeper smoke (login + patient search; dev also appointment
      create/cancel) — **supported, needs a dedicated smoke-test login** in
      `/etc/phr/smoke-{prod,dev}.env`.

### 4. OS & dependency hardening (medium) — box-wide, not done here
These touch every StoreFactory store on sf-prod-1 and need a maintenance window.
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
- [x] The compose that runs is in the repo (`deploy/compose/`) and only changes
      through a deploy; a PR touching `deploy/` should still carry a deployment
      note. Only `main` can update the deploy tool on the box, and previews never
      take their compose file from the branch being previewed.
- [x] CI holds a forced-command key (`deploy/bin/phr-deploy-ssh`) that can run
      nothing but `phr-deploy` with a fixed grammar; every call is logged in
      `/opt/phr-deploy/state/ssh.log`.
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
