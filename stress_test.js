const StressTester = require('./src/sim/StressTester');
const TestCaseGenerator = require('./src/sim/TestCaseGenerator');
const chalk = require('chalk');

/**
 * CLI Entry Point for Automated Stress Testing & Scoring.
 */
async function main() {
    const tester = new StressTester(0.001);
    const generator = new TestCaseGenerator();

    console.log(chalk.bold.blue("\n🚀 INITIALIZING AUTOMATED STRESS TEST SUITE...\n"));

    // Case 1: Clean High-Res Circle (Ideal Scenario)
    await tester.runTest("Clean Circle", () => 
        generator.generateCircle(0, 0, 10, 100, { jitter: 0 })
    );

    // Case 2: Low-Resolution Faceted Arc (CAM Edge Case)
    await tester.runTest("Low-Res Faceted", () => 
        generator.generateCircle(10, 10, 5, 8, { jitter: 0 })
    );

    // Case 3: High-Density Jittered Spiral (Precision Stress)
    await tester.runTest("Jittered Spiral", () => 
        generator.generateSpiral(0, 0, 1, 10, 3, 500, { jitter: 0.0002 })
    );

    // Case 4: Irregular Point Spacing (Data Starvation simulation)
    await tester.runTest("Irregular Spacing", () => 
        generator.generateCircle(0, 0, 20, 200, { stepJitter: 0.2 })
    );

    // Case 5: Micro-Step Data (Buffer Overload simulation)
    await tester.runTest("Micro-Step Arc", () => 
        generator.generateCircle(5, 5, 2, 500, { jitter: 0.0001 })
    );

    // Case 6: Inflecting S-Curve (Direction Changes)
    await tester.runTest("S-Curve Transitions", () =>
        generator.generateSCurve({ length: 100, amplitude: 10, wavelength: 50, segments: 400, jitter: 0.001 })
    );

    // Case 7: Serrated Zig-Zag (Non-Arc Geometry Rejection)
    await tester.runTest("Serrated Zig-Zag", () =>
        generator.generateZigZag({ length: 50, width: 5, count: 20, jitter: 0 })
    );

    // Case 8: Sensor Drift (Low-frequency sinusoidal error)
    await tester.runTest("Low-Freq Sensor Drift", () =>
        generator.generateCircle(0, 0, 15, 300, { driftAmplitude: 0.005, driftFrequency: 0.1 })
    );

    // Case 9: Compound Noise (Vibration + Drift + Micro-steps)
    await tester.runTest("Compound Noise Hell", () =>
        generator.generateSpiral(0, 0, 5, 20, 5, 1000, { jitter: 0.002, driftAmplitude: 0.01, driftFrequency: 0.05 })
    );

    tester.printReport();
}

main().catch(err => {
    console.error(chalk.red("\n❌ Stress Test Failed: " + err.message));
});
