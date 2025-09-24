const ESP32Simulator = require('./esp32-simulator');
const PacketAnalyzer = require('./packet-analyzer');
const fs = require('fs');
const path = require('path');

class LoadTest {
    constructor(options = {}) {
        this.deviceCount = options.deviceCount || 10;
        this.duration = options.duration || 60; // seconds
        this.serverHost = options.serverHost || '127.0.0.1';
        this.packetLoss = options.packetLoss || 0;
        this.jitter = options.jitter || 0;
        this.rampUp = options.rampUp || false;

        this.simulators = [];
        this.analyzer = null;
        this.results = {
            startTime: null,
            endTime: null,
            deviceCount: this.deviceCount,
            packetsGenerated: 0,
            packetsReceived: 0,
            errors: 0,
            peakMemory: 0,
            avgCpu: 0
        };
    }

    async run() {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🚀 UDP AUDIO SYSTEM LOAD TEST`);
        console.log(`${'='.repeat(60)}`);
        console.log(`Devices: ${this.deviceCount}`);
        console.log(`Duration: ${this.duration}s`);
        console.log(`Server: ${this.serverHost}`);
        console.log(`Packet Loss: ${(this.packetLoss * 100).toFixed(1)}%`);
        console.log(`Jitter: ${this.jitter}ms`);
        console.log(`Ramp Up: ${this.rampUp ? 'Enabled' : 'Disabled'}`);
        console.log(`${'='.repeat(60)}\n`);

        this.results.startTime = Date.now();

        // Start packet analyzer
        console.log('📡 Starting packet analyzer...');
        this.analyzer = new PacketAnalyzer(5004);
        this.analyzer.start();

        // Create and start simulators
        console.log(`🤖 Creating ${this.deviceCount} simulators...`);
        await this.createSimulators();

        // Monitor system resources
        this.startResourceMonitoring();

        // Run test for specified duration
        console.log(`⏱️ Running test for ${this.duration} seconds...`);
        await this.sleep(this.duration * 1000);

        // Stop test
        console.log('\n⏹️ Stopping test...');
        await this.stopTest();

        // Generate report
        this.generateReport();
    }

    async createSimulators() {
        for (let i = 1; i <= this.deviceCount; i++) {
            const deviceNumber = i.toString().padStart(3, '0');

            // Create simulator with test parameters
            const simulator = new ESP32Simulator(deviceNumber, {
                serverHost: this.serverHost,
                packetLoss: this.packetLoss,
                jitter: this.jitter,
                verbose: false,
                audioPattern: this.getPatternForDevice(i)
            });

            this.simulators.push(simulator);

            // Start simulator
            if (this.rampUp) {
                // Gradual ramp-up
                await this.sleep(1000);
            }

            simulator.start();
            console.log(`  ✅ Device ${deviceNumber} started`);
        }
    }

    getPatternForDevice(index) {
        const patterns = ['sine', 'square', 'sawtooth', 'noise', 'chirp'];
        return patterns[index % patterns.length];
    }

    startResourceMonitoring() {
        this.resourceInterval = setInterval(() => {
            const memUsage = process.memoryUsage();
            const memMB = memUsage.heapUsed / 1024 / 1024;

            if (memMB > this.results.peakMemory) {
                this.results.peakMemory = memMB;
            }

            // Log resource usage
            console.log(`📊 Memory: ${memMB.toFixed(2)}MB | Active Devices: ${this.simulators.filter(s => s.isTransmitting).length}`);
        }, 5000);
    }

    async stopTest() {
        this.results.endTime = Date.now();

        // Stop resource monitoring
        clearInterval(this.resourceInterval);

        // Stop all simulators
        for (const simulator of this.simulators) {
            simulator.stop();
            this.results.packetsGenerated += simulator.stats.packetsSent;
            this.results.errors += simulator.stats.errors;
        }

        // Get analyzer stats
        const analyzerStats = this.analyzer.exportStats();
        this.results.packetsReceived = analyzerStats.stats.totalPackets;

        // Stop analyzer
        this.analyzer.socket.close();
    }

    generateReport() {
        const duration = (this.results.endTime - this.results.startTime) / 1000;
        const pps = this.results.packetsGenerated / duration;
        const successRate = (this.results.packetsReceived / this.results.packetsGenerated * 100).toFixed(2);

        const report = {
            summary: {
                duration: `${duration.toFixed(1)}s`,
                devices: this.deviceCount,
                packetsGenerated: this.results.packetsGenerated,
                packetsReceived: this.results.packetsReceived,
                successRate: `${successRate}%`,
                packetsPerSecond: pps.toFixed(1),
                errors: this.results.errors,
                peakMemoryMB: this.results.peakMemory.toFixed(2)
            },
            configuration: {
                serverHost: this.serverHost,
                packetLoss: this.packetLoss,
                jitter: this.jitter,
                rampUp: this.rampUp
            },
            deviceStats: this.simulators.map(sim => ({
                id: sim.deviceNumber,
                packetsSent: sim.stats.packetsSent,
                packetsReceived: sim.stats.packetsReceived,
                errors: sim.stats.errors
            })),
            timestamp: new Date().toISOString()
        };

        // Print report
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📈 LOAD TEST REPORT`);
        console.log(`${'='.repeat(60)}`);
        console.log(`Duration: ${report.summary.duration}`);
        console.log(`Devices: ${report.summary.devices}`);
        console.log(`Packets Generated: ${report.summary.packetsGenerated}`);
        console.log(`Packets Received: ${report.summary.packetsReceived}`);
        console.log(`Success Rate: ${report.summary.successRate}`);
        console.log(`Throughput: ${report.summary.packetsPerSecond} pps`);
        console.log(`Errors: ${report.summary.errors}`);
        console.log(`Peak Memory: ${report.summary.peakMemoryMB} MB`);
        console.log(`${'='.repeat(60)}\n`);

        // Save report to file
        const reportPath = path.join(__dirname, `../logs/load-test-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`📁 Report saved to: ${reportPath}`);

        return report;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run load test if executed directly
if (require.main === module) {
    const args = process.argv.slice(2);

    const options = {
        deviceCount: parseInt(args.find(a => a.startsWith('--devices='))?.split('=')[1] || '10'),
        duration: parseInt(args.find(a => a.startsWith('--duration='))?.split('=')[1] || '60'),
        serverHost: args.find(a => a.startsWith('--server='))?.split('=')[1] || '127.0.0.1',
        packetLoss: parseFloat(args.find(a => a.startsWith('--loss='))?.split('=')[1] || '0'),
        jitter: parseFloat(args.find(a => a.startsWith('--jitter='))?.split('=')[1] || '0'),
        rampUp: args.includes('--ramp-up')
    };

    const test = new LoadTest(options);

    test.run().catch(error => {
        console.error('❌ Load test failed:', error);
        process.exit(1);
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log('\n⚠️ Test interrupted');
        process.exit(0);
    });
}

module.exports = LoadTest;