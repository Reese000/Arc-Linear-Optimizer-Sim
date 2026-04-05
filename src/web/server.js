const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const GCodeParser = require('../core/GCodeParser');
const ArcFitter = require('../core/ArcFitter');
const TestCaseGenerator = require('../sim/TestCaseGenerator');
const AIOptimizer = require('../ai/Optimizer');

const app = express();
const PORT = 3005;
const GCODE_DIR = path.join(process.cwd(), 'gcode');

// Ensure gcode directory exists
if (!fs.existsSync(GCODE_DIR)) {
    fs.mkdirSync(GCODE_DIR, { recursive: true });
}

console.log(`[${new Date().toISOString()}] >>> SERVER STARTING ON PORT ${PORT} <<<`);

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
    next();
});

// CORS support
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Standardized error response helper
function sendError(res, status, message) {
    res.status(status).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString()
    });
}

// Standardized success response helper
function sendSuccess(res, data) {
    res.json({
        success: true,
        data: data,
        timestamp: new Date().toISOString()
    });
}

/**
 * API: Returns toolpath segments for original and optimized files.
 * Supports Haas constraint parameters: tolerance, minArcRadius, maxArcRadius, maxIJK, allowHelix
 */
console.log("Registering GET /api/toolpath");
app.get('/api/toolpath', async (req, res) => {
    const fileName = req.query.file || 'test_linear.nc';

    // Sanitize file name - prevent path traversal
    const safeFileName = path.basename(fileName);
    if (!safeFileName.endsWith('.nc') && !safeFileName.endsWith('.txt')) {
        return sendError(res, 400, 'Invalid file type. Only .nc or .txt files allowed.');
    }

    const filePath = path.join(GCODE_DIR, safeFileName);

    if (!fs.existsSync(filePath)) {
        return sendError(res, 404, `File not found: ${safeFileName}`);
    }

    try {
        const tolerance = parseFloat(req.query.tolerance) || 0.001;
        const constraints = {
            minArcRadius: parseFloat(req.query.minArcRadius) || 0,
            maxArcRadius: parseFloat(req.query.maxArcRadius) || Infinity,
            maxIJK: parseFloat(req.query.maxIJK) || Infinity,
            allowHelix: req.query.allowHelix === 'true',
            ransac: req.query.ransac === 'true'
        };

        const parser = new GCodeParser();
        const originalData = await parser.parseFile(filePath);

        const fitter = new ArcFitter(tolerance, constraints);
        const optimizedStrings = fitter.optimize(originalData);

        // Convert parsed state data to a simple line segment array for the frontend
        const originalSegments = originalData.map(d => ({
            x: d.state.x,
            y: d.state.y,
            z: d.state.z
        }));

        sendSuccess(res, {
            original: originalSegments,
            optimizedStrings: optimizedStrings,
            summary: {
                origCount: originalData.length,
                optCount: optimizedStrings.length,
                arcsGenerated: fitter.lastArcs ? fitter.lastArcs.length : 0,
                linearsGenerated: fitter.lastLinearsCount || 0
            },
            constraints: constraints,
            stats: {
                arcs: fitter.lastArcs || [],
                arcStats: fitter.lastArcs ? {
                    totalArcs: fitter.lastArcs.length,
                    avgSweepDegrees: fitter.lastArcs.reduce((sum, a) => sum + a.sweepDegrees, 0) / fitter.lastArcs.length,
                    maxSweepDegrees: Math.max(...fitter.lastArcs.map(a => a.sweepDegrees))
                } : null
            }
        });
    } catch (err) {
        console.error('Error processing toolpath:', err);
        return sendError(res, 500, `Internal server error: ${err.message}`);
    }
});

/**
 * API: Generates a new toolpath from a seed.
 * Supports Haas constraint parameters: tolerance, minArcRadius, maxArcRadius, maxIJK, allowHelix
 */
