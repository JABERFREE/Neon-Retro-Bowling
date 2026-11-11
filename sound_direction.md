# Neon-Retro-Futuristic Bowling Sound Direction

## Sonic Palette
The game sound design is styled in "Synthwave Electro Cyberpunk," matching the high-contrast pink/blue neon aesthetic. Sound effects should combine organic analog qualities (like real bowling pin clatters and heavy ball rolling rumbles) with synthesized, heavily chorused, and retro-futuristic digital sounds.

## Music Direction
- **Style**: Loopable instrumental Synthwave/Outrun background music.
- **Instruments**: Analog-style retro synthesizers, deep pumping basslines, lush 1980s synth pads, and a punchy LinnDrum style electronic drum beat (90-110 BPM).
- **Mood**: High-energy, cybernetic, and cool. It sets a relaxing but driving pace, encouraging the player to time their flicks and aim carefully.

## SFX Language
- **Ball Roll**: A heavy, low-frequency hum or drone mixed with a high-tech electric whirring noise that increases in frequency and volume based on ball speed.
- **Pin Hit / Clatter**: A bright, metallic, glass-shattering clatter rather than plain wood pin collisions, suggesting glowing futuristic pins. It features a fast attack, rich stereo spread, and subtle echo/reverb.
- **Gutter Roll**: A soft sliding synth whoosh with a slightly disappointed low-passed tone.
- **Strike Fanfare**: A triumphant synth brass chord combined with crowd cheers, electronic laser zaps, and an explosive reverse crash cymbal.
- **Spare Sound**: A cheerful, arpeggiated synth arpeggio indicating a clean sweep.
- **UI Interaction**: Clean, high-pitched retro laser clicks, sweep sounds for swipes, and low synth errors for invalid gestures.

## Mix And Playback Notes
- **Dynamic Volumes**: Pin-to-pin and ball-to-pin hit sound volumes must scale proportionally to their collision velocity. Heavy hits are loud and dramatic; subtle scrapes are quiet and distinct.
- **Gating**: Avoid sound overlapping mud. Limit the maximum concurrent clatter sounds to 3 channels using a simple priority queue or cooldown gate.
- **Mute / Control**: Simple master volume slider and mute/unmute buttons on the UI overlay.
