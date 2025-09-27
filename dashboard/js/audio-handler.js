/**
 * Dashboard Audio Handler
 * Handles audio processing in the browser for ESP32 testing
 * Features: MP3 upload, microphone capture, Opus encoding/decoding
 */

class DashboardAudioHandler {
    constructor() {
        this.audioContext = null;
        this.ws = null;
        this.isConnected = false;

        // Audio state
        this.isMicrophoneActive = false;
        this.isReceivingAudio = false;
        this.isStreamingFile = false;

        // Audio nodes
        this.microphoneStream = null;
        this.microphoneSource = null;
        this.scriptProcessor = null;
        this.gainNode = null;

        // Opus codec (will be loaded dynamically)
        this.opusEncoder = null;
        this.opusDecoder = null;
        this.opusReady = false;

        // Audio parameters (matching ESP32)
        this.sampleRate = 16000;
        this.channels = 1;
        this.frameDuration = 20; // ms
        this.frameSize = (this.sampleRate * this.frameDuration) / 1000; // 320 samples

        // Sequence numbering
        this.sequenceNumber = 0;

        // Audio playback buffer
        this.playbackQueue = [];
        this.isPlaying = false;

        // Reconnection timeout tracker
        this.reconnectTimeout = null;

        // Statistics
        this.stats = {
            packetsSent: 0,
            packetsReceived: 0,
            bytesSent: 0,
            bytesReceived: 0
        };

        // Visualization
        this.waveformCanvas = null;
        this.waveformContext = null;
        this.analyser = null;

        this.initialize();
    }

    async initialize() {
        try {
            // Initialize Web Audio API
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000 // Browser native rate, we'll resample
            });

            // Initialize WebSocket connection with delay to ensure server is ready
            setTimeout(() => this.connectWebSocket(), 1000);

            // Load Opus codec (using simple fallback for now)
            await this.initializeOpus();

            // Set up visualization
            this.setupVisualization();

