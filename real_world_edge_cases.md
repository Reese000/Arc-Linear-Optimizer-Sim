# Real-World G-Code Optimization Edge Cases

This document outlines potential failure scenarios when running the optimized G-code in real-world CNC environments that are **not covered by the current test suite**. These edge cases should be validated before deploying the optimizer to production Haas machines.

---

## 1. File Input & Parsing Edge Cases

### 1.1 Malformed Numeric Values
- **`.X` or `X.` without complete number** - Parser expects `[-+]?\d*\.?\d+`; may fail on edge cases
- **Scientific notation** - `X1.5e3` not supported by regex
- **Multiple decimal points** - `X1.2.3` undefined behavior
- **Leading zeros with sign** - `X-0.5` handling

### 1.2 Line Ending & Encoding Issues
- **Mixed CRLF/LF line endings** across a single file
- **UTF-8 BOM** at file start (U+FEFF)
- **No final newline** at EOF
- **Extremely long lines** (>1MB) - buffer/performance issues

### 1.3 Comment & Whitespace Variations
- **Nested parentheses** - `(comment (nested) end)` - current regex strips from first `(` to last `)`
- **Unclosed parentheses** - `(missing end` - may consume rest of line
- **Semicolon before parentheses** - order matters in regex
- **Tabs vs spaces** - tokenization assumes clean letter-digit pattern
- **Comments mid-token** - `G1X10` (no space) vs `G1 X10`

