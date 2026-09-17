'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const protobuf = require('protobufjs');

function loadBrowserScript(relativePath, globals = {}) {
    const sandbox = {
        console,
        Uint8Array,
        ArrayBuffer,
        URL,
        ...globals,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const filename = path.join(__dirname, '..', relativePath);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return sandbox;
}

describe('RDProtocol relay WebSocket serialization', () => {
    let RDProtocol;
    let RendezvousMessage;

    beforeAll(async () => {
        const root = await protobuf.load(path.join(__dirname, '../protos/rendezvous.proto'));
        RendezvousMessage = root.lookupType('hbb.RendezvousMessage');
        RDProtocol = loadBrowserScript('public/js/rdclient/protocol.js').RDProtocol;
    });

    test('keeps native WS payload raw while retaining TCP framing', () => {
        const protocol = new RDProtocol();
        protocol.types.RendezvousMessage = RendezvousMessage;
        const message = { requestRelay: { id: 'target', uuid: 'relay-test-uuid' } };

        const raw = protocol.serializeRendezvous(message);
        const framed = protocol.encodeRendezvous(message);
        const decoded = protocol.createStreamDecoder().feed(framed);

        expect(decoded).toHaveLength(1);
        expect(Buffer.from(decoded[0]).equals(Buffer.from(raw))).toBe(true);
        expect(Buffer.from(framed).equals(Buffer.from(raw))).toBe(false);
    });
});

describe('RDConnection native relay WebSocket transport', () => {
    test('selects message transport on the relay URL', async () => {
        const sockets = [];
        class MockWebSocket {
            static OPEN = 1;

            constructor(url) {
                this.url = url;
                sockets.push(this);
            }
        }

        const sandbox = loadBrowserScript('public/js/rdclient/connection.js', {
            location: { protocol: 'https:', host: 'console.example.test' },
            WebSocket: MockWebSocket,
        });
        const connection = new sandbox.RDConnection();
        const opening = connection.connectRelay();

        expect(sockets[0].url).toBe(
            'wss://console.example.test/ws/relay?transport=message'
        );
        sockets[0].onopen();
        await expect(opening).resolves.toBe(sockets[0]);
    });
});

describe('RDClient raw relay messages', () => {
    test('does not add TCP framing to native WS messages', () => {
        const RDClient = loadBrowserScript('public/js/rdclient/client.js').RDClient;
        const client = Object.create(RDClient.prototype);
        const raw = new Uint8Array([0x12, 0x01, 0x01]);
        client.proto = {
            loaded: true,
            serializeMessage: jest.fn(() => raw),
            frameBytes: jest.fn(() => {
                throw new Error('must not frame native WS messages');
            }),
        };
        client.crypto = { enabled: false, processOutgoing: jest.fn() };
        client.conn = { sendRelay: jest.fn() };

        client._sendPeerMessage({ testDelay: { time: 1 } });

        expect(client.proto.frameBytes).not.toHaveBeenCalled();
        expect(client.conn.sendRelay).toHaveBeenCalledWith(raw);
    });

    test('treats each incoming WS message as one relay payload', () => {
        const RDClient = loadBrowserScript('public/js/rdclient/client.js').RDClient;
        const client = Object.create(RDClient.prototype);
        client._handleRelayMessage = jest.fn();
        const raw = new Uint8Array([0x0a, 0x01, 0x01]);

        client._handleRelayData(raw.buffer);

        expect(client._handleRelayMessage).toHaveBeenCalledTimes(1);
        expect(Array.from(client._handleRelayMessage.mock.calls[0][0]))
            .toEqual(Array.from(raw));
    });

    test('tolerates legacy input implementations without optional methods', () => {
        const RDClient = loadBrowserScript('public/js/rdclient/client.js').RDClient;
        const client = Object.create(RDClient.prototype);
        client.input = {};
        client._parseVirtualDisplaySupport = jest.fn(() => ({ supported: false }));
        client._parseWindowsSessions = jest.fn(() => ({ sessions: [], currentSid: 0 }));

        expect(() => client._processPeerInfo({ platform: 'Windows', currentDisplay: 0 }))
            .not.toThrow();
        expect(() => client.resetKeyboard()).not.toThrow();
        expect(() => client.setKeyboardMode('Auto')).not.toThrow();
    });

    test('lazy-loads file-transfer runtime with the client cache version', async () => {
        const appended = [];
        let sandbox;
        const document = {
            scripts: [{ src: 'https://console.example.test/js/rdclient/client.js?v=runtime-42' }],
            querySelector: () => null,
            createElement: () => {
                const handlers = {};
                return {
                    dataset: {},
                    addEventListener(type, fn) {
                        handlers[type] = fn;
                    },
                    _dispatch(type) {
                        if (handlers[type]) handlers[type]();
                    }
                };
            },
            head: {
                appendChild(script) {
                    appended.push(script.src);
                    if (script.src.includes('/compress.js')) {
                        sandbox.RDCompress = function RDCompress() {};
                    }
                    if (script.src.includes('/file-connection.js')) {
                        sandbox.RDFileConnection = function RDFileConnection() {};
                    }
                    script._dispatch('load');
                }
            }
        };
        sandbox = loadBrowserScript('public/js/rdclient/client.js', {
            document,
            location: { href: 'https://console.example.test/remote/device' }
        });
        const client = Object.create(sandbox.RDClient.prototype);
        client._fileTransferRuntimePromise = null;

        await client._loadFileTransferRuntime();

        expect(appended).toEqual([
            '/js/rdclient/compress.js?v=runtime-42',
            '/js/rdclient/file-connection.js?v=runtime-42'
        ]);
        expect(typeof sandbox.RDCompress).toBe('function');
        expect(typeof sandbox.RDFileConnection).toBe('function');
    });
});
