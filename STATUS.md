# NAMI status

2026-10-19 — M0 and M1 complete. Private events and scoped invitations work,
and the first complete JPEG path now runs locally. A basic resumable JPEG batch queue now works.

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
- Organizer-created viewer/contributor links with optional expiry, guest
  nickname redemption, repeat access and immediate organizer revocation.
- Event-scoped guest details with clear contributor/viewer status and a
  responsive invitation flow.
- One-at-a-time contributor/organizer JPEG upload through private staging, with
  actual JPEG verification, SHA-256, exact original preservation, oriented
  metadata-stripped preview, attribution and authorized original download.
- Viewer gallery access with server-side denial of viewer uploads and all
  cross-event media operations.

## Verified

- `npm run check`: lint, typecheck, production builds and 8 API tests passed.
- `npm run test:e2e` against the local production build: 12 tests passed across
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
- The actor-schema migration preserved a legacy organizer, session, event and
  ownership record, accepted a guest afterward, and passed SQLite's foreign-key
  check.
- Invitation API checks proved raw secrets are absent from SQLite, viewer and
  contributor roles redeem correctly, a guest cannot list or create events or
  access a second event, repeat redemption keeps the nickname, and expiry and
  revocation respectively deny later redemption and access.
- The complete invitation flow passed desktop Chromium and WebKit iPad/iPhone
  profiles. Two fresh guest browser contexts redeemed the same link, and
  revocation ended both sessions. The responsive screens were also inspected at
  1440×1000, 810×1080 and 390×664 CSS pixels.
- A clean Docker image passed all 12 browser tests. Its actors, events, access
  rows and invitations survived forced container recreation with no foreign-key
  errors; the database remained mode `0600`, and the healthy read-only container
  remained UID/GID 1000:1000 and loopback-only.
- Beechan's live database was backed up consistently before migration. The
  organizer, active session, test event and ownership row matched the snapshot
  afterward, while the guest-capable actor schema and empty invitation table
  were added. The upgraded service is healthy and the test event remains.
- A generated JPEG with EXIF orientation survived upload byte-for-byte and
  matched its stored SHA-256. Its preview had the corrected orientation and no
  EXIF, originals/previews stayed mode `0600`, and staging was empty afterward.
- Media API checks deny missing sessions, cross-origin writes, viewer writes and
  cross-event IDs. Authorized viewers can see previews and download the exact
  original bytes.
- The contributor upload/gallery flow passed desktop Chromium and WebKit
  iPad/iPhone profiles. Visual inspection at 1440×1000, 810×1080 and 390×664 CSS
  pixels found readable controls and no remaining horizontal overflow.
- A clean Docker image processed three generated JPEGs with Sharp/libvips. Every
  stored size/hash matched, all previews were JPEGs without EXIF, and database
  rows and files survived forced container recreation with no foreign-key errors.

- Final JPEG verification also rejects oversized and multiple-file requests,
  cleans their staging files, and revokes an in-flight real HTTP upload before
  publication. The live database now contains two actors, one event, one
  invitation and two photos; existing originals match their stored SHA-256.

- Final live deployment is healthy and loopback-only. A fresh mode-`0600`
  SQLite backup passed integrity/foreign-key checks. Existing actors, event,
  invitation, access and media rows survived the update unchanged; both original
  and preview file hashes matched the pre-update manifest. This snapshot is not
  a complete media backup or disaster-recovery proof.

## Fixes during verification

- Used Fastify's current LogController instead of its deprecated logging option.
- Corrected the hidden-file test to expect the static plugin's 403 denial.
- Separated manual screenshot capture from browser interaction checks: Playwright
  WebKit injects an inline screenshot stylesheet that the CSP rejects. Normal
  page loading and interactions have no such console error. CSP stayed strict.
- Added compiler tools to the disposable Docker build stage because the Node 22
  image had no matching prebuilt `better-sqlite3` binary. The runtime stays slim.
- Replaced native invitation `<select>` controls with large radio choices after
  WebKit exposed a browser-generated inline-style CSP violation. CSP remains
  strict and all three browser profiles pass.
