const dgram = require('dgram');
const { OpusEncoder } = require('@discordjs/opus');

class PacketAnalyzer {
    constructor(port = 5004) {
        this.socket = dgram.createSocket('udp4');
        this.port = port;
        this.decoder = new OpusEncoder(16000, 1);

        // Statistics
        this.stats = {
            totalPackets: 0,
            validPackets: 0,
            invalidPackets: 0,
            audioPackets: 0,
            controlPackets: 0,
            heartbeatPackets: 0,
            opusErrors: 0,
            totalBytes: 0
        };

        // Device tracking
        this.devices = new Map();

        // Packet history for analysis
        this.packetHistory = [];
        this.maxHistory = 1000;

        // Start time
        this.startTime = Date.now();
    }

    start() {
        this.socket.on('message', (msg, rinfo) => {
            this.analyzePacket(msg, rinfo);
        });

        this.socket.on('error', (err) => {
            console.error(`❌ Analyzer error: ${err.message}`);
        });

        this.socket.bind(this.port, () => {
            console.log(`\n${'='.repeat(50)}`);
            console.log(`📡 UDP Packet Analyzer`);
            console.log(`${'='.repeat(50)}`);
            console.log(`Listening on port: ${this.port}`);
            console.log(`Press Ctrl+C to stop`);
            console.log(`${'='.repeat(50)}\n`);
        });

        // Periodic reporting
        setInterval(() => this.printReport(), 10000);
    }

    analyzePacket(packet, rinfo) {
        const now = Date.now();
        this.stats.totalPackets++;
        this.stats.totalBytes += packet.length;

        // Basic validation
        if (packet.length < 8) {
            this.stats.invalidPackets++;
            console.log(`❌ Invalid packet (too small): ${packet.length} bytes from ${rinfo.address}`);
            return;
        }

        // Parse header
        const deviceId = packet.slice(0, 4).toString().replace(/\0/g, '');
        const sequence = packet.readUInt16BE(4);
        const packetType = packet.readUInt16BE(6);
        const payload = packet.slice(8);

        // Track device
        if (!this.devices.has(deviceId)) {
            this.devices.set(deviceId, {
                firstSeen: now,
                lastSeen: now,
                packets: 0,
                bytes: 0,
                lastSequence: -1,
                lostPackets: 0,
                address: rinfo.address,
                port: rinfo.port
            });
            console.log(`✅ New device detected: ${deviceId} from ${rinfo.address}:${rinfo.port}`);
        }

        const device = this.devices.get(deviceId);
        device.lastSeen = now;
        device.packets++;
        device.bytes += packet.length;

        // Check sequence
        if (device.lastSequence >= 0) {
            const expected = (device.lastSequence + 1) & 0xFFFF;
            if (sequence !== expected) {
                const lost = (sequence - expected + 0x10000) & 0xFFFF;
                if (lost < 1000) {
                    device.lostPackets += lost;
                    console.log(`⚠️ Sequence gap: Device ${deviceId} lost ${lost} packets`);
                }
            }
        }
        device.lastSequence = sequence;

        // Analyze by packet type
        switch(packetType) {
            case 0x0001: // Audio
                this.stats.audioPackets++;
                this.analyzeAudioPacket(deviceId, sequence, payload);
                break;

            case 0x0002: // Control
                this.stats.controlPackets++;
                this.analyzeControlPacket(deviceId, payload);
                break;

            case 0x0003: // Heartbeat
                this.stats.heartbeatPackets++;
                break;

            default:
                console.log(`⚠️ Unknown packet type: 0x${packetType.toString(16)} from ${deviceId}`);
        }

        // Add to history
        this.addToHistory({
            timestamp: now,
            deviceId,
            sequence,
            type: packetType,
            size: packet.length,
            address: rinfo.address,
            port: rinfo.port
        });

        this.stats.validPackets++;
    }

