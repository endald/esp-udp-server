/**
 * Dashboard Audio Server
 * Enhanced dashboard with audio capabilities for ESP32 testing
 * Supports MP3 streaming, microphone input, and audio reception
 */

const DashboardServer = require('./dashboard-server');
const WebSocket = require('ws');
const EventEmitter = require('events');

// Note: Opus encoding/decoding happens in the browser (audio-handler.js)
// The server just passes through the base64-encoded Opus packets
// This avoids Node.js compatibility issues with WASM libraries

class DashboardAudioServer extends DashboardServer {
    constructor(udpServer) {
        super(udpServer);

        this.wsServer = null;
        this.wsClients = new Set();
        this.audioEventEmitter = new EventEmitter();

        // Register dashboard as virtual device
        this.registerVirtualDevice();

        // Track what devices dashboard is listening to
        this.listeningTo = new Set();

        // Audio stats
        this.audioStats = {
            packetsFromDashboard: 0,
            packetsToDashboard: 0,
            bytesFromDashboard: 0,
            bytesToDashboard: 0
        };
    }

    start() {
        // Override parent's HTTP server to add audio test route
        this.httpServer = require('http').createServer((req, res) => {
            // Handle different routes
            if (req.url === '/' || req.url === '/index.html') {
                this.serveDashboard(res);
            } else if (req.url === '/audio-test.html' || req.url === '/audio-test') {
                this.serveAudioTestPage(res);
            } else if (req.url === '/api/stats') {
                this.serveStats(res);
            } else if (req.url === '/api/devices') {
                this.serveDevices(res);
            } else if (req.url === '/api/route' && req.method === 'POST') {
                this.handleRouteUpdate(req, res);
            } else if (req.url === '/api/route/clear' && req.method === 'POST') {
                this.handleClearRoutes(req, res);
            } else if (req.url.startsWith('/js/')) {
                this.serveStaticFile(req, res);
            } else if (req.url.startsWith('/dashboard/')) {
                this.serveStaticFile(req, res);
            } else if (req.url.endsWith('.wasm')) {
                // Handle WASM files from any path
                this.serveStaticFile(req, res);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.httpServer.listen(this.port, '0.0.0.0', () => {
            console.log(`📊 Dashboard HTTP server running on port ${this.port}`);
            console.log(`🌐 Access dashboard at: http://YOUR_SERVER_IP:${this.port}`);
            console.log(`🎧 Audio testing at: http://YOUR_SERVER_IP:${this.port}/audio-test.html`);
        });

        // Create WebSocket server for audio streaming
        this.wsServer = new WebSocket.Server({
            port: 8082,
            perMessageDeflate: false // Disable compression for low latency
        });

        this.wsServer.on('connection', (ws, req) => {
            console.log('🎧 Dashboard audio client connected from:', req.connection.remoteAddress);
            this.handleWebSocketConnection(ws);
        });

        console.log(`🔊 WebSocket audio server running on port 8082`);
    }

    registerVirtualDevice() {
        if (this.udpServer && this.udpServer.deviceManager) {
            // Register dashboard as a virtual device "DSH"
            const virtualDevice = {
                id: 'DSH',
                address: '127.0.0.1',
                port: 0, // Virtual port (not used for actual UDP)
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                online: true,
                isDashboard: true,
                packetsReceived: 0,
                packetsTransmitted: 0,
                stats: {
                    jitter: [],
                    latency: [],
                    packetLoss: 0
                }
            };

            this.udpServer.deviceManager.devices.set('DSH', virtualDevice);
            console.log('📱 Dashboard registered as virtual device: DSH');
        }
    }

    handleWebSocketConnection(ws) {
        this.wsClients.add(ws);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                this.handleWebSocketMessage(ws, data);
            } catch (error) {
                console.error('Invalid WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            this.wsClients.delete(ws);
            console.log('🔌 Dashboard audio client disconnected');
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        // Send initial connection confirmation
        ws.send(JSON.stringify({
            type: 'connected',
            deviceId: 'DSH',
            timestamp: Date.now()
        }));
    }

    handleWebSocketMessage(ws, message) {
        switch (message.type) {
            case 'audio_packet':
                this.handleOutgoingAudio(message);
                break;

            case 'start_listening':
                this.startListeningToDevice(message.deviceId);
                break;

            case 'stop_listening':
                this.stopListeningToDevice(message.deviceId);
                break;

            case 'request_stats':
                this.sendAudioStats(ws);
                break;

            case 'set_route':
                this.setAudioRoute(message.from, message.to);
                break;

            default:
                console.warn('Unknown WebSocket message type:', message.type);
        }
    }

    handleOutgoingAudio(message) {
        // Dashboard is sending audio to an ESP32 device
        if (!this.udpServer) return;

        // Build UDP packet format: [DeviceID(4)][Seq(2,BE)][Type(2)][OpusData]
        const opusData = Buffer.from(message.opus, 'base64');
        const packet = Buffer.alloc(8 + opusData.length);

        // Write device ID (DSH)
        packet.write('DSH\0', 0, 4);

        // Write sequence number (big-endian)
        packet.writeUInt16BE(message.sequence || 0, 4);

        // Write packet type (0x0001 for audio)
        packet.writeUInt16BE(0x0001, 6);

        // Copy Opus data
        opusData.copy(packet, 8);

        // Route through existing audio router
        const targetDevice = this.udpServer.deviceManager.getDevice(message.to);
        if (targetDevice && targetDevice.online) {
            this.udpServer.sendToDevice(targetDevice, packet);
            this.audioStats.packetsFromDashboard++;
            this.audioStats.bytesFromDashboard += packet.length;

            console.log(`🎵 Dashboard → ${message.to}: ${opusData.length} bytes`);
        } else {
            console.warn(`Target device ${message.to} not found or offline`);
        }
    }

    handleIncomingAudio(sourceDeviceId, packet) {
        // ESP32 device is sending audio that dashboard wants to receive
        if (!this.listeningTo.has(sourceDeviceId)) return;

        // Extract audio data from UDP packet
        const sequence = packet.readUInt16BE(4);
        const packetType = packet.readUInt16BE(6);

        if (packetType !== 0x0001) return; // Only handle audio packets

        const opusData = packet.slice(8);

        // Send to all connected WebSocket clients
        const wsMessage = {
            type: 'audio_received',
            from: sourceDeviceId,
            sequence: sequence,
            opus: opusData.toString('base64'),
            timestamp: Date.now()
        };

        this.broadcast(wsMessage);
        this.audioStats.packetsToDashboard++;
        this.audioStats.bytesToDashboard += packet.length;

        if (this.audioStats.packetsToDashboard % 50 === 0) {
            console.log(`🎧 Dashboard ← ${sourceDeviceId}: ${this.audioStats.packetsToDashboard} packets received`);
        }
    }

    startListeningToDevice(deviceId) {
        this.listeningTo.add(deviceId);

        // Set up route so device audio comes to dashboard
        if (this.udpServer && this.udpServer.audioRouter) {
            this.udpServer.audioRouter.setRoute(deviceId, 'DSH');
        }

        console.log(`👂 Dashboard started listening to device: ${deviceId}`);

        // Notify clients
        this.broadcast({
            type: 'listening_started',
            deviceId: deviceId,
            timestamp: Date.now()
        });
    }

    stopListeningToDevice(deviceId) {
        this.listeningTo.delete(deviceId);

        // Remove route
        if (this.udpServer && this.udpServer.audioRouter) {
            this.udpServer.audioRouter.removeRoute(deviceId, 'DSH');
        }

        console.log(`🔇 Dashboard stopped listening to device: ${deviceId}`);

        // Notify clients
        this.broadcast({
            type: 'listening_stopped',
            deviceId: deviceId,
            timestamp: Date.now()
        });
    }

    setAudioRoute(from, to) {
        if (this.udpServer && this.udpServer.audioRouter) {
            this.udpServer.audioRouter.setRoute(from, to);
            console.log(`🔀 Audio route set: ${from} → ${to}`);
        }
    }

    sendAudioStats(ws) {
        ws.send(JSON.stringify({
            type: 'audio_stats',
            stats: this.audioStats,
            listeningTo: Array.from(this.listeningTo),
            timestamp: Date.now()
        }));
    }

    broadcast(message) {
        const data = JSON.stringify(message);
        this.wsClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });
    }

    serveAudioTestPage(res) {
        const fs = require('fs');
        const path = require('path');
        const audioTestPath = path.join(__dirname, '..', 'dashboard', 'audio-test.html');

        if (fs.existsSync(audioTestPath)) {
            const html = fs.readFileSync(audioTestPath, 'utf8');
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(html);
        } else {
            res.writeHead(404);
            res.end('Audio test page not found');
        }
    }

    serveStaticFile(req, res) {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, '..', 'dashboard', req.url.substring(1));

        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath);
            const contentType = {
                '.js': 'application/javascript',
                '.css': 'text/css',
                '.html': 'text/html',
                '.wasm': 'application/wasm'  // Add WASM MIME type
            }[ext] || 'text/plain';

            res.writeHead(200, {'Content-Type': contentType});
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404);
            res.end('File not found');
        }
    }

    // Override parent method to add audio handling
    serveDevices(res) {
        const devices = super.serveDevices(res);

        // Add dashboard as a device in the list
        const dashboardDevice = {
            id: 'DSH',
            name: 'Dashboard',
            online: true,
            isDashboard: true,
            address: '127.0.0.1',
            port: 0,
            packetsReceived: this.audioStats.packetsToDashboard,
            packetsTransmitted: this.audioStats.packetsFromDashboard
        };

        return devices;
    }

    stop() {
        super.stop();

        if (this.wsServer) {
            this.wsServer.close();
            console.log('WebSocket audio server stopped');
        }
    }
}

module.exports = DashboardAudioServer;