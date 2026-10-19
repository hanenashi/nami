# nami
photo sharing done terribly right

<p align="center">
  <img src="assets/nami.png" alt="NAMI avatar" width="400">
</p>

**NAMI / なみ / mezi námi** — memories made together.

A small, self-hostable place for family and friends to share photographs from
one gathering. The first testers use an iPad and iPhone; simple screens and
Safari compatibility come first.

Current milestone: **M1, private events and invitations**. Local organizer setup,
login, event creation and event details work. Invitations, uploads and galleries
do not exist yet. This is not ready to accept family photographs or internet
traffic.

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
`staging/`, `originals/`, `previews/`, and `backups/`; M0 only creates these empty
directories. The mount must already exist so Docker cannot silently create a
root-owned data folder. The container runs as an unprivileged user.

Optionally copy `.env.example` to `.env`, make it mode `0600`, and edit its
non-secret settings before starting. `NAMI_DATA_DIR` sets the host directory;
inside the container the path is always `/data`. `NAMI_PORT` changes the host
port. `NAMI_SECURE_COOKIES` stays `false` for local HTTP and must be `true` under
HTTPS. The Compose port is explicitly bound to **127.0.0.1**, not the LAN or
public internet. There is deliberately no public-bind toggle yet.

Only built web assets are served. The data tree is never a static web directory.
Data, photographs, databases, backups and local environment files must stay out
of this public repository. `.dockerignore` allowlists application build inputs.
Organizer data and hashed sessions live in `db/nami.sqlite`. Passphrases are
hashed with scrypt; session cookies are HttpOnly and their raw values are not
stored in the database. The same-disk `backups/` folder is not disaster recovery;
backup/restore remains unimplemented and is required before real family use.

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
and creating and reopening an event. WebKit emulation is not a physical Safari
test.
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

## Project layout

- `apps/web/`: React + TypeScript + Vite; user-facing strings in `src/copy.ts`.
- `apps/api/`: Fastify, static page serving, healthcheck and data-root setup.
- `tests/`: browser smoke test and disposable-server launcher.
- `compose.yaml` / `Dockerfile`: one local service with persistent external data.
- `battleplan.md`: product intent and milestones.
- `STATUS.md`: verified progress, limits and the next concrete task.
