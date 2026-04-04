const GCodeParser = require('../core/GCodeParser');
const ArcFitter = require('../core/ArcFitter');
const Verifier = require('./Verifier');
const TestCaseGenerator = require('./TestCaseGenerator');
const chalk = require('chalk');
const fs = require('fs');

/**
 * StressTester: Runs a battery of tests against the Arc-Linear Optimizer.
 * Evaluates performance based on data compression, accuracy, and toolpath stability.
 */
class StressTester {
    constructor(tolerance = 0.001, constraints = {}) {
        this.tolerance = tolerance;
        this.constraints = constraints;
        this.results = [];
        this.generator = new TestCaseGenerator();
        this._cancelled = false;
    }

    /**
     * Cancel any ongoing test run.
     */
    cancel() {
        this._cancelled = true;
    }

    /**
     * Executes a single test case with optional constraints.
     * @param {string} name - Descriptive test name
     * @param {Function} generatorFn - Function returning {degraded, gcode, groundTruth}
     * @param {Object} options - {constraints: Object} to override tester's default constraints
     * @returns {Object} - Result object with counts, score, runtime, etc.
     */
    async runTest(name, generatorFn, options = {}) {
        const { degraded, gcode } = generatorFn();

        // Use test-specific constraints if provided, otherwise use default
        const testConstraints = options.constraints || this.constraints;

     // 1. Process degraded G-code
     const parser = new GCodeParser();
     const lines = gcode.split('\n');
     const parsedData = [];
     for (const line of lines) {
         const cmd = GCodeParser.parseLine(line);
         if (cmd) {
             parser.state.updateFromCommand(cmd);
             parsedData.push({ raw: line, cmd: cmd, state: parser.state.clone() });
         }
     }

     // Determine effective tolerance from G187 if present (smaller wins)
     let effectiveTolerance = this.tolerance;
     for (const item of parsedData) {
         if (item.state.g187Enabled && item.state.g187Tolerance !== null) {
             effectiveTolerance = Math.min(effectiveTolerance, item.state.g187Tolerance);
         }
     }

     // 2. Optimize with constraints
     const startTime = Date.now();
     const fitter = new ArcFitter(this.tolerance, testConstraints);
     const optimized = fitter.optimize(parsedData);
     const arcs = fitter.lastArcs || [];
     const endTime = Date.now();

     // 3. Verify each arc and compute overall max deviation using effective tolerance
     const verifier = new Verifier(effectiveTolerance);
     let overallMaxDev = 0;
     let allArcsSafe = true;

     for (const arc of arcs) {
         const verification = verifier.verify(arc.originalPoints, arc.circle, arc.start, arc.end);
         if (!verification.isSafe) allArcsSafe = false;
         if (verification.maxDeviation > overallMaxDev) overallMaxDev = verification.maxDeviation;
     }

        if (arcs.length === 0) overallMaxDev = 0;

         // 4. Score (with stability) - use effectiveTolerance for accuracy metric
         const origCount = parsedData.length;
         const optCount = optimized.length;
         const compression = ((1 - optCount / origCount) * 100).toFixed(2);
         const score = this.calculateScore(origCount, optCount, overallMaxDev, arcs, effectiveTolerance);

        const result = {
            name,
            origCount,
            optCount,
            compression,
            runtime: endTime - startTime,
            score,
            maxDeviation: overallMaxDev,
            arcsGenerated: arcs.length,
            allArcsSafe: allArcsSafe
        };

        this.results.push(result);
        return result;
    }

