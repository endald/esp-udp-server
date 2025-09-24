const dgram = require('dgram');
const { OpusEncoder } = require('@discordjs/opus');
const crypto = require('crypto');
const CONFIG = require('../config/server-config.json');

class ESP32Simulator {
    constructor(deviceNumber, options = {}) {
        // Device identification
        this.deviceNumber = deviceNumber;
        this.deviceId = deviceNumber.padEnd(4, '\0'); // 4 bytes with null padding

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
        this.receivedPackets = new Map();

        // Audio generation
        this.audioPattern = options.audioPattern || this.getDefaultPattern(deviceNumber);
        this.phase = 0;
        this.frequency = options.frequency || 440; // Hz

        // Statistics
        this.stats = {
            packetsSent: 0,
            packetsReceived: 0,
            bytesTransmitted: 0,
            bytesReceived: 0,
            errors: 0,
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
        this.simulateJitter = options.jitter || 0;

        this.setupSocket();
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
            console.log(`\n${'='.repeat(40)}`);
            console.log(`📱 ESP32 Simulator ${this.deviceNumber}`);
            console.log(`${'='.repeat(40)}`);
            console.log(`Device ID: ${this.deviceId.replace(/\0/g, '')}`);
            console.log(`Local: ${address.address}:${address.port}`);
            console.log(`Server: ${this.serverHost}:${this.serverPort}`);
            console.log(`Audio: ${this.audioPattern} @ ${this.frequency}Hz`);
            console.log(`${'='.repeat(40)}\n`);
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

    stop() {
        if (!this.isTransmitting) return;

        this.isTransmitting = false;
        clearInterval(this.transmitInterval);
        clearInterval(this.heartbeatInterval);

        console.log(`⏹️ Device ${this.deviceNumber} stopped`);
        this.printStats();
    }

    transmitAudioPacket() {
        // Simulate packet loss
        if (this.simulatePacketLoss > 0 && Math.random() < this.simulatePacketLoss) {
            return; // Drop packet
        }

        // Generate PCM audio
        const pcmData = this.generatePCMAudio();

        // Encode to Opus
        const opusData = this.encoder.encode(pcmData);

        // Build packet
        const packet = this.buildAudioPacket(opusData);

        // Simulate jitter
        const delay = this.simulateJitter > 0 ? Math.random() * this.simulateJitter : 0;

        setTimeout(() => {
            this.socket.send(packet, this.serverPort, this.serverHost, (err) => {
                if (err) {
                    console.error(`Send error: ${err.message}`);
                    this.stats.errors++;
                } else {
                    this.stats.packetsSent++;
                    this.stats.bytesTransmitted += packet.length;

                    if (this.verbose && this.stats.packetsSent % 50 === 0) {
                        console.log(`📤 [${this.deviceNumber}] Sent packet #${this.stats.packetsSent} (${packet.length} bytes)`);
                    }
                }
            });
        }, delay);

        // Increment sequence number
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

                case 'chirp':
                    const chirpFreq = this.frequency * (1 + i / this.frameSize);
                    sample = Math.sin(2 * Math.PI * chirpFreq * i / this.sampleRate);
                    break;

                default:
                    sample = 0;
            }

            // Apply volume scaling
            sample *= 0.3; // 30% volume to avoid clipping

            // Convert to 16-bit integer
            const int16Sample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
            samples.writeInt16LE(int16Sample, i * 2);
        }

        this.phase = (this.phase + this.frameSize) % this.sampleRate;
        return samples;
    }

    buildAudioPacket(opusData) {
        const packet = Buffer.alloc(8 + opusData.length);

        // Device ID (4 bytes)
        packet.write(this.deviceId, 0, 4);

        // Sequence number (2 bytes, big-endian)
        packet.writeUInt16BE(this.sequenceNumber, 4);

        // Packet type (2 bytes) - 0x0001 for audio
        packet.writeUInt16BE(0x0001, 6);

        // Opus audio data
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

        switch(packetType) {
            case 0x0001: // Audio packet
                this.handleAudioPacket(sourceId, sequence, packet.slice(8));
                break;

            case 0x0002: // Control packet
                this.handleControlPacket(sourceId, packet.slice(8));
                break;

            case 0x0003: // Heartbeat acknowledgment
                if (this.verbose) {
                    console.log(`💓 Heartbeat ACK from server`);
                }
                break;

            default:
                console.warn(`Unknown packet type: 0x${packetType.toString(16)}`);
        }
    }

