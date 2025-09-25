/**
 * Integrated UDP + Dashboard Server
 * This combines the UDP audio server with the web dashboard
 * allowing them to communicate and share data
 */

const UDPServer = require('./server/udp-server');
const DashboardServer = require('./server/dashboard-server');

// Start the UDP server
const udpServer = new UDPServer();
udpServer.start();

// Start the dashboard with reference to UDP server
const dashboard = new DashboardServer(udpServer);
dashboard.start();

console.log('\n════════════════════════════════════════');
console.log('✅ INTEGRATED SERVER RUNNING');
console.log('════════════════════════════════════════');
console.log('UDP Server: Port 5004');
console.log('Dashboard: http://YOUR_SERVER_IP:8080');
console.log('════════════════════════════════════════\n');

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down integrated server...');
    udpServer.stop();
    dashboard.stop();
    process.exit(0);
});