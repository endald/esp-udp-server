const EventEmitter = require('events');
const CONFIG = require('../config/server-config.json');

class AudioRouter extends EventEmitter {
    constructor(deviceManager) {
        super();
        this.deviceManager = deviceManager;
        this.routes = new Map(); // sourceId -> Set of targetIds
        this.broadcastMode = new Map(); // deviceId -> boolean
        this.mutedDevices = new Set();
        this.routingMode = CONFIG.routing.defaultMode; // 'unicast', 'broadcast', 'group'
    }

    // Set a direct route from source to target
    setRoute(sourceId, targetId) {
        // ALLOW self-routing for echo mode
        if (!this.routes.has(sourceId)) {
            this.routes.set(sourceId, new Set());
        }

        this.routes.get(sourceId).add(targetId);

        if (sourceId === targetId) {
            console.log(`🔊 ECHO MODE enabled: ${sourceId} → ${targetId} (self-echo)`);
        } else {
            console.log(`📡 Route created: ${sourceId} → ${targetId}`);
        }

        this.emit('route-created', { source: sourceId, target: targetId });
        return true;
    }

    // Set multiple routes at once
    setMultipleRoutes(sourceId, targetIds) {
        if (!Array.isArray(targetIds)) {
            targetIds = [targetIds];
        }

        // Allow self-routing in multiple routes
        this.routes.set(sourceId, new Set(targetIds));
        console.log(`📡 Multiple routes created from ${sourceId} to ${targetIds.length} devices`);

        this.emit('routes-updated', { source: sourceId, targets: targetIds });
        return true;
    }

    // Remove a specific route
    removeRoute(sourceId, targetId) {
        const routes = this.routes.get(sourceId);
        if (!routes) return false;

        routes.delete(targetId);
        if (routes.size === 0) {
            this.routes.delete(sourceId);
        }

        console.log(`❌ Route removed: ${sourceId} → ${targetId}`);
        this.emit('route-removed', { source: sourceId, target: targetId });
        return true;
    }

    // Clear all routes for a device
    clearRoutes(deviceId) {
        this.routes.delete(deviceId);
        console.log(`🧹 Cleared all routes for ${deviceId}`);
        this.emit('routes-cleared', { device: deviceId });
    }

    // Get all routes for a source device
    getRoutes(sourceId) {
        if (this.mutedDevices.has(sourceId)) {
            return []; // Device is muted
        }

        // Check broadcast mode
        if (this.broadcastMode.get(sourceId)) {
            return this.deviceManager.getOnlineDevices()
                .filter(d => d.id !== sourceId && !this.mutedDevices.has(d.id))
                .map(d => d.id);
        }

        // Check group routing
        const groups = this.deviceManager.getDeviceGroups(sourceId);
        if (groups.length > 0) {
            const groupTargets = new Set();
            groups.forEach(groupId => {
                const members = this.deviceManager.getGroupMembers(groupId);
                members.forEach(memberId => {
                    if (memberId !== sourceId && !this.mutedDevices.has(memberId)) {
                        groupTargets.add(memberId);
                    }
                });
            });

            // Combine group and direct routes
            const directRoutes = this.routes.get(sourceId) || new Set();
            return Array.from(new Set([...groupTargets, ...directRoutes]));
        }

        // Return direct routes only
        const routes = this.routes.get(sourceId);
        return routes ? Array.from(routes).filter(id => !this.mutedDevices.has(id)) : [];
    }

    // Enable broadcast mode for a device
    enableBroadcast(deviceId) {
        this.broadcastMode.set(deviceId, true);
        console.log(`📢 Broadcast mode enabled for ${deviceId}`);
        this.emit('broadcast-enabled', { device: deviceId });
    }

    // Disable broadcast mode for a device
    disableBroadcast(deviceId) {
        this.broadcastMode.set(deviceId, false);
        console.log(`🔇 Broadcast mode disabled for ${deviceId}`);
        this.emit('broadcast-disabled', { device: deviceId });
    }

    // Mute a device (no audio routing)
    muteDevice(deviceId) {
        this.mutedDevices.add(deviceId);
        console.log(`🔇 Device ${deviceId} muted`);
        this.emit('device-muted', { device: deviceId });
    }

    // Unmute a device
    unmuteDevice(deviceId) {
        this.mutedDevices.delete(deviceId);
        console.log(`🔊 Device ${deviceId} unmuted`);
        this.emit('device-unmuted', { device: deviceId });
    }

