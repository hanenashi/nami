# NAMI status

2026-10-19 — M0 and M1 complete. Private events, invitations and the JPEG
gallery work. Resumable JPEG batches and the album-first interface run locally.

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
- Album-first organizer/guest event screens with one immediate multi-JPEG Add
  photos picker, square responsive grid, compact progress and secondary invite
  controls. A full-screen viewer supports swipe, pinch/double-tap zoom,
  keyboard navigation and original download.

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

No HEIC/video processing, scheduled backup/restore tooling or public deployment
yet. Crash
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

## Album UX pass

The user supplied
`/storage/emulated/0/Documents/codex/NAMI mobile photo-sharing UX research.pdf`
on the Pixel (22 pages). It recommends progressive disclosure: photos and one
Add photos control first; upload machinery and organizer administration behind
secondary controls. A synthetic iPhone WebKit screenshot of the old page
confirmed the gallery was pushed below two large upload forms and a tall header.
The local visual reference is `docs/design/album-mobile-concept.png`; it is a
concept only and contains synthetic imagery, not product assets.

The current frontend retains the resumable client and existing APIs/data. The
organizer and guest pages now place a compact header and one picker above a
three-column phone grid. Organizer invitation history and revocation are in a
secondary disclosure, reachable through Invite people. The viewer shows only
attribution and original download outside the image; Escape, arrow keys and
touch gestures navigate and zoom. Upload progress stays small, expands for
details and disappears after success. Returning invitees still use the existing
one-tap Continue as name flow; broader invitation copy polish remains open.

Browser tests use disposable generated JPEGs. `npm run check` passed all 8 API
tests and `npm run test:e2e` passed all 12 desktop Chromium and iPad/iPhone
WebKit flows after the redesign. They cover the native file chooser tap, viewer
keyboard navigation, iPhone synthetic swipe/double-tap, focus return, invite
revocation and no horizontal overflow at 320px. iPhone/iPad album and iPhone
viewer screenshots were visually inspected. The tap test caught and fixed an
invisible file input that did not respond to mobile WebKit label taps. Physical
Pixel touch, long batches and real photographs remain to check.

## Next task

Retry the Pixel's paused batch with the SSH tunnel stable, then check real
interrupted/retried transfers and iPad/iPhone tester feedback before family
invitations. After UX, return to M2 quota/ledger work, browser
interruption/large-batch checks and HEIC decoder probing. JPEG remains the
only accepted format now.

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
  resumes on reselect after a reload. Idle sessions expire after seven days
  through startup/hourly pruning; orphaned transport files get one hour of
  grace. No background job processing or full orphan reconciliation yet.

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

## Upload retention increment

- Expired transport sessions are removed after seven idle days on startup and
  hourly. A live HEAD/PATCH/DELETE or finalization is excluded from pruning.
  Unreferenced UUID-named upload files are removed after one hour.
- API tests use aged session/file fixtures to check retained fresh files,
  protected active work, stale sessions, orphan removal and preserved photos.

- A real HTTP API test uploaded and finalized 100 more JPEG sessions in one
  sequence, checked each original byte-for-byte, and left no staging sessions.
  This checks backend throughput and slot reuse; 100-file browser interaction
  and long-running mobile behavior still need testing.

## Album deployment and recovery check

- Built the frontend-only image without touching the running instance. The
  container was then stopped for a full active-data backup at
  `../nami-backups/pre-album-20261019` (private mode 0700; files 0600), with a
  SHA-256 manifest. A disposable restore started the current API and passed
  SQLite integrity and foreign-key checks. There was no schema change.
- Before and after deployment, the live and restored data matched the snapshot:
  3 actors, 6 sessions, 2 events, 4 event-access rows, 3 invitations, 7 media
  rows and no staged uploads. The 15 snapshot files matched their copy hashes;
  live originals and previews matched the manifest. The image is healthy and
  bound only to `127.0.0.1:3000`; the new built assets are served. This is a
  same-host backup, not an off-host disaster-recovery setup.

