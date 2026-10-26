# nami
photo sharing done terribly right

<p align="center">
  <img src="assets/nami.png" alt="NAMI avatar" width="400">
</p>

**NAMI / なみ / mezi námi** — memories made together.

A small, self-hostable place for family and friends to share photographs from
one gathering. The first testers use an iPad and iPhone; simple screens and
Safari compatibility come first.

Milestone **M1, private events and invitations, is complete**, along with the
first JPEG gallery path. Organizers and invited contributors use one Add photos
action for one or many JPEGs. NAMI preserves their exact bytes, makes separate
previews and shows a photo-first album with a full-screen viewer and authorized
original downloads. Uploads proceed sequentially and can resume after an
interruption when the same files are selected again. Other photo and video
formats come later. NAMI is not ready for real family photographs or public
internet exposure yet.

An **owner-only private technical beta** now runs on Beechan with a second
Docker instance, separate data and private Tailscale HTTPS. The existing
development instance at `127.0.0.1:3000` is stopped and its data stay intact.
Testers will need Tailscale for this stage; ordinary no-installation family
links belong to the later family pilot. See the [deployment stages and immediate
roadmap](battleplan.md#8-deployment-stages-and-immediate-roadmap).

The beta's exact URL is shown by `tailscale serve status`; the
[private beta operations note](docs/private-beta-ops.md) has start/stop,
recovery and access requirements. The owner created its first organizer and
event. One trusted external Android device has reached NAMI through a machine
share, redeemed an invitation and uploaded photos; Beechan's other HTTPS port
did not load from that device. The current beta data is disposable test data
with copies of the photos elsewhere. The tailnet
policy limits externally shared users to beta HTTPS. Further testers must
receive machine shares, not full tailnet membership, after the remaining
access checks. Do not send organizer credentials to guests.

A separate **family pilot candidate** is prepared on Beechan at
`https://beechan.tail8d9f69.ts.net:10000/`. It is still **tailnet-only** and
has a separate database with disposable test photos. The owner has created its
organizer and tested invitations and uploads. Its edge blocks owner controls;
those remain available through private tailnet port 10001. The
[family pilot preflight](docs/family-pilot-preflight.md) records verified checks,
remaining gates, operations and rollback. No public switch or family invitation
has been made.

The pilot has a verified encrypted **on-demand** backup to Kurochan. Its
scheduled timer is disabled because Kurochan is usually shut down; no further
backup runs automatically. A restore from the remote copy passed, including
original-photo hashes. Kurochan is a second machine in the same home, so a
separate-site backup and recovery-key copy are still needed before relying on
NAMI for valued family photographs. Manual backup and recovery commands are in
the [pilot preflight](docs/family-pilot-preflight.md#encrypted-backup-and-recovery).

If the exact same JPEG is selected again for the same event, NAMI keeps the
existing tile and original rather than adding another copy. The album reports
how many selected files were already present. The first contributor attribution
is retained; visually similar photos with different bytes remain separate.

On Android, a cloud or photo picker can occasionally hand Chrome a file it can
no longer read. If an upload says to select the photo again, tap **Add photos**
and choose a local copy through **Files** or the picker's **Browse** option.
Retrying the old, unreadable selection will not help. NAMI checks that it can
read a chunk before opening a new server upload and keeps the picker selection
alive while the batch runs; other files that already reached the album remain.

In an organizer album, **Select** switches thumbnails into selection mode.
Use **All**, **None**, or **Reverse**, then confirm **Remove selected**. Removing
photos deletes their original and preview files. **Event settings** contains
event deletion; it asks for the exact event name and a separate acknowledgement
because it also removes photos and invitations. Keep a verified backup before
using either permanent action on valued photographs.

## Start on Beechan

Docker Engine and Docker Compose v2 are required. From a terminal:

```sh
cd /home/beechan/GIT/nami
mkdir -p ../nami-data
chmod 700 ../nami-data
docker compose up --build -d --wait
```

On Beechan, `beechan` is a member of the `docker` group, so Docker commands do
not need `sudo`. Open a new login session after that membership changes; an
already-open shell can use `newgrp docker`. Membership in this group grants
[root-level privileges](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user),
so do not add untrusted accounts.

Open **http://127.0.0.1:3000** in a browser on Beechan. This address refers to
Beechan only; it will not open NAMI on someone else's iPad. Remote family access
comes later, after access controls and an explicitly approved deployment.

First visit: open **http://127.0.0.1:3000/organizer**, enter your name, and choose
a passphrase of at least 12 characters. This creates the single organizer
account. Later visits show the sign-in form. There is no email recovery yet, so
store the passphrase in your password manager.

If the organizer passphrase is lost, someone with trusted shell/Docker access
to the NAMI host can reset it without deleting events or photos. From an
interactive terminal on Beechan, with the container running:

```sh
cd /home/beechan/GIT/nami
docker compose exec nami node apps/api/dist/admin-reset.js
```

The command asks for the new passphrase twice without echoing it. Do not put a
passphrase on the command line. It makes and verifies a private SQLite backup in
`../nami-data/backups/`, changes the existing organizer account and signs out
its old sessions. Guest sessions, events and media are left alone. Sign in with
the new passphrase afterward. This same-host database backup is a rollback aid,
not a full photo backup or off-host disaster recovery. There is deliberately no
unauthenticated web reset route or default recovery password.

### Superadmin owner controls

NAMI also has a separate, private superadmin login for account recovery and
people management. It has **no default passphrase**. Set or rotate its
passphrase from an interactive Beechan terminal once after NAMI starts:

```sh
cd /home/beechan/GIT/nami
docker compose exec nami node apps/api/dist/superadmin-setup.js
```

The prompt does not echo the passphrase or accept it as a command argument. It
verifies a private SQLite backup before changing the superadmin credential and
signs out earlier superadmin sessions. Store this separate passphrase in a
password manager. If it is lost too, rerun the host command to rotate it.

After setup, open **http://127.0.0.1:3000/superadmin** on Beechan or
**http://127.0.0.1:33000/superadmin** on the Pixel while its SSH tunnel is open.
The page lists the organizer and redeemed guests, their current event access,
photo counts and active sessions. It can sign out a person on every device,
disable a guest's invitations/access without deleting their photos, and reset
the organizer passphrase after making a SQLite backup. The superadmin cannot
silently sign in as another person. A disabled guest can later receive a
replacement link from the organizer's People & invitations panel.

An inactive guest with no event access, active sessions, photos, unfinished
uploads or usable invitation can instead be permanently deleted. The page
requires typing the guest's name, then verifies a private SQLite backup before
removing the guest and their invitation history. Organizers and guests who have
contributed photos cannot be deleted this way. Deletion is manual; NAMI never
automatically purges accounts.

For a temporary organizer such as `test`, **Replace organizer, keep the album**
sets a new name and passphrase on the same organizer identity. Events, photos,
guests and invitations remain; old organizer sessions end. Because the identity
is reused, existing photos show the new organizer name. A verified SQLite
backup is made before the change.

**Erase NAMI and start over** removes the organizer, guests, events,
invitations, photos and uploads so a fresh organizer can be created. It keeps
the separate superadmin credential. This requires re-entering the superadmin
passphrase, typing `ERASE ALL NAMI DATA`, and accepting a final confirmation.
The service pauses other requests, refuses to proceed with unfinished uploads,
then verifies a private backup of SQLite and all active media files before
erasing anything. The backup is stored under `../nami-data/backups/` on the
host, not off-site. Use this only when all album content can go.

The superadmin login is independent of the organizer login, with its own
hashed passphrase and session cookie. The page remains on NAMI's loopback-only
service; knowing its URL does not grant access. There is no remote access to it
from iPad/iPhone until a separate private network deployment is approved.

For the current private Pixel test, keep this SSH tunnel open in Termux:

```sh
ssh -N -L 33000:127.0.0.1:3000 beechan
```

Then open **http://127.0.0.1:33000** on that Pixel. Invitation links made there
work on the same device while the tunnel is open. Open a guest link in a private
tab or a separate browser so its guest cookie does not replace the organizer
cookie. These loopback links will not open on an iPad or iPhone; access for those
devices still needs an explicitly reviewed network deployment.

Check that it is running:

```sh
curl --fail http://127.0.0.1:3000/api/health
docker compose ps
```

The health response is `{"status":"ok","service":"nami"}`. Startup checks that
the page exists and data directories are accessible. This is not a disk-capacity
monitor or a claim that future upload/storage features have been verified.

Stop:

```sh
docker compose down
```

Rebuild after a reviewed code update:

```sh
git pull --ff-only
docker compose up --build -d --wait
```

Stopping or rebuilding preserves the external data directory. Do not delete it
to troubleshoot a startup problem. If startup reports a permission error,
ensure its owner matches `NAMI_UID`/`NAMI_GID` (defaults: 1000/1000); `id -u` and
`id -g` show your IDs. Do not solve it with world-writable permissions.

## Clean clone on another machine

```sh
git clone https://github.com/hanenashi/nami.git
cd nami
mkdir -p ../nami-data
chmod 700 ../nami-data
sudo docker compose up --build -d --wait
```

Docker Desktop users can omit `sudo` and run these commands in a Linux/WSL
terminal. No paid service, account registration or application secret is needed.
The first build needs internet access to download the Node image and packages.

## Data and configuration

Compose defaults to `../nami-data` outside the checkout. It contains `db/`,
`staging/`, `uploads/`, `originals/`, `previews/`, and `backups/`. Uploaded bytes pass through
private staging; accepted originals and generated previews remain outside the
web root. The mount must already exist so Docker cannot silently create a
root-owned data folder. The container runs as an unprivileged user.

Optionally copy `.env.example` to `.env`, make it mode `0600`, and edit its
non-secret settings before starting. `NAMI_DATA_DIR` sets the host directory;
inside the container the path is always `/data`. `NAMI_PORT` changes the host
port. `NAMI_SECURE_COOKIES` stays `false` for local HTTP and must be `true` under
HTTPS. An HTTPS reverse proxy can set `NAMI_TRUSTED_PROXIES` to its exact IP or
CIDR so login and invitation rate limits use client addresses, but only after
verifying that proxy replaces client-supplied forwarded headers. Compose passes
this optional setting into the app; blank leaves proxy trust disabled. The
Compose port is explicitly bound to
**127.0.0.1**, not the LAN or public internet. There is deliberately no
public-bind toggle yet.

Only built web assets are served. The data tree is never a static web directory.
Data, photographs, databases, backups and local environment files must stay out
of this public repository. `.dockerignore` allowlists application build inputs.
Organizer data and hashed sessions live in `db/nami.sqlite`. Passphrases are
hashed with scrypt; session cookies are HttpOnly and their raw values are not
stored in the database. Invitation secrets are also stored only as hashes. Each
link grants one event role, remembers the first nickname used, and can be
revoked by the organizer; anyone who receives the link can use that access until
then. If a guest loses a link, open **People & invitations** in the organizer
album and choose **Replace [name]’s link**. Confirm the recipient’s identity
outside NAMI before sharing the new link: anyone holding it can act as that
guest. Replacement disables the old link and guest sessions, keeps their name
and photo attribution, and gives the new link a 30-day expiry. A revoked guest
can be invited back through the same action; creating an ordinary invitation
instead creates a separate guest identity. NAMI sends no messages for you.

Each upload accepts one JPEG up to 25 MB, verifies the actual file,
stores its SHA-256, and generates a metadata-stripped preview. Original downloads
retain the exact uploaded bytes and may therefore retain EXIF/GPS. The same-disk
`backups/` folder is not disaster recovery. Manual full snapshots and disposable
restore checks have been done for updates, but scheduled and off-host backups
are still required before real family use.

## Development and checks

Use Node **22.13+ within the 22.x line** and npm. Dependencies are pinned in the
lockfile. The Docker image uses the maintained Node 22 Debian slim tag; rebuilding
can incorporate base-image security updates.

```sh
npm ci
npm run check
npx playwright install chromium webkit
npm run test:e2e
```

`check` runs ESLint, TypeScript checking, both production builds, and API tests.
Browser tests start a temporary server on `127.0.0.1:3100` with disposable data,
then stop it and remove that data. They cover Chromium desktop and WebKit with
iPad/iPhone device settings, including organizer setup, logout, repeat login,
creating and reopening an event, guest redemption, repeat access and revocation.
They also cover replacement links, old-session invalidation, and preserved guest
identity after recovery.
Superadmin API and browser tests cover separate login, people listing, session
sign-out, guest disabling, and organizer recovery on disposable data.
They also cover organizer photo selection/removal and double-confirmed event
deletion using disposable generated JPEGs.
The contributor flow also uploads a generated JPEG and displays its preview on
the organizer and guest screens. WebKit emulation is not a physical Safari test.
Some Linux hosts need Playwright's system libraries; use
`sudo npx playwright install-deps chromium webkit` when the browser installer
reports missing dependencies. Test results go to
`/tmp/nami-playwright-results`, outside Git.

Test an already running Docker instance instead:

```sh
NAMI_TEST_URL=http://127.0.0.1:3000 npm run test:e2e
```

For live frontend development, first run `npm run build`, then in two terminals:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

The API uses `127.0.0.1:3000`; Vite uses `127.0.0.1:5173` and proxies `/api` to it.
Stop the Docker instance first to free port 3000. Run `npm start` instead of the
two development commands to serve the production build without Docker.


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

## Project layout

- `apps/web/`: React + TypeScript + Vite; user-facing strings in `src/copy.ts`.
- `apps/api/`: Fastify, static page serving, healthcheck and data-root setup.
- `tests/`: browser smoke test and disposable-server launcher.
- `compose.yaml` / `Dockerfile`: one local service with persistent external data.
- `battleplan.md`: product intent and milestones.
- `STATUS.md`: verified progress, limits and the next concrete task.

## Album interface

A mobile-first interface pass is in place before family invitations. The research
PDF on the Pixel (`Documents/codex/NAMI mobile photo-sharing UX research.pdf`)
and the saved [mobile concept](docs/design/album-mobile-concept.png) guide an
album-first event view: one Add photos control, a compact header, a dense photo
grid, a full-screen viewer and quieter organizer/progress controls. The concept
uses synthetic images; the implemented interface uses the existing private
gallery and upload APIs. Browser tests cover Chromium and WebKit device profiles;
physical iPad/iPhone use still needs checking. See `STATUS.md` for verified work
and remaining limits.

## Resumable upload groundwork

The API now supports private Tus sessions at `/api/events/:eventId/uploads`:
empty POST with a fixed `Upload-Length`, then HEAD/PATCH/DELETE at the returned
relative Location. Requests require the current uploader's cookie and Tus 1.0.0
headers. Mutations require a same-origin Origin header; read-only HEAD also
accepts its absence, as browsers may omit it. Staged files survive API restarts, are
limited to 25 MiB each and ten sessions per actor (250 MiB maximum), and cannot
be downloaded through this endpoint. DELETE frees a session's allocation.

Completed resumable files are verified as JPEG, copied to immutable originals,
previewed, and added to the same private gallery. The Add photos picker transfers
one file at a time with individual and total progress, pause, retry and cancel.
A network interruption keeps the server offset; reselect the same files after a
page reload to continue. A connection failure pauses the queue at the failed
photo; use Retry after the connection returns. Keep the page open during
processing, and avoid switching the browser to desktop-site mode mid-batch.
Incomplete sessions idle for seven days are pruned at startup and hourly, and orphaned
transport files after a one-hour grace period. If a session has expired,
reselecting starts a fresh upload. A durable background job ledger remains next.