- Constrained WebKit's native file input after visual inspection found it could
  force the iPhone upload card wider than the viewport; the browser test now
  asserts the contributor page has no horizontal overflow.

## Not verified / not built

No HEIC/video processing, gallery lightbox,
scheduled backup/restore tooling or public deployment yet. Crash
reconciliation for orphaned staging/files is still pending. No physical
iPad/iPhone event-flow test yet. Current SSH-loopback invitation links work only
on the tunneled Pixel, not on relatives' devices.


## Platform direction

NAMI targets Docker on Linux, Windows and macOS, with browser access from any
supported device. Linux/Beechan is verified so far; Windows/macOS Docker and
physical iPad/iPhone testing remain outstanding.

Future Android/iOS apps should reuse React/TypeScript screens, the API client
and application logic where practical. Capacitor is a candidate, not a current
dependency or commitment. Keep file selection, sharing and background transfer
behind small replaceable boundaries as those features arrive. No native apps
are being built now, and browser background uploads are not guaranteed.

Keep storage independent of the host: opaque keys and a configured local data
root now, a replaceable storage implementation for optional cloud storage later.
Extract only boundaries needed by the next feature; avoid speculative frameworks,
cloud dependencies or broad abstractions.

## Next task

Continue M2 with abandoned-session cleanup, quota/ledger improvements and
100-file interrupted-batch testing. JPEG finalization and a simple sequential
browser queue are implemented; HEIC/video work remains later. Probe HEIC support in the actual image early;
JPEG remains the only accepted type until a decoder is verified.

## M2 transport increment

- Added SQLite-backed Tus session ownership and persistent private `uploads/`
  files, capped at ten sessions per actor and 25 MiB per file.
- Create, HEAD, PATCH and DELETE check uploader identity and current event
  contribution permission; no public staging GET route exists.
- Real HTTP tests drop a PATCH connection mid-body, verify the persisted offset,
  restart the API and resume with byte-exact results. They also test wrong
  offsets, cross-event/other-guest/viewer denial, revocation, cancellation,
  oversize creation and session allocation limits.
- Completed staged JPEGs now enter the verified original/preview/gallery path.
  A browser queue shows per-file and total progress, pause/retry/cancel and
  resumes on reselect after a reload. No expiry/background job processing or
  orphan reconciliation yet.

## Latest deployment and recovery check

- Full offline pre-Tus backup: `../nami-backups/pre-tus-20261019`, with a sibling
  SHA-256 manifest. Contains SQLite plus both originals and both previews;
  excludes older nested backups. Directory mode 0700, files 0600.
- Restored a disposable copy, started the current application against it and
  checked the additive upload-session migration. SQLite integrity and foreign
  keys passed. Restored and live rows match the backup: 2 actors, 3 sessions,
  1 event, 2 access records, 1 invitation, 2 media records. All original and
  preview hashes match. The disposable restore was removed afterward.
- Rebuilt the Docker image and deployed on the existing data mount. Container
  is healthy and remains loopback-only. This is a same-host recovery check;
  off-host disaster recovery and scheduled backups are still outstanding.

## JPEG batch increment

- API tests verify a completed upload across restart finalizes to exact original
  bytes, a preview and a gallery row; repeated finalization is idempotent.
  Wrong-owner requests and invalid JPEGs are rejected.
- Browser test transfers two JPEGs through the queue alongside the existing
  single uploader, then reads all three from the gallery across sessions.
- `npm run check` and `npm run test:e2e` cover this increment. Tests use desktop
  Chromium and simulated iPad/iPhone WebKit; physical device tests remain open.

- Before the batch deployment, stopped the container and verified a fresh full
  backup at `../nami-backups/pre-batch-20261019` with SHA-256 manifest. A
  disposable restore started successfully. Live and restored SQLite rows match
  the snapshot (2 actors, 3 sessions, 1 event, 2 access records, 1 invitation,
  2 photos); original and preview hashes match. The new image is healthy and
  still bound to `127.0.0.1:3000`.
