/**
 * Performance Regression Suite
 * Runs a set of benchmark cases and reports metrics. Can be used to detect
 * performance regressions over time.
 *
 * Output format: JSON to stdout (for CI integration)
 *
 * Usage: node benchmarks/suite.js [--json]
 */
const { performance } = require('perf_hooks');
const ArcFitter = require('../src/core/ArcFitter');
const GCodeParser = require('../src/core/GCodeParser');
const TestCaseGenerator = require('../src/sim/TestCaseGenerator');

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'G';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function msOrUs(ms) {
  return ms >= 1 ? `${ms.toFixed(2)}ms` : `${(ms*1000).toFixed(2)}µs`;
}

const cases = [
  {
    name: 'Small Circle (1000 pts)',
    generator: (g) => g.generateCircle(0, 0, 50, 1000, { jitter: 0.0005 }).gcode,
    warmup: 3,
    runs: 10
  },
  {
    name: 'Large Spiral (5000 pts)',
    generator: (g) => g.generateSpiral(0, 0, 10, 50, 3, 5000, { jitter: 0.0005 }).gcode,
    warmup: 2,
    runs: 5
  },
  {
    name: 'ZigZag (2000 pts)',
    generator: (g) => g.generateZigZag({ length: 100, width: 2, count: 50, jitter: 0.0005 }).gcode,
    warmup: 3,
    runs: 10
  },
  {
    name: 'S-Curve (3000 pts)',
    generator: (g) => g.generateSCurve({ length: 100, amplitude: 10, wavelength: 30, segments: 3000, jitter: 0.0005 }).gcode,
    warmup: 3,
    runs: 10
  }
];

async function runBenchmark(name, gcodeGen, warmup, runs) {
  const generator = new TestCaseGenerator();
  const gcode = gcodeGen(generator);
  const parser = new GCodeParser();
  const pathData = parser.parseFileContent(gcode);

  const constraints = {
    minSweep: 5,
    ransac: true,
    bidirectional: false,
    maxSearch: 50
  };
  const tolerance = 0.01;
  const fitter = new ArcFitter(tolerance, constraints);

  // Warmup
  for (let i = 0; i < warmup; i++) {
    fitter.optimize(pathData);
  }

  // Timed runs
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fitter.optimize(pathData);
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a,b) => a+b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const stdev = Math.sqrt(times.reduce((sum, t) => sum + (t-avg)**2, 0) / times.length);

  return {
    name,
    points: pathData.length,
    avgMs: avg,
    minMs: min,
    maxMs: max,
    stdevMs: stdev,
    throughputOpsPerSec: 1000 / avg,
    pointsPerMs: pathData.length / avg
  };
}

async function main() {
  const jsonOutput = process.argv.includes('--json');
  const outputFile = process.argv.find(arg => arg.startsWith('--output='))?.split('=')[1];

  console.log('Running performance regression suite...\n');

  const results = [];
  for (const bench of cases) {
    console.log(`Running: ${bench.name} (${bench.runs} runs)`);
    const res = await runBenchmark(bench.name, bench.generator, bench.warmup, bench.runs);
    results.push(res);
    console.log(`  Avg: ${msOrUs(res.avgMs)}, Min: ${msOrUs(res.minMs)}, Max: ${msOrUs(res.maxMs)}`);
    console.log(`  Throughput: ${res.throughputOpsPerSec.toFixed(1)} ops/sec, ${formatNumber(res.pointsPerMs)} pts/ms\n`);
  }

  if (outputFile) {
    require('fs').writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`Wrote JSON output to ${outputFile}`);
  }

  if (jsonOutput && !outputFile) {
    console.log(JSON.stringify(results, null, 2));
  }

   if (!jsonOutput && !outputFile) {
     // Human readable table
     console.log('=== Summary Table ===');
     const header = `${'Case'.padEnd(30)} ${'Points'.padEnd(10)} ${'Avg'.padEnd(10)} ${'Min'.padEnd(10)} ${'Max'.padEnd(10)} ${'Ops/sec'.padEnd(12)} ${'Pts/ms'.padEnd(12)}`;
     console.log(header);
     for (const r of results) {
       const row = `${r.name.padEnd(30)} ${r.points.toString().padEnd(10)} ${msOrUs(r.avgMs).padEnd(10)} ${msOrUs(r.minMs).padEnd(10)} ${msOrUs(r.maxMs).padEnd(10)} ${r.throughputOpsPerSec.toFixed(1).padEnd(12)} ${formatNumber(r.pointsPerMs).padEnd(12)}`;
       console.log(row);
     }
   }
 }
 
 main().catch(console.error);
