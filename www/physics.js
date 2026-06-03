import * as THREE from 'three';

export class BowlingPhysics {
    constructor() {
        this.gravity = -9.81;
        this.laneWidth = 1.05; // -0.525 to 0.525
        this.laneLength = 20.0; // From Z = 0 to Z = -20
        this.foulLineZ = 2.0; // Ball starts rolling around here
        this.pinDeckZ = -18.0;
        
        // Physics constants
        this.ballMass = 5.0; // kg (approx 11 lbs)
        this.pinMass = 1.5;  // kg (approx 3.3 lbs)
        this.ballRadius = 0.11; // meters (standard is ~10.8cm)
        this.pinRadius = 0.06;  // meters (standard base width approx 12cm)
        this.pinHeight = 0.38;  // meters (standard is 15 inches / 38cm)
        
        this.ball = null;
        this.pins = [];
        this.collisionsThisFrame = [];
    }

    initBall(position, velocity, spin) {
        this.ball = {
            position: position.clone(), // THREE.Vector3
            velocity: velocity.clone(), // THREE.Vector3
            spin: spin, // sideward spin (hook potential): negative is left-hook, positive is right-hook
            radius: this.ballRadius,
            state: 'ready', // 'ready', 'rolling', 'gutter', 'pit'
            trailTimer: 0
        };
    }

    initPins() {
        this.pins = [];
        // Standard 10-pin triangle layout
        const spacing = 0.305; // 12 inches center-to-center
        const zStart = this.pinDeckZ; // Head pin at -18.0
        
        // Pin layout coordinate offsets relative to pin 1
        // Row 1: Pin 1
        // Row 2: Pins 2, 3
        // Row 3: Pins 4, 5, 6
        // Row 4: Pins 7, 8, 9, 10
        const rowOffsets = [
            [{ x: 0, z: 0, id: 1 }], // Row 1
            [{ x: -spacing / 2, z: -spacing * 0.866, id: 2 }, { x: spacing / 2, z: -spacing * 0.866, id: 3 }], // Row 2
            [{ x: -spacing, z: -spacing * 1.732, id: 4 }, { x: 0, z: -spacing * 1.732, id: 5 }, { x: spacing, z: -spacing * 1.732, id: 6 }], // Row 3
            [
                { x: -spacing * 1.5, z: -spacing * 2.598, id: 7 },
                { x: -spacing / 2, z: -spacing * 2.598, id: 8 },
                { x: spacing / 2, z: -spacing * 2.598, id: 9 },
                { x: spacing * 1.5, z: -spacing * 2.598, id: 10 }
            ] // Row 4
        ];

        rowOffsets.forEach((row, rowIndex) => {
            row.forEach(p => {
                this.pins.push({
                    id: p.id,
                    initialPosition: new THREE.Vector3(p.x, 0, zStart + p.z),
                    position: new THREE.Vector3(p.x, 0, zStart + p.z),
                    velocity: new THREE.Vector3(0, 0, 0),
                    
                    // Rotation / tilting state
                    tilt: new THREE.Vector2(0, 0), // horizontal displacement offset of top (rx, rz)
                    tiltVelocity: new THREE.Vector2(0, 0), // change in tilt offset per second
                    
                    rotationY: Math.random() * Math.PI * 2, // Spin around vertical axis (visual only)
                    rotationYVelocity: 0,

                    radius: this.pinRadius,
                    mass: this.pinMass,
                    state: 'standing', // 'standing', 'sliding', 'tipped', 'pit'
                    settleTimer: 0,
                    soundCooldown: 0
                });
            });
        });
    }

    update(deltaTime, onCollision, onGutter, onPit) {
        if (!this.ball) return;
        
        this.collisionsThisFrame = [];

        // Cap deltaTime to avoid massive steps during lag
        const dt = Math.min(deltaTime, 0.016); // Run in sub-steps if delta is high
        const subSteps = 4;
        const sdt = dt / subSteps;

        for (let step = 0; step < subSteps; step++) {
            this.updatePhysicsStep(sdt, onCollision, onGutter, onPit);
        }
    }

