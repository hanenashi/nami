# NAMI — battleplan.md

> **NAMI / なみ / mezi námi** — memories made together.  
> Repository: https://github.com/hanenashi/nami  
> Existing README motto: **photo sharing done terribly right**  
> State: local-first MVP in progress · Updated: 2026-10-19

## 0. Beechan / Codex handoff

Build **NAMI**, a small, self-hostable, **event-first family/friends photo-sharing site**. First real scenario: people in Czechia and Japan, using iPhone, Android, or a computer, contribute photographs from a holiday or party. No Google/Apple login, no app install.

**Execute in small working vertical slices; do not scaffold a giant untested project.**

- Inspect repo and runtime before making changes. Start with **M0** below.
- Prefer simple, functioning code to abstractions. Check current dependency APIs and compatibility.
- Write code, run it, inspect bugs, fix them, and run tests again. Never call an unrun test “passed.”
- Make small meaningful Git commits and push working milestones. Never force-push; maintain a brief STATUS.md with verified outcomes and next tasks.
- Make routine engineering decisions autonomously. Only ask Stan when genuinely blocked by a material product/infrastructure decision.
- **Do not expose the app to the public internet, buy services, create external accounts, open ports, or invite people without explicit approval.**
- **Do not commit photos, videos, databases, original EXIF/GPS, backups, logs containing invitations, secrets, or local storage. The GitHub repo is public.**
- Keep the existing README motto and NAMI personality; minimal, warm, and non-corporate.

**North-star test:** A relative opens a private event link, uploads 100 photos through a phone browser, resumes after an interruption where possible, and browses everyone’s chronological photos. Downloads return untouched originals.

## 1. Product principles

1. **Events first, albums/views later.** Real events (trip, family gathering, birthday) are the central object, not storage folders.
2. **Frictionless visitors.** A scoped guest invitation link works without registration; contributor enters display name, selects pictures, and uploads.
3. **Returning members.** Eventually, permanent members can see all events accessible to them from one homepage; do not block initial prototype on full account-management machinery.
4. **Private by default.** No public event directory. Every media read, thumbnail and original download is permission checked.
5. **Originals are sacred.** Store byte-identical originals, build disposable previews separately.
6. **Portable.** Filesystem first; an S3-compatible adapter can be added later without changing event logic or the UI.
7. **Honest progress.** Separate uploaded bytes, verified/stored originals, media processing, and gallery-ready status.
8. **Language support.** Prepare for Czech, Japanese and English; English copy first, but collect UI strings for translation.
9. **Tens of people.** Initial target: 5–50 users, thousands of photos, tens/hundreds of GB, ordinary consumer devices and connections.
10. **No big-tech dependency in MVP.** No external OAuth, third-party tracking, AI face indexing, payments, or proprietary cloud service.

## 2. First users and flows

### Organizer
- Bootstrap a local organizer account safely (no default credentials in Git).
- Create event with title, description, dates, optional timezone.
- Invite a viewer or contributor using a revocable, optionally expiring event-scoped link; optional per-invite upload quota.
- See who contributed what. Remove unwanted event associations. Download originals.
- Revoke invite/access without silently destroying already-contributed photos.

### Guest contributor
- Open invitation URL from message/email on any browser; **no signup**.
- Supply a display name and obtain an authorized event session; remove invitation secret from visible URL after redemption.
- Browse the invited event; select large batches from gallery/files.
- See per-file and total upload progress, processing status, retries and failures.
- Add more tomorrow; reopen invitation on another device if still valid.
- See all contributors' photos on one event timeline and download permitted originals.

### Guest viewer
- Same invitation flow but read-only; upload routes must reject them.

### Later: permanent family member
- Stable login, dashboard of allowed events, optional passkeys or email links. Not necessary for first upload vertical slice. Avoid requiring SMTP during local tests.

## 3. UI / design

Mobile-first, minimalist and kind to technically reluctant relatives.

Initial screens: NAMI landing page → organizer events → create/manage event and invitations → redeem guest link → event gallery → bulk uploader → lightbox/original download.

