# NAMI status

2026-10-19 — M0 complete and verified locally, including Docker.

## Working locally

- React welcome page with readable responsive typography and a native keyboard/
  touch disclosure describing the future sharing flow. No fake upload controls.
- Fastify serves the built page and `/api/health` from one loopback address.
- External data-root initialization, private directories, no static data access.
- Locked dependencies, TypeScript, ESLint, API tests and Playwright smoke checks.
- Single-service Dockerfile/Compose configuration and copy-paste README commands.

## Verified

- `npm run check`: lint, typecheck, production builds and 2 API tests passed.
- `npm run test:e2e` against the local production build: 3 tests passed
  (Chromium desktop, WebKit iPad and iPhone profiles).
- Health response, page title/content, keyboard and touch disclosure open/close,
  no application console errors or horizontal overflow.
- Visual inspection at desktop 1505×1045, iPad 810×1080, iPhone 390×664 and
  narrow phone 320×700 CSS pixels. No real iPad/iPhone hardware test yet.
- API tests verify storage persists across app recreation, private/static paths
  stay separate, unknown routes fail, and invalid storage prevents startup.
- Initial dependency audit reported no known vulnerabilities.
- Fresh local clone: `npm ci`, `npm run check` and `npm run test:e2e` all passed
  without relying on the original checkout's dependencies or build output.
- `docker compose config --quiet` passed; this validates configuration only,
  not image construction or daemon behavior.
- Native production server demonstrated at `http://127.0.0.1:3000`; healthcheck
  returned `{"status":"ok","service":"nami"}`. This is local to Beechan.
- Fresh-clone `docker compose up --build -d --wait` succeeded with a new external
  data directory. All 3 browser tests passed against the container on loopback.
- Docker restart and forced container recreation both succeeded. A synthetic
  text fixture in the bind mount retained the same SHA-256 checksum, verified
  from inside the replacement container and on the host.
- Container inspection confirmed healthy status, UID/GID 1000:1000, read-only
  root filesystem and a port binding restricted to 127.0.0.1.

## Fixes during verification

- Used Fastify's current LogController instead of its deprecated logging option.
- Corrected the hidden-file test to expect the static plugin's 403 denial.
- Separated manual screenshot capture from browser interaction checks: Playwright
  WebKit injects an inline screenshot stylesheet that the CSP rejects. Normal
  page loading and interactions have no such console error. CSP stayed strict.

## Not verified / not built

No organizer account, events, invitations, media ingestion, HEIC processing,
gallery, database, backups, public deployment or real family photos yet.

## Next task

Start M1 with **secure local organizer bootstrap and login**, without default
credentials. Keep all checks local.
After private event access works, build one JPEG's complete upload → preview →
download flow, then verify HEIC in the real container before bulk uploads.
