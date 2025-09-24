const dgram = require('dgram');

console.log('🧪 Quick UDP Audio System Test');
console.log('==============================\n');

// Test 1: Check if server port is available
const testSocket = dgram.createSocket('udp4');

testSocket.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log('✅ Server appears to be running on port 5004');
    } else {
        console.log('❌ Error checking server port:', err.message);
    }
    testSocket.close();
    testPacketTransmission();
});

testSocket.bind(5004, () => {
    console.log('⚠️ Port 5004 is available - server may not be running');
    testSocket.close();
    process.exit(1);
});

function testPacketTransmission() {
    console.log('\n📤 Sending test packet...');

    const client = dgram.createSocket('udp4');

    // Build test packet
    const packet = Buffer.alloc(20);
    packet.write('TEST', 0, 4);
    packet.writeUInt16BE(1, 4);
    packet.writeUInt16BE(0x0003, 6); // Heartbeat
    packet.write('Hello UDP', 8);

    client.send(packet, 5004, '127.0.0.1', (err) => {
        if (err) {
            console.log('❌ Failed to send packet:', err.message);
        } else {
            console.log('✅ Test packet sent successfully');
        }
        client.close();

        testWebSocket();
    });
}

function testWebSocket() {
    console.log('\n🔌 Testing WebSocket connection...');

    try {
        const WebSocket = require('ws');
        const ws = new WebSocket('ws://localhost:8081');

        ws.on('open', () => {
            console.log('✅ WebSocket connected to server');
            ws.send(JSON.stringify({ type: 'ping' }));
        });

        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'pong') {
                console.log('✅ WebSocket communication working');
            }
            ws.close();
            printSummary();
        });

        ws.on('error', (err) => {
            console.log('⚠️ WebSocket not available (server may not be running)');
            printSummary();
        });

        setTimeout(() => {
            ws.close();
            printSummary();
        }, 2000);

    } catch (error) {
        console.log('❌ WebSocket test failed:', error.message);
        printSummary();
    }
}

function printSummary() {
    console.log('\n==============================');
    console.log('📊 Test Summary');
    console.log('==============================');
    console.log('If all tests passed, the system is ready!');
    console.log('\nNext steps:');
    console.log('1. Start server: npm start');
    console.log('2. Start simulators: npm run simulator');
    console.log('3. Open dashboard: http://localhost:8080');
    process.exit(0);
}