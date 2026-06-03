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

class MobileControls {
  constructor(options = {}) {
    this.enabled = options.enabled ?? this.detectMobile();
    this.actions = options.actions || [{ id: 'jump', label: 'JUMP' }];
    this.move = { x: 0, y: 0 };
    this.lookDelta = { x: 0, y: 0 };
    this.actionState = new Map();
    this.pointerState = {
      joystick: null,
      look: null,
      joystickCenter: { x: 0, y: 0 },
      lookLast: { x: 0, y: 0 }
    };
    this.elements = null;

    if (this.enabled) this.mount();
  }

  detectMobile() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  mount() {
    this.destroy();

    const root = document.createElement('div');
    root.id = 'mobile-game-controls';
    root.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1000;
      font-family: system-ui, sans-serif;
      user-select: none;
      touch-action: none;
    `;

    const lookZone = document.createElement('div');
    lookZone.id = 'mobile-look-zone';
    lookZone.style.cssText = `
      position: absolute;
      top: 0;
      right: 0;
      width: 58%;
      height: 100%;
      pointer-events: auto;
      touch-action: none;
    `;

    const joystick = document.createElement('div');
    joystick.id = 'virtual-joystick';
    joystick.style.cssText = `
      position: absolute;
      left: calc(24px + env(safe-area-inset-left));
      bottom: calc(24px + env(safe-area-inset-bottom));
      width: 132px;
      height: 132px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.48);
      background: rgba(10, 14, 24, 0.32);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      pointer-events: auto;
      touch-action: none;
    `;

    const knob = document.createElement('div');
    knob.id = 'virtual-joystick-knob';
    knob.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.86);
      transform: translate(-50%, -50%);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
    `;
    joystick.appendChild(knob);

    const actionBar = document.createElement('div');
    actionBar.id = 'mobile-action-buttons';
    actionBar.style.cssText = `
      position: absolute;
      right: calc(24px + env(safe-area-inset-right));
      bottom: calc(24px + env(safe-area-inset-bottom));
      display: flex;
      gap: 14px;
      align-items: flex-end;
      pointer-events: none;
    `;

    const actionButtons = new Map();
    this.actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action.id;
      button.textContent = action.label || action.id.toUpperCase();
      button.style.cssText = `
        min-width: 78px;
        min-height: 78px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.55);
        background: rgba(10, 14, 24, 0.42);
        color: white;
        font: 700 13px/1 system-ui, sans-serif;
        letter-spacing: 0;
        pointer-events: auto;
        touch-action: none;
      `;
      actionButtons.set(action.id, button);
      actionBar.appendChild(button);
    });

    root.appendChild(lookZone);
    root.appendChild(joystick);
    root.appendChild(actionBar);
    document.body.appendChild(root);

    this.elements = { root, lookZone, joystick, knob, actionButtons };
    this.bindJoystick();
    this.bindLookZone();
    this.bindActionButtons();
  }

  bindJoystick() {
    const { joystick, knob } = this.elements;
    const maxDistance = 42;

    const updateFromEvent = (event) => {
      const dx = event.clientX - this.pointerState.joystickCenter.x;
      const dy = event.clientY - this.pointerState.joystickCenter.y;
      const distance = Math.hypot(dx, dy);
      const limited = Math.min(distance, maxDistance);
      const angle = Math.atan2(dy, dx);
      const x = Math.cos(angle) * limited;
      const y = Math.sin(angle) * limited;

      knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      this.move.x = x / maxDistance;
      this.move.y = -y / maxDistance;
    };

    joystick.addEventListener('pointerdown', (event) => {
      if (this.pointerState.joystick !== null) return;
      const rect = joystick.getBoundingClientRect();
      this.pointerState.joystick = event.pointerId;
      this.pointerState.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      safelySetPointerCapture(joystick, event.pointerId);
      updateFromEvent(event);
      event.preventDefault();
    });

    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.pointerState.joystick) return;
      updateFromEvent(event);
      event.preventDefault();
    });

    const end = (event) => {
      if (event.pointerId !== this.pointerState.joystick) return;
      this.pointerState.joystick = null;
      this.move.x = 0;
      this.move.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
      safelyReleasePointerCapture(joystick, event.pointerId);
      event.preventDefault();
    };
    joystick.addEventListener('pointerup', end);
    joystick.addEventListener('pointercancel', end);
  }

  bindLookZone() {
    const { lookZone } = this.elements;

    lookZone.addEventListener('pointerdown', (event) => {
      if (this.pointerState.look !== null) return;
      this.pointerState.look = event.pointerId;
      this.pointerState.lookLast = { x: event.clientX, y: event.clientY };
      safelySetPointerCapture(lookZone, event.pointerId);
      event.preventDefault();
    });

    lookZone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.pointerState.look) return;
      this.lookDelta.x += event.clientX - this.pointerState.lookLast.x;
      this.lookDelta.y += event.clientY - this.pointerState.lookLast.y;
      this.pointerState.lookLast = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    });

    const end = (event) => {
      if (event.pointerId !== this.pointerState.look) return;
      this.pointerState.look = null;
      safelyReleasePointerCapture(lookZone, event.pointerId);
      event.preventDefault();
    };
    lookZone.addEventListener('pointerup', end);
    lookZone.addEventListener('pointercancel', end);
  }

  bindActionButtons() {
    this.elements.actionButtons.forEach((button, actionId) => {
      const setPressed = (pressed) => {
        this.actionState.set(actionId, pressed);
        button.style.background = pressed
          ? 'rgba(255, 255, 255, 0.35)'
          : 'rgba(10, 14, 24, 0.42)';
        button.style.transform = pressed ? 'scale(0.94)' : 'scale(1)';
      };

      button.addEventListener('pointerdown', (event) => {
        safelySetPointerCapture(button, event.pointerId);
        setPressed(true);
        event.preventDefault();
      });
      button.addEventListener('pointerup', (event) => {
        setPressed(false);
        safelyReleasePointerCapture(button, event.pointerId);
        event.preventDefault();
      });
      button.addEventListener('pointercancel', (event) => {
        setPressed(false);
        safelyReleasePointerCapture(button, event.pointerId);
        event.preventDefault();
      });
      button.addEventListener('pointerleave', () => setPressed(false));
    });
  }

  getMoveVector() {
    return { x: this.move.x, y: this.move.y };
  }

  consumeLookDelta() {
    const delta = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return delta;
  }

  isActionPressed(actionId) {
    return this.actionState.get(actionId) === true;
  }

  destroy() {
    this.elements?.root.remove();
    this.elements = null;
    this.move = { x: 0, y: 0 };
    this.lookDelta = { x: 0, y: 0 };
    this.pointerState = {
      joystick: null,
      look: null,
      joystickCenter: { x: 0, y: 0 },
      lookLast: { x: 0, y: 0 }
    };
    this.actionState.clear();
  }
}

export { MobileControls };