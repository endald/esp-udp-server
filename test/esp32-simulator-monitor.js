const dgram = require('dgram');
const { OpusEncoder } = require('@discordjs/opus');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/server-config.json');

class ESP32SimulatorWithMonitor {
    constructor(deviceNumber, options = {}) {
        // Device identification
        this.deviceNumber = deviceNumber;
        this.deviceId = deviceNumber.padEnd(4, '\0');

        // Network configuration
        this.serverHost = options.serverHost || '127.0.0.1';
        this.serverPort = options.serverPort || CONFIG.udp.serverPort;
        this.localPort = CONFIG.udp.devicePortStart + parseInt(deviceNumber.replace(/\D/g, ''));

        // Audio configuration
        this.sampleRate = CONFIG.audio.sampleRate;
        this.channels = CONFIG.audio.channels;
        this.frameDuration = CONFIG.audio.frameDuration;
        this.frameSize = (this.sampleRate * this.frameDuration) / 1000;

        // Opus encoder/decoder
        this.encoder = new OpusEncoder(this.sampleRate, this.channels);
        this.decoder = new OpusEncoder(this.sampleRate, this.channels);

        // UDP socket
        this.socket = dgram.createSocket('udp4');

        // Packet sequencing
        this.sequenceNumber = 0;

        // Audio generation
        this.audioPattern = options.audioPattern || this.getDefaultPattern(deviceNumber);
        this.phase = 0;
        this.frequency = options.frequency || 440;

        // Audio buffers for visualization
        this.audioBuffers = {
            outgoing: new Float32Array(2048),
            incoming: new Float32Array(2048),
            outgoingIndex: 0,
            incomingIndex: 0
        };

        // Statistics
        this.stats = {
            packetsSent: 0,
            packetsReceived: 0,
            bytesTransmitted: 0,
            bytesReceived: 0,
            errors: 0,
            packetLoss: 0,
            startTime: Date.now()
        };

        // Control flags
        this.isTransmitting = false;
        this.isMuted = false;
        this.transmitInterval = null;
        this.heartbeatInterval = null;

        // Options
        this.verbose = options.verbose || false;
        this.simulatePacketLoss = options.packetLoss || 0;
        this.enableMonitor = options.enableMonitor !== false;

        // WebSocket monitoring server
        this.monitorPort = 8000 + parseInt(deviceNumber);
        this.monitorClients = new Set();

        if (this.enableMonitor) {
            this.setupMonitorServer();
        }

        this.setupSocket();
    }

    setupMonitorServer() {
        // Create HTTP server for serving the monitor page
        this.httpServer = http.createServer((req, res) => {
            if (req.url === '/' || req.url === '/index.html') {
                const monitorPath = path.join(__dirname, '../monitor/device-monitor.html');
                fs.readFile(monitorPath, (err, data) => {
                    if (err) {
                        res.writeHead(404);
                        res.end('Monitor page not found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(data);
                    }
                });
            } else if (req.url === '/waveform.js') {
                const jsPath = path.join(__dirname, '../monitor/waveform.js');
                fs.readFile(jsPath, (err, data) => {
                    if (err) {
                        res.writeHead(404);
                        res.end('JavaScript not found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/javascript' });
                        res.end(data);
                    }
                });
            } else if (req.url === '/monitor-style.css') {
                const cssPath = path.join(__dirname, '../monitor/monitor-style.css');
                fs.readFile(cssPath, (err, data) => {
                    if (err) {
                        res.writeHead(404);
                        res.end('CSS not found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/css' });
                        res.end(data);
                    }
                });
            }
        });

        // Create WebSocket server for real-time data
        this.wss = new WebSocket.Server({ server: this.httpServer });

        this.wss.on('connection', (ws) => {
            console.log(`📊 Monitor connected for device ${this.deviceNumber}`);
            this.monitorClients.add(ws);

            // Send initial device info
            ws.send(JSON.stringify({
                type: 'device-info',
                deviceId: this.deviceNumber,
                pattern: this.audioPattern,
                frequency: this.frequency,
                sampleRate: this.sampleRate
            }));

            ws.on('close', () => {
                this.monitorClients.delete(ws);
                console.log(`📊 Monitor disconnected for device ${this.deviceNumber}`);
            });

            ws.on('error', (err) => {
                console.error(`Monitor WebSocket error: ${err.message}`);
            });
        });

        this.httpServer.listen(this.monitorPort, () => {
            console.log(`📊 Device ${this.deviceNumber} monitor: http://localhost:${this.monitorPort}`);
        });