    updatePhysicsStep(dt, onCollision, onGutter, onPit) {
        // --- 1. UPDATE BALL ---
        if (this.ball.state === 'rolling' || this.ball.state === 'gutter') {
            // Apply spin hook effect (only if on the lane, i.e., not in gutter or pit)
            if (this.ball.state === 'rolling') {
                // Real bowling hook is stronger on dry backends (Z < -10)
                const laneDryness = this.ball.position.z < -10 ? 1.5 : 0.4;
                // Spin exerts a lateral force
                const hookAccelerationX = this.ball.spin * laneDryness * 4.0;
                this.ball.velocity.x += hookAccelerationX * dt;
                
                // Keep Z velocity negative (rolling forward)
                if (this.ball.velocity.z > -2) {
                    this.ball.velocity.z = -2;
                }

                // Apply lane friction slow down slightly
                this.ball.velocity.z *= Math.exp(-0.01 * dt);
                this.ball.velocity.x *= Math.exp(-0.05 * dt);
            } else if (this.ball.state === 'gutter') {
                // Gutter is a channel: lock X, only move in Z
                this.ball.velocity.x = 0;
                this.ball.velocity.z *= Math.exp(-0.02 * dt);
            }

            // Move ball
            this.ball.position.addScaledVector(this.ball.velocity, dt);

            // Strict Lane Boundaries: Clamp X to the outer edges of the gutters (approx 0.74m)
            const absoluteMaxX = this.laneWidth / 2 + 0.22; // 0.745
            this.ball.position.x = THREE.MathUtils.clamp(this.ball.position.x, -absoluteMaxX, absoluteMaxX);

            // Gutter detection
            if (this.ball.state === 'rolling') {
                if (Math.abs(this.ball.position.x) > this.laneWidth / 2) {
                    this.ball.state = 'gutter';
                    // Drop ball into gutter groove
                    this.ball.position.y = -0.05; 
                    const gutterSide = Math.sign(this.ball.position.x);
                    this.ball.position.x = gutterSide * (this.laneWidth / 2 + 0.05);
                    // Damp X velocity
                    this.ball.velocity.x = 0;
                    if (onGutter) onGutter();
                }
            }

            // Pit detection
            if (this.ball.position.z < -21.0) {
                this.ball.state = 'pit';
                this.ball.velocity.set(0, 0, 0);
                if (onPit) onPit('ball');
            }
        }

        // --- 2. UPDATE PINS ---
        this.pins.forEach(pin => {
            if (pin.state === 'pit') return;

            // Reduce sound cooldown
            if (pin.soundCooldown > 0) pin.soundCooldown -= dt;

            // Apply gravity to tilt (tipping over)
            // If the pin is tilted, gravity pulls it further down!
            const tiltLen = pin.tilt.length();
            if (tiltLen > 0.005) {
                // Gravity torque proportional to tilt displacement
                const gravityTorque = 45.0 * (tiltLen / this.pinHeight); // stronger as tilt grows
                const tiltDirection = pin.tilt.clone().normalize();
                pin.tiltVelocity.addScaledVector(tiltDirection, gravityTorque * dt);
            }

            // Apply friction torque if sliding
            // When base slides, friction opposes movement, which exerts a tipping force in the direction of velocity!
            const slidingSpeed = pin.velocity.length();
            if (slidingSpeed > 0.1 && pin.state !== 'tipped') {
                // Slide direction
                const slideDir = new THREE.Vector2(pin.velocity.x, pin.velocity.z).normalize();
                // Friction torque tips the top of the pin forward along the slide direction
                const frictionTorque = 8.0 * slidingSpeed;
                pin.tiltVelocity.addScaledVector(slideDir, frictionTorque * dt);
            }

            // Apply spring force if standing/wobbling (tries to restore pin back vertical)
            // This is key to letting pins "wobble" but stand back up on light hits!
            if (tiltLen < 0.15 && pin.state !== 'tipped') {
                const springStrength = 40.0; // restoring force
                const springDamping = 6.0;  // damp the wobble
                
                // Pull back to center (0,0)
                pin.tiltVelocity.addScaledVector(pin.tilt, -springStrength * dt);
                pin.tiltVelocity.addScaledVector(pin.tiltVelocity, -springDamping * dt);
            } else {
                // Tipped over! Very weak restoring force, high damping
                pin.tiltVelocity.multiplyScalar(Math.exp(-4.0 * dt));
                if (tiltLen > 0.28) {
                    pin.state = 'tipped';
                }
            }

            // Update tilt values
            pin.tilt.addScaledVector(pin.tiltVelocity, dt);

            // Caps on maximum tilt to simulate lying flat on the lane floor
            const maxTilt = 0.35; // pin height is 0.38, tilt offset cap
            if (pin.tilt.length() > maxTilt) {
                pin.tilt.setLength(maxTilt);
                pin.tiltVelocity.set(0, 0); // stop tipping velocity when fully flat
            }

            // Apply physics to position (sliding on lane)
            if (pin.velocity.length() > 0.01) {
                pin.position.addScaledVector(pin.velocity, dt);
                
                // High friction on the wood lane slows down sliding pins rapidly
                const laneFriction = 3.5;
                pin.velocity.multiplyScalar(Math.exp(-laneFriction * dt));
                
                // Visual spin around vertical axis
                pin.rotationYVelocity *= Math.exp(-2.0 * dt);
                pin.rotationY += pin.rotationYVelocity * dt;
            } else {
                pin.velocity.set(0, 0, 0);
            }

            // Lock Y position to lane surface, but tilted pins drop slightly based on geometry
            const verticalDrop = Math.cos(Math.min(pin.tilt.length() / this.pinHeight, Math.PI/2));
            pin.position.y = (verticalDrop - 1) * (this.pinHeight * 0.4);

            // Gutter detection for pins
            if (Math.abs(pin.position.x) > this.laneWidth / 2) {
                // Drop into gutter
                pin.position.y = -0.05;
                // Move down the gutter with gravity/sliding
                pin.velocity.z -= 1.0 * dt; // slide down gutter
                pin.state = 'tipped';
            }

            // Pit boundary
            if (pin.position.z < -20.5 || pin.position.y < -0.2) {
                pin.state = 'pit';
                pin.velocity.set(0,0,0);
                if (onPit) onPit('pin', pin.id);
            }
        });

        // --- 3. COLLISIONS ---
        // A. Ball vs Pin Collisions
        if (this.ball.state === 'rolling') {
            this.pins.forEach(pin => {
                if (pin.state === 'pit') return;

                // Sphere to Cylinder (approximated as circle to circle in 2D horizontal plane)
                const dx = pin.position.x - this.ball.position.x;
                const dz = pin.position.z - this.ball.position.z;
                const dist2D = Math.hypot(dx, dz) || 0.001;
                const collisionDist = this.ballRadius + this.pinRadius;

                if (dist2D < collisionDist) {
                    // We have a hit!
                    const overlap = collisionDist - dist2D;
                    const normalX = dx / dist2D;
                    const normalZ = dz / dist2D;

                    // Push pin out of ball slightly
                    pin.position.x += normalX * overlap * 0.5;
                    pin.position.z += normalZ * overlap * 0.5;
                    this.ball.position.x -= normalX * overlap * 0.5;
                    this.ball.position.z -= normalZ * overlap * 0.5;

                    // 1D Collision velocities along normal
                    const ballVelN = this.ball.velocity.x * normalX + this.ball.velocity.z * normalZ;
                    const pinVelN = pin.velocity.x * normalX + pin.velocity.z * normalZ;

                    const relVelN = ballVelN - pinVelN;
                    if (relVelN > 0) {
                        // Collision impulse
                        // Elastic restitution
                        const restitution = 0.65;
                        const impulse = (1 + restitution) * relVelN / (1 / this.ballMass + 1 / this.pinMass);

                        // Update velocities
                        this.ball.velocity.x -= (impulse / this.ballMass) * normalX;
                        this.ball.velocity.z -= (impulse / this.ballMass) * normalZ;

                        pin.velocity.x += (impulse / this.pinMass) * normalX;
                        pin.velocity.z += (impulse / this.pinMass) * normalZ;

                        // Give pin spin and extreme tip torque!
                        // Impact off-center adds tilt velocity
                        const tiltImpulse = impulse * 0.15;
                        pin.tiltVelocity.x += normalX * tiltImpulse;
                        pin.tiltVelocity.y += normalZ * tiltImpulse; // Vector2 map to tilt space
                        
                        pin.rotationYVelocity = (Math.random() - 0.5) * impulse * 12.0;
                        if (pin.state === 'standing') {
                            pin.state = 'sliding';
                        }

                        // Trigger audio & particles
                        const volume = Math.min(impulse / 15.0, 1.0);
                        if (onCollision) {
                            onCollision('ball-pin', pin.id, volume);
                        }
                    }
                }
            });
        }

        // B. Pin vs Pin Collisions
        for (let i = 0; i < this.pins.length; i++) {
            const pinA = this.pins[i];
            if (pinA.state === 'pit') continue;

            for (let j = i + 1; j < this.pins.length; j++) {
                const pinB = this.pins[j];
                if (pinB.state === 'pit') continue;

                const dx = pinB.position.x - pinA.position.x;
                const dz = pinB.position.z - pinA.position.z;
                const dist2D = Math.hypot(dx, dz) || 0.001;
                const collisionDist = this.pinRadius * 2.1; // slightly larger cylinder footprint for tilts

                if (dist2D < collisionDist) {
                    const overlap = collisionDist - dist2D;
                    const normalX = dx / dist2D;
                    const normalZ = dz / dist2D;

                    // Push apart
                    pinA.position.x -= normalX * overlap * 0.5;
                    pinA.position.z -= normalZ * overlap * 0.5;
                    pinB.position.x += normalX * overlap * 0.5;
                    pinB.position.z += normalZ * overlap * 0.5;

                    const velAN = pinA.velocity.x * normalX + pinA.velocity.z * normalZ;
                    const velBN = pinB.velocity.x * normalX + pinB.velocity.z * normalZ;

                    const relVelN = velAN - velBN;
                    if (relVelN > 0) {
                        const restitution = 0.55;
                        const impulse = (1 + restitution) * relVelN / (1 / this.pinMass + 1 / this.pinMass);

                        pinA.velocity.x -= (impulse / this.pinMass) * normalX;
                        pinA.velocity.z -= (impulse / this.pinMass) * normalZ;

                        pinB.velocity.x += (impulse / this.pinMass) * normalX;
                        pinB.velocity.z += (impulse / this.pinMass) * normalZ;

                        // Transfer tilts on hit
                        const tiltTransfer = impulse * 0.1;
                        pinA.tiltVelocity.x -= normalX * tiltTransfer;
                        pinA.tiltVelocity.y -= normalZ * tiltTransfer;
                        pinB.tiltVelocity.x += normalX * tiltTransfer;
                        pinB.tiltVelocity.y += normalZ * tiltTransfer;

                        pinA.rotationYVelocity += (Math.random() - 0.5) * impulse * 8.0;
                        pinB.rotationYVelocity += (Math.random() - 0.5) * impulse * 8.0;

                        if (pinA.state === 'standing') pinA.state = 'sliding';
                        if (pinB.state === 'standing') pinB.state = 'sliding';

                        // Spark clatters
                        const volume = Math.min(impulse / 10.0, 1.0);
                        if (pinA.soundCooldown <= 0 && pinB.soundCooldown <= 0) {
                            pinA.soundCooldown = 0.08;
                            pinB.soundCooldown = 0.08;
                            if (onCollision) {
                                onCollision('pin-pin', pinA.id + '-' + pinB.id, volume);
                            }
                        }
                    }
                }
            }
        }
    }

    // Determine if all pins have settled (moving below threshold)
    hasSettled() {
        if (this.ball && (this.ball.state === 'rolling' || this.ball.state === 'gutter')) {
            return false;
        }

        // All pins are slow and not tipping fast anymore
        return this.pins.every(pin => {
            if (pin.state === 'pit') return true;
            const velocityOk = pin.velocity.length() < 0.05;
            const tiltVelOk = pin.tiltVelocity.length() < 0.1;
            return velocityOk && tiltVelOk;
        });
    }

    // Get number of fallen pins (either in the pit, or tipped over beyond angle)
    getFallenPins() {
        return this.pins.filter(pin => {
            return pin.state === 'pit' || pin.state === 'tipped' || pin.tilt.length() > 0.22;
        });
    }
}
