import * as THREE from 'three';

export class BowlingControls {
    constructor(canvas, camera, laneWidth, initZ, onThrow, onPositionChange) {
        this.canvas = canvas;
        this.camera = camera;
        this.laneWidth = laneWidth;
        this.initZ = initZ; // foul line Z, e.g. 2.0
        
        this.onThrow = onThrow; // callback when thrown: (velocity, spin)
        this.onPositionChange = onPositionChange; // callback when position shifts: (newX, newZ)

        this.ballX = 0;
        this.ballZ = initZ;
        this.startBallX = 0;
        this.pullbackRatio = 0;
        this.state = 'aiming'; // 'aiming', 'thrown', 'disabled'

        // Touch / Mouse Tracking
        this.isPointerDown = false;
        this.pointerStart = new THREE.Vector2();
        this.pointerCurrent = new THREE.Vector2();
        this.dragStartTime = 0;
        
        // Gesture parameters
        this.maxPositionOffset = laneWidth * 0.45; // limit how far the ball can slide horizontally

        this.dragPoints = []; // track points for curve/hook detection

        this.createInstructionOverlay();
        this.createPowerBar();
        this.setupListeners();
    }

    createInstructionOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'control-overlay';
        this.overlay.style.display = 'none'; // completely hide the overlay from the viewport
        document.body.appendChild(this.overlay);
    }

    createPowerBar() {
        this.powerBarContainer = document.createElement('div');
        this.powerBarContainer.id = 'power-bar-container';
        this.powerBarContainer.style.cssText = `
            position: absolute;
            bottom: 12%;
            left: 50%;
            transform: translateX(-50%);
            width: 240px;
            height: 18px;
            background: rgba(5, 0, 15, 0.9);
            border: 2px solid #00ffff;
            border-radius: 9px;
            box-shadow: 0 0 10px #00ffff;
            display: none;
            align-items: center;
            padding: 2px;
            box-sizing: border-box;
            z-index: 150;
            font-family: 'Orbitron', sans-serif;
            pointer-events: none;
            user-select: none;
            transition: border-color 0.15s, box-shadow 0.15s;
        `;
        this.powerBarContainer.innerHTML = `
            <div id="power-bar-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #00ffff, #ff00ff); border-radius: 5px; box-shadow: 0 0 8px #ff00ff; transition: width 0.05s ease-out;"></div>
            <div id="power-text" style="position: absolute; width: 100%; text-align: center; font-size: 10px; color: #fff; font-weight: bold; text-shadow: 0 0 4px #000; pointer-events: none; letter-spacing: 1px;">LAUNCH POWER: 0%</div>
        `;
        document.body.appendChild(this.powerBarContainer);
        this.powerBarFill = this.powerBarContainer.querySelector('#power-bar-fill');
        this.powerText = this.powerBarContainer.querySelector('#power-text');
    }

    showInstructions(visible) {
        if (this.overlay) {
            this.overlay.style.opacity = visible ? '1' : '0';
        }
    }

    setupListeners() {
        const onDown = (clientX, clientY) => {
            if (this.state !== 'aiming') return;

            // 1. Raycaster check to see if the user clicked directly on the actual 3D Bowling Ball mesh
            let isBallHit = false;
            if (this.ballMesh) {
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2();
                
                // Convert screenspace click to normalized device coordinates (-1 to +1)
                mouse.x = (clientX / window.innerWidth) * 2 - 1;
                mouse.y = -(clientY / window.innerHeight) * 2 + 1;
                
                raycaster.setFromCamera(mouse, this.camera);
                const intersects = raycaster.intersectObject(this.ballMesh, true);
                isBallHit = intersects.length > 0;
            }

            // 2. Fallback horizontal screenspace check for high mobile/touch accessibility
            // If they miss the exact ball mesh pixels, allow them to grab near the ball in the bottom screen region
            const ballScreenX = window.innerWidth / 2 + (this.ballX / this.laneWidth) * window.innerWidth * 0.6;
            const distToBallX = Math.abs(clientX - ballScreenX);
            const isNearBall = clientY > window.innerHeight * 0.45 && distToBallX < (window.innerWidth * 0.25);

            if (isBallHit || isNearBall) {
                this.isPointerDown = true;
                this.dragStartTime = performance.now();
                this.pointerStart.set(clientX, clientY);
                this.pointerCurrent.set(clientX, clientY);
                this.startBallX = this.ballX; // store current horizontal position
                this.pullbackRatio = 0;
                this.ballZ = this.initZ;
                this.dragPoints = [{ x: clientX, y: clientY, t: this.dragStartTime }];

                // Show empty power bar instantly for snappy feel
                this.powerBarContainer.style.display = 'flex';
                this.powerBarFill.style.width = '0%';
                this.powerText.innerText = 'LAUNCH POWER: 0%';
            }
        };

        const onMove = (clientX, clientY) => {
            if (!this.isPointerDown) return;
            
            this.pointerCurrent.set(clientX, clientY);
            const now = performance.now();
            this.dragPoints.push({ x: clientX, y: clientY, t: now });
            if (this.dragPoints.length > 30) this.dragPoints.shift();

            // 1. Position ball instantly as the player drags horizontally
            const dx = clientX - this.pointerStart.x;
            const widthRatio = window.innerWidth;
            
            // Map pixel drag to physical lane width
            const targetX = this.startBallX + (dx / widthRatio) * this.laneWidth * 1.6;
            this.ballX = THREE.MathUtils.clamp(targetX, -this.maxPositionOffset, this.maxPositionOffset);
            
            // 2. Pullback & Charge Mechanics (Vertical downward dragging)
            const dy = clientY - this.pointerStart.y;
            const maxPullbackPixels = Math.max(120, window.innerHeight * 0.22);
            
            // Pullback is active when dragging downwards (dy > 0)
            this.pullbackRatio = THREE.MathUtils.clamp(dy / maxPullbackPixels, 0, 1);
            
            // Visual pullback: slide ball backwards elastically towards the camera (max 0.65 meters)
            this.ballZ = this.initZ + this.pullbackRatio * 0.65;

            if (this.onPositionChange) {
                this.onPositionChange(this.ballX, this.ballZ);
            }

            // Update Glowing Neon Power Bar
            const percent = Math.round(this.pullbackRatio * 100);
            this.powerBarFill.style.width = percent + '%';
            this.powerText.innerText = `LAUNCH POWER: ${percent}%`;
            
            if (this.pullbackRatio > 0.8) {
                this.powerBarContainer.style.borderColor = '#ff00ff';
                this.powerBarContainer.style.boxShadow = '0 0 15px #ff00ff, inset 0 0 5px #ff00ff';
                this.powerText.style.color = '#ff00ff';
                this.powerText.style.textShadow = '0 0 3px #ff00ff';
            } else {
                this.powerBarContainer.style.borderColor = '#00ffff';
                this.powerBarContainer.style.boxShadow = '0 0 10px #00ffff';
                this.powerText.style.color = '#ffffff';
                this.powerText.style.textShadow = '0 0 3px #000';
            }
        };

        const onUp = () => {
            if (!this.isPointerDown) return;
            this.isPointerDown = false;

            // Instantly launch the ball forward using the currently charged power ratio!
            const baseSpeed = 8.5; // m/s
            const maxChargeSpeed = 11.5; // m/s
            
            const speedZ = - (baseSpeed + this.pullbackRatio * maxChargeSpeed);

            // Calculate horizontal launch speed (deflection angle) based on horizontal drag offset
            const dx = this.pointerCurrent.x - this.pointerStart.x;
            const widthRatio = window.innerWidth;
            let speedX = (dx / widthRatio) * 6.5; // Map horizontal drag deflection
            speedX = THREE.MathUtils.clamp(speedX, -3.5, 3.5);

            // Calculate spin value based on horizontal movement drift in the last few drag frames
            let spinVal = 0;
            if (this.dragPoints.length >= 2) {
                const lastPt = this.dragPoints[this.dragPoints.length - 1];
                const prevPt = this.dragPoints[Math.max(0, this.dragPoints.length - 6)];
                const dt = (lastPt.t - prevPt.t) / 1000;
                if (dt > 0.005) {
                    const driftX = lastPt.x - prevPt.x;
                    spinVal = -(driftX / widthRatio) * 18.0;
                    spinVal = THREE.MathUtils.clamp(spinVal, -3.5, 3.5);
                }
            }

            // Release throw!
            this.state = 'thrown';
            this.showInstructions(false);
            if (this.powerBarContainer) {
                this.powerBarContainer.style.display = 'none';
            }

            const velocityVec = new THREE.Vector3(speedX, 0, speedZ);
            if (this.onThrow) {
                this.onThrow(velocityVec, spinVal);
            }
        };

        // Touch Listeners
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                onDown(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                onMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        this.canvas.addEventListener('touchend', (e) => {
            onUp();
        }, { passive: true });

        // Mouse Listeners
        this.canvas.addEventListener('mousedown', (e) => {
            onDown(e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', (e) => {
            onMove(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', () => {
            onUp();
        });
    }

    reset() {
        this.state = 'aiming';
        this.ballX = 0;
        this.ballZ = this.initZ;
        this.startBallX = 0;
        this.pullbackRatio = 0;
        this.isPointerDown = false;
        this.dragPoints = [];
        this.showInstructions(true);
        if (this.powerBarContainer) this.powerBarContainer.style.display = 'none';
    }

    disable() {
        this.state = 'disabled';
        this.showInstructions(false);
        if (this.powerBarContainer) this.powerBarContainer.style.display = 'none';
    }
}