    analyzeAudioPacket(deviceId, sequence, opusData) {
        // Try to decode Opus
        try {
            const pcm = this.decoder.decode(opusData);

            // Calculate audio metrics
            const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
            const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
            const peak = Math.max(...samples.map(Math.abs));

            // Log significant audio events
            if (this.stats.audioPackets % 100 === 0) {
                console.log(`🎵 Audio: Device ${deviceId}, Seq ${sequence}, Opus ${opusData.length}B, RMS ${rms.toFixed(0)}, Peak ${peak}`);
            }

        } catch (error) {
            this.stats.opusErrors++;
            console.error(`❌ Opus decode error from ${deviceId}: ${error.message}`);
        }
    }

    analyzeControlPacket(deviceId, payload) {
        try {
            const control = JSON.parse(payload.toString());
            console.log(`🎮 Control from ${deviceId}: ${control.command}`);
        } catch (error) {
            console.error(`❌ Control packet parse error from ${deviceId}`);
        }
    }

    addToHistory(entry) {
        this.packetHistory.push(entry);
        if (this.packetHistory.length > this.maxHistory) {
            this.packetHistory.shift();
        }
    }

    calculateJitter() {
        if (this.packetHistory.length < 2) return 0;

        const deltas = [];
        for (let i = 1; i < this.packetHistory.length; i++) {
            const delta = this.packetHistory[i].timestamp - this.packetHistory[i-1].timestamp;
            deltas.push(delta);
        }

        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const jitter = Math.sqrt(deltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / deltas.length);

        return jitter;
    }

    printReport() {
        const uptime = (Date.now() - this.startTime) / 1000;
        const pps = this.stats.totalPackets / uptime;
        const bps = (this.stats.totalBytes * 8) / uptime;

        console.log(`\n${'='.repeat(50)}`);
        console.log(`📊 PACKET ANALYSIS REPORT`);
        console.log(`${'='.repeat(50)}`);
        console.log(`Uptime: ${uptime.toFixed(0)}s`);
        console.log(`Total packets: ${this.stats.totalPackets} (${pps.toFixed(1)} pps)`);
        console.log(`Valid packets: ${this.stats.validPackets}`);
        console.log(`Invalid packets: ${this.stats.invalidPackets}`);
        console.log(`Audio packets: ${this.stats.audioPackets}`);
        console.log(`Control packets: ${this.stats.controlPackets}`);
        console.log(`Heartbeat packets: ${this.stats.heartbeatPackets}`);
        console.log(`Opus errors: ${this.stats.opusErrors}`);
        console.log(`Data rate: ${(bps / 1000).toFixed(2)} kbps`);
        console.log(`Average jitter: ${this.calculateJitter().toFixed(2)}ms`);

        console.log(`\n📱 DEVICES (${this.devices.size} total):`);
        this.devices.forEach((device, id) => {
            const deviceUptime = (device.lastSeen - device.firstSeen) / 1000;
            const lossRate = device.packets > 0
                ? (device.lostPackets / (device.packets + device.lostPackets) * 100).toFixed(1)
                : 0;

            console.log(`  ${id}: ${device.packets} packets, ${(device.bytes / 1024).toFixed(2)}KB, Loss: ${lossRate}%`);
        });

        console.log(`${'='.repeat(50)}\n`);
    }

    exportStats() {
        return {
            stats: this.stats,
            devices: Array.from(this.devices.entries()).map(([id, device]) => ({
                id,
                ...device
            })),
            jitter: this.calculateJitter(),
            uptime: (Date.now() - this.startTime) / 1000
        };
    }
}

// Run analyzer if executed directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '5004');

    const analyzer = new PacketAnalyzer(port);
    analyzer.start();

    // Export stats on SIGUSR1 (Unix) or every minute
    setInterval(() => {
        const stats = analyzer.exportStats();
        const fs = require('fs');
        fs.writeFileSync('packet-analysis.json', JSON.stringify(stats, null, 2));
    }, 60000);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down analyzer...');
        analyzer.socket.close();
        process.exit(0);
    });
}

module.exports = PacketAnalyzer;