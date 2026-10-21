# Deployment

Production deployment configs for the asciicker XP editor workbench.

See [the deployment plan archive](../docs/WORKBENCH_DOCS_ARCHIVE.md#2026-03-24-mvp-deploy-cloud-run)
for the deployment posture and constraints.

## Production: Cloud Run

- Public endpoint: <https://rikiworld.com/xpedit>
- Origin: <https://asciicker-xpedit-6abo3pnlfa-uc.a.run.app/xpedit>
- Google Cloud project / region: `yuzu-agent` / `us-central1`
- Service / Artifact Registry repository: `asciicker-xpedit`
- Workflow: [Deploy to Cloud Run](../.github/workflows/deploy-cloudrun.yml)
- Routing: [Cloudflare Worker](cloudflare-worker/xpedit-router.js)

The workflow is manual. Push the intended commit to `main`, then dispatch the
workflow from `main` with that exact commit as `target_ref`:

```sh
gh workflow run deploy-cloudrun.yml \
  --repo rikiyanai/rexpaint-asciicker-workbench-v3 \
  --ref main -f target_ref="$(git rev-parse HEAD)"
```

### Authentication prerequisites

The workflow uses GitHub OIDC, not a service-account key. Set the repository's
`GCP_WORKLOAD_IDENTITY_PROVIDER` Actions secret to an existing provider resource
name. That provider must admit this repository's `main` workflow. The service
account `github-deploy@yuzu-agent.iam.gserviceaccount.com` must grant
`roles/iam.workloadIdentityUser` to the corresponding repository principal.

The old repository `rikiyanai/asciicker-xpedit` has separate Actions secrets and
repository-scoped Google Cloud trust. Neither automatically applies to
`rikiyanai/rexpaint-asciicker-workbench-v3`. An empty provider input fails the
authentication step before any container build or deployment.

### Verification and storage warning

Require all three jobs to succeed: `build-and-push`, `deploy`, and `smoke-test`.
Also test the public route, because the workflow smoke test checks the origin:

```sh
./scripts/deploy/smoke_test.sh https://rikiworld.com /xpedit
```

The smoke test checks health, workbench HTML, templates, runtime HTML, and a
stateful PNG upload. It does not establish visual or interactive acceptance.
The service uses a single instance with ephemeral filesystem storage. Export
active work before a deployment or restart; uploads and sessions will be lost.

## Alternative: self-hosted quick start

```sh
# 1. Clone and install
git clone <repo-url> /opt/asciicker-pipeline-v2
cd /opt/asciicker-pipeline-v2
python3 -m venv venv
source venv/bin/activate
pip install -e ".[deploy]"

# 2. Configure
cp deploy/.env.example .env
# Edit .env: set PIPELINE_HOST, PIPELINE_PORT, GUNICORN_WORKERS

# 3. Run
./scripts/deploy/launch_prod.sh
```

## Files

| File | Purpose |
|------|---------|
| `.env.example` | Template environment config |
| `Caddyfile` | Caddy reverse proxy config |
| `nginx.conf` | Nginx reverse proxy config |
| `systemd/asciicker-xpedit.service` | Systemd service unit |

## Reverse proxy

Choose one:

- **Caddy** (recommended for simplicity): `caddy run --config deploy/Caddyfile`
- **Nginx**: symlink `deploy/nginx.conf` into `/etc/nginx/sites-enabled/`

Both configs show two modes:

- **Mode A (root/subdomain):** The app owns the entire domain. Set `PIPELINE_BASE_PATH=` (empty).
- **Mode B (subpath):** The app lives under a prefix like `/xpedit`. Set `PIPELINE_BASE_PATH=/xpedit` in `.env`.

The domain names are placeholders — replace with your actual domain.

## Systemd

```sh
sudo cp deploy/systemd/asciicker-xpedit.service /etc/systemd/system/
# Edit paths in the unit file if not using /opt/asciicker-pipeline-v2
sudo systemctl daemon-reload
sudo systemctl enable --now asciicker-xpedit
```

## Bug report delivery

By default, bug reports are saved locally under `data/bug_reports/`. To enable GitHub Issue creation:

| Variable | Description | Example |
|----------|-------------|---------|
| `BUG_REPORT_DELIVERY` | `local` (default), `github`, or `both` | `both` |
| `BUG_REPORT_GITHUB_REPO` | GitHub repo in `owner/repo` format | `myorg/asciicker-pipeline-v2` |
| `BUG_REPORT_GITHUB_TOKEN` | GitHub PAT with `repo` or `issues:write` scope | `ghp_...` |

When `BUG_REPORT_DELIVERY` is `both`, every bug report is saved locally AND posted as a GitHub Issue. When `github`, local save still happens as a durable fallback. The token is never exposed to the browser.

## Runtime payload

The `runtime/termpp-skin-lab-static/` directory must be present. It is committed in the repo and should not be excluded or downloaded separately.
