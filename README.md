# Arc-Linear-Optimizer-Sim

A high-fidelity simulation environment for G-code linearization and arc fitting, optimized for non-HSM Haas CNC mills.

## Goal
To effectively optimize toolpaths generated using low-quality G-code (point-to-point line segments) into efficient, accurate, and gouge-free G-code using `G2`/`G3` arc commands.

## Key Features
- **G-code Linearization**: Subdividing complex toolpaths into high-resolution segments.
- **Bi-Arc Fitting**: Converting line segments to optimal arcs within a specified tolerance.
- **Gouge Protection**: Verification engine ensures the optimized toolpath never enters the part volume.
- **Haas Compatibility**: Built-in constraints for non-HSM Haas controllers (e.g., minimum segment length, radius limits).

## Architecture
- **Core Engine**: Node.js based geometric processing.
- **Simulation**: Headless coordinate verification and deviation reporting.
- **CLI**: Standard interface for processing `.nc` files.

---
*Created by Antigravity - Lead Systems Architect*
