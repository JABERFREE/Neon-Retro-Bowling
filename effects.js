import * as THREE from 'three';

export class GameEffects {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.particles = [];
        this.shockwaves = [];
        this.trailGeom = null;
        this.trailMesh = null;
        this.trailHistory = [];
        this.trailMaxPoints = 50;

        // Camera shake state
        this.shakeIntensity = 0;
        this.shakeDecay = 0.95;
        this.cameraBasePos = new THREE.Vector3(0, 3, 6); // default view position
        this.cameraBaseLookAt = new THREE.Vector3(0, 0.5, -18);

        this.initTrail();
        this.initHTMLAnnouncements();
    }

    initTrail() {
        // Create an elegant Ribbon Trail for the ball
        // We'll construct a dynamic mesh that gets updated as the ball rolls
        const width = 0.16;
        const geom = new THREE.BufferGeometry();
        const positions = new Float32Array(this.trailMaxPoints * 2 * 3); // 2 vertices per segment, 3 coords each
        const uvs = new Float32Array(this.trailMaxPoints * 2 * 2);
        
        // Setup initial UVs
        for (let i = 0; i < this.trailMaxPoints; i++) {
            const ratio = i / (this.trailMaxPoints - 1);
            // Left vertex uv
            uvs[i * 4] = ratio;
            uvs[i * 4 + 1] = 0;
            // Right vertex uv
            uvs[i * 4 + 2] = ratio;
            uvs[i * 4 + 3] = 1;
        }

        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        // Pulsating purple/blue neon gradient texture (procedural)
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 128, 0);
        grad.addColorStop(0, 'rgba(0, 255, 255, 0.9)'); // bright cyan head
        grad.addColorStop(0.3, 'rgba(128, 0, 255, 0.6)'); // purple mid
        grad.addColorStop(1, 'rgba(255, 0, 128, 0)'); // fade out tail
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.trailMesh = new THREE.Mesh(geom, material);
        this.scene.add(this.trailMesh);
    }

    resetTrail() {
        this.trailHistory = [];
        const positions = this.trailMesh.geometry.attributes.position.array;
        positions.fill(0);
        this.trailMesh.geometry.attributes.position.needsUpdate = true;
    }

    updateTrail(ballPosition, active) {
        if (!active) {
            this.resetTrail();
            return;
        }

        // Capture new point
        this.trailHistory.push(ballPosition.clone());
        if (this.trailHistory.length > this.trailMaxPoints) {
            this.trailHistory.shift();
        }

        const positions = this.trailMesh.geometry.attributes.position.array;
        const count = this.trailHistory.length;

        for (let i = 0; i < this.trailMaxPoints; i++) {
            // Map index to historical trail points
            const histIdx = Math.floor((i / (this.trailMaxPoints - 1)) * (count - 1));
            const point = this.trailHistory[histIdx] || ballPosition;

            // Width tapers off towards the end of the trail
            const widthScale = (i / (this.trailMaxPoints - 1)); // 0 at tail, 1 at head
            const halfWidth = 0.1 * widthScale;

            // Left vertex (slightly offset horizontally)
            positions[i * 6] = point.x - halfWidth;
            positions[i * 6 + 1] = point.y + 0.01; // slightly above floor to prevent z-fighting
            positions[i * 6 + 2] = point.z;

            // Right vertex
            positions[i * 6 + 3] = point.x + halfWidth;
            positions[i * 6 + 4] = point.y + 0.01;
            positions[i * 6 + 5] = point.z;
        }

        this.trailMesh.geometry.attributes.position.needsUpdate = true;
    }

    createSparks(position, count = 20, colorHex = 0x00ffff) {
        // High quality neon particle explosion
        const geom = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        const sizes = [];
        
        for (let i = 0; i < count; i++) {
            // Position near the impact point
            positions.push(
                position.x + (Math.random() - 0.5) * 0.1,
                position.y + (Math.random() - 0.5) * 0.1,
                position.z + (Math.random() - 0.5) * 0.1
            );

            // Fly outwards in all directions
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = 1.0 + Math.random() * 3.5;

            velocities.push(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.abs(Math.cos(phi) * speed) + 0.5, // bias upwards
                Math.sin(phi) * Math.sin(theta) * speed
            );

            sizes.push(0.08 + Math.random() * 0.15);
        }

        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        // Cyber particle glowing texture (procedural circular glow)
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.3, 'rgba(0, 255, 255, 0.8)');
        grad.addColorStop(0.8, 'rgba(255, 0, 255, 0.2)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.PointsMaterial({
            color: colorHex,
            size: 0.2,
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const particleSystem = new THREE.Points(geom, material);
        this.scene.add(particleSystem);

        this.particles.push({
            system: particleSystem,
            velocities: velocities,
            life: 1.0, // seconds
            maxLife: 1.0
        });
    }

    createShockwave(position, colorHex = 0xff00ff) {
        // Flat circular neon expanding shockwave on the lane floor
        const geom = new THREE.RingGeometry(0.01, 0.35, 32);
        geom.rotateX(-Math.PI / 2); // lay completely flat on lane surface

        const mat = new THREE.MeshBasicMaterial({
            color: colorHex,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(position);
        mesh.position.y = 0.02; // elevate slightly to avoid z-fighting
        this.scene.add(mesh);

        this.shockwaves.push({
            mesh: mesh,
            scale: 1.0,
            maxScale: 6.0,
            opacity: 0.85,
            life: 0.4, // seconds
            maxLife: 0.4
        });
    }

    triggerCameraShake(amount = 0.5) {
        this.shakeIntensity = amount;
    }

    update(deltaTime) {
        // --- 1. UPDATE PARTICLES ---
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= deltaTime;

            if (p.life <= 0) {
                this.scene.remove(p.system);
                p.system.geometry.dispose();
                p.system.material.dispose();
                this.particles.splice(i, 1);
            } else {
                // Decay size and move particles
                const positions = p.system.geometry.attributes.position.array;
                const vels = p.velocities;
                const lifeRatio = p.life / p.maxLife;

                for (let j = 0; j < positions.length / 3; j++) {
                    const idx = j * 3;
                    // Move
                    positions[idx] += vels[idx] * deltaTime;
                    positions[idx + 1] += vels[idx + 1] * deltaTime;
                    positions[idx + 2] += vels[idx + 2] * deltaTime;

                    // Gravity
                    vels[idx + 1] -= 9.81 * deltaTime;
                }

                p.system.geometry.attributes.position.needsUpdate = true;
                p.system.material.opacity = lifeRatio;
            }
        }

        // --- UPDATE SHOCKWAVES ---
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const s = this.shockwaves[i];
            s.life -= deltaTime;
            if (s.life <= 0) {
                this.scene.remove(s.mesh);
                s.mesh.geometry.dispose();
                s.mesh.material.dispose();
                this.shockwaves.splice(i, 1);
            } else {
                const ratio = s.life / s.maxLife; // 1 at start, 0 at end
                const scaleVal = 1 + (1 - ratio) * s.maxScale;
                s.mesh.scale.set(scaleVal, scaleVal, scaleVal);
                s.mesh.material.opacity = ratio * s.opacity;
            }
        }

        // --- 2. UPDATE CAMERA SHAKE ---
        if (this.shakeIntensity > 0.01) {
            const currentShakeX = (Math.random() - 0.5) * this.shakeIntensity;
            const currentShakeY = (Math.random() - 0.5) * this.shakeIntensity;
            const currentShakeZ = (Math.random() - 0.5) * this.shakeIntensity;

            this.camera.position.set(
                this.cameraBasePos.x + currentShakeX,
                this.cameraBasePos.y + currentShakeY,
                this.cameraBasePos.z + currentShakeZ
            );

            this.shakeIntensity *= this.shakeDecay;
            this.camera.lookAt(this.cameraBaseLookAt);
        } else if (this.camera.position.distanceTo(this.cameraBasePos) > 0.01) {
            this.camera.position.lerp(this.cameraBasePos, 0.12);
            this.camera.lookAt(this.cameraBaseLookAt);
        } else {
            this.camera.lookAt(this.cameraBaseLookAt);
        }
    }

    setCameraBase(pos, lookAtTarget) {
        this.cameraBasePos.copy(pos);
        this.cameraBaseLookAt.copy(lookAtTarget);
    }

    initHTMLAnnouncements() {
        this.annContainer = document.createElement('div');
        this.annContainer.id = 'announcement-container';
        this.annContainer.style.cssText = `
            position: absolute;
            top: 30%;
            left: 50%;
            transform: translate(-50%, -50%);
            pointer-events: none;
            z-index: 200;
            font-family: 'Orbitron', sans-serif;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        `;
        document.body.appendChild(this.annContainer);
    }

    showAnnouncement(text, type = 'strike') {
        this.annContainer.innerHTML = ''; // clear

        const textEl = document.createElement('div');
        textEl.innerText = text;
        
        let color = '#00ffff';
        let glow = '#0088ff';
        let anim = 'neon-pulse 1.5s infinite alternate';

        if (type === 'strike') {
            color = '#ff00ff';
            glow = '#ff00aa';
            anim = 'strike-zoom 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
        } else if (type === 'spare') {
            color = '#00ffff';
            glow = '#00aaff';
            anim = 'spare-zoom 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
        } else {
            // gutter or standard hits
            color = '#ffffff';
            glow = '#444444';
            anim = 'text-fade 1.5s ease-out forwards';
        }

        textEl.style.cssText = `
            font-size: 64px;
            font-weight: 900;
            letter-spacing: 5px;
            color: ${color};
            text-shadow: 0 0 10px ${color}, 0 0 20px ${glow}, 0 0 40px ${glow};
            animation: ${anim};
            opacity: 0;
        `;

        // Inject CSS animations
        if (!document.getElementById('ann-styles')) {
            const style = document.createElement('style');
            style.id = 'ann-styles';
            style.innerHTML = `
                @keyframes strike-zoom {
                    0% { transform: scale(0.2) rotate(-5deg); opacity: 0; filter: blur(5px); }
                    30% { transform: scale(1.1) rotate(3deg); opacity: 1; filter: blur(0); }
                    35% { transform: scale(1.0) rotate(0deg); opacity: 1; }
                    80% { transform: scale(1.0); opacity: 1; }
                    100% { transform: scale(1.2); opacity: 0; filter: blur(3px); }
                }
                @keyframes spare-zoom {
                    0% { transform: scale(0.2) translateY(50px); opacity: 0; }
                    30% { transform: scale(1.05) translateY(-5px); opacity: 1; }
                    35% { transform: scale(1.0) translateY(0); opacity: 1; }
                    80% { transform: scale(1.0); opacity: 1; }
                    100% { transform: scale(0.8) translateY(-30px); opacity: 0; }
                }
                @keyframes text-fade {
                    0% { transform: scale(0.8); opacity: 0; }
                    20% { transform: scale(1.0); opacity: 1; }
                    80% { opacity: 1; }
                    100% { transform: scale(1.05); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        this.annContainer.appendChild(textEl);
    }
}
