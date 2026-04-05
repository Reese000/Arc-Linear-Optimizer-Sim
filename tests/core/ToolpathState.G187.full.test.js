const ToolpathState = require('../../src/core/ToolpathState');

describe('ToolpathState G187 P/E Specifications', () => {
  describe('Smoothness P parameter', () => {
    test('P1 (ROUGH) multiplies base tolerance by 10', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 1 });
      expect(state.g187Tolerance).toBeCloseTo(0.1, 5);
    });

    test('P2 (MEDIUM) uses base tolerance unchanged', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 2 });
      expect(state.g187Tolerance).toBeCloseTo(0.01, 5);
    });

    test('P3 (FINISH) multiplies base tolerance by 0.1', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 3 });
      expect(state.g187Tolerance).toBeCloseTo(0.001, 5);
    });
  });

  describe('Corner rounding E parameter', () => {
    test('E value in mm (G21) used directly', () => {
      const state = new ToolpathState();
      state.isMetric = true;
      state.setting85 = 0.02;
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ E: 0.005 });
      expect(state.g187Tolerance).toBeCloseTo(0.005, 5);
    });

    test('E value in inches (G20) converted to mm', () => {
      const state = new ToolpathState();
      state.isMetric = false;
      state.setting85 = 0.001;
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ E: 0.0005 });
      expect(state.g187Tolerance).toBeCloseTo(0.0127, 4);
    });
  });

  describe('Combined P and E', () => {
    test('tolerance is minimum of P-based and E-based', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.setting85 = 0.1;
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 1, E: 0.05 });
      expect(state.g187Tolerance).toBeCloseTo(0.05, 5);
    });
  });

  describe('Cancellation', () => {
    test('M30 cancels G187', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ M: 30 });
      expect(state.g187Enabled).toBe(false);
    });

    test('M02 cancels G187', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ M: 2 });
      expect(state.g187Enabled).toBe(false);
    });

    test('G188 cancels G187', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ G: [188] });
      expect(state.g187Enabled).toBe(false);
    });
  });

  describe('getEffectiveTolerance integration', () => {
    test('returns G187 tolerance when tighter than default', () => {
      const state = new ToolpathState();
      state.setting191 = 'FINISH';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 1 });
      expect(state.getEffectiveTolerance(0.1)).toBeCloseTo(0.01, 5);
    });
  });
});

describe('ToolpathState G187 P/E Specifications', () => {
  describe('Smoothness P parameter', () => {
    test('P1 (ROUGH) multiplies base tolerance by 10', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 1 });
      expect(state.g187Tolerance).toBeCloseTo(0.1, 5);
    });

    test('P2 (MEDIUM) uses base tolerance unchanged', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 2 });
      expect(state.g187Tolerance).toBeCloseTo(0.01, 5);
    });

    test('P3 (FINISH) multiplies base tolerance by 0.1', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 3 });
      expect(state.g187Tolerance).toBeCloseTo(0.001, 5);
    });
  });

  describe('Corner rounding E parameter', () => {
    test('E value in mm (G21) used directly', () => {
      const state = new ToolpathState();
      state.isMetric = true;
      state.setting85 = 0.02;
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ E: 0.005 });
      expect(state.g187Tolerance).toBeCloseTo(0.005, 5);
    });

    test('E value in inches (G20) converted to mm', () => {
      const state = new ToolpathState();
      state.isMetric = false;
      state.setting85 = 0.001;
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ E: 0.0005 });
      expect(state.g187Tolerance).toBeCloseTo(0.0127, 4);
    });
  });

  describe('Combined P and E', () => {
    test('tolerance is minimum of P-based and E-based', () => {
      const state = new ToolpathState();
      state.setting191 = 'MEDIUM';
      state.setting85 = 0.1;
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 1, E: 0.05 });
      expect(state.g187Tolerance).toBeCloseTo(0.05, 5);
    });
  });

  describe('Cancellation', () => {
    test('M30 cancels G187', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ M: 30 });
      expect(state.g187Enabled).toBe(false);
    });

    test('M02 cancels G187', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ M: 2 });
      expect(state.g187Enabled).toBe(false);
    });

    test('G188 cancels G187', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ G: [188] });
      expect(state.g187Enabled).toBe(false);
    });
  });

  describe('getEffectiveTolerance integration', () => {
    test('returns G187 tolerance when tighter than default', () => {
      const state = new ToolpathState();
      state.setting191 = 'FINISH';
      state.updateFromCommand({ G: [187] });
      state.updateFromCommand({ P: 1 });
      expect(state.getEffectiveTolerance(0.1)).toBeCloseTo(0.01, 5);
    });
  });
});
