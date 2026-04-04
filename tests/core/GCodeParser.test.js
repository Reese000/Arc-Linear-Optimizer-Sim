const GCodeParser = require('../../src/core/GCodeParser');
const fs = require('fs');
const path = require('path');

describe('GCodeParser', () => {
  describe('parseLine (static)', () => {
    test('parses simple G1 move', () => {
      const result = GCodeParser.parseLine('G1 X10 Y20');
      expect(result).toEqual({
        G: [1],
        X: 10,
        Y: 20
      });
    });

    test('parses G code as array when multiple G codes on line', () => {
      const result = GCodeParser.parseLine('G1 G21 X10');
      expect(result.G).toEqual([1, 21]);
    });

    test('parses G0 rapid move', () => {
      const result = GCodeParser.parseLine('G0 X5 Y-3 Z2');
      expect(result).toEqual({
        G: [0],
        X: 5,
        Y: -3,
        Z: 2
      });
    });

    test('parses line with feedrate', () => {
      const result = GCodeParser.parseLine('G1 X5 Y10 F200');
      expect(result).toEqual({
        G: [1],
        X: 5,
        Y: 10,
        F: 200
      });
    });

    test('strips comments with parentheses', () => {
      const result = GCodeParser.parseLine('G1 X10 (this is a comment) Y20');
      expect(result).toEqual({
        G: [1],
        X: 10,
        Y: 20
      });
    });

    test('strips comments with semicolon', () => {
      const result = GCodeParser.parseLine('G1 X10 ;comment Y20');
      expect(result).toEqual({
        G: [1],
        X: 10
      });
    });

    test('ignores empty lines', () => {
      const result = GCodeParser.parseLine('');
      expect(result).toBeNull();
    });

    test('ignores comment-only lines', () => {
      const result = GCodeParser.parseLine('(just a comment)');
      expect(result).toBeNull();
    });

    test('parses decimal values', () => {
      const result = GCodeParser.parseLine('G1 X0.1234 Y-5.9876');
      expect(result).toEqual({
        G: [1],
        X: 0.1234,
        Y: -5.9876
      });
    });

    test('handles modal G codes (G90/G91)', () => {
      const result = GCodeParser.parseLine('G91');
      expect(result).toEqual({ G: [91] });
      
      const result2 = GCodeParser.parseLine('G90');
      expect(result2).toEqual({ G: [90] });
    });

    test('handles units (G20/G21)', () => {
      const result = GCodeParser.parseLine('G20');
      expect(result).toEqual({ G: [20] });
      
      const result2 = GCodeParser.parseLine('G21');
      expect(result2).toEqual({ G: [21] });
    });

    test('parses M codes', () => {
      const result = GCodeParser.parseLine('M3 S1000');
      expect(result).toEqual({
        M: [3],
        S: 1000
      });
    });

    test('handles multiple M codes on single line', () => {
      const result = GCodeParser.parseLine('M3 M8');
      expect(result.M).toEqual([3, 8]);
    });
  });

  describe('parseFile', () => {
    const sampleNC = `G90
G21
G1 X0 Y0
G1 X10 Y20 F200
G1 X30 Y20
(comment here)
G1 X30 Y30
M30`;

    test('parses a complete .nc file', async () => {
      const tempFilePath = path.join(__dirname, 'temp_test.nc');
      fs.writeFileSync(tempFilePath, sampleNC);
      
      const parser = new GCodeParser();
      const parsedData = await parser.parseFile(tempFilePath);
      
      // Count non-comment lines: G90, G21, G1 X0 Y0, G1 X10 Y20 F200, G1 X30 Y20, G1 X30 Y30, M30 = 7
      expect(parsedData.length).toBe(7);
      expect(parsedData[0].cmd).toEqual({ G: [90] });
      expect(parsedData[1].cmd).toEqual({ G: [21] });
      expect(parsedData[2].cmd).toEqual({ G: [1], X: 0, Y: 0 });
      expect(parsedData[3].cmd).toEqual({ G: [1], X: 10, Y: 20, F: 200 });
      
      // Cleanup
      fs.unlinkSync(tempFilePath);
    });

    test('maintains state across commands', async () => {
      const tempFilePath = path.join(__dirname, 'temp_state_test.nc');
      const ncContent = `G90
G1 X5 Y10
G1 X15 Y10
G1 X15 Y20`;
      fs.writeFileSync(tempFilePath, ncContent);
      
      const parser = new GCodeParser();
      const parsedData = await parser.parseFile(tempFilePath);
      
      // Check that state updates correctly
      expect(parsedData[1].state.x).toBe(5);
      expect(parsedData[1].state.y).toBe(10);
      expect(parsedData[2].state.x).toBe(15);
      expect(parsedData[2].state.y).toBe(10);
      expect(parsedData[3].state.x).toBe(15);
      expect(parsedData[3].state.y).toBe(20);
      
      fs.unlinkSync(tempFilePath);
    });

    test('captures raw line as well', async () => {
      const tempFilePath = path.join(__dirname, 'temp_raw_test.nc');
      fs.writeFileSync(tempFilePath, 'G1 X10 Y20');
      
      const parser = new GCodeParser();
      const parsedData = await parser.parseFile(tempFilePath);
      
      expect(parsedData[0].raw).toBe('G1 X10 Y20');
      expect(parsedData[0].cmd).toEqual({ G: [1], X: 10, Y: 20 });
      
      fs.unlinkSync(tempFilePath);
    });
  });
});