- Branding: **NAMI** and **mezi námi**, with optional subtle accent play. Japanese なみ (wave), Czech námi (“us” in oblique case).
- Event page: title, date, description, contributors, photo count, one obvious **Add photos** action for contributors.
- Uploader: multi-select and desktop drag/drop; queue with names/thumbnails, transferred bytes, individual status (Ready / Working / Needs attention), pause/retry/cancel when possible.
- Do not claim mobile background uploads are guaranteed. Surviving browser termination may require reselecting the same files; design a friendly recovery flow.
- Gallery: fast server thumbnails, capture-time sorting with deterministic fallback, responsive grid, lightbox, explicit original download.
- No technical jargon in normal screens; keyboard support, accessible controls, readable progress.

## 4. Suggested technical stack (verify supported package versions)

| Responsibility | Choice |
|---|---|
| Web | React + TypeScript + Vite |
| API | Node.js + TypeScript + Fastify |
| Upload | Uppy Tus client + @tus/server, with authenticated event-scoped Tus operations |
| Metadata | SQLite + migration scripts, WAL |
| Images | Sharp/libvips + ExifTool |
| Videos | FFmpeg for poster thumbnails (native playback if supported) |
| Storage | Local filesystem with abstraction for future S3/R2 |
| Processing | Small persistent SQLite jobs table/worker loop |
| Deployment | Docker Compose, configured bind mounts |
| Verification | Unit/integration tests + Playwright browser flow |

Avoid Redis, Kubernetes, microservices and elaborate queues unless evidence calls for them. Keep a straightforward workspace, e.g. apps/web, apps/api, optional packages/shared, scripts, tests.

Library/codec support varies by build: test actual HEIC/HEIF support and document required system codecs. If preview cannot be generated, keep the original and show a processing error; do not pretend success.


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

## 5. Data model and disk layout

Configurable data root (outside Git and ignored entirely):

~~~text
data/
  db/
  staging/
  uploads/       # persistent, untrusted Tus transport files
  originals/
  previews/
  backups/     # optional local convenience, not an independent backup
~~~

Use opaque file keys or SHA-256-derived names; never trust filenames as filesystem paths.

Model (exact SQL free to evolve):
- **actors / sessions** — organizer, guest and eventual member; preserve contributor identity independently of display name.
- **events** — ID, title, description, date range/timezone, owner, creation/update timestamps.
- **event_access** — actor, event, role (organizer / contributor / viewer).
- **invitations** — event, permission, securely random secret stored as hash, expiry, revocation, usage and quota.
- **blobs** — SHA-256, byte count, validated type, immutable storage key, unique physical binary.
- **media** — logical media record, blob link, original name as metadata, capture-time/source, dimensions, processing state/error.
- **event_media / contributions** — event, media, contributing actor, added time and visibility/removal flags; allow same media in multiple events.
- **uploads** — actor, event, invitation/session scope, original name, expected size, server offset, staging path, status, last error/expiry.
- **processing_jobs** — durable pending/leased/done/failed state, retries and error details.

One binary can back multiple events or contributors, but deduplication must **never** leak existence or metadata across private event boundaries. Repeated upload to the same event must not create unexpected repeated tiles. Media/event association rules should be clear and tested.

Keep storage access behind simple methods: put/get original, put/get preview, delete when unreferenced. Only local driver in MVP; no need to implement S3 yet.

## 6. Bulk upload pipeline (main technical goal)

### Client and network transfer
1. User selects up to a configurable number of files. Client shows batch count and bytes before starting.
2. Client checks extension/size for user guidance; all real validation happens again server-side.
3. Server authorizes event contributor and creates resumable staged upload. **All** Tus create, HEAD, PATCH, DELETE and later processing association paths must enforce upload owner/scope and current permissions, including after invite revocation.
4. Start with about **3 concurrent files** and **8 MiB chunks**; tune after tests. Limit in-flight reservations to prevent quota bypass through parallel uploads.
5. Resume from acknowledged offset on network loss; after browser restart, allow reselecting originals to relink partial uploads when safe. Never claim browser background transfer is reliable on iOS.
6. Staged uploads are outside any web-served directory; garbage collect truly abandoned entries after e.g. 7 days.

