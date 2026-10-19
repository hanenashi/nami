# NAMI status

2026-10-19 — M0 complete. M1 organizer access and private events complete;
invitations next.

## Working locally

- React welcome page with readable responsive typography and a native keyboard/
  touch disclosure describing the future sharing flow. No fake upload controls.
- Fastify serves the built page and `/api/health` from one loopback address.
- External data-root initialization, private directories, no static data access.
- Locked dependencies, TypeScript, ESLint, API tests and Playwright smoke checks.
- Single-service Dockerfile/Compose configuration and copy-paste README commands.
- One-time local organizer setup, persistent SQLite identity, passphrase login,
  seven-day session and sign out at `/organizer`.
- Scrypt passphrase hashing, hashed session tokens, HttpOnly SameSite cookies,
  same-origin checks and basic login/setup throttling.
- Organizer-only event creation, event list and event details with a small
  responsive form, persisted ownership and explicit event access records.

## Verified

- `npm run check`: lint, typecheck, production builds and 4 API tests passed.
- `npm run test:e2e` against the local production build: 9 tests passed across
  Chromium desktop and WebKit iPad/iPhone profiles.
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
- M1 API checks: setup validation, cross-origin rejection, one-organizer limit,
  session cookie flags, logout, repeat login and restart persistence passed.
- M1 database inspection confirmed neither the passphrase nor the raw session
  token is stored. `npm run check` passed with 3 API tests.
- M1 browser flow passed in desktop Chromium and WebKit iPad/iPhone profiles:
  first setup, signed-in state, logout and repeat login. All three layouts were
  inspected and had no horizontal overflow.
- The M1 Docker image rebuilt successfully. All 6 browser tests passed against
  an isolated container, and the organizer record survived forced recreation.
  Its database directory and file were mode `0700` and `0600`, respectively.
- Beechan's account is in the `docker` group. New login sessions can run Docker
  without `sudo`; the existing Codex session was verified with `sg docker`.
- Event API checks reject missing sessions, cross-origin creation, invalid dates
  and unknown IDs; ownership/access rows and event details survive restart.
- The event list, creation form and details flow passed desktop, iPad and iPhone
  browser checks without console errors or horizontal overflow. Their rendered
  layouts were also inspected at 1440×1000, 810×1080 and 390×664 CSS pixels.
- The event Docker image passed all 9 browser tests with disposable data. Three
  created events remained accessible after forced container recreation, with
  the database directory and file still mode `0700` and `0600`.
- Beechan's live container was rebuilt on the persistent data mount after a
  mode-`0600` SQLite snapshot. The organizer record was unchanged, the new empty
  event tables were added, and the service remains healthy and loopback-only.

## Fixes during verification

- Used Fastify's current LogController instead of its deprecated logging option.
- Corrected the hidden-file test to expect the static plugin's 403 denial.
- Separated manual screenshot capture from browser interaction checks: Playwright
  WebKit injects an inline screenshot stylesheet that the CSP rejects. Normal
  page loading and interactions have no such console error. CSP stayed strict.
- Added compiler tools to the disposable Docker build stage because the Node 22
  image had no matching prebuilt `better-sqlite3` binary. The runtime stays slim.

## Not verified / not built

No invitations, media ingestion, HEIC processing, gallery, automated backups,
public deployment or real family photos yet. No physical iPad/iPhone event-flow
test yet.

## Next task

Add **viewer/contributor invitations** with hashed secrets, optional expiry,
redemption into an event-scoped guest session, and organizer revocation.