## Pixel desktop-site interruption

- On the real Pixel 10a, toggling Kiwi to desktop-site mode during a batch left
  12 failed queue items. Ten zero-byte upload sessions filled the server's
  ten-session limit, so later files received HTTP 429. The album showed 10
  photos at the time; no completed photo was removed.
- The queue now stops after the first connection, authentication, server or
  capacity failure instead of opening more sessions. Page hide also aborts and
  pauses the queue. Retry restarts the failed file and continues the rest;
  choosing the same files after reload resumes saved server offsets. A browser
  test aborts the first PATCH and verifies only one session was opened before
  Retry, then both queued JPEGs reach the album. All 8 API and 12 browser tests
  passed on the final code.
- Before live recovery, a full snapshot with SHA-256 manifest was verified at
  `../nami-backups/pre-pixel-recovery-20261019` (33 active files). A disposable
  restore started and passed SQLite integrity/foreign-key checks. With the
  container stopped, only the ten zero-byte abandoned upload sessions/files
  were removed. Live and restored protected rows still match: 3 actors, 6
  sessions, 2 events, 4 access rows, 3 invitations and 11 media rows. Original
  and preview hashes match the snapshot. The updated service is healthy and
  remains loopback-only; the Pixel's existing private tunnel reaches it.
- The existing Kiwi tab still holds the old JavaScript until refreshed. A real
  Pixel retry on the new build remains unverified. The desktop-site screenshot
  appeared clipped; check normal mobile-site mode before assessing layout.

## Organizer removal increment

- On the Pixel, the later batch retry showed “Connection interrupted” on its
  first 2.3 MB JPEG with three files waiting; the private tunnel and NAMI health
  check subsequently answered. The queue stopped after the first failure,
  without another ten-session 429 cascade. The live queue/photos were untouched.
- Organizer albums now offer a selection mode with All, None and Reverse and a
  confirmation before permanently removing selected photos. Guest albums keep
  their uncluttered view. Event settings require the exact event title and a
  separate acknowledgement before event/photo/invitation removal.
- API deletion checks organizer access and same origin, rejects a mixed-event
  photo selection atomically, removes private original/preview files and clears
  unfinished upload sessions/files when deleting an event. Tests use disposable
  data; no live data was deleted.
- `npm run check` passed lint, TypeScript, production builds and 8 API tests.
  `npm run test:e2e` passed 12 tests in desktop Chromium and WebKit iPad/iPhone
  profiles. Tests exercise selection All/None/Reverse, cancellation,
  confirmation and event deletion. The iPhone selection screen was visually
  inspected; physical iPad/iPhone/Pixel removal has not been exercised.
- Before deployment, the container was stopped and a complete active-data
  snapshot was saved at `../nami-backups/pre-removal-20261019-2143` with a
  SHA-256 manifest. A disposable restore started the current app and passed
  health, SQLite integrity and foreign-key checks with all 25 media rows.
- The rebuilt live container is healthy and still bound only to
  `127.0.0.1:3000`. Before and after deployment: 3 actors, 6 sessions,
  2 events, 4 access rows, 3 invitations, 25 media rows and 1 unfinished upload
  session. Every original, preview and staged-upload file matches the backup
  manifest. No live deletion endpoint was called.

## Same-event JPEG duplicates

- The Pixel's current organizer tab showed 12 photo tiles. SQLite confirmed
  six exact-byte SHA-256 pairs in that event, each pair from the same contributor
  about 20 seconds apart after a repeated batch selection. These are duplicate
  uploads, not a gallery rendering fault.
- The JPEG publisher now checks validated bytes against media in the same event
  before processing, and checks again inside the final database transaction to
  handle overlapping requests in the single API process. A repeat returns the
  existing photo and discards its redundant staged file. The browser reports
  the count already present. No hash/existence information crosses event access
  boundaries. First contributor attribution remains on the shared tile.
