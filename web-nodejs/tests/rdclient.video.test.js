'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRDVideo() {
    const sandbox = {
        console,
        Uint8Array,
        ArrayBuffer,
        setTimeout,
        clearTimeout,
        performance: { now: () => 0 },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
        fs.readFileSync(
            path.join(__dirname, '..', 'public/js/rdclient/video.js'),
            'utf8'
        ) + '\nglobalThis.RDVideo = RDVideo;',
        sandbox,
        { filename: 'video.js' }
    );
    return sandbox.RDVideo;
}

describe('RDVideo AV1 keyframe classification', () => {
    const RDVideo = loadRDVideo();

    // OBU_FRAME (type 6), size 1, show_existing_frame=0,
    // frame_type=KEY_FRAME (0).
    it('recognizes an AV1 keyframe OBU', () => {
        expect(RDVideo.av1KeyframeState(new Uint8Array([0x32, 0x01, 0x00]))).toBe(true);
    });

    // Same OBU with frame_type=INTER_FRAME (1).
    it('rejects a contradictory keyframe flag for an inter frame', () => {
        expect(RDVideo.av1KeyframeState(new Uint8Array([0x32, 0x01, 0x40]))).toBe(false);
    });

    it('returns unknown when no frame OBU is present', () => {
        expect(RDVideo.av1KeyframeState(new Uint8Array([0x0a, 0x01, 0x00]))).toBeNull();
    });
});
