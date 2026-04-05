/**
 * Performance benchmark for ArcFitter
 * Usage: node benchmarks/profile.js [testCase] [iterations]
 */
const { performance } = require('perf_hooks');
const ArcFitter = require('../src/core/ArcFitter');
const TestCaseGenerator = require('../src/sim/TestCaseGenerator');

function pointsToPathData(points) {
  const pathData = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const state = {
      x: pt.x,
      y: pt.y,
      z: pt.z || 0,
      feedrate: 1000,
      getEffectiveTolerance: (tol) => tol
    };
    pathData.push({
      raw: `G1 X${pt.x} Y${pt.y} Z${pt.z || 0}`,
      cmd: { G: 1 },
      state: state
    });
  }
  return pathData;
}

async function main() {
  const testCase = process.argv[2] || 'spiral';
  const iterations = parseInt(process.argv[3]) || 10;

  console.log(`Benchmark: ${testCase}, iterations: ${iterations}`);
  console.log('Generating test data...');

  const generator = new TestCaseGenerator();
  let points = [];

  if (testCase === 'spiral') {
    const result = generator.generateSpiral(0, 0, 10, 50, 2, 3000, { jitter: 0.0005 });
    points = result.degraded;
  } else if (testCase === 'circle') {
    const result = generator.generateCircle(0, 0, 50, 2000, { jitter: 0.0005 });
    points = result.degraded;
  } else if (testCase === 'zigzag') {
    const result = generator.generateZigZag({ length: 500, width: 2, count: 100, jitter: 0.0005 });
    points = result.degraded;
  } else {
    throw new Error(`Unknown test case: ${testCase}`);
  }

  console.log(`Generated ${points.length} points`);

  const pathData = pointsToPathData(points);

  console.log(`Parsed to ${pathData.length} path items`);

  const tolerance = 0.01;
  const options = {
    minSweep: 5,
    ransac: true,
    bidirectional: false,
    maxSearch: 50
  };

  const fitter = new ArcFitter(tolerance, options);

  // Warmup
  console.log('Warming up...');
  fitter.optimize(pathData);
  console.log(`Warmup produced ${fitter.lastArcs.length} arcs`);

  // Benchmark
  console.log('Running benchmark...');
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = fitter.optimize(pathData);
    const end = performance.now();
    times.push(end - start);

    if (i === 0) {
      console.log(`First run: ${(end - start).toFixed(2)}ms, arcs: ${fitter.lastArcs.length}`);
    }
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log('\n--- Results ---');
  console.log(`Average: ${avg.toFixed(2)}ms`);
  console.log(`Min: ${min.toFixed(2)}ms`);
  console.log(`Max: ${max.toFixed(2)}ms`);
  console.log(`Throughput: ${(1000 / avg).toFixed(1)} ops/sec`);

  // Estimate scaling
  const pointsPerMs = pathData.length / avg;
  console.log(`Points per ms: ${pointsPerMs.toFixed(1)}`);
}

main().catch(console.error);
