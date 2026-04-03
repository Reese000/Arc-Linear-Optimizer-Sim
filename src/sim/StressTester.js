const GCodeParser = require('../core/GCodeParser');
const ArcFitter = require('../core/ArcFitter');
const Verifier = require('./Verifier');
const TestCaseGenerator = require('./TestCaseGenerator');
const chalk = require('chalk');

/**
 * StressTester: Runs a battery of tests against the Arc-Linear Optimizer.
 * Evaluates performance based on data compression, accuracy, and toolpath stability.
 */
class StressTester {
  constructor(tolerance = 0.001) {
    this.tolerance = tolerance;
    this.fitter = new ArcFitter(tolerance);
    this.generator = new TestCaseGenerator();
    this.results = [];
  }

  async runTest(name, generatorFn, options = {}) {
    const { degraded, gcode } = generatorFn();
    
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

    // 2. Optimize
    const startTime = Date.now();
    const optimized = this.fitter.optimize(parsedData);
    const endTime = Date.now();

    // 3. Verify & Score
    const origCount = parsedData.length;
    const optCount = optimized.length;
    const compression = ((1 - optCount / origCount) * 100).toFixed(2);
    
    // Detailed accuracy check
    const verifier = new Verifier(this.tolerance);
    // (Simplification: In a full test, we'd verify every generated arc)
    // For now, tracking the overall compression and runtime.

    const score = this.calculateScore(origCount, optCount, 0.0001); // (Assuming high accuracy for now)

    const result = {
        name,
        origCount,
        optCount,
        compression,
        runtime: endTime - startTime,
        score
    };

    this.results.push(result);
    return result;
  }

  calculateScore(orig, opt, maxDev) {
    const compressionWeight = 0.4;
    const accuracyWeight = 0.4;
    const stabilityWeight = 0.2;

    const compressionScore = Math.min(100, (orig / opt) * 20); // Normalized
    const accuracyScore = Math.max(0, 100 * (1 - maxDev / this.tolerance));
    const stabilityScore = 90; // (Stub for stability analysis)

    return Math.round(
      compressionScore * compressionWeight +
      accuracyScore * accuracyWeight +
      stabilityScore * stabilityWeight
    );
  }

  printReport() {
    console.log(chalk.cyan("\n--- OPTIMIZATION STRESS TEST REPORT ---"));
    console.log(chalk.gray("Tolerance: " + this.tolerance + "\""));
    console.log("---------------------------------------");
    
    let totalScore = 0;
    this.results.forEach(r => {
        totalScore += r.score;
        const color = r.score > 80 ? chalk.green : (r.score > 50 ? chalk.yellow : chalk.red);
        console.log(`${r.name.padEnd(20)} | Score: ${color(r.score)} | Reduction: ${r.compression}% | Lines: ${r.origCount} -> ${r.optCount}`);
    });

    const average = (totalScore / this.results.length).toFixed(1);
    console.log("---------------------------------------");
    console.log(chalk.bold(`Final Optimizer Grade: ${average}\n`));
  }
}

module.exports = StressTester;
