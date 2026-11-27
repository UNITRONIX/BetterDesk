# Web Remote file-transfer 2FA

## Problem

The browser desktop and file-transfer sessions authenticate on different relays.
Previously, RDClient forwarded a file-session challenge as the desktop
`2fa_required` event, while the shared Verify button always called desktop
`submit2FA()`. A valid code could therefore be sent to the already authenticated
session while the file session remained blocked.

This was reproduced on BetterDesk v3.5.4: the desktop became visible after the
first OTP, a second prompt appeared, and Verify did not complete file login.
The contributor reports that the separated routing and recent-OTP reuse both
worked in their self-hosted v3.5.4 deployment.

## Event and API contracts

Existing desktop event names and argument conventions remain available.
RDFileConnection retains its own internal authentication events. RDClient
exposes separate events for the file session:

| Operation | Desktop | File transfer |
| --- | --- | --- |
| Challenge | `2fa_required` | `2fa_required_filetransfer` |
| Rejected code | `2fa_error(error)` | `2fa_error_filetransfer(error)` |
| Submit | `submit2FA(code)` | `submitFileTransfer2FA(code)` |
| Complete pending OTP | Existing `login_success(response)` | `2fa_success_filetransfer` |
| Cancel pending OTP | Existing desktop lifecycle | `2fa_cancelled_filetransfer` |

`filetransfer_error(error)` reports a file connection failure without changing
an authenticated desktop into the password-entry state. Integrations that
previously treated RDClient's desktop events as file events should subscribe
to the new file-specific names.

## Recent OTP reuse

A six-digit desktop OTP is held only in that RDClient's memory for at most
15 seconds after submission. It is eligible for file transfer only after a
successful desktop LoginResponse. A file challenge consumes the eligible code
before sending one Auth2FA on the file relay. Both connections still require
independent authorization by the remote peer.

A rejected code, another challenge, or no login result within five seconds
opens the normal file OTP prompt. The fallback allows manual retry on that
relay; a delayed successful reply can still complete authentication.
Expiration, consumption, file login completion, and disconnection clear the
cached value and its timer. The code is not stored in browser storage, cookies,
server configuration, or files, and is not reused for reconnects.

The 15-second lifetime is a client retention bound, not a promise about the
peer's TOTP window. Window rollover or peer replay restrictions can require
another code. Opening the file browser later than this bound also requires
manual authentication. The current dev branch's lazy file connection is
preserved; this fix does not add an eager second connection.

## UI and failure boundaries

File authentication leaves the desktop state as streaming. Input capture is
paused during the pending file challenge, then restored only for an active,
non-view-only streaming session. The file modal temporarily hides while a
manual OTP prompt needs focus, and returns after completion or cancellation.

Ordinary file login retains its 30-second deadline. A received OTP challenge
extends the wait to 120 seconds, including a rejected-code retry. Completion,
failure, and disconnection clean up the wait. Stale file-relay events and a
rejected old login cannot affect a replacement file connection.

There is no change to the wire schemas, Auth2FA encoding, encryption, server
OTP validation, or remote access policy. A caller-visible success is based on
peer login completion, not on the presence of a cached code.

## Validation

`web-nodejs/tests/rdclient.file2fa.test.js` covers desktop compatibility,
file-only routing, UI completion, wrong-code retry, expiration, automatic
fallback, cancellation, and stale-session isolation using mocked transport,
DOM elements, and timers. It runs in the project's existing Jest CI suite.

Manual checks for reviewers:

1. Connect to a peer with 2FA and enter a valid desktop OTP.
2. Open file transfer within 15 seconds. If the peer accepts reuse, there should
   be no additional input prompt and directory browsing should complete.
3. Open file transfer after the cache expires and verify the manual prompt.
4. Reject a file OTP, then submit a fresh valid code and verify completion.
5. Verify that timeout or file-relay closure leaves the desktop session usable.
6. Repeat with a peer without 2FA and with inactive or view-only viewer tabs.

The reported live validation is on v3.5.4. The port to the recorded dev base
was verified with automated checks; live testing of that dev port remains a
review boundary.

## Provenance and attribution

This is a direct, AI-assisted contribution developed against BetterDesk's own
browser code and existing Auth2FA helpers. The submitting contributor supplied
the reproduction, event-separation design, OTP-reuse requirement, and reported
live verification. Implementation and test drafts used ChatGPT/Codex assistance.
No third-party implementation, new protocol schema, codec, or binary is imported.
Existing BetterDesk notices and AGPL-3.0 treatment are preserved. No copyright
assignment or independently clean-room-authored implementation is claimed.
