# Family pilot preflight (Beechan)

Status: **prepared, private, not open to the internet**. Do not send this URL
to family yet. The pilot database contains disposable test data.

## Routes and isolation

| Route | Reachability | Purpose |
| --- | --- | --- |
| `127.0.0.1:3002` | Beechan loopback | Pilot app, including owner controls |
| `127.0.0.1:3003` | Beechan loopback | Caddy edge; owner controls return 404 |
| `https://beechan.tail8d9f69.ts.net:10000/` | Tailnet only today | Pilot album through the edge; candidate family URL |
| `https://beechan.tail8d9f69.ts.net:10001/superadmin` | Tailnet only | Private owner recovery and people management |

The pilot is a distinct `nami-pilot` Compose project, image
`nami-pilot:f72c53e`, and mode-0700 data root `../nami-pilot-data`.
Development and beta use different projects, ports and data roots. The edge
uses a pinned Caddy image and forwards only to the pilot app on its private
Compose network. Caddy blocks `/superadmin` and `/api/superadmin` including
descendants. The direct app port must remain loopback-only. No public route,
router forwarding or paid service is active.

The edge ignores untrusted incoming `X-Forwarded-For` by Caddy's default;
NAMI currently trusts **no** forwarded
client addresses. Login rate limits therefore share a bucket among visitors
arriving through the proxy. Before relying on per-person limits, verify the
actual client-IP chain through Funnel and then explicitly configure only the
known local proxy addresses. Never trust arbitrary `X-Forwarded-For` values.

## Rehearsed checks (2026-10-27)

- Dependency audit found zero known production vulnerabilities after updating
  transitive `fast-uri`; lint, build, 13 API tests and 15 Chromium/WebKit end to
  end tests passed. The full browser suite ran over the pilot's private HTTPS
  route **before** Caddy was inserted, using disposable data. Its test data was
  moved aside and the live pilot data root recreated empty.
- After Caddy was inserted, local and tailnet HTTPS health returned 200;
  owner page/API returned 404 through port 10000 and 200 through private port
  10001. Encoded, doubled-slash and dot-path admin variants returned no owner
  data through the public candidate route. Anonymous requests for the live
  event, invitation history, preview and original all returned 401.
- Chromium phone and WebKit iPad loaded `/organizer` over private HTTPS through
  Caddy; no writes were made. Same-origin logout returned 204 and a foreign
  origin returned 403. Owner Pixel reached both private HTTPS routes.
- Docker app and edge are healthy. Beta remains healthy and its data was not
  changed by this preparation. Tailscale reports every Serve route as
  `tailnet only`; Funnel is off.
- The owner created a pilot organizer and event, then reported successful
  invitation, upload and duplicate checks, including two people selecting an
  already uploaded photo. On 2026-10-27, the live pilot had two actors, one
  event, one invitation and 13 media rows. SQLite integrity and foreign-key
  checks passed. All 13 original JPEGs matched their stored SHA-256 hashes.
- All 13 pilot previews were checked for embedded EXIF, XMP and IPTC metadata;
  none contained it. Originals remain byte-exact and may retain GPS metadata.
  The 13 originals totaled 21,780,242 bytes and no unfinished uploads were
  present. Beechan had 134 GiB free at this check. NAMI limits each JPEG to
  25 MiB and each actor to 10 unfinished upload sessions, but currently has
  no total event storage quota; monitor disk use during the pilot.
- A consistent full snapshot was made while the pilot app was briefly stopped,
  at `../nami-pilot-backups/private-pilot-20261026T164113Z` (UTC timestamp).
  Its 29-file hash manifest passed. A separate restore container served health
  and the album and retained the same actor, event, invitation and media counts.
  The restore test root was removed; the local snapshot remains on Beechan,
  with an encrypted copy subsequently sent to Kurochan.
- An encrypted Restic repository now exists on Kurochan under the owner's
  `NAMI-backups/pilot` directory. The first snapshot (`b00fbe77`) passed a full
  repository data check and was restored **from Kurochan** into a disposable
  container. Health, album, all 29 manifest entries, SQLite checks, row counts
  and all 13 original hashes passed. The repeatable backup script and the
  installed user systemd service also ran successfully on 2026-10-27. Its
  daily timer was then disabled and removed at the owner's request because
  Kurochan is usually shut down. No further backups run automatically.

## Before a public family pilot

1. The owner has created the pilot organizer. Configure a separate superadmin
   passphrase from an interactive Beechan terminal if owner recovery is desired,
   then verify it only at private port 10001. Do not share either credential.