### Verified ingestion
1. After complete transfer, verify final size and actual file signature/type, rejecting truncated or dangerous payloads.
2. Stream SHA-256 calculation, then atomically store immutable original under opaque path, reusing existing identical blob bytes where authorized processing requires it.
3. Transactionally persist logical media, contributor-event link and durable processing job. Make recovery/idempotence safe if the process crashes between filesystem write and SQLite transaction.
4. Extract EXIF metadata carefully. Prefer photo capture timestamp; preserve timezone/source assumptions. Fallback to metadata/upload time with an explicit source flag.
5. Generate thumbnails (~256 px) and browser preview (~1600 px long edge) with correct orientation; strip EXIF/GPS from preview files. Do not overwrite originals.
6. Queue/retry failed processing jobs with bounded backoff. Restart/reconcile pending/leased jobs safely. Derived files are regenerable from originals.
7. Gallery can show processing placeholders. Only call an item Ready when a usable preview exists.
8. Maintain upload ledger for support: who, event, expected/received bytes, status, error, job; do not log secrets.

### MVP file type behavior
- JPEG, PNG, WebP: supported photos + preview.
- HEIC/HEIF: preserve originals; preview if compatible decoder installed and tested; otherwise explicit unsupported-preview state.
- MP4/MOV: preserve original, extract poster frame when FFmpeg supports it; browser playback may vary by codec.
- PEF/DNG/other RAW, Live Photo still/video pairing, streaming video transcodes: later. Design must allow adding them.

Initial **configurable** safety limits (proposals, not promises): 500 items/selection; 200 MB/photo; 2 GB/video; 10 GB per guest invitation; bounded concurrent worker memory and staging usage. Test behavior near disk-full conditions.

### Moderation/removal
Removing an item from an event removes its event association, not a still-referenced shared blob. Garbage-collect unreferenced objects only under a safe documented retention rule. Contributors deleting their own contributions can come after robust ownership rules are verified.

## 7. Privacy and security gates

**Public exposure prohibited until specifically approved and checked.**

- Invitation tokens: long unpredictable secrets, only hashes stored server-side; redeem into scoped session; remove token from URL after redemption; Referrer-Policy: no-referrer.
- Invites are bearer capabilities, not strong identity: forwarded invites can be used by others. Prefer distinct invitations per person for attribution and selective revocation.
- Sessions: HttpOnly, appropriate SameSite and Secure under HTTPS; protected organizer login, expiring/revocable access.
- Every endpoint authorizes event and operation, including thumbnails, original downloads, upload creation and resumption. Test ID-guessing/cross-event access.
- Cookie-authenticated state changes require proper CSRF defense / origin enforcement.
- Server controls file size, type, media decode resource budgets, storage usage, request rate, and concurrency. Avoid resource exhaustion from hostile uploads.
- No untrusted files in static web root. Authorize served data; safe Content-Disposition and Content-Type/X-Content-Type-Options, especially for downloads.
- No third-party trackers; avoid logging tokens, GPS or sensitive names; escape user-controlled captions/filenames.
- Preview metadata must not publish GPS. Explain that original downloads may retain EXIF/GPS.
- TLS, upload limits, abuse mitigation, backup and restoration must pass before external family beta.

## 8. Local development, Beechan and deployment

Sequence:
1. **Local-only build:** Windows 11 PC or Beechan using Docker; test via localhost with disposable assets.
2. **Beechan beta rehearsal:** Debian server runs the same Compose setup with persistent bind mounts; access from Pixel through trusted LAN/Tailscale.
3. **Explicitly approved small external beta:** HTTPS tunnel/reverse proxy, ordinary browser access for relatives, proper firewall/permissions/quota, off-machine backup.
4. **Optional later hosting:** migrate same service to low-cost VPS and/or S3-compatible object storage. Do not buy anything for M0–M4.

Compose needs persistent host volumes for database, originals, staging, previews. Bind web port to **127.0.0.1 by default**, with deliberate opt-in LAN binding. For public hosting use HTTPS and secure cookie configuration. Tailscale is for developer access, never required for relatives.

Provide .env.example (no secrets), .gitignore, healthcheck, data location explanation, start/stop/update/rebuild instructions. Verify actual host constraints; do not assume Beechan's CPU, RAM, packages or disk capacity.

## 9. Backups (required before real family use)

- Provide consistent backup procedure using **SQLite backup API/command**, not naive copying of a running WAL database, plus original blobs and application metadata.
- Include file-hash manifest and verify sample files after restore.
- Test restoration into a **separate clean data root**; ensure event links, access rules and galleries are preserved.
- Previews may be regenerated; originals, DB, event associations and access rules are essential.
- Local data/backups on the same disk are not sufficient for disaster recovery; a second independent machine/disk/location is required before the family beta.
- Media and backups remain outside Git history.