console.log("Registering GET /api/generate");
app.get('/api/generate', async (req, res) => {
    const seed = parseInt(req.query.seed) || Math.floor(Math.random() * 1000000);
    const generator = new TestCaseGenerator();
    const tolerance = parseFloat(req.query.tolerance) || 0.05;
    const type = (req.query.type || 'CIRCLE').toUpperCase();

      // Haas constraints from query params
      const constraints = {
          minArcRadius: parseFloat(req.query.minArcRadius) || 0,
          maxArcRadius: parseFloat(req.query.maxArcRadius) || Infinity,
          maxIJK: parseFloat(req.query.maxIJK) || Infinity,
          minSweep: parseFloat(req.query.minSweep) || 5, // minimum arc sweep in degrees
          allowHelix: req.query.allowHelix === 'true',
          ransac: req.query.ransac !== undefined ? req.query.ransac === 'true' : true, // default RANSAC on
          bidirectional: req.query.bidirectional !== undefined ? req.query.bidirectional === 'true' : true // default on
      };

     try {
         let result;
         const jitter = 0.0005; // Use jitter smaller than default tolerance (0.001)
         if (type === 'SPIRAL') {
             // Spiral: 5 to 25 radius, 3 turns, 200 points
             result = generator.generateSpiral(0, 0, 5, 25, 3, 200, { seed, jitter });
         } else if (type === 'SCURVE') {
             result = generator.generateSCurve({ seed, length: 50, amplitude: 5, wavelength: 25, jitter });
         } else if (type === 'ZIGZAG') {
             result = generator.generateZigZag({ seed, length: 50, width: 10, count: 15, jitter });
         } else {
             // Default: CIRCLE
             const radius = 10 + (seed % 20);
             const segments = 100 + (seed % 400);
             result = generator.generateCircle(0, 0, radius, segments, { seed, jitter });
         }

         const { degraded, groundTruth, gcode } = result;

         // Optimize the degraded path by parsing the G-code (handles G0/G1 properly)
         const parser = new GCodeParser();
         const parsedData = await parser.parseFileContent(gcode);

         const fitter = new ArcFitter(tolerance, constraints);
         const optimizedStrings = fitter.optimize(parsedData);

         // Compute deviation statistics using Verifier
         let deviationStats = null;
         if (fitter.lastArcs && fitter.lastArcs.length > 0) {
           const Verifier = require('../sim/Verifier');
           const verifier = new Verifier(tolerance);
           const deviations = [];
           let withinTolCount = 0;
           fitter.lastArcs.forEach(arc => {
             // Use the arc's effective tolerance if available, otherwise default tolerance
             const arcTol = arc.effectiveTolerance || tolerance;
             const v = new Verifier(arcTol);
             const result = v.verify(arc.originalPoints, arc.circle, arc.start, arc.end);
             deviations.push(result.maxDeviation);
             if (result.isSafe) withinTolCount++;
           });
           const avgDev = deviations.reduce((a,b)=>a+b,0) / deviations.length;
           const maxDev = Math.max(...deviations);
           deviationStats = {
             average: avgDev,
             max: maxDev,
             arcsWithinTolerance: withinTolCount,
             totalArcs: fitter.lastArcs.length,
             percentWithin: (withinTolCount / fitter.lastArcs.length * 100).toFixed(1)
           };
         }

         sendSuccess(res, {
             seed: seed,
             original: parsedData.map(d => ({ x: d.state.x, y: d.state.y, z: d.state.z })),
             originalGcode: gcode.split('\n').filter(l => l.trim() !== ''),
             groundTruth: groundTruth,
             optimizedStrings: optimizedStrings,
             summary: {
                 origCount: parsedData.length,
                 optCount: optimizedStrings.length,
                 arcsGenerated: fitter.lastArcs ? fitter.lastArcs.length : 0,
                 linearsGenerated: fitter.lastLinearsCount || 0
             },
             constraints: constraints,
             stats: {
                 arcs: fitter.lastArcs || [],
                 arcStats: fitter.lastArcs ? {
                     totalArcs: fitter.lastArcs.length,
                     avgSweepDegrees: fitter.lastArcs.reduce((sum, a) => sum + a.sweepDegrees, 0) / fitter.lastArcs.length,
                     maxSweepDegrees: Math.max(...fitter.lastArcs.map(a => a.sweepDegrees))
                 } : null,
                 deviation: deviationStats
             }
         });
    } catch (err) {
        console.error('Error generating toolpath:', err);
        return sendError(res, 500, `Internal server error: ${err.message}`);
    }
});
 
