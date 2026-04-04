const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const GCodeParser = require('../core/GCodeParser');
const ArcFitter = require('../core/ArcFitter');
const TestCaseGenerator = require('../sim/TestCaseGenerator');

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
            allowHelix: req.query.allowHelix === 'true'
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
        allowHelix: req.query.allowHelix === 'true'
    };

    try {
        let result;
        if (type === 'SPIRAL') {
            result = generator.generateSpiral(0, 0, 5, 25, { seed, jitter: 0.002 });
        } else if (type === 'SCURVE') {
            result = generator.generateSCurve({ seed, length: 50, amplitude: 5, wavelength: 25, jitter: 0.002 });
        } else if (type === 'ZIGZAG') {
            result = generator.generateZigZag({ seed, length: 50, width: 10, count: 15, jitter: 0.002 });
        } else {
            // Default: CIRCLE
            const radius = 10 + (seed % 20);
            const segments = 100 + (seed % 400);
            result = generator.generateCircle(0, 0, radius, segments, { seed, jitter: 0.002 });
        }

        const { degraded, groundTruth } = result;

        // Optimize the degraded path
        const parser = new GCodeParser();
        const parsedData = degraded.map(p => {
             parser.state.updateFromCommand({ X: p.x, Y: p.y, Z: p.z, G: [1] });
             return { state: parser.state.clone(), cmd: { G: [1], X: p.x, Y: p.y, Z: p.z } };
         });

        const fitter = new ArcFitter(tolerance, constraints);
        const optimizedStrings = fitter.optimize(parsedData);

        sendSuccess(res, {
            seed: seed,
            original: degraded,
            groundTruth: groundTruth,
            optimizedStrings: optimizedStrings,
            summary: {
                origCount: degraded.length,
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
        console.error('Error generating toolpath:', err);
        return sendError(res, 500, `Internal server error: ${err.message}`);
    }
});

// File upload endpoint for custom .nc files
const multer = require('multer');
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
