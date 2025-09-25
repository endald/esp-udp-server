/**
 * Dashboard HTTP Server
 * Serves the dashboard HTML and provides real-time stats
 * Runs alongside the UDP server on port 8080
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

class DashboardServer {
    constructor(udpServer) {
        this.udpServer = udpServer;
        this.httpServer = null;
        this.port = 8080;
    }

    start() {
        this.httpServer = http.createServer((req, res) => {
            // Handle different routes
            if (req.url === '/' || req.url === '/index.html') {
                this.serveDashboard(res);
            } else if (req.url === '/api/stats') {
                this.serveStats(res);
            } else if (req.url === '/api/devices') {
                this.serveDevices(res);
            } else if (req.url === '/api/route' && req.method === 'POST') {
                this.handleRouteUpdate(req, res);
            } else if (req.url === '/api/route/clear' && req.method === 'POST') {
                this.handleClearRoutes(req, res);
            } else if (req.url.startsWith('/dashboard/')) {
                this.serveStaticFile(req, res);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.httpServer.listen(this.port, '0.0.0.0', () => {
            console.log(`📊 Dashboard HTTP server running on port ${this.port}`);
            console.log(`🌐 Access dashboard at: http://YOUR_SERVER_IP:${this.port}`);
        });
    }

    serveDashboard(res) {
        // Try to serve the actual dashboard file if it exists
        const dashboardPath = path.join(__dirname, '..', 'dashboard', 'index.html');

        if (fs.existsSync(dashboardPath)) {
            const html = fs.readFileSync(dashboardPath, 'utf8');
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(html);
        } else {
            // Serve a simple fallback dashboard
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(this.getFallbackDashboard());
        }
    }

    serveStaticFile(req, res) {
        const filePath = path.join(__dirname, '..', req.url);

        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath);
            const contentType = {
                '.js': 'application/javascript',
                '.css': 'text/css',
                '.html': 'text/html'
            }[ext] || 'text/plain';

            res.writeHead(200, {'Content-Type': contentType});
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404);
            res.end('File not found');
        }
    }

    serveStats(res) {
        const stats = this.udpServer ? {
            uptime: Math.floor((Date.now() - this.udpServer.stats.startTime) / 1000),
            packetsReceived: this.udpServer.stats.packetsReceived,
            packetsRouted: this.udpServer.stats.packetsRouted,
            packetsDropped: this.udpServer.stats.packetsDropped,
            bytesReceived: this.udpServer.stats.bytesReceived,
            bytesTransmitted: this.udpServer.stats.bytesTransmitted
        } : {};

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(stats));
    }

    serveDevices(res) {
        const devices = this.udpServer && this.udpServer.deviceManager ?
            this.udpServer.deviceManager.getOnlineDevices() : [];

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(devices));
    }

    handleRouteUpdate(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const { from, to, enable } = JSON.parse(body);

                if (this.udpServer && this.udpServer.audioRouter) {
                    if (enable) {
                        // Enable route (including self-echo if from === to)
                        this.udpServer.audioRouter.setRoute(from, to);
                        console.log(`✅ Route enabled: ${from} → ${to}${from === to ? ' (ECHO MODE)' : ''}`);
                    } else {
                        // Disable route
                        this.udpServer.audioRouter.removeRoute(from, to);
                        console.log(`❌ Route disabled: ${from} → ${to}`);
                    }
                }

                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Route update error:', error);
                res.writeHead(400, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleClearRoutes(req, res) {
        if (this.udpServer && this.udpServer.audioRouter) {
            this.udpServer.audioRouter.clearAllRoutes();
            console.log('🗑️ All routes cleared');
        }

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: true }));
    }

    getFallbackDashboard() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>ESP32 Audio Routing Control Dashboard</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Courier New', monospace;
            background: #0a0a0a;
            color: #00ff00;
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        h1 {
            text-align: center;
            font-size: 2em;
            margin-bottom: 30px;
            text-shadow: 0 0 10px #00ff00;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.8; }
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: #111;
            border: 1px solid #00ff00;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 0 20px rgba(0, 255, 0, 0.1);
        }

        .stat-label {
            font-size: 0.9em;
            opacity: 0.7;
            margin-bottom: 5px;
        }

        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
        }

        .devices-section {
            background: #111;
            border: 1px solid #00ff00;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }

        .device-list {
            margin-top: 15px;
        }

        .device-item {
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .device-online {
            border-color: #00ff00;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
        }

        .device-offline {
            border-color: #ff0000;
            opacity: 0.6;
        }

        .status-indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 10px;
            animation: blink 1s infinite;
        }

        .status-online {
            background: #00ff00;
            box-shadow: 0 0 10px #00ff00;
        }

        .status-offline {
            background: #ff0000;
        }

        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .info-section {
            background: #111;
            border: 1px solid #00ff00;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
        }

        .server-info {
            margin: 10px 0;
            font-size: 1.1em;
        }

        .refresh-notice {
            margin-top: 20px;
            opacity: 0.7;
            font-size: 0.9em;
        }

        .routing-section {
            background: #111;
            border: 1px solid #00ff00;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }

        .routing-controls {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .routing-controls button {
            background: #1a1a1a;
            color: #00ff00;
            border: 1px solid #00ff00;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
            transition: all 0.3s;
        }

        .routing-controls button:hover {
            background: #00ff00;
            color: #000;
            box-shadow: 0 0 10px #00ff00;
        }

        .routing-matrix {
            display: grid;
            gap: 10px;
            margin-top: 20px;
        }

        .route-row {
            display: grid;
            grid-template-columns: 100px 1fr;
            align-items: center;
            gap: 20px;
            padding: 10px;
            background: #1a1a1a;
            border-radius: 4px;
        }

        .route-source {
            font-weight: bold;
            color: #00ff00;
        }

        .route-targets {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .route-target {
            background: #222;
            border: 1px solid #444;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.3s;
        }

        .route-target.active {
            background: #00ff00;
            color: #000;
            border-color: #00ff00;
            box-shadow: 0 0 5px #00ff00;
        }

        .echo-mode {
            background: #1a1a1a;
            border: 2px solid #ffff00;
            padding: 15px;
            margin: 20px 0;
            border-radius: 8px;
            text-align: center;
        }

        .echo-mode.active {
            box-shadow: 0 0 20px #ffff00;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 ESP32 Audio Routing Control</h1>

        <div class="stats-grid" id="stats">
            <div class="stat-card">
                <div class="stat-label">Server Status</div>
                <div class="stat-value">🟢 ONLINE</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Uptime</div>
                <div class="stat-value" id="uptime">0s</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Packets Received</div>
                <div class="stat-value" id="packets">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Data Received</div>
                <div class="stat-value" id="data">0 KB</div>
            </div>
        </div>

        <div class="devices-section">
            <h2>📡 Connected Devices</h2>
            <div class="device-list" id="devices">
                <div class="device-item device-offline">
                    <span>No devices connected</span>
                    <span class="status-indicator status-offline"></span>
                </div>
            </div>
        </div>

        <div class="routing-section">
            <h2>🔊 Audio Routing Control</h2>
            <div class="routing-controls">
                <button onclick="setEchoMode('001')">Device 001 → Echo to Self</button>
                <button onclick="setRoute('001', '002')">001 → 002</button>
                <button onclick="setRoute('002', '001')">002 → 001</button>
                <button onclick="setBidirectional('001', '002')">001 ↔ 002</button>
                <button onclick="clearAllRoutes()">Clear All Routes</button>
            </div>

            <div id="echo-status" class="echo-mode">
                <strong>Echo Mode:</strong> <span id="echo-text">Disabled</span>
            </div>

            <div class="routing-matrix" id="routes">
                <div class="route-row">
                    <div class="route-source">Device 001:</div>
                    <div class="route-targets" id="routes-001">
                        <span class="route-target" onclick="toggleRoute('001', '001')">To Self (Echo)</span>
                        <span class="route-target" onclick="toggleRoute('001', '002')">To 002</span>
                        <span class="route-target" onclick="toggleRoute('001', '003')">To 003</span>
                    </div>
                </div>
                <div class="route-row">
                    <div class="route-source">Device 002:</div>
                    <div class="route-targets" id="routes-002">
                        <span class="route-target" onclick="toggleRoute('002', '001')">To 001</span>
                        <span class="route-target" onclick="toggleRoute('002', '002')">To Self (Echo)</span>
                        <span class="route-target" onclick="toggleRoute('002', '003')">To 003</span>
                    </div>
                </div>
                <div class="route-row">
                    <div class="route-source">Device 003:</div>
                    <div class="route-targets" id="routes-003">
                        <span class="route-target" onclick="toggleRoute('003', '001')">To 001</span>
                        <span class="route-target" onclick="toggleRoute('003', '002')">To 002</span>
                        <span class="route-target" onclick="toggleRoute('003', '003')">To Self (Echo)</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="info-section">
            <h2>Server Information</h2>
            <div class="server-info">
                <strong>UDP Port:</strong> 5004<br>
                <strong>Server IP:</strong> 138.197.73.48<br>
                <strong>Dashboard Port:</strong> 8080
            </div>
            <div class="refresh-notice">
                Auto-refreshing every 2 seconds...
            </div>
        </div>
    </div>

    <script>
        // Store current routing configuration
        let currentRoutes = {};

        // Auto-refresh stats
        async function updateStats() {
            try {
                const statsRes = await fetch('/api/stats');
                const stats = await statsRes.json();

                document.getElementById('uptime').textContent = formatUptime(stats.uptime || 0);
                document.getElementById('packets').textContent = (stats.packetsReceived || 0).toLocaleString();
                document.getElementById('data').textContent = ((stats.bytesReceived || 0) / 1024).toFixed(2) + ' KB';

                const devicesRes = await fetch('/api/devices');
                const devices = await devicesRes.json();

                const devicesHtml = devices.length > 0 ? devices.map(device => \`
                    <div class="device-item device-online">
                        <span>
                            <span class="status-indicator status-online"></span>
                            Device \${device.id} - \${device.address}:\${device.port}
                        </span>
                        <span>\${device.packetsReceived || 0} packets</span>
                    </div>
                \`).join('') : \`
                    <div class="device-item device-offline">
                        <span>No devices connected</span>
                        <span class="status-indicator status-offline"></span>
                    </div>
                \`;

                document.getElementById('devices').innerHTML = devicesHtml;
            } catch (error) {
                console.error('Failed to update stats:', error);
            }
        }

        function formatUptime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            if (hours > 0) {
                return \`\${hours}h \${minutes}m\`;
            } else if (minutes > 0) {
                return \`\${minutes}m \${secs}s\`;
            } else {
                return \`\${secs}s\`;
            }
        }

        // Routing control functions
        function setEchoMode(deviceId) {
            console.log(\`Setting echo mode for device \${deviceId}\`);
            currentRoutes[deviceId] = [deviceId];
            updateRouteDisplay();
            sendRouteUpdate(deviceId, deviceId, true);

            document.getElementById('echo-status').classList.add('active');
            document.getElementById('echo-text').textContent = \`Active for Device \${deviceId}\`;
        }

        function setRoute(from, to) {
            console.log(\`Setting route from \${from} to \${to}\`);
            currentRoutes[from] = [to];
            updateRouteDisplay();
            sendRouteUpdate(from, to, true);
        }

        function setBidirectional(device1, device2) {
            console.log(\`Setting bidirectional route between \${device1} and \${device2}\`);
            currentRoutes[device1] = [device2];
            currentRoutes[device2] = [device1];
            updateRouteDisplay();
            sendRouteUpdate(device1, device2, true);
            sendRouteUpdate(device2, device1, true);
        }

        function toggleRoute(from, to) {
            if (!currentRoutes[from]) currentRoutes[from] = [];

            const index = currentRoutes[from].indexOf(to);
            if (index > -1) {
                currentRoutes[from].splice(index, 1);
                sendRouteUpdate(from, to, false);
            } else {
                currentRoutes[from].push(to);
                sendRouteUpdate(from, to, true);
            }

            updateRouteDisplay();

            // Update echo status if it's a self-route
            if (from === to) {
                const hasEcho = currentRoutes[from] && currentRoutes[from].includes(from);
                document.getElementById('echo-status').classList.toggle('active', hasEcho);
                document.getElementById('echo-text').textContent = hasEcho ?
                    \`Active for Device \${from}\` : 'Disabled';
            }
        }

        function clearAllRoutes() {
            console.log('Clearing all routes');
            currentRoutes = {};
            updateRouteDisplay();
            sendClearAllRoutes();

            document.getElementById('echo-status').classList.remove('active');
            document.getElementById('echo-text').textContent = 'Disabled';
        }

        function updateRouteDisplay() {
            // Update route targets visual state
            ['001', '002', '003'].forEach(source => {
                ['001', '002', '003'].forEach(target => {
                    const element = document.querySelector(\`#routes-\${source} .route-target:nth-child(\${
                        target === '001' ? 1 : target === '002' ? 2 : 3
                    })\`);

                    if (element) {
                        const isActive = currentRoutes[source] && currentRoutes[source].includes(target);
                        element.classList.toggle('active', isActive);
                    }
                });
            });
        }

        // Send routing updates to server
        async function sendRouteUpdate(from, to, enable) {
            try {
                const response = await fetch('/api/route', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from, to, enable })
                });

                if (!response.ok) {
                    console.error('Failed to update route');
                }
            } catch (error) {
                console.error('Error sending route update:', error);
            }
        }

        async function sendClearAllRoutes() {
            try {
                const response = await fetch('/api/route/clear', {
                    method: 'POST'
                });

                if (!response.ok) {
                    console.error('Failed to clear routes');
                }
            } catch (error) {
                console.error('Error clearing routes:', error);
            }
        }

        // Update immediately and then every 2 seconds
        updateStats();
        setInterval(updateStats, 2000);
    </script>
</body>
</html>
        `;
    }

    stop() {
        if (this.httpServer) {
            this.httpServer.close();
            console.log('Dashboard server stopped');
        }
    }
}

// Export for use with the main UDP server
module.exports = DashboardServer;

// If run directly, start a standalone dashboard server
if (require.main === module) {
    const dashboard = new DashboardServer(null);
    dashboard.start();

    console.log('\n════════════════════════════════════════');
    console.log('📊 STANDALONE DASHBOARD SERVER RUNNING');
    console.log('════════════════════════════════════════');
    console.log('This is a basic dashboard without real-time data.');
    console.log('For full functionality, integrate with udp-server.js');
    console.log('════════════════════════════════════════\n');
}