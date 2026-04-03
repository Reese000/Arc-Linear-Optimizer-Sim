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

async function loadData(seed = 123456) {
    const type = document.getElementById('path-type').value;
    const response = await fetch(`/api/generate?seed=${seed}&type=${type}&tolerance=0.05`);
    const data = await response.json();
    
    document.getElementById('seed-input').value = data.seed;
    document.getElementById('orig-count').innerText = data.summary.origCount;
    document.getElementById('opt-count').innerText = data.summary.optCount;
    
    const compression = ((1 - data.summary.optCount / data.summary.origCount) * 100).toFixed(1);
    document.getElementById('compression-msg').innerText = `Reduction: ${compression}%`;

    renderIdeal(data.groundTruth);
    renderOriginal(data.original);
    renderOptimized(data.optimizedStrings, data.original[0]);
}

function regenerate() {
    const seed = document.getElementById('seed-input').value;
    loadData(seed);
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
            const match = line.match(/(G[23]) X([-+]?\d*\.?\d+) Y([-+]?\d*\.?\d+) I([-+]?\d*\.?\d+) J([-+]?\d*\.?\d+)/);
            if (match) {
                const [_, mode, x, y, i, j] = match;
                const end = { x: parseFloat(x), y: parseFloat(y), z: current.z };
                const center = { x: current.x + parseFloat(i), y: current.y + parseFloat(j) };
                const segments = arcToSegments(current, end, center, mode === 'G3');
                points.push(...segments);
                current = end;
            }
        } else if (line.indexOf('X') !== -1 || line.indexOf('Y') !== -1) {
            // Very basic line parser for optimization report strings
            const xMatch = line.match(/X([-+]?\d*\.?\d+)/);
            const yMatch = line.match(/Y([-+]?\d*\.?\d+)/);
            const next = { 
                x: xMatch ? parseFloat(xMatch[1]) : current.x, 
                y: yMatch ? parseFloat(yMatch[1]) : current.y, 
                z: current.z 
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

function arcToSegments(start, end, center, isCCW) {
    const points = [];
    const radius = Math.sqrt(Math.pow(start.x - center.x, 2) + Math.pow(start.y - center.y, 2));
    let startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    let endAngle = Math.atan2(end.y - center.y, end.x - center.x);

    if (!isCCW && startAngle < endAngle) startAngle += 2 * Math.PI;
    if (isCCW && endAngle < startAngle) endAngle += 2 * Math.PI;

    const angleDiff = endAngle - startAngle;
    const steps = 30;

    for (let i = 0; i <= steps; i++) {
        const theta = startAngle + (angleDiff * (i / steps));
        points.push(new THREE.Vector3(
            center.x + radius * Math.cos(theta),
            center.y + radius * Math.sin(theta),
            start.z
        ));
    }
    return points;
}

window.loadData = loadData;
window.regenerate = regenerate;
window.randomizeSeed = randomizeSeed;
window.toggleLayer = toggleLayer;

init();
loadData(123456);