    // Create a bidirectional route (full duplex)
    createBidirectionalRoute(deviceA, deviceB) {
        this.setRoute(deviceA, deviceB);
        this.setRoute(deviceB, deviceA);
        console.log(`🔄 Bidirectional route created: ${deviceA} ↔ ${deviceB}`);
        this.emit('bidirectional-route-created', { deviceA, deviceB });
    }

    // Create a conference (all devices can hear each other)
    createConference(deviceIds) {
        if (deviceIds.length > CONFIG.routing.maxGroupSize) {
            console.warn(`Conference size ${deviceIds.length} exceeds maximum ${CONFIG.routing.maxGroupSize}`);
            return false;
        }

        deviceIds.forEach(sourceId => {
            const targets = deviceIds.filter(id => id !== sourceId);
            this.setMultipleRoutes(sourceId, targets);
        });

        console.log(`📞 Conference created with ${deviceIds.length} participants`);
        this.emit('conference-created', { participants: deviceIds });
        return true;
    }

    // Get routing matrix (for dashboard)
    getRoutingMatrix() {
        const matrix = {};
        const devices = this.deviceManager.getAllDevices();

        devices.forEach(device => {
            matrix[device.id] = {
                online: device.online,
                muted: this.mutedDevices.has(device.id),
                broadcast: this.broadcastMode.get(device.id) || false,
                routes: this.getRoutes(device.id),
                groups: this.deviceManager.getDeviceGroups(device.id)
            };
        });

        return matrix;
    }

    // Update routing based on predefined scenarios
    applyRoutingScenario(scenario) {
        console.log(`🎭 Applying routing scenario: ${scenario}`);

        switch(scenario) {
            case 'all-to-all':
                // Everyone can hear everyone (conference mode)
                const allDevices = this.deviceManager.getOnlineDevices().map(d => d.id);
                this.createConference(allDevices);
                break;

            case 'pairs':
                // Pair devices (001↔002, 003↔004, etc.)
                const devices = this.deviceManager.getOnlineDevices();
                for (let i = 0; i < devices.length - 1; i += 2) {
                    this.createBidirectionalRoute(devices[i].id, devices[i + 1].id);
                }
                break;

            case 'chain':
                // Create a chain (001→002→003→004...)
                const chainDevices = this.deviceManager.getOnlineDevices();
                for (let i = 0; i < chainDevices.length - 1; i++) {
                    this.setRoute(chainDevices[i].id, chainDevices[i + 1].id);
                }
                break;

            case 'hub':
                // First device is hub, all others connect to it
                const hubDevices = this.deviceManager.getOnlineDevices();
                if (hubDevices.length > 0) {
                    const hub = hubDevices[0].id;
                    for (let i = 1; i < hubDevices.length; i++) {
                        this.createBidirectionalRoute(hub, hubDevices[i].id);
                    }
                }
                break;

            case 'clear':
                // Clear all routes
                this.routes.clear();
                this.broadcastMode.clear();
                this.mutedDevices.clear();
                console.log('🧹 All routes cleared');
                break;

            default:
                console.warn(`Unknown routing scenario: ${scenario}`);
                return false;
        }

        this.emit('scenario-applied', { scenario });
        return true;
    }

    // Export routing configuration
    exportConfiguration() {
        return {
            routes: Array.from(this.routes.entries()).map(([source, targets]) => ({
                source,
                targets: Array.from(targets)
            })),
            broadcast: Array.from(this.broadcastMode.entries()),
            muted: Array.from(this.mutedDevices),
            mode: this.routingMode
        };
    }

    // Import routing configuration
    importConfiguration(config) {
        try {
            // Clear existing configuration
            this.routes.clear();
            this.broadcastMode.clear();
            this.mutedDevices.clear();

            // Import routes
            if (config.routes) {
                config.routes.forEach(route => {
                    this.setMultipleRoutes(route.source, route.targets);
                });
            }

            // Import broadcast settings
            if (config.broadcast) {
                config.broadcast.forEach(([deviceId, enabled]) => {
                    this.broadcastMode.set(deviceId, enabled);
                });
            }

            // Import muted devices
            if (config.muted) {
                config.muted.forEach(deviceId => {
                    this.mutedDevices.add(deviceId);
                });
            }

            // Set routing mode
            if (config.mode) {
                this.routingMode = config.mode;
            }

            console.log('✅ Routing configuration imported successfully');
            this.emit('configuration-imported', config);
            return true;
        } catch (error) {
            console.error(`❌ Failed to import configuration: ${error.message}`);
            return false;
        }
    }
}

module.exports = AudioRouter;