## 10. Implementation milestones (one at a time)

### Agreed sequencing refinement (2026-10-19)

Start deliberately small. M0 remains the first checkpoint. After basic private
events/invitations, build one complete photo path: upload one JPEG, preserve its
bytes, make a thumbnail, show it in the event, and download the original. Prove
HEIC previews in the actual container early, before expanding to bulk uploads.
The original M2–M4 lists below remain the feature inventory, not a requirement to
finish transfer infrastructure before building the first useful gallery.

Primary family testers use iPad and iPhone Safari. Verify large readable controls
and minimal typing. Automated WebKit checks supplement, but do not replace,
real-device testing. Bring permission, quota and recovery checks into the slice
that introduces each feature. Decide invite disabling versus revoking redeemed
access explicitly; define duplicate-contribution/removal rules before deduplication.
Backup design must coordinate the database snapshot with original files and GC.

### M0 — Bootstrap (first work order)
- [x] Inspect existing README/repo and actual environment; settle compatible dependency versions.
- [x] Scaffold web/API, minimal NAMI landing page and Fastify health route.
- [x] Docker Compose for local start; configurable persistent data directory; .env.example.
- [x] Comprehensive gitignore and safe sample fixtures, no real photographs.
- [x] README with copy-paste setup, ports, how to start/stop, test commands and data location.
- [x] Execute build/lint/test and start app locally; record results and commit.

**Exit:** clean clone runs without paid/external services and shows NAMI page.

### M1 — Private events and invitations
- [x] Secure organizer bootstrap and local login/session.
- [x] Create/list event, view event details.
- [x] Create, redeem and revoke viewer/contributor invitation; nickname and scoped guest session.
- [x] Robust role/access enforcement across two test events.
- [x] Usable responsive event UI.

**Exit:** guest can only access entitled event; viewer cannot upload; revocation works.

### First photo vertical slice (before bulk upload)
- [x] Stream one contributor/organizer JPEG through private bounded staging.
- [x] Verify JPEG signature/decode, hash it and preserve the exact original bytes.
- [x] Generate an oriented metadata-stripped preview and show contributor attribution.
- [x] Authorize event-scoped preview and original download; deny viewer uploads.
- [x] Verify the complete flow in Docker and desktop/iPad/iPhone browser profiles.

### M2 — Resumable bulk upload
- [x] Simple sequential browser queue with per-file/total progress; Uppy remains optional if needed for later UX.
- [x] Initial Tus transport to persistent staging, owner/event permission checks on create/HEAD/PATCH/DELETE; dropped connection and API restart tested.
- [x] Retryable JPEG finalization into the verified original/preview/gallery path; transport completion alone is not Ready.
- [x] Pause/retry/resume, cancellation and browser reselect recovery for JPEG files.
- [ ] File size/type/quota enforcement and complete upload ledger; seven-day idle transport pruning is implemented.
- [x] Test dropped network, API restart and 100 sequential backend JPEG uploads/finalizations.
- [ ] Test 100-file browser queue and long-running mobile behavior.

**Exit:** 100 files upload with visible accurate statuses and recoverable interruptions.

### Album UX pass (before inviting family testers)

Source: the Pixel's `Documents/codex/NAMI mobile photo-sharing UX research.pdf`.
The saved mobile design reference is `docs/design/album-mobile-concept.png`.
Apply its album-first principle without adopting its larger storage, dedupe or
worker redesign during this interface pass.

- [x] One prominent Add photos picker for one or many JPEGs; upload immediately
  with the existing resumable client.
- [x] Compact event header and first-viewport gallery for organizers and guests;
  keep Invite discoverable and place history/revocation in a secondary panel.
- [x] Cropped square grid with three columns on phones and responsive wider
  layouts; preserve originals and private download access.
- [x] Full-screen viewer with swipe, pinch/double-tap zoom, keyboard navigation,
  clear close, discreet attribution/download and focus/scroll restoration.
- [x] Compact progress that expands for active transfers/errors and clears after
  success. Be honest that mobile browser transfers need the page open.
- [x] Test desktop Chromium, iPad/iPhone WebKit and 320px layouts with disposable
  photos; inspect screenshots and fix awkward layouts.
- [ ] Test real Pixel touch and physical iPad/iPhone use before family invitations.

