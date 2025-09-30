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

        // Global timing control to prevent packet bursts
        this.lastGlobalSendTime = 0;
        this.currentQueueIndex = 0;
        this.lastPacketSendTime = 0; // For timing diagnostics

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
     * FIXED: Only sends ONE packet per interval to prevent bursts
     */
    sendScheduledPackets() {
        const now = Date.now();

        // Enforce global timing - only one packet per 20ms interval
        if (this.lastGlobalSendTime && (now - this.lastGlobalSendTime) < this.PACKET_INTERVAL - 2) {
            return; // Too soon, skip this interval
        }

        // Get all queue keys for round-robin processing
        const queueKeys = Array.from(this.queues.keys());
        if (queueKeys.length === 0) return;

        // Try each queue starting from current index (round-robin)
        for (let i = 0; i < queueKeys.length; i++) {
            const index = (this.currentQueueIndex + i) % queueKeys.length;
            const queueKey = queueKeys[index];
            const queue = this.queues.get(queueKey);

            // Skip empty queues
            if (!queue || queue.packets.length === 0) continue;

            // Get the oldest packet
            const packet = queue.packets[0];
            const age = now - packet.timestamp;

            // Wait for initial buffering (prevents underrun on stream start)
            if (queue.packets.length < 3 && age < 40) {
                continue; // Need more packets in buffer
            }

            // Check if packet is too old (> MAX_LATENCY)
            if (age > this.MAX_LATENCY) {
                this.stats.jitterEvents++;
                if (this.stats.jitterEvents % 10 === 1) {
                    console.log(`⚠️ High latency: ${age}ms for ${queueKey}`);
                }
            }

            // Remove and send this ONE packet
            queue.packets.shift();

            // Send packet via UDP server
            if (this.udpServer && queue.toDevice) {
                try {
                    this.udpServer.sendToDevice(queue.toDevice, packet.data);

                    // Update all timing trackers
                    this.lastGlobalSendTime = now;
                    queue.lastSendTime = now;
                    this.stats.packetsSent++;

                    // Timing diagnostics - check interval consistency
                    if (this.lastPacketSendTime) {
                        const interval = now - this.lastPacketSendTime;
                        if (interval < 15 || interval > 25) {
                            console.log(`⚠️ Packet timing: ${interval}ms (expected 20ms)`);
                        }
                    }
                    this.lastPacketSendTime = now;

                    // Move to next queue for next interval (round-robin)
                    this.currentQueueIndex = (index + 1) % queueKeys.length;

                    // Log every 50th packet for monitoring
                    if (this.stats.packetsSent % 50 === 0) {
                        console.log(`📊 Pacer: Sent=${this.stats.packetsSent}, Queue=${queueKey}, ` +
                                  `Buffered=${queue.packets.length}, Dropped=${this.stats.packetsDropped}`);
                    }

                    // CRITICAL: Only send ONE packet per interval
                    return;

                } catch (error) {
                    console.error(`Failed to send paced packet: ${error.message}`);
                }
            }
        }

        // If we get here, no packets were sent - advance queue index anyway
        this.currentQueueIndex = (this.currentQueueIndex + 1) % Math.max(queueKeys.length, 1);
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