2. Decide whether the pilot will still use disposable photos. The on-demand
   encrypted backup to Kurochan is **off-host**, but both machines are in the
   same home. Before anyone entrusts valued photos, add a geographically
   separate copy, test its clean restore, and keep a recovery-key copy outside
   those two machines. Same-disk snapshots alone are insufficient.
3. Review account recovery, invitation permissions, upload size limits,
   storage capacity, monitoring and the public URL. Repeat login, invitation,
   upload, preview, original download, cross-event denial and revocation tests
   through the final HTTPS path on Pixel, iPhone and iPad. Check the actual
   client-IP/rate-limit behavior through Funnel before inviting testers.
4. Obtain the owner's explicit approval for the public switch and first
   invitations. [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)
   allows ports 443, 8443 and 10000 only; its public URL is a `ts.net` name
   and bandwidth limits apply. A public endpoint would make NAMI reachable by
   anyone who knows the URL, although events still require sign-in/invitation.

## Operations and rollback

From `/home/beechan/GIT/nami` on Beechan:

```sh
docker compose -f compose.pilot.yaml ps
docker compose -f compose.pilot.yaml up -d --no-build --wait
curl --fail http://127.0.0.1:3003/api/health
tailscale serve status
tailscale funnel status
```

The saved pre-pilot Serve JSON is in the private owner config directory, not
Git. Port 443 still targets the unrelated service and 8443 still targets
`nami-beta`; do not modify them. `10001` is the private owner route. A public
switch would replace only port 10000's Serve handler with Funnel pointing to
`http://127.0.0.1:3003`; **this has not been done**. When explicitly approved
after the gates above, use the [Funnel CLI instructions](https://tailscale.com/docs/reference/tailscale-cli/funnel)
and immediately verify `tailscale funnel status`, access from a device without
Tailscale, blocked owner paths, TLS, cookies and authorized media flows.

For immediate exposure rollback, disable Funnel on port 10000 and restore the
private Serve handler:

```sh
tailscale funnel --https=10000 off
tailscale serve --bg --https=10000 http://127.0.0.1:3003
tailscale funnel status
```

Verify `tailnet only` before declaring rollback complete. Stopping the
Compose project also removes the public app response but does not remove the
Funnel rule, so disabling Funnel is the first incident action. Preserve the
data tree and inspect logs without printing credentials or invite secrets.

## Encrypted backup and recovery

`scripts/backup-pilot.py` briefly stops only the pilot app, copies its full
data tree to a new mode-0700 directory under `../nami-pilot-backups`, verifies
SQLite integrity, foreign keys, each stored original and a SHA-256 file
manifest, then restarts the app in a `finally` block. After the app is healthy,
it sends that snapshot over SFTP/SSH to an encrypted Restic repository on
Kurochan and runs `restic check`. A failed remote transfer leaves the local
snapshot intact and returns a failing service status. Backup directories are
currently retained without automatic pruning; monitor Beechan and Kurochan
disk use. The brief stop means the pilot can return 502 during a backup.

The encryption password is **never in Git or command arguments**. Beechan's
mode-0600 file is `~/.config/nami/restic-pilot-password`; a recovery copy is
`C:\Users\hanenashi\NAMI-backups\restic-pilot-password` on Kurochan with an
explicit ACL for the owner, Administrators and SYSTEM. Keep an additional
private recovery copy before relying on this for valued photos. Losing every
password copy makes the encrypted repository unreadable. Do not print or send
the password through chat.

The automatic timer was disabled and removed at the owner's request. Run a
backup only when Kurochan is awake and reachable over SSH. The installed
systemd service can be started manually, and its result inspected afterward:

```sh
systemctl --user start nami-pilot-backup.service
systemctl --user status nami-pilot-backup.service --no-pager
journalctl --user -u nami-pilot-backup.service -n 40 --no-pager
```

From the repo, an equivalent direct run uses
`sg docker -c './scripts/backup-pilot.py'` for the current Beechan shell's
Docker group. Neither command should be run while Kurochan is shut down;
the script would still make a new local snapshot before the remote transfer
failed. For recovery on Beechan, set
`RESTIC_PASSWORD_FILE` to the protected file path, then use
`restic -r sftp:kurochan:NAMI-backups/pilot snapshots` and
`restic -r sftp:kurochan:NAMI-backups/pilot restore <snapshot-id> --target <clean-directory>`.
The restored snapshot contains the original absolute path below that target;
copy its data tree into a **new** root and verify it before switching any live
container. The remote-restored test container was removed after verification.
Do not overwrite the current pilot data root during a rehearsal.
