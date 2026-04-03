const express = require('express');
const fs = require('fs');
const path = require('path');
const GCodeParser = require('../core/GCodeParser');
const ArcFitter = require('../core/ArcFitter');
const TestCaseGenerator = require('../sim/TestCaseGenerator');

const app = express();
const PORT = 3005;

console.log(`[${new Date().toISOString()}] >>> SERVER STARTING ON PORT ${PORT} <<<`);

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

/**
 * API: Returns toolpath segments for original and optimized files.
 */
console.log("Registering GET /api/toolpath");
app.get('/api/toolpath', async (req, res) => {
    const fileName = req.query.file || 'test_linear.nc';
    const filePath = path.join(process.cwd(), fileName);
    const tolerance = parseFloat(req.query.tolerance) || 0.001;

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    try {
        const parser = new GCodeParser();
        const originalData = await parser.parseFile(filePath);
        
        const fitter = new ArcFitter(tolerance);
        const optimizedStrings = fitter.optimize(originalData);

        // Convert parsed state data to a simple line segment array for the frontend
        const originalSegments = originalData.map(d => ({ x: d.state.x, y: d.state.y, z: d.state.z }));
        
        // We'll return the strings for now, the client can parse the optimized G2/G3 or we can enrich this
        res.json({
            original: originalSegments,
            optimizedStrings: optimizedStrings,
            summary: {
                origCount: originalData.length,
                optCount: optimizedStrings.length
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * API: Generates a new toolpath from a seed.
 */
console.log("Registering GET /api/generate");
app.get('/api/generate', async (req, res) => {
    const seed = parseInt(req.query.seed) || Math.floor(Math.random() * 1000000);
    const generator = new TestCaseGenerator();
    const tolerance = parseFloat(req.query.tolerance) || 0.05;
    const type = (req.query.type || 'CIRCLE').toUpperCase();

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
             parser.state.updateFromCommand({ X: p.x, Y: p.y, G: [1] });
             return { state: parser.state.clone(), cmd: { G: [1] } };
        });

        const fitter = new ArcFitter(tolerance);
        const optimizedStrings = fitter.optimize(parsedData);

        res.json({
            seed: seed,
            original: degraded,
            groundTruth: groundTruth, // Expose ideal geometry
            optimizedStrings: optimizedStrings,
            summary: {
                origCount: degraded.length,
                optCount: optimizedStrings.length
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n✅ Visualizer Server running at http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop.\n`);
});
