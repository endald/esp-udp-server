// Waveform Visualization for ESP32 Device Monitor

class WaveformVisualizer {
    constructor() {
        this.deviceInfo = {
            deviceId: '---',
            pattern: '---',
            frequency: 0,
            sampleRate: 16000
        };

        this.stats = {
            packetsSent: 0,
            packetsReceived: 0,
            packetLoss: 0,
            lastPacketsSent: 0,
            lastPacketsReceived: 0,
            lastUpdateTime: Date.now()
        };

        this.isPaused = false;
        this.isMuted = false;

        // Canvas contexts
        this.outgoingCtx = null;
        this.incomingCtx = null;
        this.spectrumCtx = null;
        this.correlationCtx = null;

        // Waveform data buffers
        this.outgoingData = new Float32Array(2048);
        this.incomingData = new Float32Array(2048);

        // WebSocket connection
        this.ws = null;

        // Color schemes for different patterns
        this.colors = {
            sine: '#3498db',      // Blue
            square: '#e74c3c',    // Red
            sawtooth: '#f39c12',  // Orange
            noise: '#9b59b6',     // Purple
            silence: '#95a5a6'    // Gray
        };

        this.init();
    }

    init() {
        // Get canvas contexts
        const outgoingCanvas = document.getElementById('outgoingCanvas');
        const incomingCanvas = document.getElementById('incomingCanvas');
        const spectrumCanvas = document.getElementById('spectrumCanvas');
        const correlationCanvas = document.getElementById('correlationCanvas');

        if (outgoingCanvas) {
            this.outgoingCtx = outgoingCanvas.getContext('2d');
            this.outgoingCanvas = outgoingCanvas;
        }

        if (incomingCanvas) {
            this.incomingCtx = incomingCanvas.getContext('2d');
            this.incomingCanvas = incomingCanvas;
        }

        if (spectrumCanvas) {
            this.spectrumCtx = spectrumCanvas.getContext('2d');
            this.spectrumCanvas = spectrumCanvas;
        }

        if (correlationCanvas) {
            this.correlationCtx = correlationCanvas.getContext('2d');
            this.correlationCanvas = correlationCanvas;
        }

        // Connect to WebSocket
        this.connectWebSocket();

        // Start animation loop
        this.animate();

        // Update stats periodically
        setInterval(() => this.updateStats(), 1000);
    }

    connectWebSocket() {
        const port = window.location.port || 8001;
        const wsUrl = `ws://localhost:${port}`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('Connected to device monitor');
                document.getElementById('connection').textContent = 'Connected';
                document.getElementById('statusIndicator').classList.add('connected');
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };

