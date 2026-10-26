# Family pilot preflight (Beechan)

Status: **prepared, private, not open to the internet**. Do not send this URL
to family yet. The pilot database is disposable test data.

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
  10001. Encoded and doubled-slash admin paths were also checked locally.
- Chromium phone and WebKit iPad loaded `/organizer` over private HTTPS through
  Caddy; no writes were made. Same-origin logout returned 204 and a foreign
  origin returned 403. Owner Pixel reached both private HTTPS routes.
- Docker app and edge are healthy. Beta remains healthy and its data was not
  changed by this preparation. Tailscale reports every Serve route as
  `tailnet only`; Funnel is off.

## Before a public family pilot

1. Owner creates the pilot organizer at the private port-10000 `/organizer`
   page and stores its passphrase. Configure a separate superadmin passphrase
   from an interactive Beechan terminal, if owner recovery is desired, then
   verify it only at private port 10001. Do not share either credential.
2. Decide whether the pilot will still use disposable photos. Before anyone
   entrusts valued photos, set up automatic **off-host** full backups of SQLite
   plus original files, test a clean restore, and document recovery contacts.
   Same-disk snapshots and NAMI's internal SQLite backups are insufficient.
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
