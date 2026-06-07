// Audio manager using Web Audio API for highly responsive low-latency sound triggers,
// perfectly managing volume and dynamic ball rolling pitch/hum.

export class AudioManager {
    constructor() {
        this.ctx = null;
        this.buffers = {};
        this.sources = {};
        this.isMuted = false;
        this.masterVolume = 0.6;
        
        // Active looping sounds
        this.rollSoundNode = null;
        this.rollGainNode = null;
        this.musicNode = null;
        this.musicGainNode = null;

       this.soundPaths = {
      music: 'assets/audio/bgm-synthwave.mp3',
      roll: 'assets/audio/sfx-ball-roll.mp3',
      clatter: 'assets/audio/sfx-pin-clatter.mp3',
      strike: 'assets/audio/sfx-strike.mp3',
      miss: 'assets/audio/sfx-miss.mp3'
    };
        

        this.loaded = false;
    }

    async init() {
        if (this.ctx) return;
        
        // Create Audio Context (defer until user gesture to comply with browser safety)
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();
        
        // Load sounds
        const loadPromises = Object.entries(this.soundPaths).map(async ([key, path]) => {
            try {
                const response = await fetch(path);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                this.buffers[key] = audioBuffer;
            } catch (err) {
                console.warn(`Failed to load audio for ${key} from ${path}:`, err);
            }
        });

        await Promise.all(loadPromises);
        this.loaded = true;
    }

    resumeContext() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setMute(mute) {
        this.isMuted = mute;
        if (this.isMuted) {
            if (this.rollGainNode) this.rollGainNode.gain.value = 0;
            if (this.musicGainNode) this.musicGainNode.gain.value = 0;
        } else {
            if (this.rollGainNode) this.rollGainNode.gain.value = this.masterVolume * 0.4;
            if (this.musicGainNode) this.musicGainNode.gain.value = this.masterVolume * 0.35;
        }
    }

    setVolume(vol) {
        this.masterVolume = THREE.MathUtils.clamp(vol, 0, 1);
        if (!this.isMuted) {
            if (this.rollGainNode) this.rollGainNode.gain.value = this.masterVolume * 0.4;
            if (this.musicGainNode) this.musicGainNode.gain.value = this.masterVolume * 0.35;
        }
    }

    playMusic() {
        if (!this.loaded || this.isMuted || !this.buffers.music) return;
        this.resumeContext();

        // Stop existing music if playing
        if (this.musicNode) {
            try { this.musicNode.stop(); } catch(e){}
        }

        const musicSource = this.ctx.createBufferSource();
        musicSource.buffer = this.buffers.music;
        musicSource.loop = true;

        const gainNode = this.ctx.createGain();
        gainNode.gain.value = this.isMuted ? 0 : this.masterVolume * 0.35;

        musicSource.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        musicSource.start(0);
        this.musicNode = musicSource;
        this.musicGainNode = gainNode;
    }

    startRollHum() {
        if (!this.loaded || !this.buffers.roll) return;
        this.resumeContext();

        if (this.rollSoundNode) return; // already humming

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers.roll;
        source.loop = true;

        const gainNode = this.ctx.createGain();
        gainNode.gain.value = 0; // start silent, main loop will fade it in based on speed

        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        source.start(0);
        this.rollSoundNode = source;
        this.rollGainNode = gainNode;
    }

    updateRollHum(speed, maxSpeed = 16) {
        if (!this.rollGainNode || !this.rollSoundNode || this.isMuted) return;

        // Dynamic volume based on speed
        const speedRatio = speed / maxSpeed;
        const targetVol = THREE.MathUtils.clamp(speedRatio * 0.5, 0, 0.5) * this.masterVolume;
        
        // Dynamic pitch based on speed
        const targetPlaybackRate = THREE.MathUtils.clamp(0.6 + speedRatio * 0.7, 0.6, 1.4);

        // Smooth audio parameters using exponential ramp
        this.rollGainNode.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.1);
        this.rollSoundNode.playbackRate.setTargetAtTime(targetPlaybackRate, this.ctx.currentTime, 0.15);
    }

    stopRollHum() {
        if (this.rollGainNode) {
            // Fade out
            this.rollGainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            setTimeout(() => {
                if (this.rollSoundNode) {
                    try { this.rollSoundNode.stop(); } catch(e){}
                    this.rollSoundNode = null;
                    this.rollGainNode = null;
                }
            }, 200);
        }
    }

    playPinClatter(volume = 1.0) {
        if (!this.loaded || this.isMuted || !this.buffers.clatter) return;
        this.resumeContext();

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers.clatter;
        
        // Randomize pitch slightly for more natural clattering variety
        source.playbackRate.value = 0.85 + Math.random() * 0.3;

        const gainNode = this.ctx.createGain();
        gainNode.gain.value = THREE.MathUtils.clamp(volume, 0, 1) * this.masterVolume * 0.7;

        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        source.start(0);
    }

    playImpactThump(volume = 1.0) {
        if (!this.ctx || this.isMuted) return;
        this.resumeContext();

        // 1. Deep Sub-bass Impact Thump
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(42, this.ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(volume * this.masterVolume * 0.65, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.32);

        osc.start(0);
        osc.stop(this.ctx.currentTime + 0.35);

        // 2. High-Tech Cyber Zap layer
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(180, this.ctx.currentTime + 0.14);

        gain2.gain.setValueAtTime(volume * this.masterVolume * 0.22, this.ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.16);

        osc2.start(0);
        osc2.stop(this.ctx.currentTime + 0.18);
    }

    playStrikeFanfare() {
        if (!this.loaded || this.isMuted || !this.buffers.strike) return;
        this.resumeContext();

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers.strike;

        const gainNode = this.ctx.createGain();
        gainNode.gain.value = this.masterVolume * 0.8;

        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        source.start(0);
    }
    playMissSound() {
    if (!this.loaded || this.isMuted || !this.buffers.miss) return;
    this.resumeContext();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.miss;
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = this.masterVolume * 0.8;
    source.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    source.start(0);
  }

    playClick() {
        // Procedural high-pass laser beep for clicks to ensure instantly available
        if (!this.ctx) return;
        this.resumeContext();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(this.masterVolume * 0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.12);
    }
}
import * as THREE from 'three';