            this.ws.onclose = () => {
                console.log('Disconnected from device monitor');
                document.getElementById('connection').textContent = 'Disconnected';
                document.getElementById('statusIndicator').classList.remove('connected');

                // Try to reconnect after 2 seconds
                setTimeout(() => this.connectWebSocket(), 2000);
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

        } catch (error) {
            console.error('Failed to connect:', error);
        }
    }

    handleWebSocketMessage(data) {
        switch(data.type) {
            case 'device-info':
                this.updateDeviceInfo(data);
                break;

            case 'waveform-data':
                if (!this.isPaused) {
                    this.updateWaveformData(data);
                }
                break;
        }
    }

    updateDeviceInfo(data) {
        this.deviceInfo = {
            deviceId: data.deviceId,
            pattern: data.pattern,
            frequency: data.frequency,
            sampleRate: data.sampleRate
        };

        // Update UI
        document.getElementById('deviceId').textContent = data.deviceId;
        document.getElementById('audioPattern').textContent = data.pattern;
        document.getElementById('frequency').textContent = data.frequency;
        document.getElementById('sampleRate').textContent = data.sampleRate;
    }

    updateWaveformData(data) {
        // Update waveform buffers
        if (data.outgoing && data.outgoing.length > 0) {
            this.outgoingData = new Float32Array(data.outgoing);
        }

        if (data.incoming && data.incoming.length > 0) {
            this.incomingData = new Float32Array(data.incoming);
        }

        // Update statistics
        if (data.stats) {
            this.stats.packetsSent = data.stats.packetsSent;
            this.stats.packetsReceived = data.stats.packetsReceived;
            this.stats.packetLoss = data.stats.packetLoss;

            document.getElementById('packetsSent').textContent = data.stats.packetsSent;
            document.getElementById('packetsReceived').textContent = data.stats.packetsReceived;
            document.getElementById('packetLoss').textContent = data.stats.packetLoss;

            // Update transmit status
            const status = data.stats.isTransmitting ?
                (data.stats.isMuted ? 'Muted' : 'Transmitting') : 'Idle';
            document.getElementById('transmitStatus').textContent = status;
        }

        // Update timestamp
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
    }

    drawWaveform(ctx, canvas, data, color) {
        if (!ctx || !canvas) return;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw grid
        this.drawGrid(ctx, canvas);

        // Draw waveform
        ctx.strokeStyle = color || this.colors[this.deviceInfo.pattern] || '#3498db';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const sliceWidth = canvas.width / data.length;
        let x = 0;

        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            const y = (1 - v) * canvas.height / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.stroke();

        // Draw zero line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
    }

    drawGrid(ctx, canvas) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 0.5;

        // Vertical lines
        for (let x = 0; x < canvas.width; x += 50) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }

        // Horizontal lines
        for (let y = 0; y < canvas.height; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
    }

    drawSpectrum(ctx, canvas, data) {
        if (!ctx || !canvas) return;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Perform simple FFT approximation (for visualization only)
        const fftSize = 128;
        const spectrum = new Float32Array(fftSize);

        // Simple frequency analysis
        for (let f = 0; f < fftSize; f++) {
            let real = 0;
            let imag = 0;
            const freq = f * this.deviceInfo.sampleRate / fftSize;

            for (let t = 0; t < Math.min(data.length, 512); t++) {
                const angle = -2 * Math.PI * f * t / fftSize;
                real += data[t] * Math.cos(angle);
                imag += data[t] * Math.sin(angle);
            }

            spectrum[f] = Math.sqrt(real * real + imag * imag);
        }

        // Draw spectrum bars
        const barWidth = canvas.width / fftSize;
        const maxValue = Math.max(...spectrum);

        for (let i = 0; i < fftSize; i++) {
            const height = (spectrum[i] / maxValue) * canvas.height * 0.8;
            const hue = (i / fftSize) * 120; // Green to red gradient

            ctx.fillStyle = `hsl(${120 - hue}, 70%, 50%)`;
            ctx.fillRect(i * barWidth, canvas.height - height, barWidth - 1, height);
        }

        // Draw frequency labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px monospace';
        ctx.fillText('0 Hz', 5, canvas.height - 5);
        ctx.fillText(`${this.deviceInfo.sampleRate/2} Hz`, canvas.width - 40, canvas.height - 5);
    }

    drawCorrelation(ctx, canvas) {
        if (!ctx || !canvas) return;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calculate correlation between incoming and outgoing
        const correlation = this.calculateCorrelation(this.outgoingData, this.incomingData);

        // Draw correlation graph
        ctx.strokeStyle = '#27ae60';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const sliceWidth = canvas.width / correlation.length;
        let x = 0;

        for (let i = 0; i < correlation.length; i++) {
            const y = (1 - correlation[i]) * canvas.height / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.stroke();

        // Draw correlation value
        const maxCorr = Math.max(...correlation);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '12px monospace';
        ctx.fillText(`Max Correlation: ${maxCorr.toFixed(3)}`, 10, 20);
    }

    calculateCorrelation(signal1, signal2) {
        const correlationLength = 256;
        const correlation = new Float32Array(correlationLength);

        for (let lag = 0; lag < correlationLength; lag++) {
            let sum = 0;
            let count = 0;

            for (let i = 0; i < signal1.length - lag; i++) {
                if (i + lag < signal2.length) {
                    sum += signal1[i] * signal2[i + lag];
                    count++;
                }
            }

            correlation[lag] = count > 0 ? sum / count : 0;
        }

        return correlation;
    }

    updateStats() {
        const now = Date.now();
        const deltaTime = (now - this.stats.lastUpdateTime) / 1000;

        if (deltaTime > 0) {
            // Calculate packet rates
            const txRate = (this.stats.packetsSent - this.stats.lastPacketsSent) / deltaTime;
            const rxRate = (this.stats.packetsReceived - this.stats.lastPacketsReceived) / deltaTime;

            document.getElementById('txRate').textContent = `${txRate.toFixed(1)} pps`;
            document.getElementById('rxRate').textContent = `${rxRate.toFixed(1)} pps`;

            // Update quality indicator
            const lossRate = this.stats.packetLoss / Math.max(this.stats.packetsSent, 1);
            let quality = 'Excellent';
            if (lossRate > 0.05) quality = 'Poor';
            else if (lossRate > 0.02) quality = 'Fair';
            else if (lossRate > 0.01) quality = 'Good';

            document.getElementById('quality').textContent = quality;

            // Store for next calculation
            this.stats.lastPacketsSent = this.stats.packetsSent;
            this.stats.lastPacketsReceived = this.stats.packetsReceived;
            this.stats.lastUpdateTime = now;
        }
    }

    animate() {
        if (!this.isPaused) {
            // Draw outgoing waveform
            this.drawWaveform(this.outgoingCtx, this.outgoingCanvas, this.outgoingData);

            // Draw incoming waveform
            this.drawWaveform(this.incomingCtx, this.incomingCanvas, this.incomingData);

            // Draw spectrum analysis
            this.drawSpectrum(this.spectrumCtx, this.spectrumCanvas, this.outgoingData);

            // Draw correlation
            this.drawCorrelation(this.correlationCtx, this.correlationCanvas);
        }

        requestAnimationFrame(() => this.animate());
    }
}

// Global instance
let visualizer = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    visualizer = new WaveformVisualizer();
});

// Control functions
function togglePause() {
    if (visualizer) {
        visualizer.isPaused = !visualizer.isPaused;
        document.getElementById('pauseBtn').textContent = visualizer.isPaused ? 'Resume' : 'Pause';
    }
}

function clearBuffers() {
    if (visualizer) {
        visualizer.outgoingData.fill(0);
        visualizer.incomingData.fill(0);
    }
}

function toggleMute() {
    if (visualizer) {
        visualizer.isMuted = !visualizer.isMuted;
        document.getElementById('muteBtn').textContent = visualizer.isMuted ? 'Unmute' : 'Mute';
        // Note: Actual muting would need to be sent to the simulator
    }
}