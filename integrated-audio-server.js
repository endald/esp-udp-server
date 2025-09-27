/**
 * Integrated Audio Server
 * Combines UDP server, enhanced dashboard with audio capabilities, and audio bridge
 * Provides complete audio testing system for ESP32 devices
 */

const UDPServer = require('./server/udp-server');
const DashboardAudioServer = require('./server/dashboard-audio-server');
const AudioBridge = require('./server/audio-bridge');

// Start the UDP server
console.log('\n════════════════════════════════════════');
console.log('🚀 Starting Integrated Audio Server...');
console.log('════════════════════════════════════════\n');

const udpServer = new UDPServer();
udpServer.start();

// Start the enhanced dashboard with audio support
const dashboardServer = new DashboardAudioServer(udpServer);
dashboardServer.start();

// Create audio bridge to connect WebSocket and UDP
const audioBridge = new AudioBridge(udpServer, dashboardServer);

console.log('\n════════════════════════════════════════');
console.log('✅ INTEGRATED AUDIO SERVER RUNNING');
console.log('════════════════════════════════════════');
console.log('📡 UDP Server: Port 5004');
console.log('🌐 Dashboard: http://YOUR_SERVER_IP:8080');
console.log('🎧 Audio Test: http://YOUR_SERVER_IP:8080/audio-test.html');
console.log('🔊 WebSocket Audio: ws://YOUR_SERVER_IP:8082');
console.log('════════════════════════════════════════\n');

console.log('Features:');
console.log('  • MP3 file streaming to ESP32 devices');
console.log('  • Browser microphone to ESP32');
console.log('  • Listen to ESP32 audio in browser');
console.log('  • Audio quality diagnostics');
console.log('  • Real-time waveform visualization');
console.log('  • Dashboard acts as virtual device "DSH"');
console.log('');

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down integrated audio server...');
    udpServer.stop();
    dashboardServer.stop();
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});