# Beechan private beta operations

This is an owner-only technical deployment. It uses disposable photos until
off-site recovery and family-pilot readiness are complete. No tester has been
invited, and NAMI has no public internet route.

## Isolation and access

- Development remains the separate `nami` Compose project and data root at
  `../nami-data`. It was stopped before beta setup and must not be migrated,
  reset or reused for beta.
- `compose.beta.yaml` runs `nami-beta` from a pinned local image on
  `127.0.0.1:3001`, with `../nami-beta-data` mounted at `/data`. Its SQLite,
  uploads, originals, previews and internal backups are separate. The data
  root is mode 0700; cookies are Secure, HttpOnly and SameSite Strict.
- Tailscale Serve adds private HTTPS on port 8443. Its existing port-443 root
  route serves another application and must remain unchanged. Discover the
  beta URL with `tailscale serve status`; use `/organizer` for first setup.
- Beechan's effective tailnet filter currently permits the full tailnet port
  range. **Do not share Beechan or add external testers yet.** Review the
  complete admin-console policy, replace broad access with grants that let
  selected testers reach only beta HTTPS, and prove from a separate tester
  identity that other Beechan ports are denied. Grants add permissions; a
  narrower grant does not cancel a broader one. Keep Tailscale Funnel off.

## Routine commands

From the repository root on Beechan:

```sh
docker compose -f compose.beta.yaml ps
docker compose -f compose.beta.yaml stop
docker compose -f compose.beta.yaml up -d --no-build --wait
curl --fail http://127.0.0.1:3001/api/health
tailscale serve status
```

The pinned image `nami-beta:3476e38` was built from reviewed source revision
`3476e38`. `pull_policy: never` prevents an accidental registry pull. To build
it again, first check out that revision in a separate worktree, then run
`docker build -t nami-beta:3476e38 .` there. A normal `docker compose up` for
development does not control beta; always pass `-f compose.beta.yaml`.

## Backup and restore

For a consistent full snapshot, stop beta first, copy the **entire**
`../nami-beta-data` tree to a private directory outside that tree, then hash
every copied file and verify SQLite `PRAGMA integrity_check` and
`PRAGMA foreign_key_check`. A live copy of a WAL database is not a reliable
backup. Keep modes 0700 for directories and 0600 for files. Restore only into
a separate disposable root first and prove organizer login, events and exact
original-photo hashes before relying on it. These same-disk snapshots are
rollback aids, not disaster recovery.

The verified clean snapshot before synthetic tests is
`../nami-beta-backups/clean-preflight-20261021`. A complete synthetic-data
snapshot is `../nami-beta-backups/post-https-tests-20261021`; its disposable
restore served three events and matched nine original JPEG hashes. The live
beta was returned to the clean snapshot; the prior synthetic data tree was
retained at `../nami-beta-backups/qa-live-20261021`. None of these paths belong
in Git or in an invitation.

For a code update, build and test a new, explicitly tagged image from a known
revision. Stop beta, take and verify a full snapshot, change the `image:` tag
in `compose.beta.yaml`, then start with `--no-build --wait`. Check health,
HTTPS login, permissions, SQLite integrity and original-file hashes. Keep the
previous image tag. To roll back, stop beta and return to the previous tag;
if a database migration changed the schema, also restore the matching
pre-update data snapshot before starting the old image. Preserve the failed
data tree under a separate name until the cause is understood. An image-tag
switch and return was rehearsed with identical application code; a real
schema-changing rollback has not been tested.

## Before testers

Verify the access-policy change from an actual outside tester account, then
test a real Pixel, iPhone and iPad through HTTPS. The owner chooses whom to
invite only after seeing those results. The family pilot with ordinary links
and no Tailscale requirement remains a later, separately approved stage.
