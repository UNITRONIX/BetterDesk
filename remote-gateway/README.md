# BetterDesk RDP/VNC gateway

This directory contains the deployment contract for the optional Guacamole
daemon used by BetterDesk's RDP/VNC session broker. The pinned source version
is verified by `.github/workflows/remote-gateway-supply-chain.yml`; the
workflow reports upstream changes but never changes the manifest or deploys
code automatically. `.github/workflows/remote-gateway-update.yml` may prepare
an update PR against `dev`, but merging that PR remains a reviewed decision.

The broker in `betterdesk-server/api/remote_target_gateway.go` only connects
to `GUACD_ADDRESS` on loopback. It rejects remote guacd addresses and refuses
to create a session when the daemon is unavailable. The browser never receives
the target password or a direct target socket.

## Supply-chain and licence policy

Only an upstream Apache Guacamole release and dependencies whose runtime
licences are explicitly approved by BetterDesk may be used. The installer must
not download an unpinned npm fork or an unverified binary. A release must
include:

- the exact upstream source version and SHA-256 checksums;
- a generated SBOM and complete third-party licence notices;
- a review proving that the RDP and VNC dependency paths meet the project's
  permissive-licence requirement (Apache-2.0, MIT, BSD or ISC);
- a reproducible build or a signed, checksum-verified artifact.

Until that manifest is present, the session broker remains fail-closed. The
database/API/UI parts can still be configured and tested for reachability.

The current pinned source is Apache Guacamole `1.6.0`. Its RDP path still
requires a complete transitive runtime audit. The VNC path is explicitly
blocked because the required LibVNCServer dependency is GPL-2.0, which is
outside BetterDesk's permissive-license policy. A future replacement or
separate licensing decision is required before VNC can be enabled.

## Runtime contract

- guacd listens on `127.0.0.1:4822` only;
- `REMOTE_TARGET_VAULT_KEY` is a dedicated AES-GCM key and must not be
  replaced by `JWT_SECRET`;
- systemd/NSSM must run guacd as a separate unprivileged service account;
- no public firewall rule may expose port 4822.
