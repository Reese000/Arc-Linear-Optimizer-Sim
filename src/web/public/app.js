import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// GeometryUtils: copy minimal needed functions
const GeometryUtils = {
  chordalError: function(radius, angle) {
    if (radius === 0) return 0;
    return radius * (1 - Math.cos(angle / 2));
  },
  maxStepAngleForTolerance: function(radius, tolerance) {
    if (radius === 0) return 2 * Math.PI;
    // Solve: radius*(1-cos(theta/2)) = tolerance => cos(theta/2) = 1 - tolerance/radius
    // For small tolerance/radius, use approximation: cos(x) ≈ 1 - x^2/2 => x = sqrt(2*tolerance/radius)
    // But use arccos for accuracy
    const ratio = 1 - tolerance / radius;
    if (ratio <= -1) return Math.PI; // max half-turn
    if (ratio >= 1) return 0;
    return 2 * Math.acos(ratio);
  },
  estimateSegments: function(radius, sweepRadians, tolerance) {
    if (radius === 0) return Math.ceil(sweepRadians / 0.1) + 3; // arbitrary for points
    const maxStepAngle = this.maxStepAngleForTolerance(radius, tolerance);
    const steps = Math.ceil(sweepRadians / maxStepAngle);
    // Ensure at least 3 segments for any arc
    return Math.max(3, steps);
  }
};

let scene, camera, renderer, controls;
let idealPath, originalPath, optimizedPath;
let deviationPath; // Heatmap showing radial deviation
let originalPoints = []; // Store point data for markers
let optimizedPoints = [];
let originalGcode = []; // Store G-code lines for comparison
let optimizedGcode = [];
let pointMarkers; // THREE.Points for showing endpoints/vertices
let currentFile = null; // Currently loaded file name (if any)
const showPoints = true; // Toggle to show point markers
const showDeviation = true; // Toggle deviation coloring

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121212);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(50, 50, 50);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    
    // Grid Helper
    const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2; // Make XY the floor plane
    scene.add(gridHelper);

    // Axis Helper
    const axesHelper = new THREE.AxesHelper(10);
    scene.add(axesHelper);

    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

 async function loadData(seed = 123456, file = null) {
      // If a file is specified, remember it for AI optimization
      if (file) {
          currentFile = file;
      }

      const type = document.getElementById('path-type').value;
      const tolerance = document.getElementById('constraint-tolerance').value;
      const minRadius = document.getElementById('constraint-min-radius').value;
      const maxRadius = document.getElementById('constraint-max-radius').value;
      const maxIJK = document.getElementById('constraint-max-ijk').value;
      const minSweep = document.getElementById('constraint-min-sweep').value;
      const allowHelix = document.getElementById('constraint-allow-helix').checked;
      const ransac = document.getElementById('constraint-ransac').checked;
      const bidirectional = document.getElementById('constraint-bidirectional').checked;

    // Show loading indicator
    const statusEl = document.getElementById('upload-status');
    if (statusEl) {
        statusEl.innerHTML = '⏳ Generating...';
        statusEl.style.color = '#ffeb3b';
    }

     let url;
     if (file) {
         url = `/api/toolpath?file=${encodeURIComponent(file)}&tolerance=${tolerance}&minArcRadius=${minRadius}&maxArcRadius=${maxRadius}&maxIJK=${maxIJK}&minSweep=${minSweep}&allowHelix=${allowHelix}&ransac=${ransac}&bidirectional=${bidirectional}`;
     } else {
         url = `/api/generate?seed=${seed}&type=${type}&tolerance=${tolerance}&minArcRadius=${minRadius}&maxArcRadius=${maxRadius}&maxIJK=${maxIJK}&minSweep=${minSweep}&allowHelix=${allowHelix}&ransac=${ransac}&bidirectional=${bidirectional}`;
     }

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to load data');
        }

         const payload = data.data;
         document.getElementById('seed-input').value = payload.seed || seed;
         document.getElementById('orig-count').innerText = payload.summary.origCount;
         document.getElementById('opt-count').innerText = payload.summary.optCount;

         const compression = ((1 - payload.summary.optCount / payload.summary.origCount) * 100).toFixed(1);
         document.getElementById('compression-msg').innerText = `Reduction: ${compression}%`;

         // Show deviation stats if available
         const devEl = document.getElementById('deviation-stats');
         if (payload.stats && payload.stats.deviation) {
           const d = payload.stats.deviation;
           const tol = parseFloat(tolerance);
           devEl.innerHTML = `
             <div class="stat">Deviation (max): <span style="color:${d.max <= tol ? '#4caf50' : '#f44336'}">${d.max.toFixed(6)}</span> mm</div>
             <div class="stat">Deviation (avg): <span>${d.average.toFixed(6)}</span> mm</div>
             <div class="stat">Arcs within tol: <span>${d.percentWithin}%</span> (${d.arcsWithinTolerance}/${d.totalArcs})</div>
           `;
         } else {
           devEl.innerHTML = '';
         }

     if (payload.groundTruth) {
         renderIdeal(payload.groundTruth);
     } else {
         // No ideal geometry available (e.g., custom file upload); hide ideal layer
         if (idealPath) idealPath.visible = false;
         document.getElementById('show-ideal').checked = false;
     }
     renderOriginal(payload.original);
     // Use originalGcode from server if available
     originalGcode = payload.originalGcode || [];
     renderOptimized(payload.optimizedStrings, payload.original[0], payload.stats ? payload.stats.arcs : null);

        if (statusEl) {
            statusEl.innerHTML = '✅ Done!';
            statusEl.style.color = '#4caf50';
            setTimeout(() => { statusEl.innerHTML = ''; }, 2000);
        }
    } catch (err) {
        console.error('Load error:', err);
        if (statusEl) {
            statusEl.innerHTML = `❌ ${err.message}`;
            statusEl.style.color = '#f44336';
        }
        alert(`Error: ${err.message}`);
    }
}

