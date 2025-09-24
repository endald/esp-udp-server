// WebSocket connection
let ws = null;
let wsReconnectInterval = null;

// Application state
const state = {
    devices: new Map(),
    routes: new Map(),
    stats: {},
    selectedDevice: null,
    contextMenuDevice: null
};

// Initialize application
function init() {
    connectWebSocket();
    setupEventListeners();
    startUpdateLoop();
}

// WebSocket connection management
function connectWebSocket() {
    const wsUrl = 'ws://localhost:8081';

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('Connected to server');
            document.getElementById('serverStatus').classList.add('connected');
            document.getElementById('serverAddress').textContent = wsUrl;

            // Request initial state
            ws.send(JSON.stringify({ type: 'get-devices' }));
            ws.send(JSON.stringify({ type: 'get-routes' }));
            ws.send(JSON.stringify({ type: 'get-stats' }));

            // Clear reconnect interval
            if (wsReconnectInterval) {
                clearInterval(wsReconnectInterval);
                wsReconnectInterval = null;
            }

            addLog('Connected to server', 'success');
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
        };

        ws.onclose = () => {
            console.log('Disconnected from server');
            document.getElementById('serverStatus').classList.remove('connected');
            document.getElementById('serverAddress').textContent = 'Disconnected';
            addLog('Disconnected from server', 'error');

            // Attempt to reconnect
            if (!wsReconnectInterval) {
                wsReconnectInterval = setInterval(() => {
                    console.log('Attempting to reconnect...');
                    connectWebSocket();
                }, 5000);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            addLog('Connection error', 'error');
        };

    } catch (error) {
        console.error('Failed to connect:', error);
        addLog('Failed to connect to server', 'error');
    }
}

// Handle WebSocket messages
function handleWebSocketMessage(message) {
    switch(message.type) {
        case 'initial-state':
            updateDevices(message.devices);
            updateRoutes(message.routes);
            updateStats(message.stats);
            break;

        case 'devices':
            updateDevices(message.devices);
            break;

        case 'routes':
            updateRoutes(message.routes);
            break;

        case 'stats':
            updateStats(message.stats);
            break;

        case 'device-connected':
            addDevice(message.device);
            addLog(`Device ${message.device.id} connected`, 'success');
            break;

        case 'device-disconnected':
            updateDeviceStatus(message.deviceId, false);
            addLog(`Device ${message.deviceId} disconnected`, 'warning');
            break;

        case 'route-created':
            addLog(`Route created: ${message.source} → ${message.target}`, 'info');
            requestRoutes();
            break;

        case 'route-removed':
            addLog(`Route removed: ${message.source} → ${message.target}`, 'info');
            requestRoutes();
            break;

        case 'packets':
            updatePacketFlow(message.packets);
            break;

        case 'error':
            addLog(`Error: ${message.message}`, 'error');
            break;
    }
}

// Update devices display
function updateDevices(devices) {
    const grid = document.getElementById('devicesGrid');
    grid.innerHTML = '';

    devices.forEach(device => {
        state.devices.set(device.id, device);

        const card = document.createElement('div');
        card.className = `device-card ${device.online ? 'online' : 'offline'}`;
        card.dataset.deviceId = device.id;

        card.innerHTML = `
            <div class="device-id">${device.id}</div>
            <div class="device-status">${device.online ? 'Online' : 'Offline'}</div>
            <div class="device-stats">
                <div>Packets: ${device.packetsReceived || 0}</div>
                <div>Loss: ${device.packetLossRate || 0}%</div>
            </div>
        `;

        card.addEventListener('click', (e) => selectDevice(device.id, e));
        card.addEventListener('contextmenu', (e) => showDeviceMenu(device.id, e));

        grid.appendChild(card);
    });

    updateRoutingMatrix();
}