- API tests cover direct, simultaneous and Tus repeat uploads, preserved
  originals, no extra media/files, and the same bytes in a different event.
  Browser tests cover the
  notice and three distinct JPEGs across desktop Chromium and WebKit iPad/iPhone.
  `npm run check` passed 8 API tests; `npm run test:e2e` passed 12 browser tests.
- Physical blob sharing between events and multiple contributor associations
  are still future work; this increment prevents same-event duplicate tiles.
- Before cleaning the live album, the container was stopped and a full snapshot
  was verified at `../nami-backups/pre-dedupe-20261019-2201` with a SHA-256
  manifest. A disposable restore passed app health, SQLite integrity and
  foreign-key checks with all 12 original media rows. The private snapshot
  also records exactly which six redundant rows were removed.
- Each pair's original file was rehashed against its database SHA-256 and its
  contributor ID checked equal before keeping the older row and removing the
  later row and its private original/preview files. The live album now has six
  media rows, six originals and six previews; all remaining original hashes
  match SQLite, and integrity/foreign-key checks pass. Actors, sessions,
  event, access and invitations retain their pre-cleanup counts (3, 6, 1, 1,
  0); there were no unfinished uploads.
- The rebuilt container is healthy on `127.0.0.1:3000` only. The Pixel Kiwi
  organizer tab was refreshed over wireless ADB and showed six photos and six
  tiles without an alert. A physical repeat-upload test of the new behavior
  remains for the next hands-on check.

## Organizer recovery increment

- Added an interactive, host-only organizer passphrase reset command. It takes
  no passphrase argument, makes and verifies a mode-0600 SQLite backup before
  changing the existing organizer hash, and invalidates only organizer
  sessions. It adds no HTTP recovery route or default password.
- The login handler rechecks the current hash after asynchronous scrypt
  verification so an old passphrase cannot create a session during a reset.
- A disposable API test verified the backup, preserved organizer/event/invite
  identity and guest access, rejected the old passphrase and accepted the new
  one. A real pseudo-terminal test verified that the prompt does not echo a
  synthetic passphrase; its old login returned 401 and new login 200.
- The live organizer passphrase was not reset. Guest link replacement and
  permanent member/admin account management remain future work.
- `npm run check` passed lint, typechecking, both production builds and 9 API
  tests. `npm run test:e2e` passed 12 desktop Chromium and WebKit iPad/iPhone
  tests. The CLI was also exercised through a real pseudo-terminal on disposable
  data, with no typed passphrase echoed.
- Before deployment, the stopped live instance was backed up in full at
  `../nami-backups/pre-admin-reset-20261019-2222` with a SHA-256 manifest.
  A disposable restore started the new app and passed health, SQLite integrity
  and foreign-key checks. The live container is healthy and loopback-only;
  3 actors, 5 sessions, 1 event, 1 access row, 0 invitations, 4 media rows and
  0 upload sessions match the pre-deploy snapshot. Every live original/preview
  hash matches. The reset command exists in the image, and no live reset
  backup was created: the live organizer credentials were not touched.

## Guest invitation replacement increment

- Organizer can replace a redeemed guest invitation from People & invitations,
  including after expiry or revocation. A confirmation explains that existing
  links and sessions stop working and the new bearer link acts as the same guest.
  The organizer must verify the recipient outside NAMI before sharing it.
- Replacement is one SQLite transaction: revoke all earlier links for that
  guest/event, remove that event access and guest sessions, and issue a 30-day
  replacement linked to the existing actor. Redeeming it restores event access
  without asking for a new name. Earlier photo attribution stays with that actor.
  Previously revoked rows cannot disable a newer active link.
- Disposable API tests cover lost and revoked-link replacement, old sessions,
  one guest actor, preserved JPEG attribution, unauthorized/cross-origin calls
  and SQLite foreign keys. Browser flow covers organizer replacement and guest
  recovery on desktop Chromium, iPad WebKit and iPhone WebKit profiles.