            console.log('Dashboard audio handler initialized');
        } catch (error) {
            console.error('Failed to initialize audio handler:', error);
        }
    }

    connectWebSocket() {
        const wsUrl = `ws://${window.location.hostname}:8082`;
        console.log('Attempting WebSocket connection to:', wsUrl);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('✅ Connected to audio WebSocket server');
                this.isConnected = true;
                this.updateStatus('Connected', 'success');
            };

            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket closed. Code:', event.code, 'Reason:', event.reason);
                this.isConnected = false;
                this.updateStatus('Disconnected - Retrying...', 'warning');

                // Attempt reconnection after 3 seconds
                if (!this.reconnectTimeout) {
                    this.reconnectTimeout = setTimeout(() => {
                        this.reconnectTimeout = null;
                        this.connectWebSocket();
                    }, 3000);
                }
            };

            this.ws.onerror = (error) => {
                console.warn('WebSocket connection error. Server may be starting up or port 8082 may be blocked.');
                this.updateStatus('Connection error - Retrying...', 'warning');
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateStatus('WebSocket unavailable', 'error');
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'connected':
                console.log('Dashboard registered as device:', message.deviceId);
                break;

            case 'audio_received':
                this.handleReceivedAudio(message);
                break;

            case 'audio_stats':
                this.updateStatistics(message.stats);
                break;

            default:
                console.log('Received message:', message);
        }
    }

    async initializeOpus() {
        try {
            // Wait for libopus to be loaded
            let attempts = 0;
            const maxAttempts = 50; // 5 seconds max wait

            while (typeof libopus === 'undefined' && attempts < maxAttempts) {
                console.log('Waiting for libopus to load...', attempts);
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if (typeof libopus === 'undefined') {
                throw new Error('libopus failed to load after 5 seconds');
            }

            console.log('libopus loaded, waiting for WASM...');

            // Wait for WASM to be fully loaded and ready
            // libopus uses Module.ready promise
            if (typeof Module !== 'undefined' && Module.ready) {
                await Module.ready;
                console.log('WASM Module ready');
            }

            // Additional wait to ensure everything is initialized
            await new Promise(resolve => setTimeout(resolve, 500));

            // Initialize Opus encoder with ESP32-matching settings
            // Parameters: channels, samplerate, bitrate, frame_duration_ms, voice_optimization
            this.opusEncoder = new libopus.Encoder(
                1,      // 1 channel (mono)
                16000,  // 16kHz sample rate
                16000,  // 16kbps bitrate
                20,     // 20ms frame duration
                true    // Voice optimization (OPUS_APPLICATION_VOIP)
            );

            // Initialize Opus decoder
            // Parameters: channels, samplerate
            this.opusDecoder = new libopus.Decoder(
                1,      // 1 channel (mono)
                16000   // 16kHz sample rate
            );

            this.opusReady = true;
            console.log('✅ Opus codec initialized with libopusjs (16kHz mono, 16kbps, 20ms frames)');

        } catch (error) {
            console.error('Failed to initialize Opus codec:', error);
            console.error('Make sure libopus.wasm.js and libopus.wasm are loaded from /js/ directory');
            this.opusReady = false;

            // Retry initialization after 2 seconds
            setTimeout(() => {
                console.log('Retrying Opus initialization...');
                this.initializeOpus();
            }, 2000);
        }
    }

    // ============= MP3 File Upload and Streaming =============

    async uploadAndStreamMP3(file, targetDevice) {
        if (!file || !this.isConnected) {
            console.error('No file selected or not connected');
            return;
        }

        console.log(`Streaming ${file.name} to device ${targetDevice}`);
        this.isStreamingFile = true;

        try {
            // Read file as ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();

            // Decode audio file
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Convert to mono 16kHz
            const monoData = this.convertToMono16kHz(audioBuffer);

            // Stream in 20ms chunks
            await this.streamAudioData(monoData, targetDevice);

        } catch (error) {
            console.error('Failed to process MP3 file:', error);
        } finally {
            this.isStreamingFile = false;
        }
    }

    convertToMono16kHz(audioBuffer) {
        // Get the first channel (mono)
        const channelData = audioBuffer.getChannelData(0);

        // Calculate resampling ratio
        const ratio = this.sampleRate / audioBuffer.sampleRate;
        const outputLength = Math.floor(channelData.length * ratio);
        const output = new Float32Array(outputLength);

        // Simple linear resampling
        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i / ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, channelData.length - 1);
            const fraction = srcIndex - srcIndexFloor;

            output[i] = channelData[srcIndexFloor] * (1 - fraction) +
                       channelData[srcIndexCeil] * fraction;
        }

        return output;
    }

    async streamAudioData(audioData, targetDevice) {
        const totalFrames = Math.floor(audioData.length / this.frameSize);

        for (let i = 0; i < totalFrames; i++) {
            if (!this.isStreamingFile) break;

            // Extract frame
            const frameStart = i * this.frameSize;
            const frameEnd = frameStart + this.frameSize;
            const frame = audioData.slice(frameStart, frameEnd);

            // Convert to Int16
            const pcmData = new Int16Array(this.frameSize);
            for (let j = 0; j < this.frameSize; j++) {
                pcmData[j] = Math.floor(frame[j] * 32767);
            }

            // Encode and send
            this.sendAudioPacket(pcmData, targetDevice);

            // Wait 20ms before sending next frame
            await new Promise(resolve => setTimeout(resolve, this.frameDuration));
        }

        console.log('Finished streaming file');
    }

    // ============= Microphone Capture =============

    async startMicrophone(targetDevice) {
        if (this.isMicrophoneActive) {
            console.warn('Microphone already active');
            return;
        }

        try {
            // Request microphone access
            this.microphoneStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: this.sampleRate
                }
            });

            // Create audio nodes
            this.microphoneSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
            this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0;

            // Audio processing buffer
            let audioBuffer = new Float32Array(0);

            this.scriptProcessor.onaudioprocess = (event) => {
                if (!this.isMicrophoneActive) return;

                const inputData = event.inputBuffer.getChannelData(0);

                // Accumulate audio data
                const newBuffer = new Float32Array(audioBuffer.length + inputData.length);
                newBuffer.set(audioBuffer);
                newBuffer.set(inputData, audioBuffer.length);
                audioBuffer = newBuffer;

                // Process complete frames
                while (audioBuffer.length >= this.frameSize) {
                    const frame = audioBuffer.slice(0, this.frameSize);
                    audioBuffer = audioBuffer.slice(this.frameSize);

                    // Convert to Int16
                    const pcmData = new Int16Array(this.frameSize);
                    for (let i = 0; i < this.frameSize; i++) {
                        pcmData[i] = Math.floor(frame[i] * 32767);
                    }

                    // Send audio packet
                    this.sendAudioPacket(pcmData, targetDevice);
                }
            };

            // Connect audio graph
            this.microphoneSource.connect(this.gainNode);
            this.gainNode.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);

            this.isMicrophoneActive = true;
            console.log('Microphone started');
            this.updateStatus('Microphone active', 'success');

        } catch (error) {
            console.error('Failed to start microphone:', error);
            this.updateStatus('Microphone error', 'error');
        }
    }

    stopMicrophone() {
        if (!this.isMicrophoneActive) return;

        // Disconnect audio nodes
        if (this.microphoneSource) {
            this.microphoneSource.disconnect();
            this.microphoneSource = null;
        }

        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }

        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }

        // Stop microphone stream
        if (this.microphoneStream) {
            this.microphoneStream.getTracks().forEach(track => track.stop());
            this.microphoneStream = null;
        }

        this.isMicrophoneActive = false;
        console.log('Microphone stopped');
        this.updateStatus('Microphone stopped', 'info');
    }

    // ============= Audio Reception and Playback =============

    startListening(deviceId) {
        if (!this.isConnected) {
            console.error('Not connected to server');
            return;
        }

        this.ws.send(JSON.stringify({
            type: 'start_listening',
            deviceId: deviceId
        }));

        this.isReceivingAudio = true;
        console.log(`Started listening to device ${deviceId}`);
    }

    stopListening(deviceId) {
        if (!this.isConnected) return;

        this.ws.send(JSON.stringify({
            type: 'stop_listening',
            deviceId: deviceId
        }));

        this.isReceivingAudio = false;
        console.log(`Stopped listening to device ${deviceId}`);
    }

    handleReceivedAudio(message) {
        try {
            // Decode base64 Opus data to Uint8Array
            const opusData = Uint8Array.from(atob(message.opus), c => c.charCodeAt(0));

            // Input Opus packet to decoder
            this.opusDecoder.input(opusData);

            // Get decoded PCM samples (Int16Array)
            const pcmData = this.opusDecoder.output();

            if (!pcmData || pcmData.length === 0) {
                console.warn('Opus decoder returned empty data');
                return;
            }

            // Add to playback queue
            this.playbackQueue.push(pcmData);
            this.stats.packetsReceived++;
            this.stats.bytesReceived += opusData.length;

            // Start playback if not already playing
            if (!this.isPlaying) {
                this.startPlayback();
            }

            // Update visualization
            this.updateWaveform(pcmData);

        } catch (error) {
            console.error('Error decoding audio packet:', error);
        }
    }

    async startPlayback() {
        if (this.isPlaying || this.playbackQueue.length === 0) return;

        this.isPlaying = true;

        while (this.playbackQueue.length > 0) {
            const pcmData = this.playbackQueue.shift();

            // Convert to Float32 for Web Audio
            const floatData = new Float32Array(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
                floatData[i] = pcmData[i] / 32768;
            }

            // Create audio buffer
            const audioBuffer = this.audioContext.createBuffer(1, floatData.length, this.sampleRate);
            audioBuffer.getChannelData(0).set(floatData);

            // Play audio
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioContext.destination);
            source.start();

            // Wait for frame duration
            await new Promise(resolve => setTimeout(resolve, this.frameDuration));
        }

        this.isPlaying = false;
    }

    // ============= Audio Transmission =============

    sendAudioPacket(pcmData, targetDevice) {
        if (!this.isConnected || !this.opusReady) return;

        try {
            // libopusjs expects Int16Array input for encoding
            // Input the PCM samples (must be exactly frameSize samples)
            this.opusEncoder.input(pcmData);

            // Get the encoded Opus packet
            const opusData = this.opusEncoder.output();

            if (!opusData || opusData.length === 0) {
                console.warn('Opus encoder returned empty data');
                return;
            }

            // Convert Uint8Array to base64 for WebSocket transmission
            const base64Opus = btoa(String.fromCharCode(...opusData));

            // Send via WebSocket
            const message = {
                type: 'audio_packet',
                from: 'DSH',
                to: targetDevice,
                sequence: this.sequenceNumber++,
                opus: base64Opus,
                timestamp: Date.now()
            };

            this.ws.send(JSON.stringify(message));

            this.stats.packetsSent++;
            this.stats.bytesSent += opusData.length;

        } catch (error) {
            console.error('Error encoding audio packet:', error);
        }
    }

    // ============= Visualization =============

    setupVisualization() {
        this.waveformCanvas = document.getElementById('waveform-canvas');
        if (!this.waveformCanvas) return;

        this.waveformContext = this.waveformCanvas.getContext('2d');
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
    }

    updateWaveform(pcmData) {
        if (!this.waveformCanvas || !this.waveformContext) return;

        const canvas = this.waveformCanvas;
        const ctx = this.waveformContext;

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw waveform
        ctx.strokeStyle = '#0f0';
        ctx.beginPath();

        const sliceWidth = canvas.width / pcmData.length;
        let x = 0;

        for (let i = 0; i < pcmData.length; i++) {
            const v = (pcmData[i] / 32768 + 1) / 2;
            const y = v * canvas.height;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.stroke();
    }

    // ============= Utility Functions =============

    setMicrophoneGain(gain) {
        if (this.gainNode) {
            this.gainNode.gain.value = gain;
        }
    }

    updateStatus(message, type) {
        const statusElement = document.getElementById('audio-status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `status ${type}`;
        }
    }

    updateStatistics(stats) {
        if (stats) {
            Object.assign(this.stats, stats);
        }

        // Update UI
        document.getElementById('packets-sent').textContent = this.stats.packetsSent;
        document.getElementById('packets-received').textContent = this.stats.packetsReceived;
        document.getElementById('bytes-sent').textContent = (this.stats.bytesSent / 1024).toFixed(2) + ' KB';
        document.getElementById('bytes-received').textContent = (this.stats.bytesReceived / 1024).toFixed(2) + ' KB';
    }

    getStatistics() {
        return this.stats;
    }

    // ============= Cleanup =============

    destroy() {
        this.stopMicrophone();
        this.stopListening();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

// Initialize when page loads
let audioHandler = null;

document.addEventListener('DOMContentLoaded', () => {
    audioHandler = new DashboardAudioHandler();
    window.audioHandler = audioHandler; // Make it globally accessible
});