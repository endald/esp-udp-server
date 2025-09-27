/**
 * Audio Bridge
 * Bridges audio between WebSocket (Dashboard) and UDP (ESP32 devices)
 * Handles packet format conversion and routing
 */

class AudioBridge {
    constructor(udpServer, dashboardServer) {
        this.udpServer = udpServer;
        this.dashboardServer = dashboardServer;

        // Intercept UDP audio packets for dashboard
        this.setupUDPInterception();

        // Track sequence numbers for dashboard
        this.dashboardSequence = 0;

        console.log('🌉 Audio bridge initialized');
    }

    setupUDPInterception() {
        if (!this.udpServer) return;

        // Hook into the UDP server's routing mechanism
        const originalRouteAudio = this.udpServer.routeAudio.bind(this.udpServer);

        this.udpServer.routeAudio = (sourceDevice, packet) => {
            // Call original routing
            originalRouteAudio(sourceDevice, packet);

            // Also check if dashboard is listening to this device
            const routes = this.udpServer.audioRouter.getRoutes(sourceDevice.id);
            if (routes.includes('DSH')) {
                this.bridgeUDPToWebSocket(packet, sourceDevice);
            }
        };
    }

    bridgeUDPToWebSocket(udpPacket, sourceDevice) {
        // Forward UDP audio to dashboard via WebSocket
        if (this.dashboardServer) {
            this.dashboardServer.handleIncomingAudio(sourceDevice.id, udpPacket);
        }
    }

    bridgeWebSocketToUDP(wsMessage) {
        // This is handled directly in dashboard-audio-server.js
        // for better integration with the existing UDP server
    }

    // Create UDP packet from dashboard audio
    createUDPPacket(audioData, targetDeviceId) {
        const opusData = Buffer.from(audioData, 'base64');
        const packet = Buffer.alloc(8 + opusData.length);

        // Device ID (DSH for dashboard)
        packet.write('DSH\0', 0, 4);

        // Sequence number (big-endian)
        packet.writeUInt16BE(this.dashboardSequence++, 4);

        // Packet type (0x0001 for audio)
        packet.writeUInt16BE(0x0001, 6);

        // Opus audio data
        opusData.copy(packet, 8);

        return packet;
    }

    // Parse UDP packet for dashboard consumption
    parseUDPPacket(packet) {
        if (packet.length < 8) return null;

        return {
            deviceId: packet.slice(0, 4).toString().replace(/\0/g, ''),
            sequence: packet.readUInt16BE(4),
            type: packet.readUInt16BE(6),
            audioData: packet.slice(8)
        };
    }

    getStatistics() {
        return {
            dashboardSequence: this.dashboardSequence,
            bridgeActive: true
        };
    }
}

module.exports = AudioBridge;