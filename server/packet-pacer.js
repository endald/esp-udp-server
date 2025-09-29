/**
 * Packet Pacer - Server-side jitter buffer and timing correction
 *
 * Receives packets from browser at irregular intervals and sends them
 * to ESP32 devices at precise 20ms intervals to prevent audio corruption.
 *
 * Features:
 * - 100ms jitter buffer depth
 * - Precise 20ms packet pacing
 * - Handles packet reordering
 * - Graceful drop handling
 */

class PacketPacer {
    constructor(udpServer) {
        this.udpServer = udpServer;

        // Packet queues per device pair (from -> to)
        this.queues = new Map(); // Key: "FROM_ID->TO_ID", Value: packet queue

        // Timing configuration
        this.PACKET_INTERVAL = 20; // 20ms between packets
        this.MAX_BUFFER_SIZE = 10; // Max 10 packets (200ms) in buffer
        this.MAX_LATENCY = 100;    // Max 100ms initial latency

        // Statistics
        this.stats = {
            packetsReceived: 0,
            packetsSent: 0,
            packetsDropped: 0,
            jitterEvents: 0
        };

        // Start the pacing timer
        this.startPacer();
    }

    /**
     * Add a packet to the buffer for paced delivery
     * @param {Buffer} packet - The UDP packet to send
     * @param {Object} fromDevice - Source device object
     * @param {Object} toDevice - Target device object
     */
    bufferPacket(packet, fromDevice, toDevice) {
        if (!fromDevice || !toDevice) return;

        const queueKey = `${fromDevice.id}->${toDevice.id}`;

        // Get or create queue for this device pair
        if (!this.queues.has(queueKey)) {
            this.queues.set(queueKey, {
                packets: [],
                toDevice: toDevice,
                lastSendTime: 0,
                sequence: 0
            });
        }

        const queue = this.queues.get(queueKey);

        // Add packet to queue with timestamp
        queue.packets.push({
            data: packet,
            timestamp: Date.now(),
            sequence: this.extractSequence(packet)
        });

        this.stats.packetsReceived++;

        // Drop old packets if buffer is full
        while (queue.packets.length > this.MAX_BUFFER_SIZE) {
            queue.packets.shift(); // Remove oldest
            this.stats.packetsDropped++;
            console.log(`Dropped packet for ${queueKey} - buffer full`);
        }

        // Sort by sequence number to handle reordering
        queue.packets.sort((a, b) => a.sequence - b.sequence);
    }

    /**
     * Extract sequence number from packet header
     * @param {Buffer} packet - UDP packet
     * @returns {number} Sequence number
     */
    extractSequence(packet) {
        if (packet.length < 6) return 0;
        return (packet[4] << 8) | packet[5];
    }

    /**
     * Start the packet pacing timer
     */
    startPacer() {
        // Use setInterval for more consistent timing than setTimeout
        this.pacerInterval = setInterval(() => {
            this.sendScheduledPackets();
        }, this.PACKET_INTERVAL);

        console.log(`📡 Packet pacer started - ${this.PACKET_INTERVAL}ms intervals`);
    }

    /**
     * Send packets that are scheduled for transmission
     */
    sendScheduledPackets() {
        const now = Date.now();

        for (const [queueKey, queue] of this.queues.entries()) {
            // Check if it's time to send the next packet
            if (queue.packets.length === 0) continue;

            // Ensure minimum interval between packets
            if (queue.lastSendTime && (now - queue.lastSendTime) < this.PACKET_INTERVAL) {
                continue;
            }

            // Get the oldest packet
            const packet = queue.packets[0];

            // Wait for initial buffering (prevents underrun on stream start)
            const age = now - packet.timestamp;
            if (queue.packets.length < 3 && age < 40) {
                // Wait for more packets to build up initial buffer
                continue;
            }

            // Check if packet is too old (> MAX_LATENCY)
            if (age > this.MAX_LATENCY) {
                // Log jitter event but still send the packet
                this.stats.jitterEvents++;
                if (this.stats.jitterEvents % 10 === 1) {
                    console.log(`⚠️ High latency detected: ${age}ms for ${queueKey}`);
                }
            }

            // Remove packet from queue and send it
            queue.packets.shift();

            // Send packet via UDP server
            if (this.udpServer && queue.toDevice) {
                try {
                    this.udpServer.sendToDevice(queue.toDevice, packet.data);
                    queue.lastSendTime = now;
                    this.stats.packetsSent++;

                    // Log every 100th packet for monitoring
                    if (this.stats.packetsSent % 100 === 0) {
                        console.log(`📊 Pacer stats: Sent=${this.stats.packetsSent}, ` +
                                  `Buffered=${queue.packets.length}, ` +
                                  `Dropped=${this.stats.packetsDropped}, ` +
                                  `Jitter=${this.stats.jitterEvents}`);
                    }
                } catch (error) {
                    console.error(`Failed to send paced packet: ${error.message}`);
                }
            }
        }
    }

    /**
     * Get statistics for monitoring
     * @returns {Object} Current statistics
     */
    getStats() {
        const queueStats = {};
        for (const [key, queue] of this.queues.entries()) {
            queueStats[key] = {
                buffered: queue.packets.length,
                lastSend: queue.lastSendTime
            };
        }

        return {
            ...this.stats,
            queues: queueStats,
            uptime: this.pacerInterval ? 'running' : 'stopped'
        };
    }

    /**
     * Stop the packet pacer
     */
    stop() {
        if (this.pacerInterval) {
            clearInterval(this.pacerInterval);
            this.pacerInterval = null;
            console.log('Packet pacer stopped');
        }

        // Clear all queues
        this.queues.clear();
    }

    /**
     * Check if a route should use the pacer
     * Dashboard (DSH) to ESP devices should be paced
     * @param {string} fromId - Source device ID
     * @param {string} toId - Target device ID
     * @returns {boolean} Whether to use pacer
     */
    shouldUsePacer(fromId, toId) {
        // Use pacer for dashboard to ESP32 audio
        if (fromId === 'DSH' && toId !== 'DSH') {
            return true;
        }

        // Don't pace ESP32 to ESP32 (they already have good timing)
        return false;
    }
}

module.exports = PacketPacer;