- `npm run check` passed lint, TypeScript, production builds and 10 API tests.
  `npm run test:e2e` passed 12 desktop Chromium and iPad/iPhone WebKit tests.
  One iPad upload test stalled on an earlier run, then passed three focused
  reruns and the final full suite; keep watching that upload retry flow.
- The built image was deployed only to the existing loopback-bound Beechan
  instance. Before deployment the stopped service was fully snapshotted at
  `../nami-backups/pre-guest-recovery-20261019-2234`; nine active files matched
  SHA-256, SQLite integrity/foreign keys passed, and a disposable restore ran
  the new app successfully. The live service is healthy on `127.0.0.1:3000`;
  actor/session/event/access/invitation/media/upload counts match the snapshot
  (3/4/1/1/0/4/0), all four original hashes match, and no guest link was
  replaced on live data.

## Superadmin owner-controls increment

- Added a separate superadmin passphrase and session cookie. It is not an actor
  and cannot impersonate the organizer or guests. The credential has no default
  value and is set or rotated through an interactive host command; old
  superadmin sessions are invalidated. Setup verifies a private SQLite backup.
- The private `/superadmin` page lists every organizer/member/guest actor, event
  access, photo count and active sessions. It can sign out any actor, disable a
  guest's invitations and access while retaining the actor/photos, and reset
  the organizer passphrase using the existing backed-up reset routine.
- API tests cover separate login, role isolation, same-origin checks, guest
  sign-out/disable, organizer recovery, credential rotation and preservation of
  events/actors. Browser tests exercise the page on desktop Chromium and
  iPad/iPhone WebKit. A disposable pseudo-terminal test caught and fixed a
  prompt race that could echo a very fast paste; the final run confirmed no
  echo and a valid SQLite backup.
- Full checks passed: 11 API tests and 15 browser tests. The service was stopped
  and the live data snapshotted at `../nami-backups/pre-superadmin-20261019-2307`;
  nine active files matched SHA-256, all four original photo hashes matched,
  SQLite integrity/foreign keys passed, and a disposable restore with the new
  schema stayed healthy with protected row counts unchanged.
- The rebuilt Beechan container is healthy and still bound only to
  `127.0.0.1:3000`. Live counts after migration match the snapshot: 4 actors,
  7 sessions, 1 event, 1 event-access row, 3 invitations, 4 media rows, and no
  unfinished uploads. The new superadmin tables are empty, the people API
  denies unauthenticated access, and the Pixel's existing private tunnel
  reaches `/superadmin`. The owner subsequently set the real superadmin
  passphrase through the interactive Beechan command; its value was never
  shared with Codex.

## Inactive guest cleanup increment

- Added a manual **Permanently delete** action for guests who have no current
  event access, active session, contributed photos, unfinished uploads or usable
  invitation. It requires typing the guest's name and verifies a private
  SQLite backup before removing the actor and its invitation history. The
  organizer and photo contributors cannot be deleted; no automatic purge runs.
- API coverage checks authorization, same-origin protection, live-access and
  photo guards, name confirmation, backup creation, deletion and surviving
  event/foreign-key integrity. Browser coverage uses desktop Chromium and
  iPad/iPhone WebKit. `npm run check` passed (11 API tests) and the full browser
  suite passed (15 tests).
- The rebuilt Beechan image is live and healthy on `127.0.0.1:3000` only. Before
  switching containers, a full 25-file snapshot was saved at
  `../nami-backups/pre-guest-cleanup-20261019-142552`; every SHA-256 matched,
  and SQLite integrity and foreign keys passed. Post-deploy counts still match
  the snapshot: 4 actors, 5 sessions, 1 event, 1 event-access row, 3 invitations,
  4 media, 0 uploads, 1 superadmin credential and 2 superadmin sessions. All 8
  active media files still match by SHA-256. The page responds, the people API
  rejects unauthenticated access, and no live guest was deleted.

## Organizer replacement and full reset increment

- Added two distinct superadmin actions for a temporary organizer such as
  `test`. Replacement changes the organizer name and passphrase in place after
  a verified SQLite backup, signs out old organizer sessions, and preserves
  event/photo/invitation ownership. Existing photo attribution shows the new
  name because the actor identity is reused.
