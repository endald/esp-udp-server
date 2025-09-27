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

            // Initialize WebSocket connection
            this.connectWebSocket();

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
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to audio WebSocket server');
            this.isConnected = true;
            this.updateStatus('Connected', 'success');
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from audio WebSocket server');
            this.isConnected = false;
            this.updateStatus('Disconnected', 'error');

            // Attempt reconnection after 3 seconds
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
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
        // For now, we'll use a simple PCM approach
        // In production, integrate opus.js or libopus.js
        this.opusReady = true;

        // Placeholder for Opus encoder
        this.opusEncoder = {
            encode: (pcmData) => {
                // Simple compression placeholder
                // In real implementation, use actual Opus encoding
                const compressed = new Uint8Array(pcmData.length / 2);
                for (let i = 0; i < compressed.length; i++) {
                    compressed[i] = Math.floor((pcmData[i * 2] + pcmData[i * 2 + 1]) / 2 / 256 + 128);
                }
                return compressed;
            }
        };

        // Placeholder for Opus decoder
        this.opusDecoder = {
            decode: (opusData) => {
                // Simple decompression placeholder
                const pcm = new Int16Array(opusData.length * 2);
                for (let i = 0; i < opusData.length; i++) {
                    const sample = (opusData[i] - 128) * 256;
                    pcm[i * 2] = sample;
                    pcm[i * 2 + 1] = sample;
                }
                return pcm;
            }
        };

        console.log('Opus codec initialized (using placeholder)');
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
        // Decode Opus data
        const opusData = Uint8Array.from(atob(message.opus), c => c.charCodeAt(0));
        const pcmData = this.opusDecoder.decode(opusData);

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

        // Encode audio
        const opusData = this.opusEncoder.encode(pcmData);

        // Send via WebSocket
        const message = {
            type: 'audio_packet',
            from: 'DSH',
            to: targetDevice,
            sequence: this.sequenceNumber++,
            opus: btoa(String.fromCharCode(...opusData)),
            timestamp: Date.now()
        };

        this.ws.send(JSON.stringify(message));

        this.stats.packetsSent++;
        this.stats.bytesSent += opusData.length;
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