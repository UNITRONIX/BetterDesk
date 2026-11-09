#!/usr/bin/env node
/**
 * Dev-only: keep the demo devices from seed-ui-data.js online by sending
 * RustDesk RegisterPeer heartbeats over UDP to the local signal server.
 *
 *   docker compose exec -d -u betterdesk betterdesk \
 *     node /app/scripts/dev/fake-heartbeats.js
 */

'use strict';

const dgram = require('dgram');
const fs = require('fs');

const idsFile = process.argv[2] || '/app/data/dev-online-ids.json';
const host = process.env.SIGNAL_HOST || '127.0.0.1';
const port = Number(process.env.SIGNAL_PORT || 21116);
const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));

// RendezvousMessage { register_peer (6) { id (1), serial (2) } } encoded by hand.
function registerPeer(id) {
    const idBytes = Buffer.from(id, 'utf8');
    const inner = Buffer.concat([Buffer.from([0x0a, idBytes.length]), idBytes, Buffer.from([0x10, 0x01])]);
    return Buffer.concat([Buffer.from([0x32, inner.length]), inner]);
}

const sock = dgram.createSocket('udp4');
function beat() {
    ids.forEach((id) => sock.send(registerPeer(id), port, host));
}
beat();
setInterval(beat, 5000);
console.log(`Sending heartbeats for ${ids.length} devices to ${host}:${port}`);