    handleAudioPacket(sourceId, sequence, opusData) {
        if (sourceId === this.deviceId.replace(/\0/g, '')) {
            return; // Ignore own packets (echo)
        }

        try {
            // Decode Opus to PCM
            const pcmData = this.decoder.decode(opusData);

            if (this.verbose) {
                console.log(`🔊 [${this.deviceNumber}] Audio from ${sourceId} (seq: ${sequence}, ${opusData.length} bytes)`);
            }

            // Here you could play the audio or process it further
            // For simulation, we just track statistics

        } catch (error) {
            console.error(`Opus decode error: ${error.message}`);
            this.stats.errors++;
        }
    }

    handleControlPacket(sourceId, data) {
        try {
            const control = JSON.parse(data.toString());
            console.log(`🎮 Control from ${sourceId}: ${control.command}`);

            switch(control.command) {
                case 'mute':
                    this.mute();
                    break;
                case 'unmute':
                    this.unmute();
                    break;
                case 'change-pattern':
                    this.changeAudioPattern(control.pattern);
                    break;
                default:
                    console.warn(`Unknown control command: ${control.command}`);
            }
        } catch (error) {
            console.error(`Control packet error: ${error.message}`);
        }
    }

    sendHeartbeat() {
        const packet = Buffer.alloc(8);
        packet.write(this.deviceId, 0, 4);
        packet.writeUInt16BE(0, 4); // Sequence 0 for heartbeat
        packet.writeUInt16BE(0x0003, 6); // Heartbeat type

        this.socket.send(packet, this.serverPort, this.serverHost);
    }

    sendControl(command, data = {}) {
        const control = JSON.stringify({ command, ...data });
        const packet = Buffer.alloc(8 + Buffer.byteLength(control));

        packet.write(this.deviceId, 0, 4);
        packet.writeUInt16BE(0, 4); // Sequence 0 for control
        packet.writeUInt16BE(0x0002, 6); // Control type
        packet.write(control, 8);

        this.socket.send(packet, this.serverPort, this.serverHost);
        console.log(`📡 Sent control: ${command}`);
    }

    mute() {
        this.isMuted = true;
        console.log(`🔇 Device ${this.deviceNumber} muted`);
    }

    unmute() {
        this.isMuted = false;
        console.log(`🔊 Device ${this.deviceNumber} unmuted`);
    }

    changeAudioPattern(pattern) {
        this.audioPattern = pattern;
        console.log(`🎵 Changed audio pattern to: ${pattern}`);
    }

    getDefaultPattern(deviceNumber) {
        const patterns = ['sine', 'square', 'sawtooth', 'noise'];
        const index = parseInt(deviceNumber.replace(/\D/g, '')) % patterns.length;
        return patterns[index];
    }

    printStats() {
        const uptime = (Date.now() - this.stats.startTime) / 1000;
        const sendRate = this.stats.packetsSent / uptime;
        const dataRate = (this.stats.bytesTransmitted / 1024) / uptime;

        console.log(`\n📊 Device ${this.deviceNumber} Statistics:`);
        console.log(`  Uptime: ${uptime.toFixed(1)}s`);
        console.log(`  Packets sent: ${this.stats.packetsSent} (${sendRate.toFixed(1)} pps)`);
        console.log(`  Packets received: ${this.stats.packetsReceived}`);
        console.log(`  Data transmitted: ${(this.stats.bytesTransmitted / 1024).toFixed(2)} KB`);
        console.log(`  Data received: ${(this.stats.bytesReceived / 1024).toFixed(2)} KB`);
        console.log(`  Data rate: ${dataRate.toFixed(2)} KB/s`);
        console.log(`  Errors: ${this.stats.errors}`);
    }

    close() {
        this.stop();
        this.socket.close();
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
    const packetLoss = parseFloat(args.find(a => a.startsWith('--loss='))?.split('=')[1] || '0');
    const jitter = parseFloat(args.find(a => a.startsWith('--jitter='))?.split('=')[1] || '0');

    console.log('🚀 ESP32 Audio Simulator');
    console.log('========================');
    console.log(`Devices: ${deviceCount}`);
    console.log(`Server: ${serverHost}:${CONFIG.udp.serverPort}`);
    console.log(`Packet loss: ${(packetLoss * 100).toFixed(1)}%`);
    console.log(`Jitter: ${jitter}ms`);
    console.log('========================\n');

    // Create simulators
    const simulators = [];
    for (let i = 1; i <= deviceCount; i++) {
        const deviceNumber = i.toString().padStart(3, '0');
        const simulator = new ESP32Simulator(deviceNumber, {
            serverHost,
            verbose,
            packetLoss,
            jitter
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

module.exports = ESP32Simulator;