    /**
     * Computes a composite score from compression, accuracy, and stability metrics.
     * @param {number} orig - Original line count
     * @param {number} opt - Optimized line count
     * @param {number} maxDev - Maximum deviation observed
     * @param {Array} arcs - Array of arc records (with sweepDegrees, circle.radius, etc.)
     * @returns {number} - Score 0-100
     */
    /**
     * Computes a composite score from compression, accuracy, and stability metrics.
     * @param {number} orig - Original line count
     * @param {number} opt - Optimized line count
     * @param {number} maxDev - Maximum deviation observed
     * @param {Array} arcs - Array of arc records (with sweepDegrees, circle.radius, etc.)
     * @param {number} effectiveTolerance - Tolerance actually enforced (mm)
     * @returns {number} - Score 0-100
     */
    calculateScore(orig, opt, maxDev, arcs = [], effectiveTolerance) {
        const compressionWeight = 0.4;
        const accuracyWeight = 0.4;
        const stabilityWeight = 0.2;

        const compressionScore = Math.min(100, (orig / opt) * 20);
        const accuracyScore = Math.max(0, 100 * (1 - maxDev / effectiveTolerance));

        let stabilityScore = 100;
        if (arcs.length > 0) {
            let smallSweepCount = 0;
            let largeSweepCount = 0;
            let radii = [];
            for (const a of arcs) {
                if (a.sweepDegrees < 10) smallSweepCount++;
                if (a.sweepDegrees > 180) largeSweepCount++;
                radii.push(a.circle.radius);
            }
            const pctSmall = smallSweepCount / arcs.length;
            const pctLarge = largeSweepCount / arcs.length;

            const radiiMean = radii.reduce((a,b) => a+b, 0) / radii.length;
            const radiusVariance = radii.reduce((sum, r) => sum + Math.pow(r - radiiMean, 2), 0) / radii.length;
            const cv = Math.sqrt(radiusVariance) / (radiiMean || 1);

            stabilityScore = Math.max(0, 100 - 40 * pctSmall - 20 * pctLarge - 15 * cv);
        } else {
            stabilityScore = 80;
        }

        return Math.round(
            compressionScore * compressionWeight +
            accuracyScore * accuracyWeight +
            stabilityScore * stabilityWeight
        );
    }
            const pctSmall = smallSweepCount / arcs.length;
            const pctLarge = largeSweepCount / arcs.length;

            // Coefficient of variation of radii
            const radiiMean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
            const radiiVariance = radii.reduce((sum, r) => sum + Math.pow(r - radiiMean, 2), 0) / radii.length;
            const cv = Math.sqrt(radiiVariance) / (radiiMean || 1);