function regenerate() {
    const seed = document.getElementById('seed-input').value;
    loadData(seed);
}

async function uploadFile() {
    const fileInput = document.getElementById('file-upload');
    const file = fileInput.files[0];
    if (!file) {
        alert('Please select a file to upload.');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

     try {
         const response = await fetch('/api/upload', {
             method: 'POST',
             body: formData
         });
         const data = await response.json();

         if (!response.ok || !data.success) {
             throw new Error(data.error || 'Upload failed');
         }

         // Store current file for AI optimization
         currentFile = data.data.filename;
         // Load the uploaded file
         await loadData(null, data.data.filename);

    } catch (err) {
        console.error('Upload error:', err);
        alert(`Upload failed: ${err.message}`);
    }
}

function toggleLayer(type) {
    if (type === 'ideal' && idealPath) idealPath.visible = document.getElementById('show-ideal').checked;
    if (type === 'original' && originalPath) originalPath.visible = document.getElementById('show-orig').checked;
    if (type === 'optimized' && optimizedPath) optimizedPath.visible = document.getElementById('show-opt').checked;
}

function randomizeSeed() {
    const newSeed = Math.floor(Math.random() * 1000000);
    document.getElementById('seed-input').value = newSeed;
    loadData(newSeed);
}

async function aiOptimize() {
    if (!currentFile) {
        alert('Please upload a G-code file first to use AI optimization.');
        return;
    }
    const statusEl = document.getElementById('ai-status');
    if (!statusEl) return;
    statusEl.innerHTML = '⏳ AI optimizing... (evaluating parameter combinations)';
    statusEl.style.color = '#ffeb3b';

    try {
        // Fixed parameters: we send constraints as single values (they will be fixed in searchSpace)
        const minRadius = document.getElementById('constraint-min-radius').value;
        const maxRadius = document.getElementById('constraint-max-radius').value;
        const maxIJK = document.getElementById('constraint-max-ijk').value;
        const allowHelix = document.getElementById('constraint-allow-helix').checked;
        // Search space: vary these parameters
        const searchParams = {
            tolerance: '0.005,0.01,0.02',
            minSweep: '5,10',
            useRANSAC: 'true,false',
            bidirectional: 'true,false',
            maxSearch: '50,100'
        };
        // Build query
        let url = `/api/ai_optimize?file=${encodeURIComponent(currentFile)}&samples=20&numWorkers=4`;
        // Add fixed constraints (single values)
        url += `&minArcRadius=${encodeURIComponent(minRadius)}&maxArcRadius=${encodeURIComponent(maxRadius)}&maxIJK=${encodeURIComponent(maxIJK)}&allowHelix=${allowHelix}`;
        // Add search space parameters
        for (const [key, val] of Object.entries(searchParams)) {
            url += `&${key}=${encodeURIComponent(val)}`;
        }

        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'AI optimization failed');
        }
        const outcome = data.data;
        const best = outcome.bestResult;

        // Update stats
        document.getElementById('orig-count').innerText = originalPoints.length;
        document.getElementById('opt-count').innerText = best.lineCount;
        const compression = ((1 - best.lineCount / originalPoints.length) * 100).toFixed(1);
        document.getElementById('compression-msg').innerText = `Reduction: ${compression}% (AI score: ${best.quality})`;

        // Render optimized G-code
        renderOptimized(best.optimized, originalPoints[0], best.arcs);

        statusEl.innerHTML = '✅ AI optimization complete!';
        statusEl.style.color = '#4caf50';
        setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
    } catch (err) {
        console.error('AI error:', err);
        statusEl.innerHTML = `❌ Error: ${err.message}`;
        statusEl.style.color = '#f44336';
    }
}
    const statusEl = document.getElementById('ai-status');
    if (!statusEl) return;
    statusEl.innerHTML = '⏳ AI optimizing... (evaluating parameter combinations)';
    statusEl.style.color = '#ffeb3b';
    try {
        // Use current constraint values as base; AI will sample around them
        const samples = 20; // could be made configurable
        const numWorkers = 4;
        const url = `/api/ai_optimize?file=${encodeURIComponent(currentFile)}&samples=${samples}&numWorkers=${numWorkers}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'AI optimization failed');
        }
        const outcome = data.data;
        const best = outcome.bestResult;
        // Update stats
        document.getElementById('orig-count').innerText = originalPoints.length;
        document.getElementById('opt-count').innerText = best.lineCount;
        const compression = ((1 - best.lineCount / originalPoints.length) * 100).toFixed(1);
        document.getElementById('compression-msg').innerText = `Reduction: ${compression}% (AI score: ${best.quality})`;
        // Render optimized G-code
        renderOptimized(best.optimized, originalPoints[0], best.stats ? best.stats.arcs : null);
        statusEl.innerHTML = '✅ AI optimization complete!';
        statusEl.style.color = '#4caf50';
        setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
    } catch (err) {
        console.error('AI error:', err);
        statusEl.innerHTML = `❌ Error: ${err.message}`;
        statusEl.style.color = '#f44336';
    }
}

function renderIdeal(segments) {
    if (idealPath) scene.remove(idealPath);
    const geometry = new THREE.BufferGeometry().setFromPoints(
        segments.map(p => new THREE.Vector3(p.x, p.y, p.z + 0.05))
    );
    const material = new THREE.LineBasicMaterial({ color: 0x00bcd4, linewidth: 2 });
    idealPath = new THREE.Line(geometry, material);
    scene.add(idealPath);
}

function renderOriginal(segments) {
    if (originalPath) scene.remove(originalPath);
    if (pointMarkers) scene.remove(pointMarkers);

    // Store points for markers
    originalPoints = segments;

    const geometry = new THREE.BufferGeometry().setFromPoints(
        segments.map(p => new THREE.Vector3(p.x, p.y, p.z + 0.1))
    );
    const material = new THREE.LineBasicMaterial({ color: 0xff5722, linewidth: 2 });
    originalPath = new THREE.Line(geometry, material);
    scene.add(originalPath);

    // Create point markers (small spheres) at each point
    if (showPoints) {
        const markerGeom = new THREE.BufferGeometry();
        const markerPositions = [];
        const markerSizes = [];
        segments.forEach(p => {
            markerPositions.push(p.x, p.y, p.z + 0.12);
            markerSizes.push(0.15); // size for each point
        });
        markerGeom.setAttribute('position', new THREE.Float32BufferAttribute(markerPositions, 3));
        const markerMaterial = new THREE.PointsMaterial({ color: 0xff5722, size: 0.3, sizeAttenuation: true });
        pointMarkers = new THREE.Points(markerGeom, markerMaterial);
        scene.add(pointMarkers);
    }
}

function renderOptimized(strings, startPoint, arcStats) {
    if (optimizedPath) scene.remove(optimizedPath);
    if (deviationPath) scene.remove(deviationPath);

    // Store G-code for comparison panel
    optimizedGcode = Array.isArray(strings) ? strings : [strings];

    const points = [];
    let current = { x: startPoint.x, y: startPoint.y, z: startPoint.z };

    optimizedGcode.forEach(line => {
        line = line.trim();
        if (line.startsWith('G2') || line.startsWith('G3')) {
            // Match G2/G3 with optional Z and F
            const match = line.match(/(G[23])\s+X([-+]?\d*\.?\d+)\s+Y([-+]?\d*\.?\d+)(?:\s+Z([-+]?\d*\.?\d+))?\s+I([-+]?\d*\.?\d+)\s+J([-+]?\d*\.?\d+)(?:\s+F([\d.]+))?/);
            if (match) {
                const [_, mode, x, y, zVal, i, j] = match;
                const end = {
                    x: parseFloat(x),
                    y: parseFloat(y),
                    z: zVal !== undefined ? parseFloat(zVal) : current.z
                };
                const center = { x: current.x + parseFloat(i), y: current.y + parseFloat(j) };
                const isCCW = mode === 'G3';
                const segments = arcToSegments(current, end, center, isCCW, 0.001);
                points.push(...segments);
                current = end;
            }
        } else if (line.startsWith('G0') || line.startsWith('G1')) {
            const xMatch = line.match(/X([-+]?\d*\.?\d+)/);
            const yMatch = line.match(/Y([-+]?\d*\.?\d+)/);
            const zMatch = line.match(/Z([-+]?\d*\.?\d+)/);
            const next = {
                x: xMatch ? parseFloat(xMatch[1]) : current.x,
                y: yMatch ? parseFloat(yMatch[1]) : current.y,
                z: zMatch ? parseFloat(zMatch[1]) : current.z
            };
            points.push(new THREE.Vector3(next.x, next.y, next.z));
            current = next;
        }
    });

    optimizedPoints = points;

    const geometry = new THREE.BufferGeometry().setFromPoints(
        points.map(p => new THREE.Vector3(p.x, p.y, p.z + 0.15))
    );
    const material = new THREE.LineBasicMaterial({ color: 0x4caf50, linewidth: 4 });
    optimizedPath = new THREE.Line(geometry, material);
    scene.add(optimizedPath);

    // Update code panel
    renderCodePanel();

    // If we have arcStats with originalPoints and circles, render deviation heatmap on original path
    if (arcStats && arcStats.arcs && showDeviation) {
        renderDeviationOverlay(arcStats.arcs);
    }
}

function renderDeviationOverlay(arcs) {
    if (!arcs || arcs.length === 0) return;

    const deviationPositions = [];
    const deviationColors = [];
    const tolerance = 0.01; // Use same tolerance as optimization (could be passed from server)

    arcs.forEach(arc => {
        const circle = arc.circle;
        const radius = circle.radius;
        const cx = circle.center.x;
        const cy = circle.center.y;

        // Color map: green (0) -> yellow (0.5*tol) -> red (tol) -> magenta (>tol)
        const getColor = (dev) => {
            const t = Math.min(dev / tolerance, 1.0);
            // Interpolate: green (0,1,0) -> yellow (1,1,0) -> red (1,0,0) -> magenta (1,0,1)
            if (t < 0.5) {
                // green to yellow
                const local = t * 2;
                return new THREE.Color(local, 1, 0);
            } else if (t < 0.75) {
                // yellow to red
                const local = (t - 0.5) * 4;
                return new THREE.Color(1, 1 - local, 0);
            } else {
                // red to magenta
                const local = (t - 0.75) * 4;
                return new THREE.Color(1, 0, local);
            }
        };

        // For each original point in this arc, compute radial deviation
        (arc.originalPoints || []).forEach(p => {
            const dist = Math.hypot(p.x - cx, p.y - cy);
            const dev = Math.abs(dist - radius);
            deviationPositions.push(p.x, p.y, p.z + 0.12); // Slightly above original
            const color = getColor(dev);
            deviationColors.push(color.r, color.g, color.b);
        });
    });

    if (deviationPositions.length === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(deviationPositions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(deviationColors, 3));

    const mat = new THREE.PointsMaterial({
        size: 0.4,
        vertexColors: true,
        sizeAttenuation: true
    });
    deviationPath = new THREE.Points(geom, mat);
    scene.add(deviationPath);
}

function arcToSegments(start, end, center, isCCW, tolerance = 0.001) {
    const points = [];
    const radius = Math.sqrt(Math.pow(start.x - center.x, 2) + Math.pow(start.y - center.y, 2));
    let startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    let endAngle = Math.atan2(end.y - center.y, end.x - center.x);

    if (!isCCW && startAngle < endAngle) startAngle += 2 * Math.PI;
    if (isCCW && endAngle < startAngle) endAngle += 2 * Math.PI;

    let angleDiff = endAngle - startAngle;
    const TWOPI = 2 * Math.PI;
    if (angleDiff < 0) angleDiff += TWOPI;

    // Use adaptive tessellation based on radius and tolerance
    const numSteps = Math.max(3, Math.ceil(GeometryUtils.estimateSegments(radius, angleDiff, tolerance)));

    // Helical: interpolate Z linearly
    const zStart = start.z;
    const zEnd = end.z;
    const hasZChange = Math.abs(zEnd - zStart) > 1e-9;

    for (let i = 0; i <= numSteps; i++) {
        const theta = startAngle + (angleDiff * (i / numSteps));
        const x = center.x + radius * Math.cos(theta);
        const y = center.y + radius * Math.sin(theta);
        let z = zStart;
        if (hasZChange) {
            z = zStart + (zEnd - zStart) * (i / numSteps);
        }
        points.push(new THREE.Vector3(x, y, z));
    }
    return points;
}

window.loadData = loadData;
window.regenerate = regenerate;
window.randomizeSeed = randomizeSeed;
window.aiOptimize = aiOptimize;
window.toggleLayer = toggleLayer;
window.uploadFile = uploadFile;
window.toggleCodeView = toggleCodeView;

function renderCodePanel() {
    const container = document.getElementById('code-list');
    const view = document.querySelector('input[name="code-view"]:checked').value;
    const gcode = view === 'original' ? originalGcode : optimizedGcode;

    if (!gcode || gcode.length === 0) {
        container.innerHTML = '<div style="color: #aaa;">No G-code available</div>';
        return;
    }

    const linesHtml = gcode.map((line, idx) => {
        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="code-line" data-index="${idx}" onmouseover="highlightSegment(${idx})" style="cursor: pointer; padding: 2px 0; border-bottom: 1px solid #333;">${(idx+1).toString().padStart(4)}: ${escaped}</div>`;
    }).join('');

    container.innerHTML = `<div style="max-height: 60vh; overflow-y: auto;">${linesHtml}</div>`;
}

function toggleCodeView(view) {
    renderCodePanel();
}

// Optional: highlight corresponding 3D segment when hovering G-code line
window.highlightSegment = function(lineIndex) {
    // Not implemented yet - could flash a segment or change color
    console.log('Hovered G-code line:', lineIndex);
};

init();
loadData(123456);
