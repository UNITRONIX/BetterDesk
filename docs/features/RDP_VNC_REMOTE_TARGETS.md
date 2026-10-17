# RDP/VNC remote targets

BetterDesk stores manually configured RDP and VNC endpoints as `remote_targets`
and exposes them in the Devices view with `RDP` or `VNC` labels. They are not
RustDesk peers and do not receive an agent identity.

The browser connects to the panel WebSocket only. The panel authenticates the
operator and proxies the session to the Go API; the Go API resolves the target,
pins its resolved address, rewrites the Guacamole connection parameters and
connects to a loopback-only guacd service.

## Security requirements

- Set a dedicated `REMOTE_TARGET_VAULT_KEY`; it must not equal or fall back to
  `JWT_SECRET`.
- Keep `GUACD_ADDRESS` on `127.0.0.1:4822`; do not expose guacd publicly.
- Configure folder/group scope and the `remote_target.*` permissions before
  granting operators access.
- Saved passwords are encrypted with AES-GCM and never returned by list APIs.
- Prompt mode keeps the username but asks for the password for every session.
- Loopback, link-local, metadata and multicast destinations are rejected.
- A saved certificate fingerprint is checked before a session starts; an
  untrusted certificate must be explicitly accepted by an operator with
  connection permission.

The gateway artifact is license-gated. Only a pinned upstream Apache Guacamole
build and individually approved permissive-licensed runtime dependencies may be
installed. See `remote-gateway/manifest.json`; an empty or unverified manifest
causes the broker to fail closed.

The current viewer supports screen, keyboard, mouse and text clipboard
capabilities. File transfer, audio, multiple monitors and recording remain
explicit capability extensions and are not silently assumed for every RDP/VNC
server.