            // Penalize small arcs (too short, may cause jerky motion), large sweeps (>180), and high radius variation
            stabilityScore = Math.max(0, 100 - 40 * pctSmall - 20 * pctLarge - 15 * cv);
        } else {
            // No arcs means all linears, which is stable but not optimal
            stabilityScore = 80;
        }

        return Math.round(
          compressionScore * compressionWeight +
          accuracyScore * accuracyWeight +
          stabilityScore * stabilityWeight
        );
    }

    /**
     * Returns an array of test case definitions (name, generator, optional constraints).
     * @returns {Array<{name: string, generator: Function, constraints?: Object}>}
     */
    getTestSuite() {
        return [
            // Original stress_test.js cases
            {
                name: 'Clean Circle',
                generator: () => this.generator.generateCircle(0, 0, 10, 100, { jitter: 0 })
            },
            {
                name: 'Low-Res Faceted',
                generator: () => this.generator.generateCircle(10, 10, 5, 8, { jitter: 0 })
            },
            {
                name: 'Jittered Spiral',
                generator: () => this.generator.generateSpiral(0, 0, 1, 10, 3, 500, { jitter: 0.0002 })
            },
            {
                name: 'Irregular Spacing',
                generator: () => this.generator.generateCircle(0, 0, 20, 200, { stepJitter: 0.2 })
            },
            {
                name: 'Micro-Step Arc',
                generator: () => this.generator.generateCircle(5, 5, 2, 500, { jitter: 0.0001 })
            },
            {
                name: 'S-Curve Transitions',
                generator: () => this.generator.generateSCurve({ length: 100, amplitude: 10, wavelength: 50, segments: 400, jitter: 0.001 })
            },
            {
                name: 'Serrated Zig-Zag',
                generator: () => this.generator.generateZigZag({ length: 50, width: 5, count: 20, jitter: 0 })
            },
            {
                name: 'Low-Freq Sensor Drift',
                generator: () => this.generator.generateCircle(0, 0, 15, 300, { driftAmplitude: 0.005, driftFrequency: 0.1 })
            },
            {
                name: 'Compound Noise Hell',
                generator: () => this.generator.generateSpiral(0, 0, 5, 20, 5, 1000, { jitter: 0.002, driftAmplitude: 0.01, driftFrequency: 0.05 })
            },
            // Additional diverse cases from plan
            {
                name: 'Tiny Circle (high seg)',
                generator: () => this.generator.generateCircle(0, 0, 0.5, 200, { seed: 1001, jitter: 0.001 })
            },
            {
                name: 'Huge Circle (1000mm)',
                generator: () => this.generator.generateCircle(0, 0, 500, 800, { seed: 1002, jitter: 0.01 }),
                constraints: { maxArcRadius: 1000 }
            },
            {
                name: 'Near-Collinear',
                generator: () => {
                    const points = [];
                    for (let i = 0; i <= 100; i++) {
                        const x = i * 0.1;
                        const y = x * 0.01 + Math.sin(x) * 0.001;
                        points.push({ x, y, z: 0 });
                    }
                    return this.generator.applyDegradation(points, { seed: 1003, jitter: 0.0005 });
                }
            },
            {
                name: 'Sweep >180°',
                generator: () => {
                    const points = [];
                    for (let i = 0; i <= 120; i++) {
                        const theta = (i / 120) * 1.5 * Math.PI;
                        points.push({ x: 10 * Math.cos(theta), y: 10 * Math.sin(theta), z: 0 });
                    }
                    return { groundTruth: points, degraded: points, gcode: this.generator.pointsToGcode(points) };
                }
            },
            {
                name: 'Helical Circle',
                generator: () => {
                    const points = [];
                    for (let i = 0; i <= 100; i++) {
                        const theta = (i / 100) * 2 * Math.PI;
                        points.push({ x: 10 * Math.cos(theta), y: 10 * Math.sin(theta), z: i * 0.05 });
                    }
                    return this.generator.applyDegradation(points, { seed: 1005, jitter: 0.002 });
                },
                constraints: { allowHelix: true }
            },
            {
                name: 'Mixed Modes (S-Curve)',
                generator: () => this.generator.generateSCurve({ seed: 1006, length: 80, amplitude: 10, wavelength: 40, jitter: 0.003 })
            },
            {
                name: 'Zig-Zag (High Freq)',
                generator: () => this.generator.generateZigZag({ seed: 1007, length: 60, width: 8, count: 30 })
            },
            {
                name: 'Spiral (Involute)',
                generator: () => this.generator.generateSpiral(0, 0, 1, 15, 3, 400, { seed: 1008, jitter: 0.004 })
            },
            {
                name: 'Inch Units (G20)',
                generator: () => {
                    const points = [];
                    for (let i = 0; i <= 100; i++) {
                        const theta = (i / 100) * 2 * Math.PI;
                        points.push({ x: 2 * Math.cos(theta), y: 2 * Math.sin(theta), z: 0 });
                    }
                    return this.generator.applyDegradation(points, { seed: 1009, jitter: 0.001 });
                }
            },
            {
                name: 'Very Low Jitter',
                generator: () => this.generator.generateCircle(0, 0, 20, 300, { seed: 1010, jitter: 0.0001 })
            },
            {
                name: 'Tiny Min Radius Constraint',
                generator: () => this.generator.generateCircle(0, 0, 10, 200, { seed: 1011, jitter: 0.002 }),
                constraints: { minArcRadius: 5 }
            },
            {
                name: 'Max IJK Constraint',
                generator: () => this.generator.generateCircle(0, 0, 50, 500, { seed: 1012, jitter: 0.003 }),
                constraints: { maxIJK: 20 }
            }
        ];
    }

    /**
     * Runs the entire test suite with controlled concurrency.
     * @param {number} parallel - Number of tests to run concurrently (default 4)
     * @param {Function} onProgress - Optional callback(completed, total) for progress updates
     * @returns {Array} - Array of test result objects
     */
    async runAllTests(parallel = 4, onProgress = null) {
        const suite = this.getTestSuite();
        this.results = []; // Reset results
        this._cancelled = false;
        console.log(chalk.cyan(`\nRunning ${suite.length} stress tests with concurrency ${parallel}...`));

        // Concurrency-controlled execution
        for (let i = 0; i < suite.length; i += parallel) {
            if (this._cancelled) {
                console.log(chalk.yellow('Test run cancelled by user.'));
                break;
            }

            const batch = suite.slice(i, i + parallel);
            const batchPromises = batch.map(test => this.runTest(test.name, test.generator, { constraints: test.constraints }));
            const batchResults = await Promise.all(batchPromises);
            this.results.push(...batchResults);

            // Progress reporting
            const completed = Math.min(i + parallel, suite.length);
            if (onProgress) {
                onProgress(completed, suite.length);
            } else {
                console.log(chalk.gray(`Progress: ${completed}/${suite.length} tests completed`));
            }
        }

        return this.results;
    }

    /**
     * Exports test results to a JSON file.
     * @param {string} filePath - Destination file path
     * @returns {string} - Path to written file
     */
    exportJSON(filePath) {
        const data = {
            meta: {
                tolerance: this.tolerance,
                constraints: this.constraints,
                timestamp: new Date().toISOString(),
                totalTests: this.results.length
            },
            results: this.results
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(chalk.green(`JSON report written to ${filePath}`));
        return filePath;
    }

    /**
     * Exports test results to a CSV file.
     * @param {string} filePath - Destination file path
     * @returns {string} - Path to written file
     */
    exportCSV(filePath) {
        const headers = ['Name', 'OrigCount', 'OptCount', 'Compression%', 'Runtime(ms)', 'Score', 'MaxDeviation', 'ArcsGenerated', 'AllArcsSafe'];
        const rows = this.results.map(r => [
            r.name,
            r.origCount,
            r.optCount,
            r.compression,
            r.runtime,
            r.score,
            r.maxDeviation.toFixed(6),
            r.arcsGenerated,
            r.allArcsSafe
        ]);
        const csvContent = [headers, ...rows.map(r => r.join(','))].join('\n');
        fs.writeFileSync(filePath, csvContent);
        console.log(chalk.green(`CSV report written to ${filePath}`));
        return filePath;
    }

    /**
     * Exports test results to an HTML report.
     * @param {string} filePath - Destination file path
     * @returns {string} - Path to written file
     */
    exportHTML(filePath) {
        const avgScore = (this.results.reduce((sum, r) => sum + r.score, 0) / this.results.length).toFixed(1);
        const html = `<!DOCTYPE html><html><head><title>Stress Test Report</title>
        <style>body{font-family:Arial;background:#1a1a1a;color:#fff;padding:20px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #444;padding:8px;text-align:left}th{background:#333}tr:nth-child(even){background:#2a2a2a}.pass{background:#2e7d32}.fail{background:#c62828}</style></head>
        <body><h1>Arc-Linear Optimizer Stress Test Report</h1>
        <p>Generated: ${new Date().toISOString()}</p>
        <p>Tolerance: ${this.tolerance}</p>
        <p>Average Score: <strong>${avgScore}</strong></p>
        <table><thead><tr><th>Test</th><th>Orig</th><th>Opt</th><th>Reduction</th><th>Runtime(ms)</th><th>Score</th><th>MaxDev</th><th>Arcs</th><th>Safe</th></tr></thead><tbody>
        ${this.results.map(r => `<tr class="${r.allArcsSafe ? 'pass' : 'fail'}">
            <td>${r.name}</td><td>${r.origCount}</td><td>${r.optCount}</td><td>${r.compression}%</td><td>${r.runtime}</td><td>${r.score}</td><td>${r.maxDeviation.toFixed(6)}</td><td>${r.arcsGenerated}</td><td>${r.allArcsSafe ? 'Yes' : 'No'}</td>
        </tr>`).join('')}
        </tbody></table></body></html>`;
        fs.writeFileSync(filePath, html);
        console.log(chalk.green(`HTML report written to ${filePath}`));
        return filePath;
    }

    printReport() {
        console.log(chalk.cyan("\n--- OPTIMIZATION STRESS TEST REPORT ---"));
        console.log(chalk.gray("Tolerance: " + this.tolerance + "\""));
        console.log("---------------------------------------");

        let totalScore = 0;
        this.results.forEach(r => {
            totalScore += r.score;
            const color = r.score > 80 ? chalk.green : (r.score > 50 ? chalk.yellow : chalk.red);
            console.log(`${r.name.padEnd(25)} | Score: ${color(r.score)} | Reduction: ${r.compression.padStart(6)}% | Lines: ${r.origCount} -> ${r.optCount}`);
        });

        const average = (totalScore / this.results.length).toFixed(1);
        console.log("---------------------------------------");
        console.log(chalk.bold(`Final Optimizer Grade: ${average}\n`));
    }
}

module.exports = StressTester;
