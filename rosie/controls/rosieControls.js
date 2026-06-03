import * as THREE from 'three';
import { MobileControls } from './rosieMobileControls.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTextEntryTarget(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function normalizeModelForward(value) {
  return value === 'negative-z' ? 'negative-z' : 'positive-z';
}

function safelySetPointerCapture(element, pointerId) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Some browsers reject capture for synthetic or already-ended pointers.
  }
}

function safelyReleasePointerCapture(element, pointerId) {
  try {
    element.releasePointerCapture?.(pointerId);
  } catch {
    // Ignore stale pointer release paths.
  }
}

function hasTouchInput() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

class PlayerController {
  constructor(player, options = {}) {
    this.player = player;
    this.moveSpeed = options.moveSpeed ?? 8;
    this.jumpSpeed = options.jumpSpeed ?? options.jumpForce ?? 12;
    this.gravity = options.gravity ?? 28;
    this.groundLevel = options.groundLevel ?? 0;
    this.enabled = options.enabled ?? true;
    this.rotateToMovement = options.rotateToMovement ?? true;
    this.cameraMode = options.cameraMode || 'third-person';
    this.modelForward = normalizeModelForward(options.modelForward);
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.moveInput = new THREE.Vector2();
    this.isOnGround = true;
    this.canJump = true;

    this.mobileControls = options.mobileControls === false
      ? null
      : options.mobileControls || new MobileControls({
          actions: options.actions || [{ id: 'jump', label: 'JUMP' }]
        });

    this._onKeyDown = (event) => {
      if (!this.enabled || isTextEntryTarget(event)) return;
      this.keys.add(event.code);
    };
    this._onKeyUp = (event) => {
      this.keys.delete(event.code);
    };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.rotateToMovement = mode !== 'first-person';
  }

  isGrounded() {
    return this.player.position.y <= this.groundLevel + 0.001;
  }

  isActionPressed(actionId = 'jump') {
    if (actionId === 'jump' && this.keys.has('Space')) return true;
    return this.mobileControls?.isActionPressed(actionId) ?? false;
  }

  getMoveInput() {
    let x = 0;
    let y = 0;

    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;

    const mobile = this.mobileControls?.getMoveVector();
    if (mobile) {
      x += mobile.x;
      y += mobile.y;
    }

    this.moveInput.set(x, y);
    if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();
    return this.moveInput;
  }

  getMoveDirection(cameraYaw = 0) {
    const input = this.getMoveInput();
    const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const direction = new THREE.Vector3();

    direction.addScaledVector(right, input.x);
    direction.addScaledVector(forward, input.y);
    if (direction.lengthSq() > 1) direction.normalize();
    return direction;
  }

  update(deltaTime, cameraYaw = 0) {
    if (!this.enabled) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      return this.velocity;
    }

    const dt = Math.min(deltaTime, 0.05);
    const direction = this.getMoveDirection(cameraYaw);
    const grounded = this.isGrounded();
    this.isOnGround = grounded;
    this.canJump = grounded;

    this.velocity.x = direction.x * this.moveSpeed;
    this.velocity.z = direction.z * this.moveSpeed;

    if (grounded) {
      this.player.position.y = this.groundLevel;
      if (this.velocity.y < 0) this.velocity.y = 0;
      if (this.isActionPressed('jump')) {
        this.velocity.y = this.jumpSpeed;
        this.isOnGround = false;
        this.canJump = false;
      }
    } else {
      this.velocity.y -= this.gravity * dt;
    }

    this.player.position.x += this.velocity.x * dt;
    this.player.position.y += this.velocity.y * dt;
    this.player.position.z += this.velocity.z * dt;

    if (this.player.position.y < this.groundLevel) {
      this.player.position.y = this.groundLevel;
      this.velocity.y = 0;
      this.isOnGround = true;
      this.canJump = true;
    }

    if (this.rotateToMovement && this.cameraMode !== 'first-person' && direction.lengthSq() > 0.0001) {
      const positiveZYaw = Math.atan2(direction.x, direction.z);
      this.player.rotation.y = this.modelForward === 'negative-z'
        ? positiveZYaw + Math.PI
        : positiveZYaw;
    }

    return this.velocity;
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.mobileControls?.destroy();
  }
}

