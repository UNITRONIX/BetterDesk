/**
 * RdClient web — PunchHoleResponse / connection-params parity with Go signal rules.
 */
const path = require('path');
const protobuf = require('protobufjs');
const {
    interpretPunchHoleResponse,
    FAILURE
} = require('../public/js/rdclient/punchhole-response');
const {
    normalizeConnection,
    resolveConnectTimeouts,
    DEFAULTS
} = require('../public/js/rdclient/connection-params');

describe('RDPunchHoleResponse.interpretPunchHoleResponse (#405)', () => {
    it('treats OFFLINE + relay_server as error (not success)', () => {
        const result = interpretPunchHoleResponse({
            failure: FAILURE.OFFLINE,
            relayServer: '85.14.70.12',
            socketAddr: new Uint8Array(0)
        });
        expect(result.error).toBe('Device offline');
        expect(result.relayServer).toBeUndefined();
    });

    it('treats LICENSE_MISMATCH as error even with socket_addr', () => {
        const result = interpretPunchHoleResponse({
            failure: FAILURE.LICENSE_MISMATCH,
            relayServer: 'relay.example',
            socketAddr: new Uint8Array([1, 2, 3, 4])
        });
        expect(result.error).toBe('License mismatch');
    });

    it('honors otherFailure over success heuristics', () => {
        const result = interpretPunchHoleResponse({
            failure: 0,
            otherFailure: 'Protocol mismatch',
            relayServer: 'relay.example'
        });
        expect(result.error).toBe('Protocol mismatch');
    });

    it('succeeds for SYMMETRIC force-relay shape with relay + socket', () => {
        const result = interpretPunchHoleResponse({
            failure: 0,
            relayServer: '85.14.70.12',
            socketAddr: new Uint8Array([127, 0, 0, 1, 0, 80]),
            natType: 1,
            pk: new Uint8Array([9, 9])
        });
        expect(result.error).toBeUndefined();
        expect(result.relayServer).toBe('85.14.70.12');
        expect(result.pk).toEqual(new Uint8Array([9, 9]));
        expect(result.natType).toBe(1);
    });

    it('succeeds when only relay_server is present (unset failure=0)', () => {
        const result = interpretPunchHoleResponse({
            failure: 0,
            relayServer: 'relay.only'
        });
        expect(result.error).toBeUndefined();
        expect(result.relayServer).toBe('relay.only');
    });

    it('maps empty relay+socket with failure=0 to Device not found', () => {
        const result = interpretPunchHoleResponse({
            failure: 0,
            relayServer: '',
            socketAddr: new Uint8Array(0)
        });
        expect(result.error).toBe('Device not found');
    });

    it('accepts snake_case field names from raw JSON', () => {
        const result = interpretPunchHoleResponse({
            failure: FAILURE.OFFLINE,
            relay_server: 'x',
            other_failure: ''
        });
        expect(result.error).toBe('Device offline');
    });
});

describe('RDConnectionParams', () => {
    it('uses DEFAULTS when connection is missing', () => {
        expect(normalizeConnection(null)).toEqual(DEFAULTS);
    });

    it('sizes rendezvous/signal waits from p2p_fallback_ms with floor 15s', () => {
        const short = resolveConnectTimeouts({ p2p_fallback_ms: 2000 });
        expect(short.rendezvousMs).toBe(15000);
        expect(short.signalRelayMs).toBe(15000);

        const long = resolveConnectTimeouts({ p2p_fallback_ms: 20000 });
        expect(long.rendezvousMs).toBe(30000);
        expect(long.signalRelayMs).toBe(30000);
    });
});

describe('RDClient PunchHoleRequest forceRelay encoding', () => {
    let RendezvousMessage;
    let NatType;
    let ConnType;

    beforeAll(async () => {
        const root = await protobuf.load([
            path.join(__dirname, '../protos/rendezvous.proto')
        ]);
        RendezvousMessage = root.lookupType('hbb.RendezvousMessage');
        NatType = root.lookupEnum('hbb.NatType');
        ConnType = root.lookupEnum('hbb.ConnType');
    });

    it('encodes force_relay=true and SYMMETRIC nat for web remote', () => {
        const msg = RendezvousMessage.fromObject({
            punchHoleRequest: {
                id: '296263640',
                natType: NatType.values.SYMMETRIC,
                licenceKey: 'dGVzdA==',
                connType: ConnType.values.DEFAULT_CONN,
                token: '',
                version: 'BetterDesk-Web/1.4.9',
                forceRelay: true
            }
        });
        const buf = RendezvousMessage.encode(msg).finish();
        expect(buf.length).toBeGreaterThan(0);
        const decoded = RendezvousMessage.decode(buf).toJSON();
        expect(decoded.punchHoleRequest.forceRelay).toBe(true);
        expect(decoded.punchHoleRequest.version).toBe('BetterDesk-Web/1.4.9');
        expect(String(decoded.punchHoleRequest.natType)).toMatch(/SYMMETRIC|1/);
    });
});
