# Rosie Component Library

This folder contains **pre-built Rosie components** that you can use or not, depending on your use case.
These are production-ready, tested components - but only use them if they fit the specific request.

## 🚨 Important: Always Read Before Using

**You must use the `read` tool to load a component's source code BEFORE importing it.**

Example workflow:
```javascript
// 1. Use read tool first
read(file_path="/rosie/controls/rosieControls.js")

// 2. Then import after reviewing
import { PlayerController, ThirdPersonCameraController } from './rosie/controls/rosieControls.js';
```

---

## Available Components

### 🎮 rosieControls.js (3D Games - Three.js)

**Path:** `/rosie/controls/rosieControls.js`
**Exports:** `PlayerController`, `ThirdPersonCameraController`, `FirstPersonCameraController`

**What it does:**
- WASD movement with camera-relative direction
- Jumping, gravity, ground detection
- Rotates the player's local `+Z` visual front toward movement by default
- Third-person camera with desktop click-to-lock pointer control, natural vertical look direction, zoom, and clamped orbit
- Optional first-person pointer-lock camera with yaw and pitch
- Automatic mobile controls with movement joystick, natural right-side camera drag, and action buttons
- Mobile movement helpers return plain `{ x, y }` objects; use numeric math or convert to `new THREE.Vector2(...)` before calling vector methods

**Use for:** 3D platformers, exploration games, action games
**Don't use for:** 2D games, racing games, top-down games

**Model facing convention:** Build the visible front of a controlled character on local `+Z` by default: face, visor, headlights, or nose at `z > 0`; backpack, exhaust, trails, or tail at `z < 0`. If a model intentionally faces local `-Z`, pass `modelForward: 'negative-z'`.

**Quick example:**
```javascript
const controller = new PlayerController(playerMesh, {
  moveSpeed: 10,
  jumpSpeed: 15,
  groundLevel: 0,
  modelForward: 'positive-z'
});

const cameraRig = new ThirdPersonCameraController(
  camera, playerMesh, renderer.domElement, {
  distance: 7,
  targetHeight: 1.4,
  pointerLock: true,
  mobileControls: controller.mobileControls
});

// In game loop:
const cameraYaw = cameraRig.update();
controller.update(deltaTime, cameraYaw);
```

---

### 📱 phaserMobileControls.js (2D Games - Phaser)

**Path:** `/rosie/controls/phaserMobileControls.js`
**Exports:** `VirtualJoystick`, `ActionButton`, `MobileControlsManager`

**What it does:**
- Virtual joystick for movement (fixed position, left side)
- Action buttons with visual feedback (jump, shoot, etc.)
- Mobile controls manager with safe area handling and resize layout

**Use for:** 2D mobile games using Phaser
**Don't use for:** 3D games, desktop-only games

**Quick example:**
```javascript
import { MobileControlsManager } from './rosie/controls/phaserMobileControls.js';

// In GameScene - add controls
this.mobileControls = new MobileControlsManager(this);
this.mobileControls.addJoystick();
this.mobileControls.addButton({
  label: 'JUMP',
  onPress: () => this.player.jump()
});

// In update() - get movement
const move = this.mobileControls.getMovement();
this.player.setVelocityX(move.x * speed);
```

---

### 📱 rosieMobileControls.js (Internal)

**Path:** `/rosie/controls/rosieMobileControls.js`
**Note:** Auto-imported by rosieControls.js - no need to import separately

---

## Usage Rules

✅ **DO:**
- Read source with `read` tool before using
- Import from rosie/ folder: `'./rosie/controls/...'`
- Only use components that fit the request
- Use phaserMobileControls.js for 2D mobile games
- Use rosieControls.js for 3D games

❌ **DON'T:**
- Import without reading first
- Recreate these components
- Use 3D controls for 2D games (or vice versa)