- Full reset requires the separate superadmin passphrase, the exact phrase
  `ERASE ALL NAMI DATA`, and a final browser confirmation. It pauses other
  requests, rejects unfinished uploads, verifies a private SQLite and media
  backup (including original-photo hashes), then clears actors, sessions,
  events, invitations, photos and active media files. Superadmin access remains
  so the owner can set up a fresh organizer.
- Disposable API tests cover replacement, backup failures, auth checks,
  unfinished uploads, full restore contents, empty state, and fresh organizer
  setup. Browser tests run both choices on desktop Chromium and iPad/iPhone
  WebKit. The final checks passed: 12 API tests and 15 browser tests. No live
  organizer, event, guest, invitation or photo was changed by these tests.
- While this increment was in development, the live instance changed through
  separate user activity to 1 organizer, 0 guests, 0 events and 0 photos. The
  service was stopped and this current state snapshotted at
  `../nami-backups/pre-organizer-options-20261019-144410`: all 29 files matched
  SHA-256, SQLite integrity/foreign keys passed, and the rebuilt service came
  back healthy. Post-deploy counts still match (1 actor, 0 sessions, 0 events,
  0 invitations, 0 media, 1 superadmin credential, 2 superadmin sessions).
  Both new write routes deny unauthenticated requests; the service remains
  loopback-only. Neither organizer option was run against live data.

## Android Chrome unreadable-file investigation

- After the owner created organizer `Standa` and event `pokus`, the first of two
  selected JPEGs reached the album, while `9628.jpg` failed before sending a
  byte. On the real Pixel Chrome tab, CDP reported `net::ERR_UPLOAD_FILE_CHANGED`
  for PATCH; both a one-chunk and full `File.arrayBuffer()` read then failed
  with `NotReadableError`. HEAD to the private NAMI tunnel succeeded, and the
  server had one zero-byte upload session. This points to Chrome losing access
  to the selected file, rather than NAMI rejecting its JPEG or the tunnel
  failing. The precise Android picker/provider trigger remains unverified.
- The web uploader now reads each 256 KiB chunk into memory before PATCH,
  checks the first chunk before creating a new upload session, and retains the
  input selection after choosing files. If the browser cannot read a file, the
  album directs the person to reselect it via Files/Browse and hides the futile
  Retry button for that selection. A real network failure still offers Retry.
- `npm run check` passed lint, production build, TypeScript and 12 API tests.
  `npm run test:e2e` passed 15 tests across desktop Chromium and iPad/iPhone
  WebKit profiles. A browser test simulates an unreadable file, verifies the
  recovery message and confirms no server upload was started. Successful batch
  and interrupted-PATCH Retry paths still pass. Real Pixel reselection after
  deployment remains to be checked.
- Before deployment, the stopped service was fully snapshotted at
  `../nami-backups/pre-android-picker-20261019T150215Z`. All four active files
  matched their SHA-256 copy hashes; SQLite integrity and foreign-key checks
  passed. A disposable copy booted the rebuilt API and answered health 200.
  After deployment the same four live files still match, with 1 actor, 1
  session, 1 event, 1 access row, 0 invitations, 1 media row and 1 unfinished
  upload session. No backend schema changed. The rebuilt container is healthy
  and bound only to `127.0.0.1:3000`; the Pixel's SSH tunnel answered health
  from Termux. Reloading the real Pixel Chrome tab loaded the new JavaScript,
  showed `pokus` and its existing photo, and produced no page errors. A second
  real JPEG selection has not yet been tested on that device.

## Next milestone agreed 2026-10-20 — isolated private technical beta

- This is a documented plan only. No beta container, data root, Serve route,
  policy grant, tester invitation or public exposure was created in this step.
  Development NAMI continues on loopback port 3000 with its existing data.
