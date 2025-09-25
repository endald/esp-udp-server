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

    getFallbackDashboard() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>ESP32 UDP Audio Server Dashboard</title>
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
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 ESP32 UDP Audio Server</h1>

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

        <div class="info-section">
            <h2>Server Information</h2>
            <div class="server-info">
                <strong>UDP Port:</strong> 5004<br>
                <strong>Server IP:</strong> ${require('os').networkInterfaces().eth0?.[0]?.address || 'YOUR_SERVER_IP'}<br>
                <strong>Dashboard Port:</strong> 8080
            </div>
            <div class="refresh-notice">
                Auto-refreshing every 2 seconds...
            </div>
        </div>
    </div>

    <script>
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