        // Start sending waveform data
        this.startMonitorStream();
    }

    startMonitorStream() {
        setInterval(() => {
            if (this.monitorClients.size > 0) {
                const data = {
                    type: 'waveform-data',
                    outgoing: Array.from(this.audioBuffers.outgoing),
                    incoming: Array.from(this.audioBuffers.incoming),
                    stats: {
                        packetsSent: this.stats.packetsSent,
                        packetsReceived: this.stats.packetsReceived,
                        packetLoss: this.stats.packetLoss,
                        isTransmitting: this.isTransmitting,
                        isMuted: this.isMuted
                    }
                };

                const message = JSON.stringify(data);
                this.monitorClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(message);
                    }
                });
            }
        }, 50); // 20 FPS update rate
    }

    setupSocket() {
        this.socket.on('error', (err) => {
            console.error(`❌ Socket error on ${this.deviceId}: ${err.message}`);
            this.stats.errors++;
        });

        this.socket.on('message', (msg, rinfo) => {
            this.handleIncomingPacket(msg, rinfo);
        });

        this.socket.on('listening', () => {
            const address = this.socket.address();
            console.log(`\n${'='.repeat(50)}`);
            console.log(`📱 ESP32 Simulator ${this.deviceNumber} (with Monitor)`);
            console.log(`${'='.repeat(50)}`);
            console.log(`Device ID: ${this.deviceId.replace(/\0/g, '')}`);
            console.log(`Local: ${address.address}:${address.port}`);
            console.log(`Server: ${this.serverHost}:${this.serverPort}`);
            console.log(`Audio: ${this.audioPattern} @ ${this.frequency}Hz`);
            console.log(`Monitor: http://localhost:${this.monitorPort}`);
            console.log(`${'='.repeat(50)}\n`);
        });

        this.socket.bind(this.localPort);
    }

    start() {
        if (this.isTransmitting) {
            console.warn(`Device ${this.deviceNumber} is already transmitting`);
            return;
        }

        this.isTransmitting = true;
        this.stats.startTime = Date.now();

        // Start audio transmission
        this.transmitInterval = setInterval(() => {
            if (!this.isMuted) {
                this.transmitAudioPacket();
            }
        }, this.frameDuration);

        // Start heartbeat
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, CONFIG.device.heartbeatInterval);

        console.log(`▶️ Device ${this.deviceNumber} started transmitting`);
    }

    transmitAudioPacket() {
        // Simulate packet loss
        if (this.simulatePacketLoss > 0 && Math.random() < this.simulatePacketLoss) {
            this.stats.packetLoss++;
            return;
        }

        // Generate PCM audio
        const pcmData = this.generatePCMAudio();

        // Store in outgoing buffer for visualization
        this.storePCMInBuffer(pcmData, this.audioBuffers.outgoing, 'outgoingIndex');

        // Encode to Opus
        const opusData = this.encoder.encode(pcmData);

        // Build packet
        const packet = this.buildAudioPacket(opusData);

        // Send packet
        this.socket.send(packet, this.serverPort, this.serverHost, (err) => {
            if (err) {
                console.error(`Send error: ${err.message}`);
                this.stats.errors++;
            } else {
                this.stats.packetsSent++;
                this.stats.bytesTransmitted += packet.length;

                if (this.verbose && this.stats.packetsSent % 50 === 0) {
                    console.log(`📤 [${this.deviceNumber}] Sent packet #${this.stats.packetsSent}`);
                }
            }
        });

        this.sequenceNumber = (this.sequenceNumber + 1) & 0xFFFF;
    }

    generatePCMAudio() {
        const samples = Buffer.alloc(this.frameSize * 2); // 16-bit samples

        for (let i = 0; i < this.frameSize; i++) {
            let sample = 0;

            switch(this.audioPattern) {
                case 'sine':
                    sample = Math.sin(2 * Math.PI * this.frequency * (this.phase + i) / this.sampleRate);
                    break;

                case 'square':
                    sample = (Math.sin(2 * Math.PI * this.frequency * (this.phase + i) / this.sampleRate) > 0) ? 0.5 : -0.5;
                    break;

                case 'sawtooth':
                    sample = 2 * ((this.frequency * (this.phase + i) / this.sampleRate) % 1) - 1;
                    break;

                case 'noise':
                    sample = Math.random() * 2 - 1;
                    break;

                case 'silence':
                    sample = 0;
                    break;
            }

            // Apply volume scaling
            sample *= 0.3;

            // Convert to 16-bit integer
            const int16Sample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
            samples.writeInt16LE(int16Sample, i * 2);
        }

        this.phase = (this.phase + this.frameSize) % this.sampleRate;
        return samples;
    }

    storePCMInBuffer(pcmData, buffer, indexKey) {
        // Convert Buffer to Int16Array
        const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);

        // Store normalized samples in circular buffer
        for (let i = 0; i < samples.length; i++) {
            buffer[this.audioBuffers[indexKey]] = samples[i] / 32768.0; // Normalize to -1 to 1
            this.audioBuffers[indexKey] = (this.audioBuffers[indexKey] + 1) % buffer.length;
        }
    }

    buildAudioPacket(opusData) {
        const packet = Buffer.alloc(8 + opusData.length);
        packet.write(this.deviceId, 0, 4);
        packet.writeUInt16BE(this.sequenceNumber, 4);
        packet.writeUInt16BE(0x0001, 6); // Audio packet type
        opusData.copy(packet, 8);
        return packet;
    }

    handleIncomingPacket(packet, rinfo) {
        if (packet.length < 8) {
            console.warn(`Invalid packet size: ${packet.length}`);
            return;
        }

        const sourceId = packet.slice(0, 4).toString().replace(/\0/g, '');
        const sequence = packet.readUInt16BE(4);
        const packetType = packet.readUInt16BE(6);

        this.stats.packetsReceived++;
        this.stats.bytesReceived += packet.length;

        if (packetType === 0x0001) { // Audio packet
            this.handleAudioPacket(sourceId, sequence, packet.slice(8));
        }
    }

    handleAudioPacket(sourceId, sequence, opusData) {
        if (sourceId === this.deviceId.replace(/\0/g, '')) {
            return; // Ignore own packets
        }

        try {
            // Decode Opus to PCM
            const pcmData = this.decoder.decode(opusData);

            // Store in incoming buffer for visualization
            this.storePCMInBuffer(pcmData, this.audioBuffers.incoming, 'incomingIndex');

            if (this.verbose) {
                console.log(`🔊 [${this.deviceNumber}] Audio from ${sourceId} (seq: ${sequence}, ${opusData.length} bytes)`);
            }

        } catch (error) {
            console.error(`Opus decode error: ${error.message}`);
            this.stats.errors++;
        }
    }

    sendHeartbeat() {
        const packet = Buffer.alloc(8);
        packet.write(this.deviceId, 0, 4);
        packet.writeUInt16BE(0, 4);
        packet.writeUInt16BE(0x0003, 6); // Heartbeat type
        this.socket.send(packet, this.serverPort, this.serverHost);
    }

    getDefaultPattern(deviceNumber) {
        const patterns = {
            '001': 'square',
            '002': 'sawtooth',
            '003': 'noise'
        };
        return patterns[deviceNumber] || 'sine';
    }

    stop() {
        if (!this.isTransmitting) return;

        this.isTransmitting = false;
        clearInterval(this.transmitInterval);
        clearInterval(this.heartbeatInterval);

        console.log(`⏹️ Device ${this.deviceNumber} stopped`);
    }

    close() {
        this.stop();
        this.socket.close();

        if (this.httpServer) {
            this.httpServer.close();
        }

        if (this.wss) {
            this.wss.clients.forEach(client => client.close());
            this.wss.close();
        }

        console.log(`Device ${this.deviceNumber} closed`);
    }
}

// Run simulator if executed directly
if (require.main === module) {
    const args = process.argv.slice(2);

    // Parse arguments
    const deviceCount = parseInt(args.find(a => a.startsWith('--devices='))?.split('=')[1] || '3');
    const serverHost = args.find(a => a.startsWith('--server='))?.split('=')[1] || '127.0.0.1';
    const verbose = args.includes('--verbose');

    console.log('🚀 ESP32 Audio Simulator with Monitoring');
    console.log('========================================');
    console.log(`Devices: ${deviceCount}`);
    console.log(`Server: ${serverHost}:${CONFIG.udp.serverPort}`);
    console.log('========================================\n');

    // Create simulators
    const simulators = [];
    for (let i = 1; i <= deviceCount; i++) {
        const deviceNumber = i.toString().padStart(3, '0');
        const simulator = new ESP32SimulatorWithMonitor(deviceNumber, {
            serverHost,
            verbose,
            enableMonitor: true
        });
        simulators.push(simulator);
    }

    // Start all simulators
    setTimeout(() => {
        simulators.forEach(sim => sim.start());
    }, 1000);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down simulators...');
        simulators.forEach(sim => sim.close());
        process.exit(0);
    });
}

module.exports = ESP32SimulatorWithMonitor;