**Exit:** a family member sees the album immediately and uses one clear action
to add photos. Keep the service private and preserve live data during deployment.

### M3 — Preserve, process and index
- [ ] Signature/size verification and streamed SHA-256.
- [ ] Immutable originals, exact-byte dedup, event/uploader association.
- [ ] Metadata extraction, orientation, timestamps/source flag.
- [ ] Durable job queue, thumbnails/previews and retry/restart logic.
- [ ] HEIC and video poster test with honest compatibility reporting.

**Exit:** originals match original checksums, derivatives are generated, retries survive restart.

### M4 — Gallery and downloads
- [ ] Responsive grid, capture-time timeline, lightbox, contributor label.
- [ ] Secured original download; appropriate placeholder/error display.
- [ ] Organizer removal, visibility and access controls.
- [ ] Czech/Japanese/English-ready copy.
- [ ] Real browser flow on at least desktop and available phone(s).

**Exit:** guest can contribute and enjoy the event without instructions.

### M5 — Hardening and backup
- [ ] Automated cross-event access, invalid token, malicious media, quota and race tests.
- [ ] Crash recovery, disk-full and upload restart tests.
- [ ] Consistent backup, restore-to-clean-instance, verify checksum.
- [ ] Document LAN vs public production config; rollback/update procedure.
- [ ] Write a beta-readiness report with known limitations.
- [ ] **Stop for explicit approval before any internet-facing deployment.**

**Exit:** local proof of reliability and documented risks, not an unsupported claim of production security.

## 11. Required testing matrix

| Case | Expected behavior |
|---|---|
| Batch of 100 photos | Every file ready or failed with visible reason/retry |
| Duplicate binary same event | No unintended second physical copy or event tile |
| Same binary, two people/events | One blob, correct associations, no cross-event information leak |
| Kill network halfway | Resume accurately where underlying browser/file access permits |
| Kill/restart API | Existing completed uploads survive, partial upload state consistent |
| Kill/restart worker | Processing resumes idempotently, original remains untouched |
| Expired/revoked invitation during upload | Next relevant request denied, no new unauthorized access |
| Wrong event upload ID or media ID | Access denied, including HEAD/PATCH/download/preview |
| Broken image or faked MIME/extension | Server rejects safely, no dangerous active content served |
| Portrait JPEG, HEIC, MP4/MOV | Correct preview where supported; explicit error otherwise |
| Missing EXIF time | Predictable chronological fallback, marked as fallback |
| Delete preview | Can regenerate from original |
| Delete event reference | Other events and shared blob not harmed |
| Restore backup to separate instance | Events and media work, SHA-256 checks match |
| Phone + desktop browsers | Usable layout, honest progress, navigation works |

Automate as much as sensible (integration tests + Playwright). For manual tests, report exact device/browser, test steps and outcomes. Never write "tested" just because code looks plausible.

## 12. Explicitly out of scope for MVP

No native phone apps, automatic background camera roll backup, PWA offline sync, face recognition/AI tags, RAW editing, Live Photo pairing, advanced video transcoding, public signup, social media feed, comments, payments, geolocation maps, multi-tenant SaaS, external SMTP/OAuth, cloud storage migration, or enormous distributed infrastructure.

Possible later: curated highlights, permanent members, album views across events, self-removal, passkeys, better video and RAW support, photo-book export.

## 13. Open decisions (should not block M0)

- Default invitation model: recommend one named link/person, with optional group links later.
- Full member login: local password, passkeys or email magic link once event flow works.
- Exact retention policy for deleted event associations and orphaned blobs.
- Handling timezone-confused EXIF and camera-clock corrections without modifying originals.
- Real-world phone/browser video codec support.
- Hosting geography/costs and offsite backup once local beta has proven useful.

## 14. FIRST IMMEDIATE TASK FOR BEECHAN

**Implement M0 only, verify it genuinely runs, then commit.** Make local setup reproducible, with clear instructions for Stan (who should not need to know programming). Demonstrate NAMI landing page and API healthcheck, do a clean Docker start and smoke test.

At the end, report:
1. What actually runs and where.
2. Exact copy-paste commands to launch, test and stop it.
3. Test commands and real results.
4. Bugs/blockers and how you resolved or isolated them.
5. The **single next concrete task** for M1.

Do not jump ahead to a monolithic untestable implementation. NAMI should become reliable one working slice at a time.
