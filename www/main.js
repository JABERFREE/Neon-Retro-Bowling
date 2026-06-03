import * as THREE from 'three';
import { BowlingPhysics } from './physics.js';
import { BowlingControls } from './controls.js';
import { AudioManager } from './audio.js';
import { GameEffects } from './effects.js';

// Intercept and bypass third-party CrazyGames SDK domain restrictions in sandbox environments
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && (
        (event.reason.message && event.reason.message.includes('CrazySDK is disabled on this domain')) ||
        (event.reason.toString && event.reason.toString().includes('CrazySDK is disabled on this domain'))
    )) {
        event.preventDefault();
        console.log('CrazyGames SDK sandbox rejection bypassed safely.');
    }
});

window.addEventListener('error', (event) => {
    if (event.message && event.message.includes('CrazySDK is disabled on this domain')) {
        event.preventDefault();
        console.log('CrazyGames SDK sandbox error bypassed safely.');
    }
});

class BowlingGame {
    constructor() {
        this.container = document.getElementById('game-container');
        this.physics = new BowlingPhysics();
        this.audio = new AudioManager();
        this.effects = null;
        this.controls = null;

        // Core Game Settings
        this.foulLineZ = 2.0;
        this.cameraApproachPos = new THREE.Vector3(0, 0.65, 3.4);
        this.cameraRollPos = new THREE.Vector3(0, 0.55, 3.0);
        this.cameraPinsPos = new THREE.Vector3(0, 1.8, -13);
        
        // Three.js Objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.timer = new THREE.Timer();
        this.ballMesh = null;
        this.pinMeshes = []; // maps pin index to Mesh group

        // Game State Machine
        // 'START_SCREEN', 'POSITIONING', 'AIMING', 'ROLLING', 'PINS_SETTLING', 'FRAME_CLEANUP', 'GAME_OVER'
        this.gameState = 'START_SCREEN';
        
        // Bowling Scoring Rules
        this.currentFrame = 1; // 1 to 10
        this.currentThrow = 1; // 1 or 2 (or 3 in frame 10)
        this.scores = Array.from({ length: 10 }, () => ({ throws: [], score: null, isStrike: false, isSpare: false }));
        this.runningTotal = 0;
        this.currentLevel = 1; // level 1 starting default
        this.scoreAccumulatedFromPreviousLevels = 0;

        // CrazyGames HTML5 SDK integration & fail-safe states
        this.cgSDK = null;
        this.isAdPlaying = false;
        this.savedMuteStateBeforeAd = false;
        if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.environment !== 'disabled') {
            this.cgSDK = window.CrazyGames.SDK;
            console.log('CrazyGames SDK successfully loaded and active.');
        } else {
            this.cgSDK = null;
            console.log('CrazyGames SDK disabled or in sandbox domain. SDK calls bypassed safely.');
        }

        this.initThree();
        this.buildLane();
        this.initGameSystems();
        this.setupHTMLUI();
        