/**
 * API: AI-guided parameter optimization to find best arc fitting configuration.
 * Accepts a file name and search space parameters (arrays as comma-separated or single values).
 * Runs multiple optimizations in parallel and returns the best result.
 */
console.log("Registering GET /api/ai_optimize");
app.get('/api/ai_optimize', async (req, res) => {
    const fileName = req.query.file || 'test_linear.nc';
    const safeFileName = path.basename(fileName);
    if (!safeFileName.endsWith('.nc') && !safeFileName.endsWith('.txt')) {
        return sendError(res, 400, 'Invalid file type. Only .nc or .txt files allowed.');
    }
    const filePath = path.join(GCODE_DIR, safeFileName);
    if (!fs.existsSync(filePath)) {
        return sendError(res, 404, `File not found: ${safeFileName}`);
    }

    try {
        const gcode = fs.readFileSync(filePath, 'utf8');

        // Build search space from query parameters
        const parseValue = (v) => {
            if (v === undefined || v === null) return undefined;
            const num = Number(v);
            return isNaN(num) ? v : num;
        };
        const parseArray = (param) => {
            if (param === undefined) return undefined;
            if (Array.isArray(param)) return param;
            if (typeof param === 'string' && param.includes(',')) {
                return param.split(',').map(parseValue);
            }
            return [parseValue(param)];
        };

        const searchSpace = {};
        const numericKeys = ['tolerance', 'minSweep', 'maxSearch', 'minArcRadius', 'maxArcRadius', 'maxIJK'];
        numericKeys.forEach(key => {
            const val = req.query[key];
            if (val !== undefined) {
                const arr = parseArray(val);
                if (arr) searchSpace[key] = arr;
            }
        });
        // Boolean flags
        if (req.query.useRANSAC !== undefined) {
            const arr = parseArray(req.query.useRANSAC);
            if (arr) searchSpace.useRANSAC = arr.map(v => v === true || v === 'true');
        }
         if (req.query.bidirectional !== undefined) {
             const arr = parseArray(req.query.bidirectional);
             if (arr) searchSpace.bidirectional = arr.map(v => v === true || v === 'true');
         }
         if (req.query.allowHelix !== undefined) {
             const arr = parseArray(req.query.allowHelix);
             if (arr) searchSpace.allowHelix = arr.map(v => v === true || v === 'true');
         }
         // Number of samples (trials)
        const samples = parseInt(req.query.samples) || 20;
        // Number of workers
        const numWorkers = parseInt(req.query.numWorkers) || Math.max(1, Math.floor(require('os').cpus().length / 2));

        const optimizer = new AIOptimizer({ numWorkers });
        const outcome = await optimizer.optimize(gcode, searchSpace, samples);

        sendSuccess(res, outcome);
    } catch (err) {
        console.error('AI optimization error:', err);
        return sendError(res, 500, `AI optimization failed: ${err.message}`);
    }
});

// File upload endpoint...
const upload = multer({
    dest: GCODE_DIR,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.nc' || ext === '.txt') {
            cb(null, true);
        } else {
            cb(new Error('Only .nc and .txt files are allowed'));
        }
    }
});

console.log("Registering POST /api/upload");
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return sendError(res, 400, 'No file uploaded');
        }

        const originalName = req.file.originalname;
        const safeName = path.basename(originalName);
        const targetPath = path.join(GCODE_DIR, safeName);

        // Rename the uploaded file to safeName (move from multer temp)
        fs.renameSync(req.file.path, targetPath);

        return sendSuccess(res, {
            message: 'File uploaded successfully',
            filename: safeName,
            size: req.file.size,
            path: targetPath
        });
    } catch (err) {
        console.error('Upload error:', err);
        return sendError(res, 500, `Upload failed: ${err.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`\n✅ Visualizer Server running at http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop.\n`);
});
