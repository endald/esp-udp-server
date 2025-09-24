const WebSocket = require('ws');
const http = require('http');
const CONFIG = require('../config/server-config.json');

class WebSocketAPI {
    constructor(udpServer) {
        this.udpServer = udpServer;
        this.server = http.createServer();
        this.wss = new WebSocket.Server({ server: this.server });
        this.clients = new Set();

        this.setupWebSocket();
        this.setupEventHandlers();
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            console.log(`🔌 New WebSocket connection from ${req.socket.remoteAddress}`);
            this.clients.add(ws);

            // Send initial state
            this.sendInitialState(ws);

            // Handle incoming messages
            ws.on('message', (message) => {
                this.handleMessage(ws, message);
            });

            // Handle disconnection
            ws.on('close', () => {
                this.clients.delete(ws);
                console.log('🔌 WebSocket client disconnected');
            });

            // Handle errors
            ws.on('error', (error) => {
                console.error(`WebSocket error: ${error.message}`);
            });

            // Ping to keep connection alive
            const pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                } else {
                    clearInterval(pingInterval);
                }
            }, CONFIG.websocket.pingInterval);
        });
    }

    setupEventHandlers() {
        // Device events
        this.udpServer.deviceManager.on('device-connected', (device) => {
            this.broadcast({
                type: 'device-connected',
                device: this.serializeDevice(device)
            });
        });

        this.udpServer.deviceManager.on('device-disconnected', (device) => {
            this.broadcast({
                type: 'device-disconnected',
                deviceId: device.id
            });
        });

        // Routing events
        this.udpServer.audioRouter.on('route-created', (data) => {
            this.broadcast({
                type: 'route-created',
                ...data
            });
        });

        this.udpServer.audioRouter.on('route-removed', (data) => {
            this.broadcast({
                type: 'route-removed',
                ...data
            });
        });

        // Packet events (throttled)
        let packetBuffer = [];
        let packetTimer = null;

        this.udpServer.on('packet', (packet) => {
            packetBuffer.push(packet);

            if (!packetTimer) {
                packetTimer = setTimeout(() => {
                    if (packetBuffer.length > 0) {
                        this.broadcast({
                            type: 'packets',
                            packets: packetBuffer
                        });
                        packetBuffer = [];
                    }
                    packetTimer = null;
                }, 100); // Send packet updates every 100ms
            }
        });
    }

    handleMessage(ws, message) {
        try {
            const data = JSON.parse(message);

            switch(data.type) {
                case 'get-devices':
                    this.sendDevices(ws);
                    break;

                case 'get-routes':
                    this.sendRoutes(ws);
                    break;

                case 'set-route':
                    this.setRoute(data.source, data.target);
                    break;

                case 'remove-route':
                    this.removeRoute(data.source, data.target);
                    break;

                case 'create-bidirectional':
                    this.createBidirectionalRoute(data.deviceA, data.deviceB);
                    break;

                case 'enable-broadcast':
                    this.enableBroadcast(data.deviceId);
                    break;

                case 'disable-broadcast':
                    this.disableBroadcast(data.deviceId);
                    break;

                case 'mute-device':
                    this.muteDevice(data.deviceId);
                    break;

                case 'unmute-device':
                    this.unmuteDevice(data.deviceId);
                    break;

                case 'apply-scenario':
                    this.applyScenario(data.scenario);
                    break;

                case 'get-stats':
                    this.sendStats(ws);
                    break;

                case 'export-config':
                    this.exportConfiguration(ws);
                    break;

                case 'import-config':
                    this.importConfiguration(data.config);
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                default:
                    console.warn(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error(`Message handling error: ${error.message}`);
            ws.send(JSON.stringify({
                type: 'error',
                message: error.message
            }));
        }
    }

    sendInitialState(ws) {
        const devices = this.udpServer.deviceManager.exportDeviceList();
        const routes = this.udpServer.audioRouter.getRoutingMatrix();
        const stats = this.udpServer.stats;

        ws.send(JSON.stringify({
            type: 'initial-state',
            devices,
            routes,
            stats,
            config: {
                sampleRate: CONFIG.audio.sampleRate,
                frameDuration: CONFIG.audio.frameDuration
            }
        }));
    }

    sendDevices(ws) {
        const devices = this.udpServer.deviceManager.exportDeviceList();
        ws.send(JSON.stringify({
            type: 'devices',
            devices
        }));
    }

    sendRoutes(ws) {
        const routes = this.udpServer.audioRouter.getRoutingMatrix();
        ws.send(JSON.stringify({
            type: 'routes',
            routes
        }));
    }

    sendStats(ws) {
        const stats = {
            server: this.udpServer.stats,
            devices: {}
        };

        this.udpServer.deviceManager.getAllDevices().forEach(device => {
            stats.devices[device.id] = this.udpServer.deviceManager.getDeviceStats(device.id);
        });

        ws.send(JSON.stringify({
            type: 'stats',
            stats
        }));
    }

    setRoute(source, target) {
        const success = this.udpServer.audioRouter.setRoute(source, target);
        this.broadcast({
            type: 'route-update',
            success,
            source,
            target
        });
    }

    removeRoute(source, target) {
        const success = this.udpServer.audioRouter.removeRoute(source, target);
        this.broadcast({
            type: 'route-update',
            success,
            source,
            target
        });
    }

    createBidirectionalRoute(deviceA, deviceB) {
        this.udpServer.audioRouter.createBidirectionalRoute(deviceA, deviceB);
        this.broadcast({
            type: 'bidirectional-created',
            deviceA,
            deviceB
        });
    }

    enableBroadcast(deviceId) {
        this.udpServer.audioRouter.enableBroadcast(deviceId);
        this.broadcast({
            type: 'broadcast-enabled',
            deviceId
        });
    }

    disableBroadcast(deviceId) {
        this.udpServer.audioRouter.disableBroadcast(deviceId);
        this.broadcast({
            type: 'broadcast-disabled',
            deviceId
        });
    }

    muteDevice(deviceId) {
        this.udpServer.audioRouter.muteDevice(deviceId);
        this.broadcast({
            type: 'device-muted',
            deviceId
        });
    }

    unmuteDevice(deviceId) {
        this.udpServer.audioRouter.unmuteDevice(deviceId);
        this.broadcast({
            type: 'device-unmuted',
            deviceId
        });
    }

    applyScenario(scenario) {
        const success = this.udpServer.audioRouter.applyRoutingScenario(scenario);
        this.broadcast({
            type: 'scenario-applied',
            scenario,
            success
        });
    }

    exportConfiguration(ws) {
        const config = {
            routing: this.udpServer.audioRouter.exportConfiguration(),
            devices: this.udpServer.deviceManager.exportDeviceList()
        };

        ws.send(JSON.stringify({
            type: 'configuration',
            config
        }));
    }

    importConfiguration(config) {
        const success = this.udpServer.audioRouter.importConfiguration(config);
        this.broadcast({
            type: 'configuration-imported',
            success
        });
    }

    serializeDevice(device) {
        return {
            id: device.id,
            address: device.address,
            port: device.port,
            online: device.online,
            lastSeen: device.lastSeen
        };
    }

    broadcast(message) {
        const data = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    }

    start() {
        this.server.listen(CONFIG.websocket.port, () => {
            console.log(`📡 WebSocket API listening on port ${CONFIG.websocket.port}`);
        });
    }

    stop() {
        this.wss.clients.forEach(client => {
            client.close();
        });
        this.server.close();
    }
}

module.exports = WebSocketAPI;