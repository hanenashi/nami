# Beechan private beta operations

This is a private technical deployment. The owner confirmed on 2026-10-27
that this beta database and its photos are disposable test data with copies
elsewhere. One trusted external Android device completed the machine-share
access test; Tailscale was later uninstalled from it. The share can remain
authorized for future devices on that account until explicitly revoked. NAMI
has no public internet route.

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
- On 2026-10-27, the complete tailnet policy was backed up privately and its
  broad `*`-to-`*` grant was replaced with two grants: direct tailnet members
  retain full access, while externally shared users can reach Beechan only on
  TCP 8443. Existing Tailscale SSH and node-attribute settings were preserved.
  The candidate passed Tailscale's policy validator and API readback matched.
  Owner access to beta HTTPS was checked from Pixel. Tailscale's saved policy
  tests rejected `autogroup:shared` as a test source; no such tests were saved.
  On 2026-10-27, a separate-tailnet Pixel accepted a machine share. Its browser
  loaded beta `/api/health`, the NAMI page and an event after organizer login.
  Beechan's port-443 HTTPS URL kept loading without a response on that Pixel,
  while the owner's Pixel received HTTP 404 from the same URL. This is strong
  evidence of the intended deny, but a timed connection result and SSH denial
  have not been measured from the external device. The same Pixel subsequently
  redeemed a NAMI invitation and uploaded photos. The live database has two
  actors, one event, one invitation and 19 media rows; SQLite integrity and
  foreign keys passed, and all 19 originals matched their stored hashes.
  A new full snapshot is optional while this remains disposable test data;
  durable off-site backups and a restore test are required before real family
  photos are entrusted to a publicly reachable pilot. Keep Tailscale Funnel
  off. Future private-beta testers must receive machine shares, not full
  tailnet membership.

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
