const EventEmitter = require('events');
const CONFIG = require('../config/server-config.json');

class DeviceManager extends EventEmitter {
    constructor() {
        super();
        this.devices = new Map();
        this.deviceGroups = new Map();
    }

    updateDevice(deviceId, info) {
        let device = this.devices.get(deviceId);

        if (!device) {
            // New device registration
            device = {
                id: deviceId,
                address: info.address,
                port: info.port,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                online: true,
                sequence: info.sequence || 0,
                lastSequence: -1,
                packetsReceived: 0,
                packetsLost: 0,
                stats: {
                    jitter: [],
                    latency: [],
                    packetLoss: 0
                }
            };

            this.devices.set(deviceId, device);
            console.log(`✅ New device registered: ${deviceId} from ${info.address}:${info.port}`);
            this.emit('device-connected', device);
        } else {
            // Update existing device
            const wasOffline = !device.online;

            // Check for packet loss
            if (device.lastSequence >= 0) {
                const expectedSeq = (device.lastSequence + 1) & 0xFFFF;
                if (info.sequence !== expectedSeq) {
                    const lost = (info.sequence - expectedSeq + 0x10000) & 0xFFFF;
                    if (lost < 1000) { // Reasonable packet loss
                        device.packetsLost += lost;
                        console.warn(`⚠️ Device ${deviceId} lost ${lost} packets`);
                    }
                }
            }

            // Update device info
            device.address = info.address;
            device.port = info.port;
            device.lastSeen = Date.now();
            device.online = true;
            device.lastSequence = info.sequence;
            device.packetsReceived++;

            // Calculate jitter
            if (device.lastPacketTime) {
                const jitter = Date.now() - device.lastPacketTime - CONFIG.audio.frameDuration;
                device.stats.jitter.push(Math.abs(jitter));
                if (device.stats.jitter.length > 100) {
                    device.stats.jitter.shift();
                }
            }
            device.lastPacketTime = Date.now();

            if (wasOffline) {
                console.log(`📡 Device ${deviceId} reconnected`);
                this.emit('device-reconnected', device);
            }
        }

        return device;
    }

    getDevice(deviceId) {
        return this.devices.get(deviceId);
    }

    getOnlineDevices() {
        return Array.from(this.devices.values()).filter(d => d.online);
    }

    getAllDevices() {
        return Array.from(this.devices.values());
    }

    checkTimeouts() {
        const now = Date.now();
        const timeout = CONFIG.device.timeoutSeconds * 1000;

        this.devices.forEach(device => {
            if (device.online && (now - device.lastSeen) > timeout) {
                device.online = false;
                console.log(`⚠️ Device ${device.id} went offline (timeout)`);
                this.emit('device-disconnected', device);
            }
        });
    }

    getDeviceStats(deviceId) {
        const device = this.devices.get(deviceId);
        if (!device) return null;

        const uptime = Date.now() - device.firstSeen;
        const avgJitter = device.stats.jitter.length > 0
            ? device.stats.jitter.reduce((a, b) => a + b, 0) / device.stats.jitter.length
            : 0;

        return {
            id: device.id,
            address: device.address,
            port: device.port,
            online: device.online,
            uptime: Math.floor(uptime / 1000),
            packetsReceived: device.packetsReceived,
            packetsLost: device.packetsLost,
            packetLossRate: device.packetsReceived > 0
                ? (device.packetsLost / (device.packetsReceived + device.packetsLost) * 100).toFixed(2)
                : 0,
            avgJitter: avgJitter.toFixed(2),
            lastSeen: device.lastSeen
        };
    }

    // Group management for multi-party calls
    createGroup(groupId, deviceIds = []) {
        if (this.deviceGroups.has(groupId)) {
            console.warn(`Group ${groupId} already exists`);
            return false;
        }

        this.deviceGroups.set(groupId, new Set(deviceIds));
        console.log(`✅ Created group ${groupId} with ${deviceIds.length} devices`);
        return true;
    }

    addToGroup(groupId, deviceId) {
        const group = this.deviceGroups.get(groupId);
        if (!group) {
            console.warn(`Group ${groupId} does not exist`);
            return false;
        }

        if (group.size >= CONFIG.routing.maxGroupSize) {
            console.warn(`Group ${groupId} is full`);
            return false;
        }

        group.add(deviceId);
        console.log(`Added ${deviceId} to group ${groupId}`);
        return true;
    }

    removeFromGroup(groupId, deviceId) {
        const group = this.deviceGroups.get(groupId);
        if (!group) return false;

        group.delete(deviceId);
        if (group.size === 0) {
            this.deviceGroups.delete(groupId);
            console.log(`Deleted empty group ${groupId}`);
        }
        return true;
    }

    getGroupMembers(groupId) {
        const group = this.deviceGroups.get(groupId);
        return group ? Array.from(group) : [];
    }

    getDeviceGroups(deviceId) {
        const groups = [];
        this.deviceGroups.forEach((members, groupId) => {
            if (members.has(deviceId)) {
                groups.push(groupId);
            }
        });
        return groups;
    }

    // Export device list for monitoring
    exportDeviceList() {
        const devices = [];
        this.devices.forEach(device => {
            devices.push(this.getDeviceStats(device.id));
        });
        return devices;
    }

    // Clear offline devices (maintenance)
    cleanupOfflineDevices() {
        let removed = 0;
        const now = Date.now();
        const maxOfflineTime = 3600000; // 1 hour

        this.devices.forEach((device, id) => {
            if (!device.online && (now - device.lastSeen) > maxOfflineTime) {
                this.devices.delete(id);
                removed++;
            }
        });

        if (removed > 0) {
            console.log(`🧹 Cleaned up ${removed} offline devices`);
        }
        return removed;
    }
}

module.exports = DeviceManager;