const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Integration Tests', () => {
  const testFile = 'tests/integration/test_input.nc';
  const outputDir = 'output';

  beforeAll(() => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
  });

  test('full pipeline: parse, optimize, write', () => {
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
    execSync(`node main.js ${testFile} 0.001`, { stdio: 'pipe' });

    const outputFile = path.join(outputDir, 'test_input_optimized.nc');
    expect(fs.existsSync(outputFile)).toBe(true);

    const output = fs.readFileSync(outputFile, 'utf8');
    expect(output).toContain('G2'); // Should contain arc commands

    // Cleanup
    fs.unlinkSync(testFile);
    fs.unlinkSync(outputFile);
  });
});
