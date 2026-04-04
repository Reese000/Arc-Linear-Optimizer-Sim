const ToolpathState = require('../../src/core/ToolpathState');

describe('ToolpathState', () => {
  let state;

  beforeEach(() => {
    state = new ToolpathState();
  });

  describe('constructor', () => {
    test('initializes with default values', () => {
      expect(state.x).toBe(0);
      expect(state.y).toBe(0);
      expect(state.z).toBe(0);
      expect(state.feedrate).toBe(0);
      expect(state.isMetric).toBe(true);
      expect(state.isAbsolute).toBe(true);
      expect(state.modalGroup1).toBe('G0');
    });
  });

  describe('updateFromCommand', () => {
    test('updates X, Y, Z in absolute mode (metric)', () => {
      state.updateFromCommand({ X: 10, Y: 20, Z: -5 });
      expect(state.x).toBe(10);
      expect(state.y).toBe(20);
      expect(state.z).toBe(-5);
    });

    test('updates X, Y, Z in incremental mode (metric)', () => {
      state.isAbsolute = false;
      state.x = 5;
      state.y = 10;
      state.z = 2;
      
      state.updateFromCommand({ X: 3, Y: -2, Z: 1 });
      expect(state.x).toBe(8);
      expect(state.y).toBe(8);
      expect(state.z).toBe(3);
    });

    test('handles inch to mm conversion when in inch mode', () => {
      state.isMetric = false;
      state.updateFromCommand({ X: 1, Y: 2 });
      expect(state.x).toBe(25.4);
      expect(state.y).toBe(50.8);
    });

    test('preserves feedrate', () => {
      state.updateFromCommand({ F: 100 });
      expect(state.feedrate).toBe(100);
    });

    test('handles G code modal updates', () => {
      state.updateFromCommand({ G: [0, 20, 90] });
      expect(state.modalGroup1).toBe('G0');
      expect(state.isMetric).toBe(false);
      expect(state.isAbsolute).toBe(true);
    });

    test('handles single G code', () => {
      state.updateFromCommand({ G: 1 });
      expect(state.modalGroup1).toBe('G1');
    });

    test('updates modal G1', () => {
      state.updateFromCommand({ G: 1 });
      expect(state.modalGroup1).toBe('G1');
    });

    test('updates modal G2', () => {
      state.updateFromCommand({ G: 2 });
      expect(state.modalGroup1).toBe('G2');
    });

    test('updates modal G3', () => {
      state.updateFromCommand({ G: 3 });
      expect(state.modalGroup1).toBe('G3');
    });
  });

  describe('clone', () => {
    test('creates an independent copy', () => {
      state.updateFromCommand({ X: 10, Y: 20, Z: 5 });
      const clone = state.clone();
      
      expect(clone.x).toBe(10);
      expect(clone.y).toBe(20);
      expect(clone.z).toBe(5);
      
      clone.x = 100;
      expect(state.x).toBe(10);
    });
  });

  describe('getPosition', () => {
    test('returns current position object', () => {
      state.updateFromCommand({ X: 15.5, Y: -3.2, Z: 7.8 });
      const pos = state.getPosition();
      
      expect(pos).toEqual({ x: 15.5, y: -3.2, z: 7.8 });
    });
  });
});
