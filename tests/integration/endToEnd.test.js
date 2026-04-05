const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GCodeParser } = require('../../src/core/GCodeParser');
const { ArcFitter } = require('../../src/core/ArcFitter');

describe('Integration Tests', () => {
  const outputDir = 'output';
  let tempDir;

  beforeAll(() => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    tempDir = fs.mkdtempSync(path.join(outputDir, 'intgtest_'));
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('full pipeline: parse, optimize, write', () => {
    const testFile = path.join(tempDir, 'test_input.nc');
    const content = `G90
G21
G1 X0 Y0
G1 X10 Y0
G1 X10 Y10
G1 X0 Y10
G1 X0 Y0
M30`;
    fs.writeFileSync(testFile, content);

    // Run the optimizer
    execSync(`node main.js --input ${testFile} --tolerance 0.001`, { stdio: 'pipe' });

    const outputFile = path.join(outputDir, 'test_input_optimized.nc');
    expect(fs.existsSync(outputFile)).toBe(true);

    const output = fs.readFileSync(outputFile, 'utf8');
    expect(output).toContain('G2'); // Should contain arc commands

    // Cleanup
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  });

  test('G20 + G187 tolerance sets effective tolerance', async () => {
    const testFile = path.join(tempDir, 'g20_g187.nc');
    fs.writeFileSync(testFile, `G20
G187 P0.001
G90
G1 X0 Y0 F100
G1 X4 Y0
G1 X4 Y3
G1 X0 Y3
G1 X0 Y0
M30`);

    const parser = new GCodeParser();
    const data = await parser.parseFile(testFile);
    const fitter = new ArcFitter(0.1, {}); // 0.1 mm > 0.0254 mm
    const resultLines = fitter.optimize(data, { isMetric: false });
    const arcs = fitter.lastArcs;

    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs[0].effectiveTolerance).toBeCloseTo(0.0254, 4);
  });

  test('G92 work offsets accounted for in output', async () => {
    const testFile = path.join(tempDir, 'g92_test.nc');
    fs.writeFileSync(testFile, `G21
G90
G92 X10 Y5
G1 X0 Y0 F100
G1 X100 Y0
G1 X100 Y50
G1 X0 Y50
G1 X0 Y0
M30`);

    const parser = new GCodeParser();
    const data = await parser.parseFile(testFile);
    const fitter = new ArcFitter(0.001, {});
    const resultLines = fitter.optimize(data, { isMetric: true });

    const arcs = fitter.lastArcs;
    expect(arcs.length).toBeGreaterThan(0);

    // Expected work coordinate points (from the G1 commands)
    const expectedPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 }
    ];

    for (const arc of arcs) {
      const { x: sx, y: sy } = arc.start;
      const { x: ex, y: ey } = arc.end;
      const isStartValid = expectedPoints.some(p => Math.abs(p.x - sx) < 1e-6 && Math.abs(p.y - sy) < 1e-6);
      const isEndValid = expectedPoints.some(p => Math.abs(p.x - ex) < 1e-6 && Math.abs(p.y - ey) < 1e-6);
      expect(isStartValid).toBe(true);
      expect(isEndValid).toBe(true);
    }

    // Verify parser captured G92 offsets
    const g92Entry = data.find(e => e.cmd.G && e.cmd.G.includes(92));
    expect(g92Entry).not.toBeUndefined();
    expect(g92Entry.state.workOffsetX).toBeCloseTo(10, 5);
    expect(g92Entry.state.workOffsetY).toBeCloseTo(5, 5);
  });

  test('Batch processing does not contaminate state between files', async () => {
    const file1 = path.join(tempDir, 'file1.nc');
    fs.writeFileSync(file1, `G20
G187 P0.001
G90
G1 X0 Y0 F100
G1 X2 Y0
G1 X2 Y2
G1 X0 Y2
G1 X0 Y0
M30`);

    const file2 = path.join(tempDir, 'file2.nc');
    fs.writeFileSync(file2, `G21
G90
G1 X0 Y0 F100
G1 X20 Y0
G1 X20 Y20
G1 X0 Y20
G1 X0 Y0
M30`);

    const parser1 = new GCodeParser();
    const data1 = await parser1.parseFile(file1);
    const parser2 = new GCodeParser();
    const data2 = await parser2.parseFile(file2);

    const fitter = new ArcFitter(0.1, {});

    // Process file1 (inch)
    const result1 = fitter.optimize(data1, { isMetric: false });
    const arcs1 = fitter.lastArcs;
    expect(arcs1.length).toBeGreaterThan(0);
    expect(arcs1[0].effectiveTolerance).toBeCloseTo(0.0254, 4);

    // Process file2 (metric)
    const result2 = fitter.optimize(data2, { isMetric: true });
    const arcs2 = fitter.lastArcs;
    expect(arcs2.length).toBeGreaterThan(0);
    expect(arcs2[0].effectiveTolerance).toBeCloseTo(0.1, 4);
  });

  test('Helical arcs preserve Z linearity', async () => {
    const helixFile = path.join(tempDir, 'helix.nc');
    // Generate a semicircle (180 deg) with Z linearly increasing
    const radius = 10;
    const zStart = 0, zEnd = 5;
    const numPoints = 13; // includes start and end
    const startAngle = 0;
    const endAngle = Math.PI; // 180 deg
    let lines = ['G21', 'G90', `G1 X${radius.toFixed(4)} Y0 Z${zStart.toFixed(4)} F100`];
    for (let i = 1; i < numPoints; i++) {
      const frac = i / (numPoints - 1);
      const angle = startAngle + frac * (endAngle - startAngle);
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      const z = zStart + frac * (zEnd - zStart);
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z${z.toFixed(4)}`);
    }
    lines.push('M30');
    fs.writeFileSync(helixFile, lines.join('\n'));

    const parser = new GCodeParser();
    const data = await parser.parseFile(helixFile);
    const fitter = new ArcFitter(0.01, {});
    const resultLines = fitter.optimize(data, { isMetric: true, allowHelix: true });

    const arcs = fitter.lastArcs;
    expect(arcs.length).toBeGreaterThan(0);

    // Find an arc with Z change
    const helicalArc = arcs.find(a => Math.abs(a.end.z - a.start.z) > 1e-6);
    expect(helicalArc).toBeDefined();

    // Verify that the arc command in output includes Z
    const arcCmd = resultLines.find(l => l.startsWith('G2') || l.startsWith('G3'));
    expect(arcCmd).toMatch(/Z[-\d.+]/);
  });

  test('Modal suppression reduces redundant G2/G3 codes', async () => {
    const testFile = path.join(tempDir, 'modal_supp.nc');
    fs.writeFileSync(testFile, `G21
G90
G1 X0 Y0 F100
G2 I10 J0 X10 Y0
G2 I0 J10 X20 Y0
M30`);

    const parser = new GCodeParser();
    const data = await parser.parseFile(testFile);
    const fitter = new ArcFitter(0.01, {});
    const resultLines = fitter.optimize(data, { isMetric: true, modalSuppression: true });

    // Count lines that represent arcs (presence of I or J)
    const arcCount = resultLines.filter(l => /I[-+]?\d/.test(l) || /J[-+]?\d/.test(l)).length;
    // Count explicit G2/G3 at start of line
    const g2g3Count = resultLines.filter(l => /^G[23] /.test(l)).length;

    // With modal suppression, some arcs should omit the G2/G3 prefix
    expect(g2g3Count).toBeLessThan(arcCount);
  });

  test('Precision settings control decimal places', async () => {
    const testFile = path.join(tempDir, 'precision_test.nc');
    fs.writeFileSync(testFile, `G21
G90
G1 X0 Y0 F100
G1 X100 Y0
G1 X100 Y100
G1 X0 Y100
G1 X0 Y0
M30`);

    // Metric default: 3 decimals
    const parser1 = new GCodeParser();
    const data1 = await parser1.parseFile(testFile);
    const fitter1 = new ArcFitter(0.01, {});
    const result1 = fitter1.optimize(data1, { isMetric: true });
    const arcLine1 = result1.find(l => l.startsWith('G2') || l.startsWith('G3'));
    expect(arcLine1).toMatch(/X-?\d+\.\d{3}\b/);

    // Metric override: 5 decimals
    const parser2 = new GCodeParser();
    const data2 = await parser2.parseFile(testFile);
    const fitter2 = new ArcFitter(0.01, {});
    const result2 = fitter2.optimize(data2, { isMetric: true, precision: 5 });
    const arcLine2 = result2.find(l => l.startsWith('G2') || l.startsWith('G3'));
    expect(arcLine2).toMatch(/X-?\d+\.\d{5}\b/);

    // Inch default: 4 decimals
    const inchFile = path.join(tempDir, 'inch.nc');
    fs.writeFileSync(inchFile, `G20
G90
G1 X0 Y0 F100
G1 X4 Y0
G1 X4 Y3
G1 X0 Y3
G1 X0 Y0
M30`);
    const parser3 = new GCodeParser();
    const data3 = await parser3.parseFile(inchFile);
    const fitter3 = new ArcFitter(0.01, {});
    const result3 = fitter3.optimize(data3, { isMetric: false });
    const arcLine3 = result3.find(l => l.startsWith('G2') || l.startsWith('G3'));
    expect(arcLine3).toMatch(/X-?\d+\.\d{4}\b/);

    // Inch override: 6 decimals
    const parser4 = new GCodeParser();
    const data4 = await parser4.parseFile(inchFile);
    const fitter4 = new ArcFitter(0.01, {});
    const result4 = fitter4.optimize(data4, { isMetric: false, precision: 6 });
    const arcLine4 = result4.find(l => l.startsWith('G2') || l.startsWith('G3'));
    expect(arcLine4).toMatch(/X-?\d+\.\d{6}\b/);
  });

  test('Constraint boundaries: min-radius rejection', async () => {
    const testFile = path.join(tempDir, 'min_radius.nc');
    const radius = 0.5; // mm
    const cx = 0, cy = 0;
    const startAngle = 0;
    const endAngle = (2/3) * Math.PI; // 120 deg
    const steps = 12;
    let lines = ['G21', 'G90', `G1 X${cx + radius} Y${cy} F100`];
    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const angle = startAngle + frac * (endAngle - startAngle);
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)}`);
    }
    lines.push('M30');
    fs.writeFileSync(testFile, lines.join('\n'));

    const parser = new GCodeParser();
    const data = await parser.parseFile(testFile);

    // With min-radius constraint
    const fitter = new ArcFitter(0.01, { minArcRadius: 1.0 });
    const result = fitter.optimize(data, { isMetric: true });
    const arcs = fitter.lastArcs;
    expect(arcs.length).toBe(0);
    const hasArcLine = result.some(l => /I[-+]?\d/.test(l) || /J[-+]?\d/.test(l));
    expect(hasArcLine).toBe(false);
  });

  test('Constraint boundaries: max-radius rejection', async () => {
    const testFile = path.join(tempDir, 'max_radius.nc');
    const radius = 10; // mm
    const cx = 0, cy = 0;
    const startAngle = 0;
    const endAngle = (2/3) * Math.PI;
    const steps = 12;
    let lines = ['G21', 'G90', `G1 X${cx + radius} Y${cy} F100`];
    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const angle = startAngle + frac * (endAngle - startAngle);
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)}`);
    }
    lines.push('M30');
    fs.writeFileSync(testFile, lines.join('\n'));

    const parser = new GCodeParser();
    const data = await parser.parseFile(testFile);
    const fitter = new ArcFitter(0.01, { maxArcRadius: 5 });
    const result = fitter.optimize(data, { isMetric: true });
    const arcs = fitter.lastArcs;
    expect(arcs.length).toBe(0);
  });

  test('Constraint boundaries: maxIJK rejection', async () => {
    const testFile = path.join(tempDir, 'maxijk.nc');
    const radius = 10; // mm -> I offset magnitude will be 10 for this configuration
    const cx = 0, cy = 0;
    const startAngle = 0;
    const endAngle = (2/3) * Math.PI;
    const steps = 12;
    let lines = ['G21', 'G90', `G1 X${cx + radius} Y${cy} F100`];
    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const angle = startAngle + frac * (endAngle - startAngle);
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)}`);
    }
    lines.push('M30');
    fs.writeFileSync(testFile, lines.join('\n'));

    const parser = new GCodeParser();
    const data = await parser.parseFile(testFile);
    const fitter = new ArcFitter(0.01, { maxIJK: 5 });
    const result = fitter.optimize(data, { isMetric: true });
    const arcs = fitter.lastArcs;
    expect(arcs.length).toBe(0);
  });
});