// Update routing matrix
function updateRoutingMatrix() {
    const container = document.getElementById('routingMatrix');
    const devices = Array.from(state.devices.values());

    if (devices.length === 0) {
        container.innerHTML = '<p>No devices connected</p>';
        return;
    }

    let html = '<table class="routing-table"><thead><tr><th>From \\ To</th>';

    // Header row
    devices.forEach(device => {
        html += `<th>${device.id}</th>`;
    });
    html += '</tr></thead><tbody>';

    // Data rows
    devices.forEach(fromDevice => {
        html += `<tr><th>${fromDevice.id}</th>`;

        devices.forEach(toDevice => {
            const isActive = isRouteActive(fromDevice.id, toDevice.id);
            const cellClass = fromDevice.id === toDevice.id ? 'disabled' : 'route-cell';
            const activeClass = isActive ? 'route-active' : '';

            html += `<td class="${cellClass} ${activeClass}"
                        data-from="${fromDevice.id}"
                        data-to="${toDevice.id}"
                        onclick="toggleRoute('${fromDevice.id}', '${toDevice.id}')">
                     ${fromDevice.id === toDevice.id ? '-' : ''}
                     </td>`;
        });

        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// Check if route is active
function isRouteActive(from, to) {
    const routes = state.routes.get(from);
    return routes && routes.routes && routes.routes.includes(to);
}

// Update routes
function updateRoutes(routes) {
    Object.entries(routes).forEach(([deviceId, routeInfo]) => {
        state.routes.set(deviceId, routeInfo);
    });

    updateRoutingMatrix();
    updateActiveRoutesCount();
}

// Update statistics
function updateStats(stats) {
    state.stats = stats;

    if (stats.packetsRouted !== undefined) {
        document.getElementById('serverPackets').textContent = stats.packetsRouted;
    }

    if (stats.bytesTransmitted !== undefined) {
        const kbps = (stats.bytesTransmitted / 1024).toFixed(2);
        document.getElementById('bandwidth').textContent = `${kbps} KB`;
    }
}

// Device selection
function selectDevice(deviceId, event) {
    event.preventDefault();
    state.selectedDevice = deviceId;

    // Open route configuration modal
    openRouteModal(deviceId);
}

// Show device context menu
function showDeviceMenu(deviceId, event) {
    event.preventDefault();

    state.contextMenuDevice = deviceId;
    const menu = document.getElementById('deviceMenu');

    // Update menu items based on device state
    const device = state.devices.get(deviceId);
    const routes = state.routes.get(deviceId);

    if (routes && routes.muted) {
        document.getElementById('muteText').textContent = 'Unmute';
    } else {
        document.getElementById('muteText').textContent = 'Mute';
    }

    if (routes && routes.broadcast) {
        document.getElementById('broadcastText').textContent = 'Disable Broadcast';
    } else {
        document.getElementById('broadcastText').textContent = 'Enable Broadcast';
    }

    // Position and show menu
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;
    menu.classList.add('visible');

    // Hide menu on click outside
    document.addEventListener('click', hideContextMenu);
}

// Hide context menu
function hideContextMenu() {
    document.getElementById('deviceMenu').classList.remove('visible');
    document.removeEventListener('click', hideContextMenu);
}

// Toggle route
function toggleRoute(from, to) {
    if (from === to) return;

    if (isRouteActive(from, to)) {
        sendCommand('remove-route', { source: from, target: to });
    } else {
        sendCommand('set-route', { source: from, target: to });
    }
}

// Route modal functions
function openRouteModal(deviceId) {
    const modal = document.getElementById('routeModal');
    const fromSpan = document.getElementById('routeFrom');
    const toSelect = document.getElementById('routeTo');

    fromSpan.textContent = deviceId;

    // Populate target devices
    toSelect.innerHTML = '';
    state.devices.forEach(device => {
        if (device.id !== deviceId) {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = `${device.id} (${device.online ? 'Online' : 'Offline'})`;
            toSelect.appendChild(option);
        }
    });

    modal.classList.add('visible');
}

function closeRouteModal() {
    document.getElementById('routeModal').classList.remove('visible');
}

function createRoute() {
    const from = document.getElementById('routeFrom').textContent;
    const to = document.getElementById('routeTo').value;
    const type = document.querySelector('input[name="routeType"]:checked').value;

    if (type === 'bidirectional') {
        sendCommand('create-bidirectional', { deviceA: from, deviceB: to });
    } else {
        sendCommand('set-route', { source: from, target: to });
    }

    closeRouteModal();
}

// Stats modal functions
function viewDeviceStats() {
    const deviceId = state.contextMenuDevice;
    const device = state.devices.get(deviceId);

    if (!device) return;

    const modal = document.getElementById('statsModal');
    const deviceSpan = document.getElementById('statsDeviceId');
    const content = document.getElementById('deviceStatsContent');

    deviceSpan.textContent = deviceId;

    content.innerHTML = `
        <div class="stat-item">
            <div class="label">Status</div>
            <div class="value">${device.online ? 'Online' : 'Offline'}</div>
        </div>
        <div class="stat-item">
            <div class="label">Address</div>
            <div class="value">${device.address}:${device.port}</div>
        </div>
        <div class="stat-item">
            <div class="label">Packets Received</div>
            <div class="value">${device.packetsReceived || 0}</div>
        </div>
        <div class="stat-item">
            <div class="label">Packet Loss</div>
            <div class="value">${device.packetLossRate || 0}%</div>
        </div>
        <div class="stat-item">
            <div class="label">Average Jitter</div>
            <div class="value">${device.avgJitter || 0}ms</div>
        </div>
        <div class="stat-item">
            <div class="label">Uptime</div>
            <div class="value">${device.uptime || 0}s</div>
        </div>
    `;

    modal.classList.add('visible');
    hideContextMenu();
}

function closeStatsModal() {
    document.getElementById('statsModal').classList.remove('visible');
}

// Context menu actions
function toggleMute() {
    const deviceId = state.contextMenuDevice;
    const routes = state.routes.get(deviceId);

    if (routes && routes.muted) {
        sendCommand('unmute-device', { deviceId });
    } else {
        sendCommand('mute-device', { deviceId });
    }

    hideContextMenu();
}

function toggleBroadcast() {
    const deviceId = state.contextMenuDevice;
    const routes = state.routes.get(deviceId);

    if (routes && routes.broadcast) {
        sendCommand('disable-broadcast', { deviceId });
    } else {
        sendCommand('enable-broadcast', { deviceId });
    }

    hideContextMenu();
}

function clearDeviceRoutes() {
    const deviceId = state.contextMenuDevice;
    // Clear all routes for this device
    state.devices.forEach(device => {
        if (device.id !== deviceId) {
            sendCommand('remove-route', { source: deviceId, target: device.id });
            sendCommand('remove-route', { source: device.id, target: deviceId });
        }
    });
    hideContextMenu();
}

// Apply routing scenario
function applyScenario(scenario) {
    sendCommand('apply-scenario', { scenario });
    addLog(`Applied ${scenario} routing scenario`, 'info');
}

// Send command to server
function sendCommand(type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...data }));
    } else {
        addLog('Not connected to server', 'error');
    }
}