        // Start Loop
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a001a, 0.02);

        // Camera (Widen Field of View vertically if Portrait/Mobile)
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(aspect < 1.0 ? 64 : 45, aspect, 0.1, 100);
        this.camera.position.copy(this.cameraApproachPos);
        this.camera.lookAt(0, 0.15, -18);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        const initialPixelRatio = Math.max(1, window.devicePixelRatio || 1);
        this.renderer.setPixelRatio(initialPixelRatio);
        const initialWidth = this.container.clientWidth || window.innerWidth;
        const initialHeight = this.container.clientHeight || window.innerHeight;
        this.renderer.setSize(initialWidth, initialHeight, false);
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        // Lights
        // A. Ambient Deep Space Purple glow
        const ambLight = new THREE.AmbientLight(0x220044, 1.8);
        this.scene.add(ambLight);

        // B. Hemisphere Light
        const hemiLight = new THREE.HemisphereLight(0x00ffff, 0xff00ff, 0.6);
        this.scene.add(hemiLight);

        // C. Glowing spotlight on the Pin Deck area
        const pinSpotlight = new THREE.SpotLight(0xff00bb, 15, 25, Math.PI / 4, 0.5, 1);
        pinSpotlight.position.set(0, 6, -18);
        pinSpotlight.target.position.set(0, 0, -18);
        pinSpotlight.castShadow = true;
        pinSpotlight.shadow.mapSize.width = 1024;
        pinSpotlight.shadow.mapSize.height = 1024;
        pinSpotlight.shadow.bias = -0.001;
        this.scene.add(pinSpotlight);
        this.scene.add(pinSpotlight.target);

        // D. Lane directional accent light
        const laneDirLight = new THREE.DirectionalLight(0x00ffff, 1.5);
        laneDirLight.position.set(0, 5, 0);
        this.scene.add(laneDirLight);

        window.addEventListener('resize', () => this.onWindowResize());
    }

    buildLane() {
        // --- 1. THE LANE ---
        const laneWidth = this.physics.laneWidth;
        const laneLength = 23.0; // slightly longer than physics area to extend behind player

        // Generate retro wood/grid texture procedurally
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        // Classic wood grain gradient base
        const grad = ctx.createLinearGradient(0, 0, 512, 0);
        grad.addColorStop(0, '#1c0e07'); // dark edges
        grad.addColorStop(0.3, '#30180c');
        grad.addColorStop(0.5, '#422110'); // glowing wood board color
        grad.addColorStop(0.7, '#30180c');
        grad.addColorStop(1, '#1c0e07');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 1024);

        // Add wood plank stripes
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 2;
        const numPlanks = 39; // standard lane has 39 boards
        const plankWidth = 512 / numPlanks;
        for (let i = 0; i <= numPlanks; i++) {
            ctx.beginPath();
            ctx.moveTo(i * plankWidth, 0);
            ctx.lineTo(i * plankWidth, 1024);
            ctx.stroke();
        }

        // Overlay glowing cyan retro gridlines
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.45)';
        ctx.lineWidth = 3;
        const numGridHorizontal = 30;
        const gridStep = 1024 / numGridHorizontal;
        for (let i = 0; i <= numGridHorizontal; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * gridStep);
            ctx.lineTo(512, i * gridStep);
            ctx.stroke();
        }

        // Add traditional lane arrow markers
        ctx.fillStyle = 'rgba(0, 255, 255, 0.85)';
        const arrowPositions = [0.25, 0.35, 0.5, 0.65, 0.75];
        arrowPositions.forEach(ratio => {
            const x = ratio * 512;
            const y = 350; // arrow distance down the lane
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - 10, y + 25);
            ctx.lineTo(x + 10, y + 25);
            ctx.closePath();
            ctx.fill();
            // Arrow neon bloom shadow
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0; // reset
        });

        const laneTexture = new THREE.CanvasTexture(canvas);
        laneTexture.wrapS = THREE.RepeatWrapping;
        laneTexture.wrapT = THREE.RepeatWrapping;
        laneTexture.repeat.set(1, 4); // stretch grid over the lane
        laneTexture.colorSpace = THREE.SRGBColorSpace;

        const laneMat = new THREE.MeshStandardMaterial({
            map: laneTexture,
            roughness: 0.08, // highly reflective wood lane finish
            metalness: 0.15,
            bumpScale: 0.02
        });

        const laneGeom = new THREE.BoxGeometry(laneWidth, 0.1, laneLength);
        const laneMesh = new THREE.Mesh(laneGeom, laneMat);
        laneMesh.position.set(0, -0.05, -7); // centered, slightly lowered
        laneMesh.receiveShadow = true;
        this.scene.add(laneMesh);

        // --- 2. NEON LANE BORDERS (Gutters) ---
        // Gutters are dark channels, bordered by bright neon pink lights
        const gutterWidth = 0.22;
        const gutterDepth = 0.08;
        const gutterGeom = new THREE.BoxGeometry(gutterWidth, gutterDepth, laneLength);
        const gutterMat = new THREE.MeshStandardMaterial({
            color: 0x050010,
            roughness: 0.4,
            metalness: 0.8
        });

        // Left Gutter
        const leftGutter = new THREE.Mesh(gutterGeom, gutterMat);
        leftGutter.position.set(-(laneWidth / 2 + gutterWidth / 2), -gutterDepth / 2, -7);
        leftGutter.receiveShadow = true;
        this.scene.add(leftGutter);

        // Right Gutter
        const rightGutter = new THREE.Mesh(gutterGeom, gutterMat);
        rightGutter.position.set((laneWidth / 2 + gutterWidth / 2), -gutterDepth / 2, -7);
        rightGutter.receiveShadow = true;
        this.scene.add(rightGutter);

        // Also add cyan floor grids beside the lanes to create a wide virtual court
        const floorGeom = new THREE.PlaneGeometry(30, 40);
        const floorGridTexture = new THREE.CanvasTexture(this.createGridCanvas());
        floorGridTexture.wrapS = THREE.RepeatWrapping;
        floorGridTexture.wrapT = THREE.RepeatWrapping;
        floorGridTexture.repeat.set(15, 20);
        
        const floorMat = new THREE.MeshStandardMaterial({
            map: floorGridTexture,
            roughness: 0.9,
            metalness: 0.1
        });
        const floorMesh = new THREE.Mesh(floorGeom, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(0, -0.1, -10);
        floorMesh.receiveShadow = true;
        this.scene.add(floorMesh);

        // --- 3. SYNTHWAVE HORIZON BACKDROP ---
        const bgTexture = new THREE.TextureLoader().load('assets/retro-bg.webp');
        bgTexture.colorSpace = THREE.SRGBColorSpace;
        const bgGeom = new THREE.PlaneGeometry(36, 20);
        const bgMat = new THREE.MeshBasicMaterial({
            map: bgTexture,
            side: THREE.DoubleSide
        });
        const bgMesh = new THREE.Mesh(bgGeom, bgMat);
        bgMesh.position.set(0, 8, -23.5);
        this.scene.add(bgMesh);
    }

    createGridCanvas() {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const cx = c.getContext('2d');
        cx.fillStyle = '#070014';
        cx.fillRect(0, 0, 128, 128);
        cx.strokeStyle = '#220055';
        cx.lineWidth = 2;
        cx.strokeRect(0, 0, 128, 128);
        return c;
    }

    initGameSystems() {
        // Effects (Particles & Camera shake)
        this.effects = new GameEffects(this.scene, this.camera);
        
        // Physics Pins Initialization
        this.physics.initPins();
        this.buildPinMeshes();

        // Create elegant, pulsing dashed target dots for trajectory guidance
        this.trajectoryDots = [];
        this.maxTrajectoryDots = 12;
        const dotGeom = new THREE.PlaneGeometry(0.045, 0.045);

        // Soft circular glow map (procedural canvas)
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(0, 255, 255, 0.95)');
        grad.addColorStop(0.4, 'rgba(0, 128, 255, 0.4)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        const dotTexture = new THREE.CanvasTexture(canvas);

        for (let i = 0; i < this.maxTrajectoryDots; i++) {
            const mat = new THREE.MeshBasicMaterial({
                map: dotTexture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                opacity: 0
            });
            const mesh = new THREE.Mesh(dotGeom, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = 0.012; // elevate slightly above lane
            this.scene.add(mesh);
            this.trajectoryDots.push(mesh);
        }

        // Create an elegant, continuous glowing trajectory line down the lane floor
        const lineGeom = new THREE.BufferGeometry();
        const linePositions = new Float32Array(40 * 3); // 40 points, 3 coords each
        lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

        const lineMat = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.trajectoryLine = new THREE.Line(lineGeom, lineMat);
        this.scene.add(this.trajectoryLine);

        // Control systems Setup
        this.controls = new BowlingControls(
            this.renderer.domElement,
            this.camera,
            this.physics.laneWidth,
            this.foulLineZ,
            // Throw callback
            (velocity, spin) => this.throwBall(velocity, spin),
            // Position adjustment callback
            (newX, newZ) => {
                if (this.ballMesh) {
                    this.ballMesh.position.x = newX;
                    if (newZ !== undefined) {
                        this.ballMesh.position.z = newZ;
                    }
                }
            }
        );

        // Prepare first Ball
        this.spawnBall();
        this.controls.ballMesh = this.ballMesh;
    }

    buildPinMeshes() {
        // Clean existing
        this.pinMeshes.forEach(mesh => this.scene.remove(mesh));
        this.pinMeshes = [];
        this.pinStripeMaterials = [];

        // Pin material: shiny pearlescent white
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.1,
            metalness: 0.2,
            bumpScale: 0.05
        });

        // Shared static geoms
        const baseGeom = new THREE.CylinderGeometry(0.045, 0.06, 0.22, 16);
        const neckGeom = new THREE.CylinderGeometry(0.02, 0.038, 0.1, 16);
        const headGeom = new THREE.SphereGeometry(0.026, 16, 16);

        // Instantiate meshes according to physics pin positions
        this.physics.pins.forEach((pin, index) => {
            // Create a unique standard material with emissive properties for this pin's neon stripes.
            // This allows us to flash each pin independently when hit!
            const stripeMat = new THREE.MeshStandardMaterial({
                color: 0xff00ff,
                emissive: 0xff00ff,
                emissiveIntensity: 1.0,
                roughness: 0.1,
                metalness: 0.2
            });
            this.pinStripeMaterials.push(stripeMat);

            const pinGroup = new THREE.Group();

            // Assemble the pin parts elastically
            const baseMesh = new THREE.Mesh(baseGeom, bodyMat);
            baseMesh.position.y = 0.11;
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            pinGroup.add(baseMesh);

            const neckMesh = new THREE.Mesh(neckGeom, bodyMat);
            neckMesh.position.y = 0.26;
            neckMesh.castShadow = true;
            neckMesh.receiveShadow = true;
            pinGroup.add(neckMesh);

            const headMesh = new THREE.Mesh(headGeom, bodyMat);
            headMesh.position.y = 0.33;
            headMesh.castShadow = true;
            pinGroup.add(headMesh);

            const stripe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.015, 16), stripeMat);
            stripe1.position.y = 0.27;
            pinGroup.add(stripe1);

            const stripe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.027, 0.015, 16), stripeMat);
            stripe2.position.y = 0.24;
            pinGroup.add(stripe2);

            pinGroup.position.copy(pin.position);
            this.scene.add(pinGroup);
            this.pinMeshes.push(pinGroup);
        });
    }

    spawnBall() {
        if (this.ballMesh) {
            this.scene.add(this.ballMesh);
            this.ballMesh.position.set(0, this.physics.ballRadius, this.foulLineZ);
            if (this.controls) this.controls.ballMesh = this.ballMesh;
            return;
        }

        // Generate gorgeous round 3D retro ball with glowing blue or gold grid texture
        const geom = new THREE.SphereGeometry(this.physics.ballRadius, 32, 32);

        // Canvas grid drawing
        const bCanvas = document.createElement('canvas');
        bCanvas.width = 256;
        bCanvas.height = 128;
        const bctx = bCanvas.getContext('2d');
        const isGolden = this.currentLevel >= 2;

        bctx.fillStyle = isGolden ? '#150f01' : '#03011c'; // space deep gold vs space deep blue
        bctx.fillRect(0, 0, 256, 128);
        
        bctx.strokeStyle = isGolden ? '#ffaa00' : '#00ffff'; // Gold neon vs Cyan neon lines
        bctx.lineWidth = 2.5;

        // Draw horizontal grid lines
        const gridH = 12;
        for (let i = 0; i <= gridH; i++) {
            const y = (i / gridH) * 128;
            bctx.beginPath();
            bctx.moveTo(0, y);
            bctx.lineTo(256, y);
            bctx.stroke();
        }

        // Draw vertical grid lines
        const gridV = 24;
        for (let i = 0; i <= gridV; i++) {
            const x = (i / gridV) * 256;
            bctx.beginPath();
            bctx.moveTo(x, 0);
            bctx.lineTo(x, 128);
            bctx.stroke();
        }

        const ballTexture = new THREE.CanvasTexture(bCanvas);
        ballTexture.colorSpace = THREE.SRGBColorSpace;

        const ballMat = new THREE.MeshStandardMaterial({
            map: ballTexture,
            roughness: 0.05,
            metalness: isGolden ? 0.95 : 0.8, // higher metal shine for gold
            emissive: isGolden ? 0xffbb00 : 0x00ffff,
            emissiveMap: ballTexture,
            emissiveIntensity: isGolden ? 2.2 : 1.6 // high power glow!
        });

        this.ballMesh = new THREE.Mesh(geom, ballMat);
        this.ballMesh.castShadow = true;
        this.ballMesh.position.set(0, this.physics.ballRadius, this.foulLineZ);
        this.scene.add(this.ballMesh);
        if (this.controls) this.controls.ballMesh = this.ballMesh;
    }

    throwBall(velocity, spin) {
        if (this.gameState !== 'AIMING' && this.gameState !== 'POSITIONING') return;

        // Apply a 20% speed boost reward in Level 2+
        if (this.currentLevel >= 2) {
            velocity.multiplyScalar(1.2);
        }

        // Transition camera to follow-roll position
        this.gameState = 'ROLLING';
        this.effects.setCameraBase(this.cameraRollPos, new THREE.Vector3(0, 0.15, -18));

        this.physics.initBall(this.ballMesh.position, velocity, spin);
        this.physics.ball.state = 'rolling';

        // Start dynamic rolling sound hum
        this.audio.startRollHum();
    }

    handleCollision(type, id, volume) {
        // Play physical sound effects
        if (type === 'ball-pin') {
            this.audio.playPinClatter(volume * 1.3);
            this.audio.playImpactThump(volume); // Synthesized sub-bass crash and retro zap layer!
            
            // Screen shake based on intensity
            this.effects.triggerCameraShake(volume * 0.45);

            // Fetch pin position to spawn particles and shockwaves
            const pinIdx = parseInt(id) - 1;
            const pin = this.physics.pins[pinIdx];
            if (pin) {
                // Flash the hit pin's neck stripes intensely
                if (this.pinStripeMaterials && this.pinStripeMaterials[pinIdx]) {
                    this.pinStripeMaterials[pinIdx].emissiveIntensity = 8.0;
                }

                // Spawn spark particles and expanding flat neon shockwave
                this.effects.createSparks(pin.position, 16, 0xff00ff);
                this.effects.createShockwave(pin.position, 0x00ffff); // Electric blue shockwave
            }
        } else if (type === 'pin-pin') {
            this.audio.playPinClatter(volume * 0.9);
            
            const pinIds = id.split('-');
            const pinAIdx = parseInt(pinIds[0]) - 1;
            const pinBIdx = parseInt(pinIds[1]) - 1;
            
            const pinA = this.physics.pins[pinAIdx];
            if (pinA) {
                // Flash colliding pin stripes
                if (this.pinStripeMaterials && this.pinStripeMaterials[pinAIdx]) {
                    this.pinStripeMaterials[pinAIdx].emissiveIntensity = 4.0;
                }
                if (this.pinStripeMaterials && this.pinStripeMaterials[pinBIdx]) {
                    this.pinStripeMaterials[pinBIdx].emissiveIntensity = 4.0;
                }

                this.effects.createSparks(pinA.position, 8, 0x00ffff);
                this.effects.createShockwave(pinA.position, 0xff00ff); // Hot pink secondary shockwave
            }
        }
    }

    handleGutter() {
        this.audio.stopRollHum();
        this.effects.showAnnouncement('GUTTER', 'gutter');
    }

    handlePit(entityType, id) {
        if (entityType === 'ball') {
            this.audio.stopRollHum();
            
            // Ball has entered backpit, wait a second for pins to settle
            setTimeout(() => {
                this.gameState = 'PINS_SETTLING';
            }, 500);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Skip physics, timers, updates, and rendering if a CrazyGames video ad is currently playing
        if (this.isAdPlaying) return;

        const deltaTime = this.timer.update(performance.now()).getDelta();

        // 1. UPDATE PHYSICS
        if (this.gameState === 'ROLLING' || this.gameState === 'PINS_SETTLING') {
            // Level 3+ moving pins incentive: let standing pins slide back & forth horizontally
            if (this.currentLevel >= 3) {
                const time = performance.now() * 0.0025;
                this.physics.pins.forEach(pin => {
                    if (pin.state === 'standing') {
                        // Slow, fluid horizontal sway based on index phase shift
                        const offset = Math.sin(time + pin.id * 1.5) * 0.15;
                        pin.position.x = pin.initialPosition.x + offset;
                    }
                });
            }

            this.physics.update(
                deltaTime,
                (type, id, vol) => this.handleCollision(type, id, vol),
                () => this.handleGutter(),
                (type, id) => this.handlePit(type, id)
            );

            // Update Tactical Real-Time Pin Map
            this.updateTacticalHUD();

            // Update Roll Hum based on speed
            if (this.physics.ball && this.physics.ball.state === 'rolling') {
                this.audio.updateRollHum(this.physics.ball.velocity.length());
            }

            // Unconditional 3-Second Round Reset Logic Safeguards
            if (this.gameState === 'ROLLING' && this.physics.ball) {
                const bPos = this.physics.ball.position;
                const bVel = this.physics.ball.velocity;

                // Case A: Ball reaches the pin deck area
                if (bPos.z < -14.5) {
                    this.gameState = 'PINS_SETTLING';
                    this.pinsSettleCountdown = 3.0; // wait 3 seconds to watch pins roll and settle
                    this.audio.stopRollHum();
                }
                // Case B: Ball gets stuck on the lane
                else if (bPos.z < 1.0 && bVel.length() < 0.15) {
                    this.gameState = 'PINS_SETTLING';
                    this.pinsSettleCountdown = 3.0;
                    this.audio.stopRollHum();
                }
            }

            // Countdown to clean up the round
            if (this.gameState === 'PINS_SETTLING') {
                this.pinsSettleCountdown -= deltaTime;
                if (this.pinsSettleCountdown <= 0) {
                    this.gameState = 'FRAME_CLEANUP';
                    this.evaluateThrow();
                }
            }

            // Dynamic Cinematic Camera System: Tracks behind the rolling ball, lags horizontally,
            // lowers to lane level, and performs a rapid dolly-zoom focus as it approaches the pins!
            if (this.physics.ball && (this.gameState === 'ROLLING' || this.gameState === 'PINS_SETTLING')) {
                const bPos = this.physics.ball.position;
                const aspect = this.camera.aspect;
                const baseFov = aspect < 1.0 ? 64 : 45;

                let camX = this.camera.position.x;
                let camY = 0.55;
                let camZ = bPos.z + 1.35;
                const lookTarget = new THREE.Vector3();

                // Phase 1: Ball travels down the lane (Z from 2.0 to -9.0)
                if (bPos.z > -9.0) {
                    // Smoothly transition camera height from approach roll position
                    const rollProgress = THREE.MathUtils.clamp((2.0 - bPos.z) / 11.0, 0, 1);
                    camY = THREE.MathUtils.lerp(0.55, 0.42, rollProgress);
                    
                    // Horizontal inertia lag: camera sways with a slight delay behind the ball's hooks
                    camX = THREE.MathUtils.lerp(this.camera.position.x, bPos.x * 0.72, 0.08);
                    
                    // Restore/keep base FOV
                    if (Math.abs(this.camera.fov - baseFov) > 0.1) {
                        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, baseFov, 0.1);
                        this.camera.updateProjectionMatrix();
                    }

                    // Look slightly in front of the ball
                    lookTarget.set(bPos.x, 0.15, bPos.z - 2.0);
                }
                // Phase 2: Focus Impact Zoom (Z from -9.0 to -17.5)
                else if (bPos.z > -17.5 && this.gameState === 'ROLLING') {
                    const zoomProgress = THREE.MathUtils.clamp((-9.0 - bPos.z) / 8.5, 0, 1);

                    // Drop to dramatic lane-level viewpoint (low angles make collisions feel massive!)
                    camY = THREE.MathUtils.lerp(0.42, 0.22, zoomProgress);

                    // Camera slowly decelerates behind the ball, letting the ball rush ahead into the pins
                    const followDist = THREE.MathUtils.lerp(1.35, 1.85, zoomProgress);
                    camZ = Math.max(-14.2, bPos.z + followDist);

                    // Slower horizontal trailing for steady focus on pin deck
                    camX = THREE.MathUtils.lerp(this.camera.position.x, bPos.x * 0.4, 0.05);

                    // Hitchcock Dolly Zoom: Dynamically narrow the FOV to enlarge the pins visually!
                    const targetFov = 26; // narrow telephoto focus
                    this.camera.fov = THREE.MathUtils.lerp(baseFov, targetFov, zoomProgress);
                    this.camera.updateProjectionMatrix();

                    // Lock visual focus onto the center of the pin deck
                    lookTarget.set(bPos.x * 0.5, 0.18, -18.2);
                }
                // Phase 3: Impact & Aftermath (during settle state)
                else {
                    // Lock camera position at perfect wide low angle just before the deck
                    camY = 0.22;
                    camZ = -14.2;
                    camX = THREE.MathUtils.lerp(this.camera.position.x, 0, 0.04); // return to center slowly

                    // Keep tight zoom FOV for impact majesty
                    const targetFov = 26;
                    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.08);
                    this.camera.updateProjectionMatrix();

                    // Focus target stays on the pins deck aftermath
                    lookTarget.set(0, 0.22, -18.5);
                }

                this.effects.setCameraBase(
                    new THREE.Vector3(camX, camY, camZ),
                    lookTarget
                );
            }
        }

        // 2. SYNCHRONIZE 3D REPRESENTATIONS
        // Sync ball
        const isRollingOrSettling = this.gameState === 'ROLLING' || this.gameState === 'PINS_SETTLING';

        if (isRollingOrSettling) {
            if (this.physics.ball && this.ballMesh) {
                this.ballMesh.position.copy(this.physics.ball.position);
                
                if (this.physics.ball.state === 'rolling' || this.physics.ball.state === 'gutter') {
                    // Roll animation based on forward movement
                    const distMoved = this.physics.ball.velocity.z * deltaTime;
                    const angle = distMoved / this.physics.ballRadius;
                    this.ballMesh.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), -angle);
                    
                    // Light trails effect
                    this.effects.updateTrail(this.ballMesh.position, true);
                } else {
                    // Ball fell in pit/gutter end, stop trail but keep sphere fully visible in scene
                    this.effects.updateTrail(null, false);
                }
            }
        } else {
            // We are in AIMING, POSITIONING, or START_SCREEN state!
            if (this.ballMesh) {
                // Ensure visual ball is ALWAYS 100% visible and correctly aligned with controls
                this.ballMesh.visible = true;
                if (this.ballMesh.material) {
                    this.ballMesh.material.opacity = 1.0;
                }

                if (this.controls) {
                    this.ballMesh.position.x = this.controls.ballX;
                    this.ballMesh.position.y = this.physics.ballRadius;
                    this.ballMesh.position.z = this.controls.ballZ;
                } else {
                    this.ballMesh.position.set(0, this.physics.ballRadius, this.foulLineZ);
                }

                // Keep trail reset
                this.effects.updateTrail(null, false);

                // Smoothly restore standard FOV as ball is reset to starting line
                const aspect = this.camera.aspect;
                const standardFov = aspect < 1.0 ? 64 : 45;
                if (Math.abs(this.camera.fov - standardFov) > 0.1) {
                    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, standardFov, 0.08);
                    this.camera.updateProjectionMatrix();
                }
            }
        }

        // Update target trajectory dashed visual dots dynamically
        this.updateTrajectoryGuide();

        // Smoothly decay hit pin stripe emissive flashes over time
        if (this.pinStripeMaterials) {
            this.pinStripeMaterials.forEach(mat => {
                if (mat && mat.emissiveIntensity > 1.0) {
                    mat.emissiveIntensity -= 15.0 * deltaTime; // Quick decay for snappy flashes
                    if (mat.emissiveIntensity < 1.0) mat.emissiveIntensity = 1.0;
                }
            });
        }

        // Sync pins
        this.physics.pins.forEach((pin, index) => {
            const mesh = this.pinMeshes[index];
            if (mesh) {
                if (pin.state === 'pit') {
                    mesh.position.y = -5; // hide in pit
                } else {
                    mesh.position.copy(pin.position);
                    mesh.rotation.set(0, pin.rotationY, 0); // Yaw
                    
                    // Apply physical tilt vectors to pitch/roll rotation
                    mesh.rotateX(pin.tilt.x / this.physics.pinHeight);
                    mesh.rotateZ(pin.tilt.y / this.physics.pinHeight);
                }
            }
        });

        // 4. EFFECTS AND CAMERA SHAKE
        this.effects.update(deltaTime);

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    evaluateThrow() {
        const fallen = this.physics.getFallenPins();
        const fallenIds = fallen.map(p => p.id);
        
        // Calculate new pins knocked down this throw
        // Retrieve count of pins standing before, compared to standing now
        const previouslyFallen = this.scores[this.currentFrame - 1].throws.length === 1 
            ? this.scores[this.currentFrame - 1].previouslyFallenIds || []
            : [];
            
        const newlyFallen = fallenIds.filter(id => !previouslyFallen.includes(id));
        const countKnockedThisThrow = newlyFallen.length;

        // Log results
        const currentFrameScore = this.scores[this.currentFrame - 1];
        currentFrameScore.throws.push(countKnockedThisThrow);

        // Cache fallen pins to avoid double-counting in second throw
        if (this.currentThrow === 1) {
            currentFrameScore.previouslyFallenIds = fallenIds;
        }

        const totalFallenCount = fallen.length;

        let resultType = 'normal';
        let feedbackText = `${countKnockedThisThrow} PINS`;

        if (this.currentThrow === 1 && totalFallenCount === 10) {
            // STRIKE!
            currentFrameScore.isStrike = true;
            feedbackText = 'STRIKE!';
            resultType = 'strike';
            this.audio.playStrikeFanfare();
            this.effects.showAnnouncement('STRIKE!', 'strike');
            this.effects.triggerCameraShake(0.9);

            // CrazyGames Happy Moments SDK Event trigger
            if (this.cgSDK && this.cgSDK.game) {
                try {
                    if (typeof this.cgSDK.game.happytime === 'function') {
                        this.cgSDK.game.happytime();
                    } else if (typeof this.cgSDK.game.happyTime === 'function') {
                        this.cgSDK.game.happyTime();
                    }
                } catch (e) {
                    console.log('CrazyGames happytime notification bypassed.');
                }
            }
        } else if (this.currentThrow === 2 && totalFallenCount === 10) {
            // SPARE!
            currentFrameScore.isSpare = true;
            feedbackText = 'SPARE!';
            resultType = 'spare';
            this.effects.showAnnouncement('SPARE!', 'spare');
            this.effects.triggerCameraShake(0.5);
        } else {
            if (countKnockedThisThrow === 0) {
                feedbackText = 'GUTTER';
            }
            this.effects.showAnnouncement(feedbackText, 'normal');
        }

        // Trigger Sweeper visually to sweep the pins
        this.startSweepAnimation(() => {
            this.advanceGameTurn();
        });
    }

    startSweepAnimation(onComplete) {
        // Smoothly slide any knocked down pin meshes downwards into the floor elastically
        const duration = 750; // ms
        const startTime = performance.now();

        const sinkInterval = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            this.physics.pins.forEach((pin, index) => {
                const fallen = pin.state === 'pit' || pin.state === 'tipped' || pin.tilt.length() > 0.22;
                if (fallen) {
                    const mesh = this.pinMeshes[index];
                    if (mesh) {
                        // Sink down below the floor surface
                        mesh.position.y = -progress * 0.8;
                    }
                }
            });

            if (progress >= 1) {
                clearInterval(sinkInterval);
                onComplete();
            }
        }, 16);
    }

    advanceGameTurn() {
        const frameData = this.scores[this.currentFrame - 1];

        // Scoring math update
        this.recalculateTotalScore();
        this.updateHUDScorecard();

        const isStrike = frameData.isStrike;
        const isSpare = frameData.isSpare;

        // Check if we proceed to next throw or next frame
        if (this.currentFrame < 10) {
            if (isStrike || this.currentThrow === 2) {
                // Advance frame
                this.currentFrame++;
                this.currentThrow = 1;
                this.resetDeckFully();
            } else {
                // Throw 2 of current frame
                this.currentThrow = 2;
                this.cleanupKnockedPins();
            }
        } else {
            // Frame 10 special logic
            const throws = frameData.throws;
            const sumThrows = throws.reduce((a, b) => a + b, 0);

            if (throws.length === 1 && throws[0] === 10) {
                // Strike in throw 1 of 10th frame: get bonus throw
                this.currentThrow = 2;
                this.resetDeckFully(); // reset for next throw
            } else if (throws.length === 2 && sumThrows >= 10) {
                // Spare or double strike: get 3rd throw
                this.currentThrow = 3;
                this.resetDeckFully();
            } else if (throws.length === 2 && sumThrows < 10) {
                // Ended frame 10 with no strike/spare: transition level!
                this.handleLevelCompletion();
                return;
            } else if (throws.length === 3) {
                // Ended frame 10 bonus throws: transition level!
                this.handleLevelCompletion();
                return;
            } else {
                this.currentThrow = 2;
                this.cleanupKnockedPins();
            }
        }

        // Return to aim state
        this.gameState = 'AIMING';
        this.effects.setCameraBase(this.cameraApproachPos, new THREE.Vector3(0, 0.15, -18));
        
        // Reset Ball Physics & Velocity so it completely stops moving
        if (this.physics.ball) {
            this.physics.ball.position.set(0, this.physics.ballRadius, this.foulLineZ);
            this.physics.ball.velocity.set(0, 0, 0);
            this.physics.ball.spin = 0;
            this.physics.ball.state = 'ready';
        }

        this.controls.reset(); // unlocked and canThrow becomes true
        this.spawnBall();
        this.updateTacticalHUD();
        console.log('Ball successfully reset for the next turn!');
    }

    handleLevelCompletion() {
        // Prepare level completion and save accumulated grand totals
        this.scoreAccumulatedFromPreviousLevels += this.runningTotal;
        this.currentLevel++;

        const proceedToNextLevel = () => {
            // Reset level score parameters
            this.runningTotal = 0;
            this.currentFrame = 1;
            this.currentThrow = 1;
            this.scores = Array.from({ length: 10 }, () => ({ throws: [], score: null, isStrike: false, isSpare: false }));

            // Flashy Level Up! Neon Announcement
            this.effects.showAnnouncement(`LEVEL UP!`, 'strike');
            setTimeout(() => {
                this.effects.showAnnouncement(`LEVEL ${this.currentLevel}`, 'spare');
            }, 1200);

            this.audio.playStrikeFanfare();

            // Refresh layouts
            this.updateHUDScorecard();
            this.updateTacticalHUD();
            this.resetDeckFully();

            // Recreate the visual ball to apply the Golden Skin if Level >= 2
            if (this.currentLevel >= 2 && this.ballMesh) {
                this.scene.remove(this.ballMesh);
                this.ballMesh = null; // force spawnBall to instantiate a fresh Golden Skin!
            }

            // Reset state and controls
            this.gameState = 'AIMING';
            this.effects.setCameraBase(this.cameraApproachPos, new THREE.Vector3(0, 0.15, -18));
            this.controls.reset();
            this.spawnBall();
        };

        // Trigger CrazyGames Mid-Roll Video Advertisement if the SDK is available
        if (this.cgSDK && this.cgSDK.ad) {
            console.log('CrazyGames Mid-Roll Ad Requested.');
            
            // Save state and pause gameplay & audio
            this.isAdPlaying = true;
            this.savedMuteStateBeforeAd = this.audio.isMuted;
            this.audio.setMute(true);

            try {
                this.cgSDK.ad.requestAd('midroll', {
                    adStarted: () => {
                        console.log('CrazyGames Ad started.');
                    },
                    adFinished: () => {
                        console.log('CrazyGames Ad finished.');
                        this.isAdPlaying = false;
                        this.audio.setMute(this.savedMuteStateBeforeAd);
                        proceedToNextLevel();
                    },
                    adError: (error) => {
                        console.warn('CrazyGames Ad error, resuming game:', error);
                        this.isAdPlaying = false;
                        this.audio.setMute(this.savedMuteStateBeforeAd);
                        proceedToNextLevel();
                    }
                });
            } catch (e) {
                console.warn('Failed to call CrazyGames SDK ad API:', e);
                this.isAdPlaying = false;
                this.audio.setMute(this.savedMuteStateBeforeAd);
                proceedToNextLevel();
            }
        } else {
            // Fail-safe: No SDK available, immediately proceed to Level 2
            proceedToNextLevel();
        }
    }

    cleanupKnockedPins() {
        // Pins that fell are moved to pit permanently so they are removed visually
        this.physics.pins.forEach((pin, i) => {
            const fallen = pin.state === 'pit' || pin.state === 'tipped' || pin.tilt.length() > 0.22;
            if (fallen) {
                pin.state = 'pit';
                pin.velocity.set(0, 0, 0);
            } else {
                // Reset slightly wobbling pins back to perfect standing center
                pin.state = 'standing';
                pin.position.copy(pin.initialPosition);
                pin.velocity.set(0, 0, 0);
                pin.tilt.set(0, 0);
                pin.tiltVelocity.set(0, 0);
            }
        });
    }

    resetDeckFully() {
        // Spawn 10 fresh pins on the lane
        this.physics.initPins();
        this.buildPinMeshes();
    }

    recalculateTotalScore() {
        // Classic bowling scoring logic with Strike/Spare bonuses
        let total = 0;
        
        for (let i = 0; i < 10; i++) {
            const frame = this.scores[i];
            const throws = frame.throws;
            
            if (throws.length === 0) continue;

            const t0 = throws[0] || 0;
            const t1 = throws[1] || 0;

            if (i < 9) { // Frames 1 to 9
                if (frame.isStrike) {
                    // Strike bonus: add next 2 throws
                    let bonus = 0;
                    const nextFrame = this.scores[i + 1];
                    if (nextFrame && nextFrame.throws.length > 0) {
                        bonus += nextFrame.throws[0] || 0;
                        if (nextFrame.isStrike) {
                            // double strike logic
                            const nextNextFrame = this.scores[i + 2];
                            if (nextNextFrame && nextNextFrame.throws.length > 0) {
                                bonus += nextNextFrame.throws[0] || 0;
                            } else if (nextFrame.throws.length > 1) {
                                bonus += nextFrame.throws[1] || 0;
                            }
                        } else {
                            bonus += nextFrame.throws[1] || 0;
                        }
                    }
                    frame.score = 10 + bonus;
                } else if (frame.isSpare) {
                    // Spare bonus: add next 1 throw
                    let bonus = 0;
                    const nextFrame = this.scores[i + 1];
                    if (nextFrame && nextFrame.throws.length > 0) {
                        bonus += nextFrame.throws[0] || 0;
                    }
                    frame.score = 10 + bonus;
                } else {
                    frame.score = t0 + t1;
                }
            } else { // Frame 10
                // Simple sum of all throws made in frame 10 (can be up to 3 throws)
                const sum = throws.reduce((a,b) => a + b, 0);
                frame.score = sum;
            }

            if (frame.score !== null) {
                // Double Points Reward: strike frames give Double Points (X2) in Level 2+
                if (frame.isStrike && this.currentLevel >= 2) {
                    frame.score *= 2;
                }
                total += frame.score;
            }
        }

        this.runningTotal = total;
    }

    endGame() {
        this.gameState = 'GAME_OVER';
        this.controls.disable();
        
        const gameOverScreen = document.getElementById('game-over-screen');
        const finalScoreVal = document.getElementById('final-score-val');
        if (gameOverScreen && finalScoreVal) {
            finalScoreVal.innerText = this.runningTotal;
            gameOverScreen.style.display = 'flex';
        }
    }

    resetGame() {
        this.currentFrame = 1;
        this.currentThrow = 1;
        this.runningTotal = 0;
        this.currentLevel = 1;
        this.scoreAccumulatedFromPreviousLevels = 0;
        this.scores = Array.from({ length: 10 }, () => ({ throws: [], score: null, isStrike: false, isSpare: false }));

        const gameOverScreen = document.getElementById('game-over-screen');
        if (gameOverScreen) {
            gameOverScreen.style.display = 'none';
        }

        // Recreate the ball mesh to revert from Golden Skin back to standard Cyan Grid
        if (this.ballMesh) {
            this.scene.remove(this.ballMesh);
            this.ballMesh = null; // force spawnBall to instantiate standard skin
        }

        this.resetDeckFully();
        this.updateHUDScorecard();
        this.updateTacticalHUD();
        
        this.gameState = 'AIMING';
        this.effects.setCameraBase(this.cameraApproachPos, new THREE.Vector3(0, 0.15, -18));
        this.controls.reset();
        this.spawnBall();
    }

    onWindowResize() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        const aspect = width / height;
        this.camera.aspect = aspect;

        // Dynamic portrait FOV compensation to make sure lane/ball/pins remain beautifully in view
        this.camera.fov = aspect < 1.0 ? 64 : 45;
        this.camera.updateProjectionMatrix();
    }

    setupHTMLUI() {
        // Inject high-fidelity responsive CSS style block for Mobile devices
        const style = document.createElement('style');
        style.innerHTML = `
            #top-header-container {
                padding-top: calc(8px + env(safe-area-inset-top)) !important;
            }
            @media (max-width: 768px), (orientation: portrait) {
                #hud-container {
                    padding: 6px !important;
                }
                #top-header-container {
                    padding: calc(4px + env(safe-area-inset-top)) 8px 4px 8px !important;
                    flex-direction: column !important;
                    justify-content: center !important;
                    align-items: center !important;
                    gap: 3px !important;
                    flex-wrap: nowrap !important;
                }
                #hud-logo {
                    font-size: 11px !important;
                    letter-spacing: 1.5px !important;
                    margin: 0 auto !important;
                    text-align: center !important;
                }
                #hud-scorecard {
                    transform: scale(0.64) !important;
                    transform-origin: center center !important;
                    gap: 1.5px !important;
                    padding: 2px 3px !important;
                    margin: 0 auto !important;
                }
                .hud-frame-box {
                    min-width: 21px !important;
                }
                .hud-total-box {
                    min-width: 36px !important;
                    padding: 0 4px !important;
                }
                #hud-sound-box {
                    position: absolute !important;
                    top: calc(72px + env(safe-area-inset-top)) !important;
                    left: 8px !important;
                    right: auto !important;
                    transform: scale(0.5) !important;
                    transform-origin: top left !important;
                    background: rgba(10, 0, 30, 0.3) !important;
                    backdrop-filter: blur(2px) !important;
                    border: 1px solid rgba(0, 255, 255, 0.35) !important;
                    box-shadow: 0 0 6px rgba(0, 255, 255, 0.15) !important;
                    padding: 2px 6px !important;
                    margin: 0 !important;
                    z-index: 120 !important;
                }
                #hud-tactical-panel {
                    position: absolute !important;
                    top: calc(72px + env(safe-area-inset-top)) !important;
                    right: 8px !important;
                    left: auto !important;
                    transform: scale(0.6) !important;
                    transform-origin: top right !important;
                    background: rgba(8, 0, 20, 0.3) !important;
                    backdrop-filter: blur(2px) !important;
                    border: 1px solid rgba(255, 0, 255, 0.35) !important;
                    box-shadow: 0 0 8px rgba(255, 0, 255, 0.15) !important;
                    padding: 6px 10px !important;
                    margin: 0 !important;
                    z-index: 120 !important;
                }
                #bottom-footer-container {
                    padding: 3px 6px !important;
                    margin-bottom: 2px !important;
                    background: rgba(5, 0, 15, 0.82) !important;
                    border-radius: 4px;
                    border-top: 1px solid rgba(0, 255, 255, 0.15);
                }
                #bottom-footer-container button {
                    font-size: 9px !important;
                    padding: 4px 8px !important;
                }
                #control-overlay {
                    bottom: 24% !important; /* Safely keep instructions above the ball control zone */
                    font-size: 11px !important;
                    width: 90%;
                }
                #control-overlay div {
                    font-size: 9px !important;
                }
            }
        `;
        document.head.appendChild(style);

        // We will build dynamic HTML elements inside the body to provide feedback and sound management controls
        const uiContainer = document.createElement('div');
        uiContainer.id = 'hud-container';
        uiContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            box-sizing: border-box;
            z-index: 50;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 15px;
        `;

        // TOP HEADER: Neon Logo + Compact Scoreboard + Sound Controls
        const topHeader = document.createElement('div');
        topHeader.id = 'top-header-container';
        topHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            pointer-events: auto;
            background: rgba(5, 0, 15, 0.6);
            border-bottom: 1px solid rgba(255, 0, 255, 0.15);
            padding: 6px 12px;
            box-sizing: border-box;
        `;

        const logo = document.createElement('h1');
        logo.id = 'hud-logo';
        logo.innerText = 'NEON BOWLING';
        logo.style.cssText = `
            font-family: 'Orbitron', sans-serif;
            color: #ff00ff;
            font-size: 14px;
            margin: 0;
            text-shadow: 0 0 6px #ff00ff, 0 0 12px #00ffff;
            letter-spacing: 1.5px;
        `;
        topHeader.appendChild(logo);

        // TOP HUD: SCORE BOARD GRID
        const scoreGrid = document.createElement('div');
        scoreGrid.id = 'hud-scorecard';
        scoreGrid.style.cssText = `
            display: flex;
            gap: 4px;
            background: rgba(10, 1, 30, 0.8);
            border: 1px solid #ff00ff;
            border-radius: 6px;
            padding: 4px 8px;
            pointer-events: auto;
            box-shadow: 0 0 10px rgba(255, 0, 255, 0.25);
        `;
        topHeader.appendChild(scoreGrid);

        const soundBox = document.createElement('div');
        soundBox.id = 'hud-sound-box';
        soundBox.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(10, 0, 30, 0.7);
            border: 1px solid #00ffff;
            box-shadow: 0 0 6px #00ffff;
            padding: 3px 8px;
            border-radius: 4px;
        `;

        const muteBtn = document.createElement('button');
        muteBtn.innerText = '🔊 MUTE';
        muteBtn.style.cssText = `
            background: transparent;
            border: none;
            color: #00ffff;
            font-family: 'Orbitron', sans-serif;
            font-size: 9px;
            cursor: pointer;
            outline: none;
            text-shadow: 0 0 3px #00ffff;
        `;
        muteBtn.addEventListener('click', () => {
            this.audio.playClick();
            const currentMute = this.audio.isMuted;
            this.audio.setMute(!currentMute);
            muteBtn.innerText = !currentMute ? '🔇 UNMUTE' : '🔊 MUTE';
        });
        soundBox.appendChild(muteBtn);

        const volSlider = document.createElement('input');
        volSlider.type = 'range';
        volSlider.min = '0';
        volSlider.max = '1';
        volSlider.step = '0.05';
        volSlider.value = '0.6';
        volSlider.style.cssText = `
            width: 60px;
            accent-color: #ff00ff;
            cursor: pointer;
        `;
        volSlider.addEventListener('input', (e) => {
            this.audio.setVolume(parseFloat(e.target.value));
        });
        soundBox.appendChild(volSlider);

        topHeader.appendChild(soundBox);
        uiContainer.appendChild(topHeader);

        // MID ROW: Tactical Status Monitor
        const midRow = document.createElement('div');
        midRow.style.cssText = `
            display: flex;
            justify-content: flex-start;
            align-items: center;
            width: 100%;
            flex-grow: 1;
            padding: 20px 0;
            pointer-events: none;
        `;

        const tacticalPanel = document.createElement('div');
        tacticalPanel.id = 'hud-tactical-panel';
        tacticalPanel.style.cssText = `
            background: rgba(10, 1, 30, 0.45);
            backdrop-filter: blur(2.5px);
            border: 1px solid #ff00ff;
            box-shadow: 0 0 10px rgba(255, 0, 255, 0.2);
            border-radius: 6px;
            padding: 10px 14px;
            font-family: 'Orbitron', sans-serif;
            color: #ffffff;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: auto;
            min-width: 140px;
            margin-left: 10px;
            user-select: none;
        `;

        tacticalPanel.innerHTML = `
            <div style="font-size: 10px; color: #8888aa; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; font-weight: bold; letter-spacing: 1px;">HUD MONITOR</div>
            <div id="hud-level-label" style="font-size: 13px; color: #ffaa00; text-shadow: 0 0 6px #ffaa00; font-weight: bold; margin-top: 4px; margin-bottom: 2px;">LEVEL 1</div>
            <div id="hud-frame-label" style="font-size: 11px; color: #ff00ff; text-shadow: 0 0 4px #ff00ff;">FRAME: 1 / 10</div>
            <div id="hud-throw-label" style="font-size: 11px; color: #00ffff; text-shadow: 0 0 4px #00ffff;">THROW: 1 / 2</div>
            <div id="hud-pins-standing" style="font-size: 11px; color: #ffffff;">STANDING: 10 / 10</div>
            
            <div style="font-size: 8px; color: #8888aa; margin-top: 4px; font-weight: bold;">PIN DECK MAP</div>
            <div id="hud-pin-deck-map" style="
                position: relative;
                width: 110px;
                height: 80px;
                background: rgba(0,0,0,0.3);
                border: 1px solid rgba(0,255,255,0.1);
                border-radius: 4px;
                margin-top: 4px;
            "></div>
        `;

        midRow.appendChild(tacticalPanel);
        uiContainer.appendChild(midRow);

        // BOTTOM FOOTER: Camera Views and Reset Button
        const bottomFooter = document.createElement('div');
        bottomFooter.id = 'bottom-footer-container';
        bottomFooter.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            pointer-events: auto;
            margin-bottom: 5px;
        `;

        const viewControls = document.createElement('div');
        viewControls.style.cssText = `
            display: flex;
            gap: 8px;
        `;

        const createViewBtn = (label, pos, lookAt) => {
            const btn = document.createElement('button');
            btn.innerText = label;
            btn.style.cssText = `
                background: rgba(10, 0, 30, 0.8);
                border: 1px solid #00ffff;
                color: #00ffff;
                font-family: 'Orbitron', sans-serif;
                font-size: 11px;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                text-shadow: 0 0 4px #00ffff;
                transition: all 0.2s ease;
            `;
            btn.addEventListener('click', () => {
                this.audio.playClick();
                this.effects.setCameraBase(pos, lookAt);
            });
            return btn;
        };

        const backView = createViewBtn('APPROACH', this.cameraApproachPos, new THREE.Vector3(0, 0.4, -18));
        const midView = createViewBtn('BALL ZOOM', this.cameraRollPos, new THREE.Vector3(0, 0.4, -18));
        const pinView = createViewBtn('PIN ZOOM', this.cameraPinsPos, new THREE.Vector3(0, 0.3, -19.5));
        
        viewControls.appendChild(backView);
        viewControls.appendChild(midView);
        viewControls.appendChild(pinView);
        bottomFooter.appendChild(viewControls);

        const restartBtn = document.createElement('button');
        restartBtn.innerText = '🔄 RESTART';
        restartBtn.style.cssText = `
            background: rgba(255, 0, 128, 0.2);
            border: 1px solid #ff00ff;
            color: #ff00ff;
            font-family: 'Orbitron', sans-serif;
            font-size: 11px;
            padding: 6px 14px;
            border-radius: 4px;
            cursor: pointer;
            text-shadow: 0 0 4px #ff00ff;
            transition: all 0.2s ease;
        `;
        restartBtn.addEventListener('click', () => {
            this.audio.playClick();
            this.resetGame();
        });
        bottomFooter.appendChild(restartBtn);

        uiContainer.appendChild(bottomFooter);
        document.body.appendChild(uiContainer);

        // Initialize Scoreboard and Tactical HUD values
        this.updateHUDScorecard();
        this.updateTacticalHUD();

        // GAME START INITIATION OVERLAY (Hidden initially during cinematic intro)
        const startOverlay = document.createElement('div');
        startOverlay.id = 'start-overlay';
        startOverlay.style.cssText = `
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(5, 0, 15, 0.4);
            backdrop-filter: blur(2px);
            display: none; /* hidden during intro splash screen */
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 300;
            font-family: 'Orbitron', sans-serif;
        `;
        startOverlay.innerHTML = `
            <div style="font-size: 42px; font-weight: 900; color: #ff00ff; text-shadow: 0 0 15px #ff00ff, 0 0 30px #00ffff; letter-spacing: 4px; margin-bottom: 10px;">NEON BOWLING</div>
            <div style="font-size: 16px; color: #00ffff; text-shadow: 0 0 8px #00ffff; margin-bottom: 40px; letter-spacing: 2px;">RETRO FUTURISTIC ARCADE</div>
            <button id="start-play-btn" style="
                background: transparent;
                border: 2px solid #00ffff;
                color: #00ffff;
                padding: 12px 36px;
                font-family: 'Orbitron', sans-serif;
                font-size: 18px;
                font-weight: bold;
                letter-spacing: 2px;
                border-radius: 8px;
                cursor: pointer;
                box-shadow: 0 0 15px rgba(0, 255, 255, 0.4);
                text-shadow: 0 0 8px #00ffff;
                transition: all 0.3s ease;
            ">START PLAYING</button>
            <div style="margin-top: 50px; color: #888; font-size: 12px; text-align: center; line-height: 1.6;">
                Swipe up quickly to release and throw.<br>
                Curve swipe left or right to execute hooks/spins!<br>
                Supports Mobile Touch & Desktop Mouse drags.
            </div>
        `;
        document.body.appendChild(startOverlay);

        // CINEMATIC SPLASH INTRO OVERLAY
        const introOverlay = document.createElement('div');
        introOverlay.id = 'intro-overlay';
        introOverlay.style.cssText = `
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(1px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            font-family: 'Orbitron', sans-serif;
            transition: opacity 0.8s ease;
            opacity: 1;
            user-select: none;
        `;
        introOverlay.innerHTML = `
            <div style="
                font-size: 32px;
                font-weight: bold;
                color: #00ffff;
                text-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff, 0 0 40px #ff00ff, 0 0 70px #ff00ff;
                animation: neon-flicker 2.5s infinite alternate;
                letter-spacing: 3px;
                text-align: center;
            ">NEXAPP GAMES</div>
            <div style="
                font-size: 10px;
                color: #ff00ff;
                text-shadow: 0 0 5px #ff00ff;
                letter-spacing: 4px;
                margin-top: 10px;
                animation: text-fade 1.5s infinite alternate;
                text-align: center;
            ">PRESENTS</div>
            <button id="intro-skip-btn" style="
                position: absolute;
                bottom: 25px;
                right: 25px;
                background: rgba(10, 0, 30, 0.4);
                border: 1px solid rgba(0, 255, 255, 0.3);
                color: rgba(0, 255, 255, 0.6);
                padding: 6px 14px;
                font-size: 10px;
                font-family: 'Orbitron', sans-serif;
                letter-spacing: 1px;
                border-radius: 4px;
                cursor: pointer;
                text-shadow: 0 0 4px rgba(0, 255, 255, 0.3);
                pointer-events: auto;
            ">SKIP</button>
        `;
        document.body.appendChild(introOverlay);

        // Setup CSS keyframe styles for flickering logo text
        const flickerStyle = document.createElement('style');
        flickerStyle.innerHTML = `
            @keyframes neon-flicker {
                0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% {
                    text-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff, 0 0 40px #ff00ff, 0 0 70px #ff00ff;
                    opacity: 1;
                }
                20%, 24%, 55% {
                    text-shadow: none;
                    opacity: 0.65;
                }
            }
        `;
        document.head.appendChild(flickerStyle);

        // Intro transition flow trigger
        let chimePlayed = false;
        const triggerChimeAndExit = () => {
            if (introOverlay.style.opacity === '0') return;
            
            // Try to play chime elastically (Web Audio context handles user gesture authorization automatically)
            if (!chimePlayed) {
                chimePlayed = true;
                this.audio.init().then(() => {
                    this.playIntroChime();
                });
            }

            introOverlay.style.opacity = '0';
            setTimeout(() => {
                if (introOverlay.parentNode) {
                    document.body.removeChild(introOverlay);
                }
                // Slide open the main start menu
                startOverlay.style.display = 'flex';
            }, 800);
        };

        // 3.5 Seconds automatic transition timer
        const autoIntroTimeout = setTimeout(() => {
            triggerChimeAndExit();
        }, 3500);

        // User touch/click triggers the chime and skips safely
        introOverlay.addEventListener('mousedown', () => {
            clearTimeout(autoIntroTimeout);
            triggerChimeAndExit();
        });
        introOverlay.addEventListener('touchstart', () => {
            clearTimeout(autoIntroTimeout);
            triggerChimeAndExit();
        }, { passive: true });

        // Start Playing button transitions to game loop
        document.getElementById('start-play-btn').addEventListener('click', () => {
            startOverlay.style.display = 'none';
            this.audio.init().then(() => {
                this.audio.playMusic();
                this.gameState = 'AIMING';
                this.controls.reset();
            });
        });

        // GAME OVER OVERLAY
        const gameOverScreen = document.createElement('div');
        gameOverScreen.id = 'game-over-screen';
        gameOverScreen.style.cssText = `
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(5, 0, 15, 0.95);
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 300;
            font-family: 'Orbitron', sans-serif;
        `;
        gameOverScreen.innerHTML = `
            <div style="font-size: 48px; font-weight: 900; color: #ff00ff; text-shadow: 0 0 15px #ff00ff; letter-spacing: 4px; margin-bottom: 10px;">GAME OVER</div>
            <div style="font-size: 20px; color: #00ffff; text-shadow: 0 0 8px #00ffff; margin-bottom: 25px;">FINAL SCORE: <span id="final-score-val" style="font-weight: bold; color: #ffffff;">0</span></div>
            <button id="restart-game-btn" style="
                background: transparent;
                border: 2px solid #ff00ff;
                color: #ff00ff;
                padding: 12px 30px;
                font-family: 'Orbitron', sans-serif;
                font-size: 16px;
                font-weight: bold;
                border-radius: 8px;
                cursor: pointer;
                box-shadow: 0 0 15px rgba(255, 0, 255, 0.4);
                text-shadow: 0 0 8px #ff00ff;
                transition: all 0.3s ease;
            ">PLAY AGAIN</button>
        `;
        document.body.appendChild(gameOverScreen);

        document.getElementById('restart-game-btn').addEventListener('click', () => {
            this.resetGame();
        });
    }

    updateHUDScorecard() {
        const grid = document.getElementById('hud-scorecard');
        if (!grid) return;

        grid.innerHTML = ''; // rebuild scorecard dynamically

        for (let i = 1; i <= 10; i++) {
            const frameIndex = i - 1;
            const scoreData = this.scores[frameIndex];
            const activeClass = i === this.currentFrame ? 'border: 1px solid #00ffff; box-shadow: 0 0 8px #00ffff;' : 'border: 1px solid rgba(255, 255, 255, 0.15);';

            const throws = scoreData.throws;
            let display1 = '';
            let display2 = '';
            let display3 = ''; // Frame 10 can have 3 throws

            if (i < 10) {
                if (scoreData.isStrike) {
                    display1 = '';
                    display2 = 'X';
                } else {
                    display1 = throws[0] !== undefined ? (throws[0] === 0 ? '-' : throws[0]) : ' ';
                    if (scoreData.isSpare) {
                        display2 = '/';
                    } else {
                        display2 = throws[1] !== undefined ? (throws[1] === 0 ? '-' : throws[1]) : ' ';
                    }
                }
            } else { // Frame 10
                if (throws[0] === 10) {
                    display1 = 'X';
                } else {
                    display1 = throws[0] !== undefined ? (throws[0] === 0 ? '-' : throws[0]) : ' ';
                }

                if (throws[1] !== undefined) {
                    if (throws[1] === 10) {
                        display2 = 'X';
                    } else if (throws[0] + throws[1] === 10 && !scoreData.isStrike) {
                        display2 = '/';
                    } else {
                        display2 = throws[1] === 0 ? '-' : throws[1];
                    }
                }

                if (throws[2] !== undefined) {
                    if (throws[2] === 10) {
                        display3 = 'X';
                    } else {
                        display3 = throws[2] === 0 ? '-' : throws[2];
                    }
                }
            }

            // Accumulate dynamic total score display
            let cumScoreDisplay = '';
            if (scoreData.score !== null) {
                // Get cumulative up to this point
                let cumScore = 0;
                for (let k = 0; k <= frameIndex; k++) {
                    cumScore += this.scores[k].score || 0;
                }
                cumScoreDisplay = cumScore;
            }

            const frameBox = document.createElement('div');
            frameBox.className = 'hud-frame-box';
            frameBox.style.cssText = `
                display: flex;
                flex-direction: column;
                background: rgba(5, 1, 18, 0.95);
                border-radius: 3px;
                min-width: 30px;
                ${activeClass}
                font-family: 'Orbitron', sans-serif;
                color: #ffffff;
                overflow: hidden;
            `;

            // Frame Number label
            const frameNum = document.createElement('div');
            frameNum.innerText = i;
            frameNum.style.cssText = `
                font-size: 8px;
                color: #8888aa;
                text-align: center;
                background: rgba(255, 255, 255, 0.05);
                padding: 1px 0;
            `;
            frameBox.appendChild(frameNum);

            // Frame throws container
            const throwsRow = document.createElement('div');
            throwsRow.style.cssText = `
                display: flex;
                height: 12px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            `;

            if (i < 10) {
                const throw1 = document.createElement('div');
                throw1.innerText = display1;
                throw1.style.cssText = `flex: 1; text-align: center; font-size: 9px; line-height: 12px; border-right: 1px solid rgba(255,255,255,0.1);`;
                
                const throw2 = document.createElement('div');
                throw2.innerText = display2;
                throw2.style.cssText = `flex: 1; text-align: center; font-size: 9px; line-height: 12px; color: ${display2 === 'X' ? '#ff00ff' : display2 === '/' ? '#00ffff' : '#ffffff'};`;
                
                throwsRow.appendChild(throw1);
                throwsRow.appendChild(throw2);
            } else {
                const throw1 = document.createElement('div');
                throw1.innerText = display1;
                throw1.style.cssText = `flex: 1; text-align: center; font-size: 9px; line-height: 12px; border-right: 1px solid rgba(255,255,255,0.1);`;
                
                const throw2 = document.createElement('div');
                throw2.innerText = display2;
                throw2.style.cssText = `flex: 1; text-align: center; font-size: 9px; line-height: 12px; border-right: 1px solid rgba(255,255,255,0.1);`;

                const throw3 = document.createElement('div');
                throw3.innerText = display3;
                throw3.style.cssText = `flex: 1; text-align: center; font-size: 9px; line-height: 12px;`;

                throwsRow.appendChild(throw1);
                throwsRow.appendChild(throw2);
                throwsRow.appendChild(throw3);
            }

            frameBox.appendChild(throwsRow);

            // Cumulative Total
            const cumBox = document.createElement('div');
            cumBox.innerText = cumScoreDisplay;
            cumBox.style.cssText = `
                font-size: 10px;
                font-weight: bold;
                text-align: center;
                height: 14px;
                line-height: 14px;
                color: #00ffff;
                text-shadow: 0 0 3px #00ffff;
            `;
            frameBox.appendChild(cumBox);

            grid.appendChild(frameBox);
        }

        // Add running total display box next to frames
        const totalBox = document.createElement('div');
        totalBox.className = 'hud-total-box';
        totalBox.style.cssText = `
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background: rgba(255, 0, 128, 0.15);
            border: 1px solid #ff00ff;
            border-radius: 3px;
            padding: 0 8px;
            font-family: 'Orbitron', sans-serif;
            color: #ffffff;
            box-shadow: 0 0 5px rgba(255, 0, 255, 0.2);
        `;
        totalBox.innerHTML = `
            <div style="font-size: 8px; color: #ff00ff; font-weight: bold;">TOTAL</div>
            <div style="font-size: 13px; font-weight: 900; color: #ffffff; text-shadow: 0 0 6px #ff00ff;">${this.runningTotal}</div>
        `;
        grid.appendChild(totalBox);
    }

    updateTacticalHUD() {
        const levelLabel = document.getElementById('hud-level-label');
        const frameLabel = document.getElementById('hud-frame-label');
        const throwLabel = document.getElementById('hud-throw-label');
        const pinsLabel = document.getElementById('hud-pins-standing');
        const pinMap = document.getElementById('hud-pin-deck-map');

        if (!frameLabel || !throwLabel || !pinsLabel || !pinMap) return;

        // 1. Update Labels
        if (levelLabel) {
            const levelColor = this.currentLevel === 1 ? '#ffaa00' : (this.currentLevel === 2 ? '#ffcc00' : '#ff3366');
            levelLabel.style.color = levelColor;
            levelLabel.style.textShadow = `0 0 6px ${levelColor}`;
            
            if (this.currentLevel >= 3) {
                levelLabel.innerHTML = `LEVEL ${this.currentLevel} <span style="font-size: 8px; color: #ff0055; animation: text-fade 1s infinite alternate;">(MOVING PINS)</span>`;
            } else if (this.currentLevel === 2) {
                levelLabel.innerHTML = `LEVEL ${this.currentLevel} <span style="font-size: 8px; color: #ffbb00;">(GOLDEN SPIN)</span>`;
            } else {
                levelLabel.innerText = `LEVEL ${this.currentLevel}`;
            }
        }

        frameLabel.innerText = `FRAME: ${this.currentFrame} / 10`;
        throwLabel.innerText = `THROW: ${this.currentThrow} / ${this.currentFrame === 10 ? 3 : 2}`;

        // Standing pins calculation
        const fallenPins = this.physics.getFallenPins();
        const fallenIds = fallenPins.map(p => p.id);
        const standingCount = 10 - fallenIds.length;
        pinsLabel.innerText = `STANDING: ${standingCount} / 10`;

        // 2. Build or Update Pin Deck Map
        pinMap.innerHTML = ''; // clear and rebuild

        // Pin Map coordinates matching pin IDs 1 to 10
        const coordinates = {
            1: { x: 50, y: 15 },
            2: { x: 33, y: 38 },
            3: { x: 67, y: 38 },
            4: { x: 18, y: 60 },
            5: { x: 50, y: 60 },
            6: { x: 82, y: 60 },
            7: { x: 5, y: 83 },
            8: { x: 35, y: 83 },
            9: { x: 65, y: 83 },
            10: { x: 95, y: 83 }
        };

        for (let id = 1; id <= 10; id++) {
            const isFallen = fallenIds.includes(id);
            const dot = document.createElement('div');
            
            const dotColor = isFallen ? '#260a3a' : '#00ffff';
            const dotGlow = isFallen ? 'none' : '0 0 6px #00ffff';

            dot.style.cssText = `
                position: absolute;
                left: ${coordinates[id].x}%;
                top: ${coordinates[id].y}%;
                transform: translate(-50%, -50%);
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: ${dotColor};
                box-shadow: ${dotGlow};
                transition: all 0.3s ease;
            `;

            // Display minor digital number label above the dot
            const numLabel = document.createElement('div');
            numLabel.innerText = id;
            numLabel.style.cssText = `
                font-size: 6px;
                color: ${isFallen ? '#444' : '#88aaee'};
                text-align: center;
                margin-top: -10px;
                font-family: monospace;
            `;
            dot.appendChild(numLabel);

            pinMap.appendChild(dot);
        }
    }

    updateTrajectoryGuide() {
        const isAiming = this.gameState === 'AIMING' || this.gameState === 'POSITIONING';
        
        if (!isAiming || !this.ballMesh || !this.trajectoryDots || !this.trajectoryLine) {
            // Hide all dots and lines when not in aiming state
            if (this.trajectoryDots) {
                this.trajectoryDots.forEach(mesh => {
                    mesh.material.opacity = 0;
                });
            }
            if (this.trajectoryLine) {
                this.trajectoryLine.material.opacity = 0;
            }
            return;
        }

        // 1. Calculate trajectory physics simulation parameters matching real-time throw mechanics
        const controls = this.controls;
        const pullbackRatio = controls ? controls.pullbackRatio || 0 : 0;
        
        let speedX = 0;
        let speedZ = -8.5; // base speed
        let spinVal = 0;

        if (controls && controls.isPointerDown) {
            const dx = controls.pointerCurrent.x - controls.pointerStart.x;
            const widthRatio = window.innerWidth;
            
            // Map horizontal drag deflection (exactly as controls do)
            speedX = (dx / widthRatio) * 6.5;
            speedX = THREE.MathUtils.clamp(speedX, -3.5, 3.5);

            const baseSpeed = 8.5;
            const maxChargeSpeed = 11.5;
            speedZ = - (baseSpeed + pullbackRatio * maxChargeSpeed);

            // Compute hook spin drift from historical pointer movements
            if (controls.dragPoints && controls.dragPoints.length >= 2) {
                const lastPt = controls.dragPoints[controls.dragPoints.length - 1];
                const prevPt = controls.dragPoints[Math.max(0, controls.dragPoints.length - 6)];
                const dt = (lastPt.t - prevPt.t) / 1000;
                if (dt > 0.005) {
                    const driftX = lastPt.x - prevPt.x;
                    spinVal = -(driftX / widthRatio) * 18.0;
                    spinVal = THREE.MathUtils.clamp(spinVal, -3.5, 3.5);
                }
            }
        }

        // Apply Level 2+ Speed Boost to projection line if active
        if (this.currentLevel >= 2) {
            speedX *= 1.2;
            speedZ *= 1.2;
        }

        const startPos = this.ballMesh.position.clone();

        // --- 2. UPDATE THE CONTINUOUS GLOWING TRAJECTORY LINE ---
        // We run a step-by-step lightweight physical simulation of the ball's future path
        const linePoints = this.trajectoryLine.geometry.attributes.position.array;
        const numLinePoints = 40;
        const simDt = 0.045; // simulated time increment per segment
        
        const simPos = startPos.clone();
        const simVel = new THREE.Vector3(speedX, 0, speedZ);
        const simSpin = spinVal;

        for (let i = 0; i < numLinePoints; i++) {
            // Set coordinate points of line segment
            linePoints[i * 3] = simPos.x;
            linePoints[i * 3 + 1] = 0.015; // slightly above lane surface to avoid Z-fighting
            linePoints[i * 3 + 2] = simPos.z;

            // Apply hook force equations matching the active physics step inside physics.js
            const laneDryness = simPos.z < -10 ? 1.5 : 0.4;
            const hookAccelerationX = simSpin * laneDryness * 4.0;
            simVel.x += hookAccelerationX * simDt;
            simVel.z *= Math.exp(-0.01 * simDt);
            simVel.x *= Math.exp(-0.05 * simDt);

            simPos.addScaledVector(simVel, simDt);
        }
        this.trajectoryLine.geometry.attributes.position.needsUpdate = true;

        // Animate line opacity and color-shift dynamically based on charge power
        this.trajectoryLine.material.opacity = 0.45 + pullbackRatio * 0.4;
        this.trajectoryLine.material.color.setRGB(pullbackRatio, 1.0 - pullbackRatio * 0.5, 1.0);

        // --- 3. UPDATE THE PULSING DASHED TARGET DOTS ---
        // Project dots symmetrically along the simulated path
        this.trajectoryDots.forEach((mesh, idx) => {
            const ratio = idx / (this.maxTrajectoryDots - 1);
            // Locate dot indices on simulated coordinates
            const simIndex = Math.floor(ratio * (numLinePoints - 1));
            
            mesh.position.set(
                linePoints[simIndex * 3],
                0.012,
                linePoints[simIndex * 3 + 2]
            );

            // Scale dots larger if highly charged
            const scaleVal = (1.0 - ratio * 0.35) * (1.0 + pullbackRatio * 0.5);
            mesh.scale.set(scaleVal, scaleVal, scaleVal);

            // Flowing neon pulse effect moving down the path (speed scales with charge!)
            const pulseSpeed = 0.007 * (1.0 + pullbackRatio * 1.5);
            const pulse = 0.6 + Math.sin(performance.now() * pulseSpeed - idx * 0.4) * 0.25;
            mesh.material.opacity = (1.0 - ratio) * pulse * (0.55 + pullbackRatio * 0.45);

            // Match color of dots to the trajectory line
            if (mesh.material && mesh.material.color) {
                mesh.material.color.setRGB(pullbackRatio, 1.0 - pullbackRatio * 0.5, 1.0);
            }
        });
    }

    playIntroChime() {
        if (!this.audio || !this.audio.ctx) return;
        this.audio.resumeContext();

        const ctx = this.audio.ctx;
        const now = ctx.currentTime;

        // 1. Cinematic low sub-bass drop
        const bass = ctx.createOscillator();
        const bassGain = ctx.createGain();
        bass.connect(bassGain);
        bassGain.connect(ctx.destination);
        bass.type = 'triangle';
        bass.frequency.setValueAtTime(100, now);
        bass.frequency.exponentialRampToValueAtTime(32, now + 1.8);
        bassGain.gain.setValueAtTime(this.audio.masterVolume * 0.5, now);
        bassGain.gain.exponentialRampToValueAtTime(0.01, now + 1.8);
        bass.start(now);
        bass.stop(now + 1.95);

        // 2. High-fidelity arpeggiated sci-fi synth chime (A Major 7 chord)
        const notes = [440, 554.37, 659.25, 830.61]; // A, C#, E, G#
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            osc.type = 'sine';
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1200, now);
            filter.frequency.exponentialRampToValueAtTime(250, now + 1.5);

            const startTime = now + idx * 0.085; // slightly arpeggiated delay
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0, now);
            gain.gain.setValueAtTime(this.audio.masterVolume * 0.18, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.6);

            osc.start(startTime);
            osc.stop(startTime + 1.7);
        });
    }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    window.game = new BowlingGame();
});
