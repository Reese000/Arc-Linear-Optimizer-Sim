# Ultimate Haas 3-Axis G-Code Optimizer

A high-fidelity simulation environment for G-code linearization and arc fitting, optimized for non-HSM Haas CNC mills.

## Goal

To effectively optimize toolpaths generated using low-quality G-code (point-to-point line segments) into efficient, accurate, and gouge-free G-code using `G2`/`G3` arc commands.

## Key Features

- **G-code Linearization**: Subdividing complex toolpaths into high-resolution segments.
- **Bi-Arc Fitting**: Converting line segments to optimal arcs within a specified tolerance.
- **Gouge Protection**: Verification engine ensures the optimized toolpath never enters the part volume.
- **Haas Compatibility**: Built-in constraints for non-HSM Haas controllers (e.g., minimum segment length, radius limits).

## Quick Start

### Installation

```bash
npm install
```

### Basic Usage

```bash
# Positional arguments (legacy)
node main.js input.nc 0.001

# Modern flags (recommended)
node main.js --input input.nc --tolerance 0.001
```

### CLI Options

```
--input, -i           Input .nc file (required)
--input-dir           Batch process directory of .nc files
--output-dir, -o      Output directory (default: ./output)
--tolerance, -t       Fit tolerance in machine units (default: 0.001)
                      Respects G20 (inch) / G21 (mm) automatically
--min-radius          Minimum arc radius allowed (default: 0)
--max-radius          Maximum arc radius allowed (default: Infinity)
--max-ijk             Maximum IJK magnitude (default: Infinity)
--allow-helix         Allow helical arcs (Z changes during arcs)
--bidirectional       Search backward and forward to maximize arc length
--report, -r          Generate optimization report (JSON)
--report-format       json or csv (default: json)
--precision           Decimal places for coordinates (override auto)
--skip-errors         Continue processing on errors
--verbose, -v         Enable verbose logging
--help                Show this help message
```

## Haas Integration

### Tolerances

- Default tolerance `0.001` meets Haas non-HSM standards for inch mode (G20).
- In metric mode (G21), the same numeric value is used (e.g., 0.001 mm). Adjust accordingly.

### Constraints

Use `--min-radius`, `--max-radius`, and `--max-ijk` to enforce machine-specific limits. Arcs violating constraints are rejected and left as linear moves.

### Feedrate Handling

Feedrates are preserved from the original G-code. The optimizer only includes an `F` word when the feedrate is explicitly set; it does not add redundant `F` values to every arc, respecting modal state.

## Advanced Usage

### Batch Processing

```bash
node main.js --input-dir ./gcode --output-dir ./optimized --tolerance 0.001 --report
```

### Generating Reports

Use `--report` to generate a detailed JSON or CSV report containing arc geometry, direction, sweep, point count, and feedrate.

```bash
node main.js --input part.nc --tolerance 0.0005 --report --report-format csv
```

Report structure:

```json
{
  "summary": {
    "originalLineCount": 100,
    "optimizedLineCount": 42,
    "arcCount": 10,
    "linearCount": 32,
    "reductionPercent": "58.00"
  },
  "arcs": [
    {
      "direction": "G2",
      "start": { "x": 0.0, "y": 0.0 },
      "end": { "x": 10.0, "y": 0.0 },
      "center": { "x": 5.0, "y": -5.0 },
      "radius": 5.0,
      "sweepDegrees": 90.0,
      "pointCount": 100,
      "feedrate": 200.0
    }
  ]
}
```

## Fusion 360 Integration

When post-processing Fusion 360 output:

1. Set tolerance to match your machine's accuracy (e.g., `0.001` for inch, `0.01` for mm).
2. Disable helical moves unless your Haas controller supports them (use `--allow-helix` if needed).
3. Use `--max-ijk` to limit IJK values to safe ranges (e.g., `10` for medium-sized arcs).
4. Enable `--report` to review arc quality before running on machine.
5. Consider `--modal-suppression` if your controller prefers minimal modal codes.

## Technical Details

### Circle Fitting Methods

- **Kåsa** (default): Algebraic least squares, fast and stable.
- **Pratt**: Minimizes algebraic error with geometric constraint.
- **Taubin**: Iteratively reweighted least squares for improved statistical properties.

These methods are available as static methods on `ArcFitter` for advanced use.

### Algorithm

The optimizer scans linear moves (G1) and attempts to fit a circle to a window of points. The window expands forward until:
- The chordal tolerance is exceeded.
- Z axis changes (unless helical arcs allowed).
- Radius or IJK limits are exceeded.
- Maximum search depth reached.

Arc direction (G2/G3) is determined from point order. Sweep angles are computed; warnings are issued for sweeps > 180°.

### Output Format

Arc commands include:
```
G2 Xend Yend Icenter_offset X Jcenter_offset Y [Ffeedrate]
```
Precision defaults to 4 decimal places for G20 (inch) and 3 for G21 (mm), overrideable via `--precision`.

## Testing

Run unit tests:

```bash
npm test
```

## Project Structure

```
src/
  core/
    ArcFitter.js      - Core arc fitting algorithms
    GCodeParser.js    - G-code parsing and modal state tracking
    ToolpathState.js  - Modal state machine (units, absolute/incremental)
  web/
    server.js         - Optional web interface
    public/
tests/
  core/
    ArcFitter.test.js
    GCodeParser.test.js
    ToolpathState.test.js
  integration/
    endToEnd.test.js
main.js               - CLI entry point
```

## License

ISC

---

*Created by Antigravity - Lead Systems Architect*
