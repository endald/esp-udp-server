# ESP32 UDP Audio Communication System

## Overview
Production-ready UDP audio routing system for ESP32 devices with real-time Opus audio compression, dynamic routing, and web-based control dashboard.

## Features
- **Real-time Audio Streaming**: 16kHz mono audio with Opus compression
- **Dynamic Routing**: Configure audio paths between devices on-the-fly
- **Web Dashboard**: Real-time monitoring and control interface
- **Multiple Routing Modes**: Unicast, broadcast, conference, and custom routing
- **ESP32 Simulator**: Test without hardware using software simulators
- **AWS IoT Integration**: Optional certificate-based authentication
- **Load Testing**: Built-in tools for performance testing

## System Architecture

```
┌─────────────┐     UDP Audio      ┌─────────────┐
│   ESP32     │◄──────────────────►│  UDP Server │
│  Device 001 │      Port 5004     │  Port 5004  │
└─────────────┘                    └──────┬──────┘
                                          │
┌─────────────┐                           │ WebSocket
│   ESP32     │◄──────────────────────────┤ Port 8081
│  Device 002 │                           │
└─────────────┘                    ┌──────┴──────┐
                                   │  Dashboard  │
┌─────────────┐                    │  Port 8080  │
│   ESP32     │                    └─────────────┘
│  Device 003 │
└─────────────┘
```

## Quick Start

### 1. Installation
```bash
cd app
npm install
```

Or use the setup script:
```bash
cd app/scripts
setup.bat        # Windows
./setup.sh       # Linux/Mac
```

### 2. Start the System

**Option A: Start All Components**
```bash
cd app/scripts
run-all.bat      # Windows
./run-all.sh     # Linux/Mac
```

**Option B: Start Components Individually**

Terminal 1 - Server:
```bash
npm start
```

Terminal 2 - Simulators:
```bash
npm run simulator
```

Terminal 3 - Dashboard:
```bash
npm run dashboard
```

### 3. Access Dashboard
Open browser: http://localhost:8080

## Packet Format

ESP32 devices must send UDP packets with this exact structure:

```
Offset  Size  Description         Example (hex)
0       4     Device ID           30 30 31 00  ("001\0")
4       2     Sequence (BE)       00 2A        (42)
6       2     Type                00 01        (audio)
8       N     Opus frame          [compressed audio]
```

Packet Types:
- `0x0001`: Audio data
- `0x0002`: Control message
- `0x0003`: Heartbeat

## Configuration

### Server Configuration (`config/server-config.json`)
```json
{
  "udp": {
    "serverPort": 5004,        // UDP listening port
    "devicePortStart": 5005,   // Device port range start
    "maxPacketSize": 512       // Maximum UDP packet size
  },
  "audio": {
    "sampleRate": 16000,       // Audio sample rate (Hz)
    "channels": 1,             // Mono audio
    "frameDuration": 20,       // Frame size (ms)
    "opusBitrate": 24000      // Opus bitrate (bps)
  }
}
```

### AWS IoT Configuration (`config/aws-config.json`)
```json
{
  "region": "us-east-2",
  "iotEndpoint": "your-iot-endpoint.amazonaws.com",
  "certificates": "../certificates/"
}
```

## Testing

### Run ESP32 Simulators
```bash
# Basic test with 3 devices
node test/esp32-simulator.js

# Advanced options
node test/esp32-simulator.js --devices=5 --server=192.168.1.100 --verbose

# With network conditions
node test/esp32-simulator.js --loss=0.05 --jitter=20
```

### Packet Analysis
```bash
# Monitor UDP traffic
node test/packet-analyzer.js

# Custom port
node test/packet-analyzer.js --port=5004
```

### Load Testing
```bash
# Default test (10 devices, 60 seconds)
npm run load-test

# Custom parameters
node test/load-test.js --devices=20 --duration=120 --ramp-up
```

## Dashboard Features

### Device Management
- Real-time device status (online/offline)
- Packet statistics and loss rate
- Individual device muting
- Broadcast mode toggle

### Routing Control
- Visual routing matrix
- Click to create/remove routes
- Predefined scenarios:
  - **Conference Mode**: All devices hear each other
  - **Pair Mode**: Devices paired in twos
  - **Chain Mode**: Sequential audio chain
  - **Hub Mode**: Star topology with central hub

### Statistics
- Real-time packet throughput
- Bandwidth utilization
- Average latency monitoring
- Active route counting

## ESP32 Hardware Integration

### Arduino Code Structure
```cpp
// Basic packet transmission
void sendAudioPacket(uint8_t* opusData, size_t length) {
    uint8_t packet[512];

    // Device ID (4 bytes)
    memcpy(packet, "001\0", 4);

    // Sequence number (2 bytes, big-endian)
    packet[4] = (sequence >> 8) & 0xFF;
    packet[5] = sequence & 0xFF;

    // Packet type (2 bytes)
    packet[6] = 0x00;
    packet[7] = 0x01; // Audio type

    // Opus audio data
    memcpy(packet + 8, opusData, length);

    // Send UDP packet
    udp.beginPacket(SERVER_IP, SERVER_PORT);
    udp.write(packet, 8 + length);
    udp.endPacket();

    sequence++;
}
```

### Required Libraries
- WiFi.h
- WiFiUdp.h
- OpusEncoder (custom implementation needed)

## API Reference

### WebSocket API

**Get Devices**
```json
{ "type": "get-devices" }
```

**Set Route**
```json
{
  "type": "set-route",
  "source": "001",
  "target": "002"
}
```

**Enable Broadcast**
```json
{
  "type": "enable-broadcast",
  "deviceId": "001"
}
```

**Apply Scenario**
```json
{
  "type": "apply-scenario",
  "scenario": "conference"
}
```

## Performance Metrics

Expected performance with default configuration:
- **Bandwidth**: ~24 kbps per device (Opus compressed)
- **Latency**: <50ms local network, <100ms internet
- **Packet Rate**: 50 packets/second per device
- **Max Devices**: 50+ concurrent connections
- **CPU Usage**: <5% server, <2% per simulator
- **Memory**: ~50MB server, ~20MB per simulator

## Troubleshooting

### No Audio Routing
1. Check device is online in dashboard
2. Verify routes are configured
3. Check device is not muted
4. Verify firewall allows UDP port 5004

### High Packet Loss
1. Check network bandwidth
2. Reduce number of devices
3. Increase jitter buffer size
4. Check for network congestion

### Dashboard Not Updating
1. Verify WebSocket connection (port 8081)
2. Check browser console for errors
3. Ensure server is running

## Production Deployment

### Server Deployment
1. Set `NODE_ENV=production`
2. Configure proper logging
3. Set up process manager (PM2)
4. Configure firewall rules
5. Set up monitoring (optional)

### Network Configuration
- Open UDP port 5004 for audio
- Open TCP port 8081 for WebSocket
- Open TCP port 8080 for dashboard
- Configure NAT if behind router

### Security Considerations
- Enable certificate authentication
- Use VPN for internet deployment
- Implement rate limiting
- Add input validation
- Monitor for anomalies

## License
MIT

## Support
For issues or questions, please check the logs directory or run with `--verbose` flag for detailed debugging information.