- Read-only inspection found Beechan's existing Tailscale Serve root already
  proxies another local service. Stage 1 must preserve that route; a separate
  HTTPS port (proposed 8443) can serve beta NAMI at `/` without changing its
  root-relative URLs. The existing tailnet grants have not been inspected or
  tested from an external tester identity yet.
- The immediate work order is in `battleplan.md` §8: isolate Compose project,
  storage and backups on loopback port 3001; pin a tested revision; configure
  Secure cookies; verify login, invitations, uploads, downloads, permissions,
  negative access checks and backup/restore/update/rollback through private
  HTTPS. Use disposable photos and stop before inviting testers.
- Family pilot follows only after a separate decision and readiness review:
  no-VPN links, off-site automated backups, restore proof, monitoring and
  recovery guidance. No public deployment or paid service is authorized.

## Owner-only private beta deployed 2026-10-21

- Added standalone `compose.beta.yaml`, pinned to local image
  `nami-beta:3476e38`. The beta binds only `127.0.0.1:3001`, has Secure
  cookies, and uses mode-0700 `../nami-beta-data`. Dev remains stopped on
  port 3000. Its four active files and SQLite rows matched a pre-beta
  fingerprint afterward; no development data was copied to beta.
- Saved the original Serve configuration privately before adding beta HTTPS
  on port 8443. The existing port-443 route was byte-for-byte unchanged in
  Serve status. Both endpoints are tailnet-only; no Funnel or public bind was
  configured. HTTPS health returned 200 locally and from Pixel Termux.
- `npm run check` passed lint, build and 12 API tests. The full Playwright
  suite ran **through the beta HTTPS URL** and passed 15 desktop Chromium and
  iPad/iPhone WebKit tests. It exercised organizer login, invitations, JPEG
  uploads, gallery and revocation with synthetic data. A direct HTTPS probe
  confirmed Secure/HttpOnly/SameSite-Strict cookies, same-origin write
  acceptance and wrong-Origin 403, byte-exact original download, authorized
  preview, anonymous 401 and cross-event 404.
- The stopped beta's synthetic-data snapshot verified 19 files, SQLite
  integrity and zero foreign-key violations. A disposable restore served all
  three events and matched the SHA-256 of all nine original JPEGs. A container
  restart preserved the rows and 18 media files. Switching to a differently
  labeled image and back preserved HTTPS health, three events and nine media
  rows; both images contained identical application code, so a schema-changing
  rollback remains untested.
- After testing, the live beta was restored to the verified clean snapshot:
  zero actors, sessions, events, invitations, media and uploads. It is healthy
  over HTTPS and ready for the owner to create a new organizer. Synthetic data
  and snapshots remain private outside Git; see `docs/private-beta-ops.md`.
- On 2026-10-27, backed up the complete Tailscale policy privately and
  replaced its broad `*` grant with full access for `autogroup:member` and
  Beechan TCP 8443 only for `autogroup:shared`. The candidate passed Tailscale
  validation, and API readback matched the applied policy. Tailscale SSH and
  node attributes were unchanged. The beta container remained healthy; HTTPS
  `/api/health` returned 200 from Beechan and Pixel, and the existing port-443
  Serve route remained configured. No tester was invited and no public route
  was created.
- The owner created a beta organizer and event. One trusted separate-tailnet
  Pixel accepted a Beechan machine share and loaded beta `/api/health`, the
  NAMI page and the event after organizer login. Beechan's port-443 URL kept
  loading without a response on that Pixel; the owner's Pixel received an
  immediate HTTP 404 from the same URL. This supports the intended port
  restriction but does not measure a final timeout or SSH denial. The OAuth
  credential used for policy setup was revoked by the owner and its local
  secret file was removed. Beta SQLite integrity and foreign keys passed.
- **Broader tester rollout is still gated.** No NAMI guest invitation was
  tested from the separate-tailnet device, and external SSH denial has not
  been measured. Physical iPad/iPhone beta use, off-site backups and real
  schema-change rollback also remain unverified. Do not add more testers yet.