class ThirdPersonCameraController {
  constructor(camera, target, domElement, options = {}) {
    this.camera = camera;
    this.target = target;
    this.domElement = domElement;
    this.distance = options.distance ?? 8;
    this.targetHeight = options.targetHeight ?? 1.2;
    this.minPitch = options.minPitch ?? -0.25;
    this.maxPitch = options.maxPitch ?? 1.05;
    this.yaw = options.yaw ?? 0;
    this.pitch = clamp(options.pitch ?? 0.35, this.minPitch, this.maxPitch);
    this.rotationSpeed = options.rotationSpeed ?? 0.004;
    this.enabled = options.enabled ?? true;
    this.mobileControls = options.mobileControls ?? null;
    this.pointerLock = options.pointerLock ?? !hasTouchInput();
    this.isPointerLocked = false;
    this.pointerId = null;
    this.lastPointer = { x: 0, y: 0 };
    this.lookAtTarget = new THREE.Vector3();

    this._onPointerDown = (event) => {
      if (!this.enabled || this.pointerId !== null || event.button > 0) return;
      if (this.pointerLock && event.pointerType !== 'touch') {
        this.domElement.requestPointerLock?.();
        event.preventDefault();
        return;
      }
      this.pointerId = event.pointerId;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      safelySetPointerCapture(this.domElement, event.pointerId);
      event.preventDefault();
    };
    this._onPointerMove = (event) => {
      if (!this.enabled || event.pointerId !== this.pointerId) return;
      this.rotateByPointerDelta(
        event.clientX - this.lastPointer.x,
        event.clientY - this.lastPointer.y
      );
      this.lastPointer = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    };
    this._onPointerUp = (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      safelyReleasePointerCapture(this.domElement, event.pointerId);
      event.preventDefault();
    };
    this._onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;
      if (this.isPointerLocked) this.pointerId = null;
    };
    this._onMouseMove = (event) => {
      if (!this.enabled || !this.isPointerLocked) return;
      this.rotateByPointerDelta(event.movementX, event.movementY);
    };
    this._onWheel = (event) => {
      if (!this.enabled) return;
      this.distance = clamp(this.distance + Math.sign(event.deltaY) * 0.75, 3, 18);
      event.preventDefault();
    };

    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('pointerup', this._onPointerUp);
    this.domElement.addEventListener('pointercancel', this._onPointerUp);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('mousemove', this._onMouseMove);
  }

  rotateByPointerDelta(deltaX, deltaY) {
    this.yaw -= deltaX * this.rotationSpeed;
    this.pitch = clamp(
      this.pitch + deltaY * this.rotationSpeed,
      this.minPitch,
      this.maxPitch
    );
  }

  getYaw() {
    return this.yaw;
  }

  get rotation() {
    return this.yaw;
  }

  set rotation(value) {
    this.yaw = value;
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    this.pointerId = null;
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock?.();
    }
  }

  update() {
    if (!this.enabled) return this.yaw;

    const mobileLook = this.mobileControls?.consumeLookDelta();
    if (mobileLook && (mobileLook.x !== 0 || mobileLook.y !== 0)) {
      this.rotateByPointerDelta(mobileLook.x, mobileLook.y);
    }

    const horizontalDistance = Math.cos(this.pitch) * this.distance;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * horizontalDistance,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * horizontalDistance
    );

    this.lookAtTarget.copy(this.target.position);
    this.lookAtTarget.y += this.targetHeight;
    this.camera.position.copy(this.lookAtTarget).add(offset);
    this.camera.lookAt(this.lookAtTarget);
    return this.yaw;
  }

  destroy() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('pointercancel', this._onPointerUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock?.();
    }
  }
}

class FirstPersonCameraController {
  constructor(camera, player, domElement, options = {}) {
    this.camera = camera;
    this.player = player;
    this.domElement = domElement;
    this.eyeHeight = options.eyeHeight ?? 1.6;
    this.mouseSensitivity = options.mouseSensitivity ?? 0.0025;
    this.minPitch = options.minPitch ?? -Math.PI / 2 + 0.1;
    this.maxPitch = options.maxPitch ?? Math.PI / 2 - 0.1;
    this.yaw = options.yaw ?? 0;
    this.pitch = options.pitch ?? 0;
    this.enabled = options.enabled ?? false;
    this.mobileControls = options.mobileControls ?? null;
    this.originalVisibility = null;

    this._onClick = () => {
      if (this.enabled && document.pointerLockElement !== this.domElement) {
        this.domElement.requestPointerLock?.();
      }
    };
    this._onMouseMove = (event) => {
      if (!this.enabled || document.pointerLockElement !== this.domElement) return;
      this.rotateByPointerDelta(event.movementX, event.movementY);
    };

    this.domElement.addEventListener('click', this._onClick);
    document.addEventListener('mousemove', this._onMouseMove);
  }

  rotateByPointerDelta(deltaX, deltaY) {
    this.yaw -= deltaX * this.mouseSensitivity;
    this.pitch = clamp(
      this.pitch - deltaY * this.mouseSensitivity,
      this.minPitch,
      this.maxPitch
    );
  }

  setEnabled(enabled) {
    if (enabled) this.enable();
    else this.disable();
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.hidePlayer();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.showPlayer();
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock?.();
    }
  }

  hidePlayer() {
    if (this.originalVisibility) return;
    this.originalVisibility = [];
    this.player.traverse?.((child) => {
      if (child.isMesh) {
        this.originalVisibility.push({ object: child, visible: child.visible });
        child.visible = false;
      }
    });
  }

  showPlayer() {
    if (!this.originalVisibility) return;
    this.originalVisibility.forEach(({ object, visible }) => {
      object.visible = visible;
    });
    this.originalVisibility = null;
  }

  getYaw() {
    return this.yaw;
  }

  get rotationY() {
    return this.yaw;
  }

  set rotationY(value) {
    this.yaw = value;
  }

  get rotationX() {
    return this.pitch;
  }

  set rotationX(value) {
    this.pitch = clamp(value, this.minPitch, this.maxPitch);
  }

  update() {
    if (!this.enabled) return this.yaw;

    const mobileLook = this.mobileControls?.consumeLookDelta();
    if (mobileLook && (mobileLook.x !== 0 || mobileLook.y !== 0)) {
      this.rotateByPointerDelta(mobileLook.x, mobileLook.y);
    }

    this.player.rotation.y = this.yaw;
    this.camera.position.set(
      this.player.position.x,
      this.player.position.y + this.eyeHeight,
      this.player.position.z
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
    return this.yaw;
  }

  destroy() {
    this.disable();
    this.domElement.removeEventListener('click', this._onClick);
    document.removeEventListener('mousemove', this._onMouseMove);
  }
}

export { PlayerController, ThirdPersonCameraController, FirstPersonCameraController };