# AI Parameter Optimizer

## Overview

The AI Optimizer automatically searches for the best arc-fitting parameters for a given G-code toolpath. It runs many optimization trials in parallel, each with a different parameter combination, and selects the one with the highest quality score.

**Quality Score** (0-100) combines:
- **Compression (60%)**: percentage reduction in line count
- **Accuracy (30%)**: all arcs must pass geometric verification (100 if all valid, else 0)
- **Stability (10%)**: penalizes many tiny arcs (<5°), arcs >180°, and high radius variation

## Using the Web UI

1. Upload your G-code file using the file picker.
2. Set your Haas constraints (tolerance, min/max radius, max IJK, min sweep).
3. Click **✨ AI Optimize (Sweep Parameters)**.
4. The system will run up to 20 trials (configurable) and display the best result.

## API Endpoint: `/api/ai_optimize`

**Method:** GET

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string (required) | Uploaded filename in `gcode/` directory |
| `samples` | integer (optional) | Number of parameter combinations to try (default: 20) |
| `workers` | integer (optional) | Number of parallel worker threads (default: auto, CPU count) |
| `tolerance` | float or comma-separated (optional) | Tolerance values to explore (e.g., `0.005,0.01,0.02`) |
| `minSweep` | int or comma-separated (optional) | Minimum arc sweep in degrees (e.g., `5,10`) |
| `maxSweep` | int (optional) | Maximum arc sweep in degrees (default: 360) |
| `maxSearch` | int or comma-separated (optional) | Maximum window search depth (e.g., `50,100`) |
| `ransacIterations` | int (optional) | Number of RANSAC iterations (default: 100) |
| `minArcRadius` | float or comma-separated (optional) | Minimum arc radius |
| `maxArcRadius` | float or comma-separated (optional) | Maximum arc radius |
| `maxIJK` | float or comma-separated (optional) | Maximum IJK magnitude |
| `useRANSAC` | true,false or comma-separated (optional) | Enable RANSAC robust fitting |
| `bidirectional` | true,false or comma-separated (optional) | Search backward and forward |

**Example:**
```
/api/ai_optimize?file=part.nc&samples=30&workers=4&tolerance=0.005,0.01,0.02&minSweep=5,10&maxSweep=360&ransacIterations=100&useRANSAC=true,false&bidirectional=true
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bestResult": {
      "optimized": [ "G2 X... Y... I... J...", ... ],
      "arcs": [ { start, end, circle, direction, sweepDegrees, originalPoints, ... }, ... ],
      "quality": 65,
      "lineCount": 150,
      "arcCount": 12,
      "params": { tolerance: 0.01, minSweep: 5, useRANSAC: true, ... }
    },
    "bestScore": 65,
    "allResults": [ ... ],
    "statistics": {
      "totalTrials": 20,
      "successful": 20,
      "errors": 0,
      "avgQuality": 50.25,
      "avgArcCount": 8.3
    }
  },
  "timestamp": "2025-04-04T22:41:00.000Z"
}
```

## How It Works

1. The server spawns a pool of worker threads (each runs `src/workers/optimize.worker.js`).
2. For each parameter combination, a worker:
   - Parses the G-code
   - Creates an `ArcFitter` with those parameters
   - Runs `optimize()`
   - Computes quality score and statistics
3. Results are collected; the best (highest score) is returned.

## Parameter Trade‑offs

- **Tolerance**: Smaller tolerance → more linear moves, less compression; larger tolerance → more arcs but risk of deviation. Haas typical: 0.001" (0.0254mm) for finish, 0.01mm for medium.
- **minSweep**: Rejects arcs with very small angular extent. Increasing reduces jagged "sawtooth" arcs.
- **maxSweep**: Controls maximum allowed arc sweep. Set to 360 to permit full-circle arcs (default is 360). Reducing this can prevent long arcs that might exceed controller limits.
- **RANSAC**: Robust fitting reduces noise and outliers but adds computational cost (O(n) per fit).
- **ransacIterations**: More iterations increase RANSAC's robustness at the cost of CPU time. Default 100.
- **Bidirectional**: Improves arc continuity by searching both directions but increases runtime (~2× slower).
- **maxSearch**: Larger values allow longer arcs but increase runtime linearly.
- **Radius Constraints**: Ensure arcs stay within machine limits (Haas: max radius ~1000mm/inch, max IJK ~999.9999).
- **workers**: More worker threads improve parallelism on multi-core systems. Default is auto (CPU count). Too many may cause memory pressure.

## Performance Tips

- Use `workers` to parallelize; optimal is number of CPU cores.
- For quick exploration, use `samples=10` and `maxSearch=30`.
- For production, run `samples=50` and include RANSAC + bidirectional.

## Command‑Line Equivalent

The AI Optimizer essentially automates what you could do manually:
```bash
# Try several tolerances
for t in 0.005 0.01 0.02; do
  node main.js --input part.nc --tolerance $t --ransac --bidirectional --report
done
```
The AI method does this in parallel and picks the best automatically.