### 1.4 Empty/Minimal Files
- Empty file (0 bytes)
- File with only whitespace
- File with only comments (no actual moves)
- File with single G1 line (can't form arc)

---

## 2. Modal State Machine Edge Cases

### 2.1 Unit Switching Mid-File
```
G20  (inch)
G1 X1 Y1
G21  (switch to mm)
G1 X25.4 Y25.4  (should be 1" in mm)
```
- State tracking correctly handles this, but **arc validation** may mix units if center offsets computed before state update
- IJK values interpretation: relative to start position regardless of absolute/incremental mode

### 2.2 Incremental vs Absolute Mode Switching
```
G90
G1 X10 Y10
G91
G1 X5 Y5  (should go to 15,15)
G90
G1 X0 Y0  (should go to 0,0 absolute)
```
- ToolpathState handles this correctly, but **optimizer window** must track state snapshots accurately
- Edge: switching modes DURING an arc candidate window (some points absolute, some incremental)

### 2.3 G187 Exact Stop Changes
- G187 enabled without P (uses machine default, not captured)
- G187 P changes mid-toolpath with tighter/looser tolerance
- G188 cancels G187, but optimizer may use stale effectiveTolerance
- Multiple G187 on same line: `G187 G187 P0.001`

### 2.4 Modal State Corruption
- First command omits G (assumes G0 default) - handled
- Non-motion G-codes (G4 dwell) - should be preserved
- M-codes that affect motion (M5 spindle stop might still move) - preserved

---

## 3. Arc Fitting Numerical Stability

### 3.1 Nearly Collinear Points
```
G1 X0 Y0
G1 X1 Y0.000001
G1 X2 Y0
```
- Circle fit denominator approaches zero → returns null (currently handled)
- But **very large computed radius** (1e15 mm) may silently pass radius constraints
- **Underflow/overflow** in sum terms with extreme coordinates

### 3.2 Coordinate Magnitude Edge Cases
- **Very large coordinates** (> 1,000,000 mm) - loss of precision in least squares sums
- **Very small coordinates** (< 0.000001) - underflow in squared terms
- **Mixed magnitude** (one point at 1e6, others at 1e-6) - conditioning issues
- **Negative zero** (-0) string parsing → -0 floating point

### 3.3 Tolerance Extremes
- Tolerance = 0 (exact fit) - may cause infinite loops or division by zero
- Tolerance = 1e-15 (near machine epsilon) - numeric noise dominates
- Tolerance > expected chordal deviation (accepts poor fits)

### 3.4 Circle Fit Degeneracy
- **All points identical** - zero radius
- **Three collinear points** - returns null (tested) but what about 4+ collinear?
- **Symmetric configurations** causing denominator exactly 0
- **Numerical instability** when points nearly collinear but not exactly

---

## 4. Arc Constraint Violations

### 4.1 Radius Constraints
- `min-radius` set higher than actual arc radius → arc rejected, fallback to linear
- `max-radius` set too low → small arcs rejected
- **Zero radius** (straight line) - should never create arc with radius 0

### 4.2 IJK Magnitude Limits
- I or J exactly equals `max-ijk` boundary - should be accepted (<=)
- I/J values with **floating point rounding** just over limit after conversion
- Negative IJK values - already handled by absolute value check

### 4.3 Search Depth Limit
- `max-search` (default 50) reached before tolerance exceeded → best arc may be shorter than optimal
- Very tight tolerance requires >50 points → algorithm gives up early
- **Long straight segments** that could be one arc but exceed max-search due to many points

---

## 5. Helical Arc Edge Cases

### 5.1 Z-Axis Variations
- **Z unchanged but should be helical?** - Z-delta = 1e-12 (effectively zero)
- **Large Z-changes** within arc: Z1 → Z100 over same XY arc
- **Z-direction reversal** mid-candidate window
- **Z-axis units mismatch** if G20/G21 switch during helix

### 5.2 Helical Sweep Angles
- Helical arc with **>180° XY sweep** + Z motion
- Full spiral helix (multiple rotations) - sweep > 360°
- Helix with **zero radius** (straight line in Z) - should not create helical arc

---

## 6. Arc Direction & Geometry

### 6.1 Direction Determination Failures
- First intermediate point is **duplicate of start** (zero-length move)
- **All points collinear** - direction default G2 but geometry invalid
- **Clockwise vs Counterclockwise** ambiguous when points symmetric around chord
- **Sweep exactly 180°** - borderline CW vs CCW

### 6.2 Sweep Angle Edge Cases
- Sweep > 180° - warning issued but arc still created (Haas may reject)
- Sweep = 0° (start=end) - degenerate closed path
- Sweep = 360° (full circle) - G2/G3 may need explicit IJK and no X/Y delta?
- **Negative sweep** after modulo arithmetic error

### 6.3 Arc Merging Issues
- `mergeArcs` merges consecutive arcs with same center/radius
- **Floating point drift** in center coordinates across arcs prevents merge
- Merged arc sweep > 180° introduced by merging
- Different feedrates - should NOT merge (feedrate check missing?)

---

## 7. Tolerance & G187 Integration

### 7.1 Effective Tolerance Selection
- G187 P in inches (G20) but optimizer uses mm internally - conversion must be perfect
- G187 P = 0 (exact stop)
- G187 enabled but **no P value ever provided** - should use machine default (unknown)
- Multiple G187 with different P values - last one wins

### 7.2 Exact Stop & Path Following
- G187 active affects chordal tolerance interpretation (axis vs tooltip?)
- **Verification uses effectiveTolerance** but optimizer uses `this.tolerance` - mismatch?
- G187 may imply **cornering requirements** beyond simple chordal deviation

---

## 8. Feedrate Handling

### 8.1 Feedrate Propagation
- **No feedrate** (F0 or missing) on first move → arc has F0? Should inherit from modal?
- Feedrate changes **mid-arc candidate window** → which F used? Current uses start.feedrate
- Feedrate = 0 (rapid move) but G1 used - unlikely but possible
- **Very high feedrate** (> 1e6) - fits in JS number but may overflow controller

### 8.2 Modal Feedrate Behavior
- F word modal on many CNCs - optimizer adds F to every arc (maybe redundant)
- `modalSuppression` flag exists but **not tested** in ArcFitter tests
- Different feedrates on consecutive arcs → redundant F suppression

---

## 9. Output Formatting & Precision

### 9.1 Decimal Rounding Edge Cases
- Value exactly halfway (e.g., 1.23445 → 1.2345 vs 1.2346 - toFixed rounds correctly?)
- **Negative values** with toFixed: `(-1.2345).toFixed(3)` = `-1.235` ✓
- Very large/small numbers with fixed precision → scientific notation? toFixed throws RangeError

### 9.2 Precision Selection
- G20 (inch) default precision 4, G21 default 3
- But ArcFitter created with precision 4 always - doesn't respect G20/G21 context
- **User override with --precision** - not passed through correctly in batch mode?

### 9.3 Modal Suppression
- `--modal-suppression` flag passed to ArcFitter but **createArcCommand ignores it** (option stored but unused)
- Should omit G2/G3 if same as previous mode
- Should omit X/Y if same as previous position? (unsafe for arcs)

---

## 10. Arc Verification & Gouge Protection

### 10.1 Verifier Angle Wrapping
- Points exactly on arc boundary (sweep limit) - epsilon comparison
- **Start/end angle computation** using atan2 - quadrant issues?
- CW vs CCW arc verification must match actual arc direction (currently deduced from mid point)

### 10.2 Point-on-Segment Logic
- Point lies exactly on arc but angle offset computation error due to modulo
- Point exactly at arc endpoint - onArc check may exclude it incorrectly
- **Floating point epsilon** (1e-9) may be too large/small for extreme coordinates

### 10.3 Endpoint Distance Handling
- Point lies beyond arc segment (not on arc) → uses min(dStart, dEnd)
- Does **not check perpendicular distance to chord** - only radial for on-arc points
- May allow points outside arc segment but within endpoint tolerance even if far from arc

---

## 11. Real-World G-Code Constructs

### 11.1 Non-Movement Commands in Path
- M3/M5 (spindle) - should pass through unchanged
- M8/M9 (coolant) - should pass through unchanged
- T-code (tool change) - may have G43 offset (tool length compensation)
- G28/G30 (reference return) - absolute move to home, should not optimize
- G92 (coordinate offset) - sets work coordinate system - optimizer must respect offsets
- G53 (machine coordinates) - absolute machine motion, ignore work offsets

### 11.2 Dwell & Delays
- G4 P1000 (dwell 1 second) - non-motion, should be preserved
- Dwell in middle of arc candidate window → breaks arc (non-G1 command)

### 11.3 Cutter Compensation (G41/G42)
- Applied by controller after parsing - optimizer should use **compensated centerline**?
- Currently ignores - may produce wrong IJK if compensation active

---

## 12. Batch Processing & File Operations

### 12.1 File System Edge Cases
- Output directory **not writable** (permissions)
- Output file **already exists** - overwrite behavior (current: fs.writeFileSync overwrites)
- Input file **disappears during processing**
- **Very large number of files** (>10,000) in batch directory - readdir performance

### 12.2 Error Handling & Continuation
- `--skip-errors` flag: which errors are recoverable? Current: catches all in batch
- **Partial write** if process killed mid-write
- Disk full during output write

### 12.3 Report Generation
- Report JSON with **no arcs** (all linears) - arcs array empty, division by zero? (lastArcs = [])
- CSV report with **special characters** in output path (commas) - not sanitized
- Report file **path traversal** if user provides malicious output-dir

---

## 13. Performance & Scale

### 13.1 Toolpath Length
- Single line with 100,000 points - max-search limits optimization window to 50 points
- Memory: storing all parsedData in memory before optimization
- **Very short toolpaths** (3 points) - edge of optimization

### 13.2 Arc Density
- Output file with **thousands of tiny arcs** (<1° each) - controller may struggle
- Arc merging should combine but may not if floating point drift
- **Long arcs** (>180° sweep) may exceed Haas limits (should warn, may fail on machine)

### 13.3 Bidirectional Mode
- `--bidirectional` scans forward AND backward from each point
- Overlapping arcs may be generated (conflicting IJK values)
- Performance: O(n²) worst-case × 2 directions

---

## 14. Machine-Specific Constraints

### 14.1 Haas Controller Quirks
- **Maximum arc radius** limit (e.g., some Haas: 1000" or 1000mm)
- **Maximum IJK magnitude** (e.g., 999.9999" or 9999.999mm)
- **Minimum arc radius** (avoid very small arcs, jerky motion)
- **Arc sweep limit** - some Haas don't support >180° arcs
- **Helical arcs** - not all Haas support Z-in-arc (check `--allow-helix`)

### 14.2 Resolution & Rounding
- Controller **resolution limits** (e.g., 0.0001" or 0.001mm)
- Optimizer precision may produce values **too fine** for controller
- Values rounded to controller resolution on input → effective positions differ

### 14.3 Lookahead & Buffer Limits
- Some CNCs have **lookahead buffer limits** (e.g., 100 blocks)
- Very long arc command (G2 X... Y... I... J...) may exceed line length limits
- **Block delete** (!) characters - preserved or stripped?

---

## 15. Material & Process Edge Cases

### 15.1 High-Speed Machining
- Very high feedrates with small tolerance → aggressive arc fitting may exceed **acceleration limits**
- Sharp interior corners (small radius arcs) → high centripetal acceleration
- Arc direction alternation (G2/G3 back-to-back) → direction change may be jerky

### 15.2 Adaptive Clearing & Trochoidal Milling
- **Trochoidal arcs** (looping arcs) - may exceed max-radius constraint
- Adaptive clearing with **variable depth-of-cut** - helical/descending arcs
- Plunging arcs (Z down while XY arc) → chip evacuation concerns

### 15.3 5-Axis & Rotation Axes
- Currently 3-axis only (X,Y,Z)
- If extended to A/B/C axes: IJK analogies (J/K for YZ plane?) not handled

---

## 16. Reporting & Data Analysis

### 16.1 Statistics Edge Cases
- `radiusCV` (coefficient of variation) with radius = 0 (division by zero)
- `reductionPercent` calculation: originalLineCount = 0 (impossible but guard)
- `sweepDegrees` > 360° reported without warning
- **Feedrate averaging** across arcs with different F values

### 16.2 CSV Formatting
- Arc direction "G2" contains comma? No, but what if future field includes comma
- Floating point values with **exponential notation** in JSON (toFixed avoids this)

---

## 17. User Configuration & Invocation

### 17.1 CLI Argument Edge Cases
- `--tolerance` negative or 0
- `--min-radius` > `--max-radius` (invalid constraint range)
- `--max-ijk` negative
- `--precision` non-integer or negative
- **Conflicting flags** (e.g., `--allow-helix` with `--max-radius` too small)

### 17.2 Batch Mode Peculiarities
- `--input-dir` with **10,000 files** - performance of sequential processing
- One file fails in batch with `--skip-errors` - counters may be wrong
- **Mixed tolerance** across files? (All use same tolerance from CLI)

### 17.3 File Path Edge Cases
- Input file with **spaces** in path (currently uses yargs-parser, should handle)
- **Relative vs absolute paths** in error messages
- **Unicode characters** in file paths (Windows: UTF-16 filenames)

---

## 18. Concurrency & Parallelization

### 18.1 Shared State Issues
- StressTester reuses `parser.state` across lines - should create new parser per test (currently does inside runTest ✓)
- **Race conditions** if parallel batch processing ever implemented (currently sequential)

### 18.2 Memory Leaks
- Large files stored entirely in memory (`parsedData` array)
- No streaming output - entire output array stored before write

---

## 19. Existing Test Gaps Summary

Current tests cover:
- Basic circle fitting (perfect data)
- Simple sequential G1 → arc conversion
- Tolerance checks
- Collinear rejection
- Unit conversion (ToolpathState)
- G187 integration (basic)
- End-to-end simple square

**Missing major categories:**
1. **Malformed input** (invalid numbers, encoding, comments)
2. **Modal state switching** (G20/G21, G90/G91 in same file)
3. **Helical arcs** (only one basic test? not in ArcFitter.test.js)
4. **Bidirectional mode** (any tests?)
5. **Arc constraint enforcement** (min/max radius, max-ijk)
6. **Modal suppression** (flag stored but output not respecting)
7. **Large/small coordinate** numerical stability
8. **Very tight/loose tolerance** extremes
9. **Non-G1 commands interrupting** arc windows (M-codes, G4, G28)
10. **Feedrate variations** in window
11. **Report generation** edge cases (empty arcs, CSV escaping)
12. **Batch processing** error handling, file system issues
13. **Arc merging** with floating point drift
14. **Verification boundary** conditions
15. **Real G-code** from Fusion 360, Mastercam, etc. (not synthetic perfect circles)

---

## 20. Recommended Fuzz Testing

Create a fuzzer that generates random G-code sequences with:
- Random numeric values (large, small, negative, NaN, Infinity - though parser will reject)
- Random G/M codes mixed in
- Random comments with special characters
- Random whitespace patterns
- Random modal state flips
- Stress test ArcFitter with near-degenerate circles

---

## 21. Machine Validation Checklist

Before running optimized code on real Haas:

- [ ] **Dry run** on machine simulator (if available)
- [ ] Verify **G187** behavior with tight tolerance on arcs
- [ ] Test **helical arcs** if used - verify Z interpolation correct
- [ ] Check **feedrate** consistency - no sudden jumps
- [ ] Monitor for **over-travel** errors at limits
- [ ] Validate **arc radius** within machine limits
- [ ] Check **smoothness** on machine (smooth operation vs jerky)
- [ ] Verify **toolpath** matches expected geometry (touch probe test)
- [ ] Test **large-format** jobs (memory, buffer limits)
- [ ] Confirm **no syntax errors** in output (run through g-code validator)
- [ ] Test with **different controllers** if multi-machine environment

---

## Conclusion

These edge cases represent real-world failure modes not captured by the current unit test suite. Priority should be given to:

1. **Numerical stability** with extreme coordinates
2. **Modal state consistency** across unit/mode switches
3. **Helical arc** correctness (if used)
4. **Constraint enforcement** (radius, IJK limits)
5. **Malformed input** robustness
6. **Machine compatibility** with real controller limits

The existing StressTester covers many geometric scenarios but lacks integration-level edge cases involving file parsing, modal state, machine constraints, and mixed command types.
