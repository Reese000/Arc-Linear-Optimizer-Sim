import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let idealPath, originalPath, optimizedPath;

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
    const type = document.getElementById('path-type').value;
    const tolerance = document.getElementById('constraint-tolerance').value;
    const minRadius = document.getElementById('constraint-min-radius').value;
    const maxRadius = document.getElementById('constraint-max-radius').value;
    const maxIJK = document.getElementById('constraint-max-ijk').value;
    const allowHelix = document.getElementById('constraint-allow-helix').checked;
    const ransac = document.getElementById('constraint-ransac').checked;

    // Show loading indicator
    const statusEl = document.getElementById('upload-status');
    if (statusEl) {
        statusEl.innerHTML = '⏳ Generating...';
        statusEl.style.color = '#ffeb3b';
    }

    let url;
    if (file) {
        url = `/api/toolpath?file=${encodeURIComponent(file)}&tolerance=${tolerance}&minArcRadius=${minRadius}&maxArcRadius=${maxRadius}&maxIJK=${maxIJK}&allowHelix=${allowHelix}&ransac=${ransac}`;
    } else {
        url = `/api/generate?seed=${seed}&type=${type}&tolerance=${tolerance}&minArcRadius=${minRadius}&maxArcRadius=${maxRadius}&maxIJK=${maxIJK}&allowHelix=${allowHelix}&ransac=${ransac}`;
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

    if (payload.groundTruth) {
        renderIdeal(payload.groundTruth);
    } else {
        // No ideal geometry available (e.g., custom file upload); hide ideal layer
        if (idealPath) idealPath.visible = false;
        document.getElementById('show-ideal').checked = false;
    }
    renderOriginal(payload.original);
    renderOptimized(payload.optimizedStrings, payload.original[0]);

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
    
    const geometry = new THREE.BufferGeometry().setFromPoints(
        segments.map(p => new THREE.Vector3(p.x, p.y, p.z + 0.1))
    );
    const material = new THREE.LineBasicMaterial({ color: 0xff5722, linewidth: 2 });
    originalPath = new THREE.Line(geometry, material);
    scene.add(originalPath);
}

function renderOptimized(strings, startPoint) {
    if (optimizedPath) scene.remove(optimizedPath);

    const points = [];
    let current = startPoint;

    strings.forEach(line => {
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
                current = end; // Update current Z for subsequent moves
            }
        } else if (line.indexOf('X') !== -1 || line.indexOf('Y') !== -1) {
            // Very basic line parser for optimization report strings
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

    const geometry = new THREE.BufferGeometry().setFromPoints(
        points.map(p => new THREE.Vector3(p.x, p.y, p.z + 0.15))
    );
    const material = new THREE.LineBasicMaterial({ color: 0x4caf50, linewidth: 4 });
    optimizedPath = new THREE.Line(geometry, material);
    scene.add(optimizedPath);
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

    // Adaptive tessellation: ensure chordal error ≤ tolerance
    let stepAngle;
    if (radius > 0) {
        const maxStepAngle = 2 * Math.sqrt(2 * tolerance / radius);
        const numSteps = Math.max(3, Math.ceil(angleDiff / maxStepAngle));
        stepAngle = angleDiff / numSteps;
    } else {
        stepAngle = angleDiff / 30; // fallback
    }

    const numSteps = Math.ceil(angleDiff / stepAngle);

    // Helical: interpolate Z linearly
    const zStart = start.z;
    const zEnd = end.z;
    const hasZChange = Math.abs(zEnd - zStart) > 1e-9;

    for (let i = 0; i <= numSteps; i++) {
        const theta = startAngle + (stepAngle * i);
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
window.toggleLayer = toggleLayer;
window.uploadFile = uploadFile;

init();
loadData(123456);
