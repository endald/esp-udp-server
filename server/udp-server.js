const dgram = require('dgram');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const DeviceManager = require('./device-manager');
const AudioRouter = require('./audio-router');
const WebSocketAPI = require('./websocket-api');

const CONFIG = require('../config/server-config.json');

class UDPAudioServer extends EventEmitter {
    constructor() {
        super();
        this.socket = dgram.createSocket('udp4');
        this.deviceManager = new DeviceManager();
        this.audioRouter = new AudioRouter(this.deviceManager);
        this.websocketAPI = new WebSocketAPI(this);

        this.stats = {
            packetsReceived: 0,
            packetsRouted: 0,
            packetsDropped: 0,
            bytesReceived: 0,
            bytesTransmitted: 0,
            startTime: Date.now()
        };

        this.setupSocket();
        this.setupLogging();
    }

    setupSocket() {
        this.socket.on('error', (err) => {
            console.error(`❌ Server error: ${err.stack}`);
            this.socket.close();
        });

        this.socket.on('message', (msg, rinfo) => {
            this.handlePacket(msg, rinfo);
        });

        this.socket.on('listening', () => {
            const address = this.socket.address();
            console.log(`\n${'='.repeat(50)}`);
            console.log(`🎵 UDP Audio Server`);
            console.log(`${'='.repeat(50)}`);
            console.log(`✅ Listening on: ${address.address}:${address.port}`);
            console.log(`✅ WebSocket API: ws://localhost:${CONFIG.websocket.port}`);
            console.log(`✅ Dashboard: http://localhost:8080`);
            console.log(`✅ Max devices: ${CONFIG.device.maxDevices}`);
            console.log(`✅ Audio: ${CONFIG.audio.sampleRate}Hz, ${CONFIG.audio.frameDuration}ms frames`);
            console.log(`${'='.repeat(50)}\n`);
        });
    }

    handlePacket(packet, rinfo) {
        try {
            // Update statistics
            this.stats.packetsReceived++;
            this.stats.bytesReceived += packet.length;

            // Validate packet minimum size
            if (packet.length < 8) {
                console.warn(`⚠️ Invalid packet size ${packet.length} from ${rinfo.address}:${rinfo.port}`);
                this.stats.packetsDropped++;
                return;
            }

            // Parse packet header
            const deviceId = packet.slice(0, 4).toString().replace(/\0/g, '');
            const sequence = packet.readUInt16BE(4);
            const packetType = packet.readUInt16BE(6);
            const audioData = packet.slice(8);

            // Register/update device
            const device = this.deviceManager.updateDevice(deviceId, {
                address: rinfo.address,
                port: rinfo.port,
                lastSeen: Date.now(),
                sequence: sequence
            });

            // Handle different packet types
            switch(packetType) {
                case 0x0001: // Audio packet
                    this.routeAudio(device, packet);
                    break;
                case 0x0002: // Control packet
                    this.handleControl(device, audioData);
                    break;
                case 0x0003: // Heartbeat
                    this.handleHeartbeat(device);
                    break;
                default:
                    console.warn(`⚠️ Unknown packet type 0x${packetType.toString(16)} from ${deviceId}`);
            }

            // Emit for monitoring
            this.emit('packet', {
                deviceId,
                sequence,
                type: packetType,
                size: packet.length,
                timestamp: Date.now()
            });

        } catch (error) {
            console.error(`❌ Packet handling error: ${error.message}`);
            this.stats.packetsDropped++;
        }
    }

    routeAudio(sourceDevice, packet) {
        const routes = this.audioRouter.getRoutes(sourceDevice.id);

        if (routes.length === 0) {
            // No active routes for this device
            return;
        }

        routes.forEach(targetDeviceId => {
            const targetDevice = this.deviceManager.getDevice(targetDeviceId);
            if (targetDevice && targetDevice.online) {
                this.sendToDevice(targetDevice, packet);
                this.stats.packetsRouted++;
            }
        });
    }

    sendToDevice(device, packet) {
        this.socket.send(packet, device.port, device.address, (err) => {
            if (err) {
                console.error(`❌ Failed to send to ${device.id}: ${err.message}`);
                this.stats.packetsDropped++;
            } else {
                this.stats.bytesTransmitted += packet.length;
            }
        });
    }

    broadcastAudio(sourceDevice, packet) {
        const devices = this.deviceManager.getOnlineDevices();
        devices.forEach(device => {
            if (device.id !== sourceDevice.id) {
                this.sendToDevice(device, packet);
            }
        });
    }

    handleControl(device, data) {
        try {
            const control = JSON.parse(data.toString());
            console.log(`🎮 Control from ${device.id}: ${control.command}`);

            switch(control.command) {
                case 'route':
                    this.audioRouter.setRoute(device.id, control.target);
                    break;
                case 'broadcast':
                    this.audioRouter.enableBroadcast(device.id);
                    break;
                case 'mute':
                    this.audioRouter.muteDevice(device.id);
                    break;
                default:
                    console.warn(`Unknown control command: ${control.command}`);
            }
        } catch (error) {
            console.error(`Control packet parse error: ${error.message}`);
        }
    }

    handleHeartbeat(device) {
        device.lastHeartbeat = Date.now();
        // Send acknowledgment
        const ack = Buffer.alloc(8);
        ack.write('SRVR', 0);
        ack.writeUInt16BE(0, 4);
        ack.writeUInt16BE(0x0003, 6);
        this.sendToDevice(device, ack);
    }

    setupLogging() {
        // Statistics reporting
        setInterval(() => {
            const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
            const onlineDevices = this.deviceManager.getOnlineDevices().length;

            console.log('\n📊 === SERVER STATISTICS ===');
            console.log(`Uptime: ${uptime}s`);
            console.log(`Online devices: ${onlineDevices}`);
            console.log(`Packets received: ${this.stats.packetsReceived}`);
            console.log(`Packets routed: ${this.stats.packetsRouted}`);
            console.log(`Packets dropped: ${this.stats.packetsDropped}`);
            console.log(`Data received: ${(this.stats.bytesReceived / 1024).toFixed(2)} KB`);
            console.log(`Data transmitted: ${(this.stats.bytesTransmitted / 1024).toFixed(2)} KB`);
            console.log('===========================\n');
        }, 30000); // Every 30 seconds

        // Device timeout check
        setInterval(() => {
            this.deviceManager.checkTimeouts();
        }, 5000);
    }

    start() {
        this.socket.bind(CONFIG.udp.serverPort);
        this.websocketAPI.start();

        // Create logs directory if it doesn't exist
        const logsDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
    }

    stop() {
        this.socket.close();
        this.websocketAPI.stop();
        console.log('Server stopped');
    }
}

// Start server if run directly
if (require.main === module) {
    const server = new UDPAudioServer();
    server.start();

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down server...');
        server.stop();
        process.exit(0);
    });
}

module.exports = UDPAudioServer;