// Request data from server
function requestRoutes() {
    sendCommand('get-routes');
}

// Update active routes count
function updateActiveRoutesCount() {
    let count = 0;
    state.routes.forEach(routeInfo => {
        if (routeInfo.routes) {
            count += routeInfo.routes.length;
        }
    });
    document.getElementById('activeRoutes').textContent = count;
}

// Add log entry
function addLog(message, type = 'info') {
    const log = document.getElementById('activityLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-timestamp">${timestamp}</span>${message}`;

    log.insertBefore(entry, log.firstChild);

    // Keep only last 100 entries
    while (log.children.length > 100) {
        log.removeChild(log.lastChild);
    }
}

// Update packet flow visualization
function updatePacketFlow(packets) {
    // Update packet counters for devices
    packets.forEach(packet => {
        const deviceCard = document.querySelector(`[data-device-id="${packet.deviceId}"]`);
        if (deviceCard) {
            // Add visual feedback for packet activity
            deviceCard.style.borderColor = '#3498db';
            setTimeout(() => {
                const device = state.devices.get(packet.deviceId);
                if (device && device.online) {
                    deviceCard.style.borderColor = '#27ae60';
                }
            }, 100);
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    // Close modals on outside click
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('visible');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeRouteModal();
            closeStatsModal();
            hideContextMenu();
        }
    });
}

// Update loop for real-time stats
function startUpdateLoop() {
    setInterval(() => {
        // Request updated stats
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendCommand('get-stats');
        }

        // Update latency display (mock for now)
        const latency = Math.floor(Math.random() * 20 + 10);
        document.getElementById('latency').textContent = `${latency} ms`;

        // Update bandwidth calculation
        if (state.stats.bytesTransmitted) {
            const kbps = ((state.stats.bytesTransmitted / 1024) /
                         ((Date.now() - state.stats.startTime) / 1000)).toFixed(2);
            document.getElementById('bandwidth').textContent = `${kbps} KB/s`;
        }
    }, 2000);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);