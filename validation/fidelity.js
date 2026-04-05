/**
 * Fidelity Validation Harness
 * Runs many random optimization trials to verify that the engine never produces
 * arcs that exceed the specified tolerance. This is a safety check for production.
 *
 * Usage: node validation/fidelity.js [iterations] [seedStart]
 */
const ArcFitter = require('../src/core/ArcFitter');
const GCodeParser = require('../src/core/GCodeParser');
const TestCaseGenerator = require('../src/sim/TestCaseGenerator');
const { performance } = require('perf_hooks');

async function runSingleTest(seed, caseType, tolerance, constraints) {
  const generator = new TestCaseGenerator();
  let result;
  if (caseType === 'spiral') {
    result = generator.generateSpiral(0, 0, 10, 50, 2, 300, { seed, jitter: 0.0005 });
  } else if (caseType === 'circle') {
    result = generator.generateCircle(0, 0, 50, 200, { seed, jitter: 0.0005 });
  } else if (caseType === 'zigzag') {
    result = generator.generateZigZag({ length: 50, width: 2, count: 10, seed, jitter: 0.0005 });
  } else {
    throw new Error(`Unknown caseType: ${caseType}`);
  }

  const parser = new GCodeParser();
  const pathData = parser.parseFileContent(result.gcode);
  const fitter = new ArcFitter(tolerance, constraints);
  fitter.optimize(pathData);

  if (!fitter.lastArcs || fitter.lastArcs.length === 0) {
    return { ok: true, seed, arcs: 0, maxDeviation: 0 };
  }

  // Check each arc with its effective tolerance
  let worstDev = 0;
  for (const arc of fitter.lastArcs) {
    const arcTol = arc.effectiveTolerance || tolerance;
    // Use Verifier to compute actual max deviation within arc
    const Verifier = require('../src/core/evaluation/Verifier');
    const verifier = new Verifier(arcTol);
    const vresult = verifier.verify(arc.originalPoints, arc.circle, arc.start, arc.end);
    if (!vresult.isSafe) {
      return { ok: false, seed, arcs: fitter.lastArcs.length, maxDeviation: vresult.maxDeviation, tolerance: arcTol };
    }
    if (vresult.maxDeviation > worstDev) worstDev = vresult.maxDeviation;
  }

  return { ok: true, seed, arcs: fitter.lastArcs.length, maxDeviation: worstDev };
}

async function main() {
  const iterations = parseInt(process.argv[2]) || 100;
  const seedStart = parseInt(process.argv[3]) || 0;

  console.log(`Fidelity Validation: ${iterations} runs, seed start ${seedStart}`);
  console.log('This will test the optimizer on random toolpaths to ensure no arc exceeds tolerance.');

  const types = ['spiral', 'circle', 'zigzag'];
  const constraints = {
    minArcRadius: 0,
    maxArcRadius: 1000,
    maxIJK: 999.9999,
    minSweep: 5,
    allowHelix: false,
    ransac: true,
    bidirectional: true
  };
  const tolerance = 0.01; // mm

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < iterations; i++) {
    const seed = seedStart + i;
    const caseType = types[i % types.length];
    const start = performance.now();
    const result = await runSingleTest(seed, caseType, tolerance, constraints);
    const elapsed = performance.now() - start;

    if (result.ok) {
      passed++;
      console.log(`[${i+1}/${iterations}] seed ${seed} (${caseType}): OK – arcs=${result.arcs}, maxDev=${result.maxDeviation.toFixed(6)} (${elapsed.toFixed(1)}ms)`);
    } else {
      failed++;
      failures.push(result);
      console.error(`[${i+1}/${iterations}] seed ${seed} (${caseType}): FAIL – arc ${result.arcs} dev ${result.maxDeviation.toFixed(6)} > tol ${result.tolerance}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total runs: ${iterations}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach(f => {
      console.log(`  seed ${f.seed}: ${f.arcs} arcs, maxDev ${f.maxDeviation}, tol ${f.tolerance}`);
    });
    process.exit(1);
  } else {
    console.log('All tests passed!');
  }
}

main().catch(console.error);
