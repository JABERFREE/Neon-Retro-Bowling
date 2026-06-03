# Future Agent Operating Guide — Neon Retro Bowling

## Project Summary & Core Loop
This project is a high-fidelity, polished, and fully interactive 3D Bowling Game rendered at full-viewport scale inside a Three.js canvas. It features a stunning "Neon-Retro-Futuristic" theme blending synthwave graphics, neon glowing elements, and responsive 3D physical modeling.

- **Primary Gameplay Loop**:
  1. **Aiming State**: The player drags the cyber-ball left/right to position it on the approach lane.
  2. **Throwing/Flicking State**: The player performs a rapid swipe/flick gesture upwards to release and roll. The speed of the swipe maps directly to forward velocity, and horizontal curved swipes induce realistic sideward spin/hook curves.
  3. **Rolling State**: The ball rolls down the glossy wood-and-neon grid lane, emitting a pulsating cyan-purple light trail with full 3D rolling rotation.
  4. **Pin-Settle State**: The ball strikes the pins, triggering complex, realistic elastic cylinder-sphere and cylinder-cylinder collisions, transferring speed, creating wobbles/tipping forces, and causing a beautiful domino-cascade effect!
  5. **Scoring State**: Knocked pins are counted, and classic bowling rulebook scores (Strikes, Spares, Frames 1-10, Extra 10th-Frame rolls, Cumulative totals) are computed and synchronized on a neon-grid HUD scoreboard.
  6. **Clean/Sweep State**: A glowing cyan sweep beam clears fallen pins between throws, and the deck resets dynamically.

## Important Files & Structure
- `/index.html`: Bootstraps the application, imports libraries (Three.js @0.184.0, web audio) with an importmap, sets full-screen styles, and establishes Google fonts (Orbitron).
- `/main.js`: Main coordinator. Instantiates the Three.js scene, builds the neon bowling lane, sets up dynamic spotlighting, manages the game state machine, handles score bookkeeping, and coordinates animations.
- `/physics.js`: A robust, custom-written 3D physical simulation specifically optimized for bowling pin-to-ball and pin-to-pin cylinder-sphere elastic collisions, gravity torque, and slide friction torques. Extremely lightweight, stable, and highly predictable.
- `/controls.js`: Touch and mouse drag/flick coordinate parser. Detects speed, swipe directions, and path curvature to supply angular spin (hooks).
- `/effects.js`: Ribbon light trail generator, spark emitters, 3D screen shake, and flashy retro HTML text announcements.
- `/audio.js`: Preloads and triggers generated synthwave soundtrack loops, dynamic rolling ball rumbles (modulating volume & playback rate by velocity), pin clatters (scaling volume by impact force), and strike zaps.

## Assets Directory & Naming Conventions
- Image files are stored under `/assets/` (e.g. `/assets/retro-bg.webp` — the synthwave skybox billboard).
- Audio files are stored under `/assets/audio/` (e.g. `/assets/audio/bgm-synthwave.mp3`, `sfx-ball-roll.mp3`, `sfx-pin-clatter.mp3`, `sfx-strike.mp3`).
- Path conventions: use relative paths (e.g. `'assets/retro-bg.webp'`, `'assets/audio/bgm-synthwave.mp3'`) inside runtime script code.

## Playback and Volume Guidelines
- Audio starts only after the user gestures (clicks the "START PLAYING" button) to satisfy standard browser security protocols.
- The UI includes a master volume slider and mute/unmute button which perfectly gates and scales all sound signals.
- Limit concurrent pin clatter triggers by using cooldown timers to prevent sound overlapping distortion.

## Guidelines for Future Development
- Always read `/art_direction.md` before making any visual modifications.
- Always read `/sound_direction.md` before adding or updating sound effects.
- Ensure the custom physics system's coefficients (such as pin mass, ball mass, restitutions, or sliding friction) are modified carefully in `/physics.js` to preserve the extremely satisfying, realistic pin reactions.
