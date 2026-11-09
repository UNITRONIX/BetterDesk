/**
 * BetterDesk Console — CDAP Audio Stream Widget
 * Provides bidirectional audio streaming from CDAP devices via WebSocket.
 * Decodes Opus/PCM audio and renders using Web Audio API.
 */

(function () {
    'use strict';

    const activeSessions = {};

    const DEFAULT_SAMPLE_RATE = 48000;
    const DEFAULT_CHANNELS = 1;
    const DEFAULT_CODEC = 'opus';
    const BUFFER_SIZE = 4096;

    // ── Audio Session Manager ────────────────────────────────────────────

    function openAudio(deviceId, widgetId, opts) {
        const key = `${deviceId}:${widgetId}`;
        if (activeSessions[key]) return;

        opts = opts || {};
        const codec = opts.codec || DEFAULT_CODEC;
        const sampleRate = opts.sampleRate || DEFAULT_SAMPLE_RATE;
        const channels = opts.channels || DEFAULT_CHANNELS;
        const direction = opts.direction || 'receive'; // receive | send | bidirectional

        const widgetEl = document.getElementById(`wval-${CSS.escape(widgetId)}`);
        if (!widgetEl) return;

        const statusEl = widgetEl.querySelector('.cdap-audio-status');
        const levelBar = widgetEl.querySelector('.cdap-audio-level-fill');

        if (statusEl) {
            statusEl.textContent = window.BetterDesk?.t?.('cdap.audio_connecting') || 'Connecting...';
            statusEl.className = 'cdap-audio-status connecting';
        }

        // Open WebSocket
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/api/cdap/devices/${encodeURIComponent(deviceId)}/audio`;
        let ws;
        try {
            ws = new WebSocket(wsUrl, ['cdap-audio']);
        } catch (err) {
            console.error('[CDAPAudio] WS creation failed:', err);
            return;
        }

        const session = {
            ws,
            widgetEl,
            widgetId,
            deviceId,
            sessionId: null,
            connected: false,
            codec,
            sampleRate,
            channels,
            direction,
            statusEl,
            levelBar,
            audioCtx: null,
            gainNode: null,
            _muted: false,
            _volume: 1.0,
            _frameCount: 0,
            _level: 0,
            _levelTimer: null,
            _micStream: null,
            _micProcessor: null
        };
        activeSessions[key] = session;

        ws.onopen = () => {
            ws.send(JSON.stringify({
                codec: codec,
                sample_rate: sampleRate,
                channels: channels,
                direction: direction
            }));
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleMessage(session, msg);
            } catch (_) {}
        };

        ws.onerror = () => {
            console.error('[CDAPAudio] WS error for', deviceId);
        };

        ws.onclose = () => {
            if (activeSessions[key]) {
                setDisconnected(session);
                delete activeSessions[key];
            }
        };
    }

    function handleMessage(session, msg) {
        switch (msg.type) {
            case 'ready':
                session.sessionId = msg.session_id;
                session.connected = true;
                initAudioContext(session);
                if (session.statusEl) {
                    session.statusEl.textContent = window.BetterDesk?.t?.('cdap.audio_streaming') || 'Streaming';
                    session.statusEl.className = 'cdap-audio-status streaming';
                }
                // Start level meter
                session._levelTimer = setInterval(() => updateLevelMeter(session), 100);
                break;

            case 'audio_frame':
                decodeAndPlay(session, msg);
                break;

            case 'error':
                console.error('[CDAPAudio] Error:', msg.error);
                break;

            case 'end':
                setDisconnected(session);
                closeAudio(session.deviceId, session.widgetId);
                break;
        }
    }

    // ── Web Audio Context ────────────────────────────────────────────────

    function initAudioContext(session) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            session.audioCtx = new AudioContext({ sampleRate: session.sampleRate });
            session.gainNode = session.audioCtx.createGain();
            session.gainNode.gain.value = session._volume;
            session.gainNode.connect(session.audioCtx.destination);

            // Resume AudioContext on user gesture (Chrome autoplay policy)
            if (session.audioCtx.state === 'suspended') {
                session.audioCtx.resume();
            }

            // Start microphone if bidirectional
            if (session.direction === 'bidirectional' || session.direction === 'send') {
                initMicrophone(session);
            }
        } catch (err) {
            console.error('[CDAPAudio] AudioContext init failed:', err);
        }
    }

    function decodeAndPlay(session, msg) {
        if (!session.audioCtx || !msg.data) return;

        session._frameCount++;

        try {
            const raw = atob(msg.data);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) {
                bytes[i] = raw.charCodeAt(i);
            }

            if (msg.codec === 'pcm' || session.codec === 'pcm') {
                playPCMFrame(session, bytes);
            } else {
                // Opus or other encoded format — use decodeAudioData
                const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                session.audioCtx.decodeAudioData(buffer).then(audioBuffer => {
                    playAudioBuffer(session, audioBuffer);
                }).catch(() => {
                    // Fallback: treat as raw PCM if decode fails
                    playPCMFrame(session, bytes);
                });
            }
        } catch (err) {
            // Ignore corrupt frames
        }
    }

    function playPCMFrame(session, bytes) {
        const { audioCtx, gainNode, channels, sampleRate } = session;
        if (!audioCtx) return;

        // Assume 16-bit signed PCM
        const samples = bytes.length / 2;
        const numFrames = Math.floor(samples / channels);
        if (numFrames <= 0) return;

        const audioBuffer = audioCtx.createBuffer(channels, numFrames, sampleRate);

        for (let ch = 0; ch < channels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < numFrames; i++) {
                const idx = (i * channels + ch) * 2;
                if (idx + 1 >= bytes.length) break;
                const sample = (bytes[idx] | (bytes[idx + 1] << 8));
                // Convert signed 16-bit to float32 [-1, 1]
                channelData[i] = (sample > 32767 ? sample - 65536 : sample) / 32768;
            }
        }

        // Track audio level for meter
        const data = audioBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        session._level = Math.sqrt(sum / data.length);

        playAudioBuffer(session, audioBuffer);
    }

    function playAudioBuffer(session, audioBuffer) {
        if (!session.audioCtx || session._muted) return;

        const source = session.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(session.gainNode);
        source.start();
    }

    // ── Microphone Input ─────────────────────────────────────────────────

    function initMicrophone(session) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn('[CDAPAudio] getUserMedia not available');
            return;
        }

        navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: session.sampleRate,
                channelCount: session.channels,
                echoCancellation: true,
                noiseSuppression: true
            }
        }).then(stream => {
            session._micStream = stream;
            const source = session.audioCtx.createMediaStreamSource(stream);

            // Use ScriptProcessorNode (wide compatibility)
            const processor = session.audioCtx.createScriptProcessor(BUFFER_SIZE, session.channels, session.channels);
            session._micProcessor = processor;

            processor.onaudioprocess = (e) => {
                if (!session.connected || session._muted) return;
                const inputData = e.inputBuffer.getChannelData(0);

                // Convert float32 to 16-bit PCM
                const pcm = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(inputData[i] * 32768)));
                }

                // Encode to base64
                const bytes = new Uint8Array(pcm.buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const b64 = btoa(binary);

                // Send as audio_input
                if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                    session.ws.send(JSON.stringify({
                        type: 'audio_input',
                        codec: 'pcm',
                        data: b64,
                        timestamp: Date.now()
                    }));
                }
            };

            source.connect(processor);
            processor.connect(session.audioCtx.destination);
        }).catch(err => {
            console.warn('[CDAPAudio] Microphone access denied:', err.message);
        });
    }

    // ── Controls ─────────────────────────────────────────────────────────

    function setVolume(deviceId, widgetId, volume) {
        const session = activeSessions[`${deviceId}:${widgetId}`];
        if (!session) return;
        session._volume = Math.max(0, Math.min(1, volume));
        if (session.gainNode) {
            session.gainNode.gain.value = session._volume;
        }
    }

    function toggleMute(deviceId, widgetId) {
        const session = activeSessions[`${deviceId}:${widgetId}`];
        if (!session) return;
        session._muted = !session._muted;
        if (session.gainNode) {
            session.gainNode.gain.value = session._muted ? 0 : session._volume;
        }
        return session._muted;
    }

    function updateLevelMeter(session) {
        if (!session.levelBar) return;
        const pct = Math.min(100, Math.round(session._level * 300));
        session.levelBar.style.width = pct + '%';
        if (pct > 80) {
            session.levelBar.className = 'cdap-audio-level-fill high';
        } else if (pct > 40) {
            session.levelBar.className = 'cdap-audio-level-fill medium';
        } else {
            session.levelBar.className = 'cdap-audio-level-fill low';
        }
    }

    // ── Disconnect / Cleanup ─────────────────────────────────────────────

    function setDisconnected(session) {
        session.connected = false;
        if (session._levelTimer) {
            clearInterval(session._levelTimer);
            session._levelTimer = null;
        }
        if (session._micProcessor) {
            session._micProcessor.disconnect();
            session._micProcessor = null;
        }
        if (session._micStream) {
            session._micStream.getTracks().forEach(t => t.stop());
            session._micStream = null;
        }
        if (session.audioCtx && session.audioCtx.state !== 'closed') {
            session.audioCtx.close().catch(() => {});
            session.audioCtx = null;
        }
        if (session.statusEl) {
            session.statusEl.textContent = window.BetterDesk?.t?.('cdap.disconnected') || 'Disconnected';
            session.statusEl.className = 'cdap-audio-status disconnected';
        }
        if (session.levelBar) {
            session.levelBar.style.width = '0%';
        }
        // Show connect button again
        const connectDiv = session.widgetEl?.querySelector('.cdap-audio-connect');
        if (connectDiv) connectDiv.classList.remove('hidden');
    }

    function closeAudio(deviceId, widgetId) {
        const key = `${deviceId}:${widgetId}`;
        const session = activeSessions[key];
        if (!session) return;

        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify({ type: 'close' }));
            session.ws.close();
        }
        setDisconnected(session);
        delete activeSessions[key];
    }

    // ── Public API ───────────────────────────────────────────────────────

    window.CDAPAudio = {
        open: openAudio,
        close: closeAudio,
        isActive: (deviceId, widgetId) => !!activeSessions[`${deviceId}:${widgetId}`],
        setVolume: setVolume,
        toggleMute: toggleMute,
        isMuted: (deviceId, widgetId) => {
            const s = activeSessions[`${deviceId}:${widgetId}`];
            return s ? s._muted : false;
        }
    };

})();
