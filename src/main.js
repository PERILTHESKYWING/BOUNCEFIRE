import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CONFIG, BOSS_DEF } from './core/config.js';
import { detectQuality, clamp, damp, formatNumber, TAU } from './core/utils.js';
import { Save } from './core/save.js';
import { Monetization } from './core/monetization.js';
import { LEVELS } from './data/levels.js';
import { THEMES } from './data/themes.js';
import { BULLET_AURAS } from './data/progression.js';
import { Arena } from './world/arena.js';
import { Particles } from './fx/particles.js';
import { Effects } from './fx/effects.js';
import { DamageNumbers } from './fx/damageNumbers.js';
import { CameraRig } from './fx/cameraRig.js';
import { Bullets } from './game/bullets.js';
import { Enemies } from './game/enemies.js';
import { Player } from './game/player.js';
import { Combat } from './game/combat.js';
import { Boss } from './game/boss.js';
import { AudioEngine } from './audio/audio.js';
import { Music } from './audio/music.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', RESULTS: 'results', DEAD: 'dead' };

class Game {
  constructor() {
    this.state = STATE.MENU;
    this.time = 0;
    this.timeScale = 1;
    this.levelIndex = 0;
    this.difficulty = 1;
    this.bossKilled = false;
    this.levelCoins = 0;

    this.save = new Save();
    this.monetization = new Monetization();
    this.audio = new AudioEngine();
    this.music = new Music(this.audio);

    this._initRenderer();
    this._initScene();

    this.camera = new THREE.PerspectiveCamera(CONFIG.render.fov, 1, CONFIG.render.near, CONFIG.render.far);
    this.cameraRig = new CameraRig(this.camera);
    this.camera_ = this.camera;

    this.qualityName = this.save.data.settings.quality || detectQuality();
    this.quality = { ...CONFIG.quality[this.qualityName], low: this.qualityName === 'low' };

    this.arena = new Arena(this.scene, this.renderer);
    this.fx = {
      particles: new Particles(this.scene, this.renderer, CONFIG.quality.high.particles),
      effects: null,
      damageNumbers: new DamageNumbers(this.camera, CONFIG.feel.damageNumberMerge),
    };
    this.fx.effects = new Effects(this.scene, this.renderer, this.fx.particles);

    this.combat = new Combat(this);
    this.bullets = new Bullets(this.scene, this);
    this.enemies = new Enemies(this.scene, this);
    this.player = new Player(this.scene, this);
    this.boss = new Boss(this.scene, this);

    this.uiRoot = document.getElementById('ui');
    this.hud = new HUD(this.uiRoot, this);
    this.screens = new Screens(this.uiRoot, this);

    this._initPost();
    this._bindEvents();
    this.refreshStats();
    this.applyQuality(this.qualityName);

    this._clock = new THREE.Clock();
    this._acc = 0;
    this._fpsSamples = [];
    this._autoQualityChecked = false;
  }

  // ------------------------------------------------------------------ setup

  _initRenderer() {
    const canvas = document.getElementById('gl');
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    });
    renderer.setClearColor(0x05060f, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x080b1c, CONFIG.render.fogNear, CONFIG.render.fogFar);

    this.hemi = new THREE.HemisphereLight(0x2a52ff, 0x040616, 0.55);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0x6ea8ff, 1.5);
    this.key.position.set(-16, 40, -10);
    this.scene.add(this.key);

    this.rim = new THREE.DirectionalLight(0x00e5ff, 1.1);
    this.rim.position.set(18, 22, 30);
    this.scene.add(this.rim);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.16);
    this.scene.add(this.ambient);

    // Sky dome: a cheap vertical gradient with drifting stars, so levels never
    // end in flat black above the maze. One draw call, follows the camera.
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x05060f) },
      uBottom: { value: new THREE.Color(0x141c3c) },
      uTime: { value: 0 },
      uStars: { value: 0.6 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 20, 14),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uBottom; uniform float uTime; uniform float uStars;
          varying vec3 vPos;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          void main() {
            float h = clamp(vPos.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 c = mix(uBottom, uTop, pow(h, 0.75));
            // sparse twinkling stars in the upper hemisphere only
            vec2 g = floor(vPos.xz * 46.0 + vPos.y * 13.0);
            float s = hash(g);
            if (s > 0.9965 && vPos.y > 0.02) {
              float tw = 0.55 + 0.45 * sin(uTime * 2.2 + s * 60.0);
              c += vec3(0.85, 0.92, 1.0) * tw * uStars * smoothstep(0.0, 0.3, vPos.y);
            }
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.sky = sky;
  }

  _initPost() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.52, 0.55, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  applyQuality(name) {
    this.qualityName = name;
    const q = CONFIG.quality[name] || CONFIG.quality.medium;
    this.quality = { ...q, low: name === 'low' };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
    this.bullets.setQuality(q.trailGhosts);
    this.fx?.particles?.setLimit(q.particles);
    this.bloom.strength = q.bloomStrength;
    this.useBloom = q.bloom;
    this._resize();
  }

  _bindEvents() {
    addEventListener('resize', () => this._resize());
    addEventListener('orientationchange', () => setTimeout(() => this._resize(), 120));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === STATE.PLAYING) this.pause();
    });
    this.player.attachInput(document.getElementById('stage'));

    const unlock = () => {
      this.audio.resume();
      this.audio.setMusicEnabled(this.save.data.settings.music);
      this.audio.setSfxEnabled(this.save.data.settings.sfx);
      if (this.state === STATE.MENU && this.level) {
        this.music.start(this.level.theme);
        this.music.setIntensity(0.25);
      }
    };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.state === STATE.PLAYING) this.pause();
        else if (this.state === STATE.PAUSED) this.resume();
      }
    });
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.max(128, w * 0.4), Math.max(128, h * 0.4));
    this.camera.aspect = w / h;
    // portrait phones need a wider vertical view than a desktop window
    this.cameraRig.baseFov = CONFIG.render.fov * clamp(1.35 - (w / h) * 0.55, 0.85, 1.32);
    this.camera.fov = this.cameraRig.baseFov;
    this.camera.updateProjectionMatrix();
  }

  haptic(pattern) {
    if (!this.save.data.settings.haptics) return;
    navigator.vibrate?.(pattern);
  }

  refreshStats() {
    const s = this.save.computeStats();
    Object.assign(this.player.stats, s);
    this.player.bulletColor.setHex(this.save.skinColor());
    this.aura = this.save.aura();
  }

  // ---------------------------------------------------------- level control

  startLevel(index) {
    this.stopAttract();
    this.levelIndex = clamp(index, 0, LEVELS.length - 1);
    const def = LEVELS[this.levelIndex];
    this.level = def;
    this.difficulty = 1 + this.levelIndex * 0.16;
    this.bossKilled = false;
    this.bossSpawned = false;
    this.levelCoins = 0;
    this.victoryT = 0;

    this.screens.hide();
    this.arena.build(def);
    this._applyTheme(THEMES[def.theme]);

    this.enemies.spawnFromArena(this.arena);
    this.bullets.clear();
    this.fx.particles.reset();
    this.fx.effects.reset();
    this.fx.damageNumbers.reset();
    this.combat.reset();
    this.monetization.resetRun();
    this.refreshStats();

    this.player.reset(0, 6);
    this.player.y = this.arena.floorAt(6);
    this.cameraRig.zoom = 0;
    this.cameraRig.snapTo({ x: this.player.x, y: this.player.y, z: this.player.z });

    if (def.boss) {
      this.bossChamber = this.arena.chambers.find((c) => c.boss);
      this.boss.despawn();
      this.hud.hideBoss();
    } else {
      this.bossChamber = null;
      this.boss.despawn();
      this.hud.hideBoss();
    }

    this.hud.setLevel(def.name, Math.max(1, this.enemies.totalCount));
    this.hud.show(true);
    this.hud.banner1(def.name, def.intro, THEMES[def.theme].accent);

    this.audio.resume();
    this.music.start(def.theme);
    this.music.setIntensity(0.12);

    this.state = STATE.PLAYING;
    this.timeScale = 1;
  }

  _applyTheme(t) {
    this.skyUniforms.uTop.value.setHex(t.bg);
    this.skyUniforms.uBottom.value.setHex(t.fog).lerp(new THREE.Color(t.hemiSky), 0.22);
    this.skyUniforms.uStars.value = t.id === 'void' ? 1.0 : t.id === 'volcanic' ? 0.15 : 0.5;
    this.scene.fog.color.setHex(t.fog);
    this.scene.fog.near = t.fogNear;
    this.scene.fog.far = t.fogFar;
    this.renderer.setClearColor(t.bg, 1);
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiInt;
    this.key.color.setHex(t.keyColor);
    this.key.intensity = t.keyInt;
    this.rim.color.setHex(t.rimColor);
    this.rim.intensity = t.rimInt;
    this.bloom.strength = this.quality.bloomStrength * t.bloom;
    this.theme = t;
    document.documentElement.style.setProperty('--accent', t.accent);
    document.documentElement.style.setProperty('--accent-2', t.accent2);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#' + t.bg.toString(16).padStart(6, '0'));
  }

  /**
   * Attract mode: the menu sits over a live arena playing itself. It is the
   * same simulation as a real level, driven by a scripted input curve, so the
   * first thing anyone sees is the game actually running.
   */
  startAttract() {
    const idx = Math.min(this.save.data.maxLevelReached, LEVELS.length - 1);
    const pick = LEVELS[idx] && !LEVELS[idx].boss ? idx : 0;
    const def = LEVELS[pick];
    this.level = def;
    this.levelIndex = pick;
    this.difficulty = 1;
    this.attract = true;
    this.attractT = 0;
    this.bossChamber = null;
    this.bossSpawned = false;

    this.arena.build(def);
    this._applyTheme(THEMES[def.theme]);
    this.enemies.spawnFromArena(this.arena);
    this.bullets.clear();
    this.fx.particles.reset();
    this.fx.effects.reset();
    this.fx.damageNumbers.reset();
    this.combat.reset();
    this.refreshStats();
    this.player.reset(0, 10);
    this.player.y = this.arena.floorAt(10);
    this.player.invuln = 1e9;          // the demo never takes damage
    this.cameraRig.zoom = 4;
    this.cameraRig.snapTo({ x: 0, y: this.player.y, z: this.player.z });
    this.hud.show(false);
    this.hud.hideBoss();
  }

  stopAttract() {
    this.attract = false;
    this.player.invuln = 0;
  }

  _driveAttract(dt) {
    this.attractT += dt;
    const t = this.attractT;
    const p = this.player;
    p.input.mag = 0.85;
    p.input.dx = Math.sin(t * 0.55) * 0.85;
    p.input.dz = 0.55 + Math.sin(t * 0.31) * 0.3;
    const d = Math.hypot(p.input.dx, p.input.dz) || 1;
    p.input.dx /= d; p.input.dz /= d;
    p.invuln = 1e9;

    // loop the demo when it runs out of arena or enemies
    if (p.z > this.arena.bounds.maxZ - 26 || this.enemies.aliveCount === 0) {
      this.save.data.maxLevelReached = this.save.data.maxLevelReached;  // unchanged
      this.startAttract();
    }
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.hud.show(false);
    this.music.setIntensity(0.05);
    this.screens.show('pause');
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.screens.hide();
    this.hud.show(true);
    this.state = STATE.PLAYING;
  }

  quitToMenu() {
    this.state = STATE.MENU;
    this.hud.show(false);
    this.hud.hideBoss();
    this.music.stop();
    this.save.recordRun({
      kills: this.combat.kills, bounces: this.bullets.stats.bounces,
      damage: this.combat.totalDamage, bestCombo: this.combat.peakCombo,
    });
    this.boss.despawn();
    this.hud.setOverdrive(false);
    this.startAttract();
    this.screens.show('title');
    if (this.audio.ready) this.music.start(this.level.theme);
    this.music.setIntensity(0.25);
  }

  revive() {
    this.screens.hide();
    this.player.revive();
    this.hud.show(true);
    this.state = STATE.PLAYING;
    this.fx.effects.screenFlash('#8a5bff', 0.6, 0.6);
    this.fx.effects.ring(this.player.x, this.player.y + 0.3, this.player.z, 0x8a5bff, 1, 28, 0.7);
    this.audio.ui('reward');
    // clear the immediate area so the revive is not instantly wasted
    this.enemies.forEachNear(this.player.x, this.player.z, 16, (e) => {
      if (e.dying > 0) return;
      this.combat.damageEnemy(e, 1e9, { color: 0x8a5bff });
    });
  }

  // -------------------------------------------------------------- callbacks

  addCoins(n) {
    this.levelCoins += n;
    this.save.addCoins(n);
  }

  onEnemyKilled() {
    if (this.state !== STATE.PLAYING) return;
    this._checkVictory();
  }

  onModifier(mod, collider) {
    const g = this;
    const c = '#' + mod.color.toString(16).padStart(6, '0');
    g.hud.toast(`${mod.label} ${mod.sub}`, c);
    g.fx.effects.ring(collider.x, collider.baseY + 0.3, collider.z, mod.color, 1.2, 14 * mod.punch, 0.5);
    g.fx.effects.flash(collider.x, collider.baseY + 3.2, collider.z, mod.color, 9 * mod.punch, 0.28);
    g.fx.particles.burst(collider.x, collider.baseY + 3, collider.z, Math.round(22 * mod.punch), mod.color, {
      speed: 20, size: 0.7, life: 0.55, spread: 2.4, gravity: 9, stretch: 1.6,
    });
    g.cameraRig.addShake(0.18 * mod.punch);
    g.cameraRig.kickFov(1.4 * mod.punch);
    g.fx.effects.screenFlash(c, 0.13 * mod.punch, 0.22);
    g.audio.modifier(mod.punch, 240 + (mod.color & 0xff));
    g.haptic(Math.round(12 * mod.punch));
  }

  onComboMilestone(value, index) {
    const label = value >= CONFIG.combo.overdriveAt ? `COMBO ${value}` : `COMBO ${value}`;
    this.hud.banner1(label, index >= 3 ? 'UNSTOPPABLE' : 'KEEP GOING', '#ffd257');
    this.audio.combo(index);
    this.music.duckFor(0.45);
    this.cameraRig.addShake(0.22);
    this.fx.effects.screenFlash('#ffd257', 0.14, 0.3);
    this.haptic([10, 30, 10]);
  }

  onOverdrive(on) {
    this.hud.setOverdrive(on);
    if (on) {
      this.hud.banner1('OVERDRIVE', 'DAMAGE ×1.5 · RAPID FIRE', '#ff5ea8');
      this.audio.overdrive();
      this.music.duckFor(0.7);
      this.cameraRig.addShake(0.5);
      this.cameraRig.kickFov(5);
      this.fx.effects.screenFlash('#ff5ea8', 0.35, 0.5);
      this.timeScale = CONFIG.feel.slowMoScale;
      this._slowMoT = 0.3;
      this.haptic([20, 40, 20, 40, 60]);
    }
  }

  onComboReset() { /* the decay bar already tells the story */ }

  onPlayerHit() {
    this.hud.hurt();
    this.audio.playerHit();
    this.cameraRig.addShake(0.5);
    this.fx.effects.screenFlash('#ff2b4d', 0.3, 0.3);
    this.fx.particles.burst(this.player.x, this.player.y + 1.5, this.player.z, 18, 0xff4d6d, {
      speed: 16, size: 0.6, life: 0.45, spread: 1.2,
    });
    this.haptic([30, 30, 30]);
  }

  onShieldChange() { /* HUD polls this each frame */ }

  onPlayerDead() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.DEAD;
    this.timeScale = 0.25;
    this._slowMoT = 1.0;
    this.fx.effects.screenFlash('#ff2b4d', 0.7, 0.7);
    this.fx.effects.blast(this.player.x, this.player.y + 1.5, this.player.z, 0xff4d6d, 12, 0.5);
    this.cameraRig.addShake(1.1);
    this.audio.enemyDeath(true);
    this.music.setIntensity(0);
    setTimeout(() => {
      if (this.state !== STATE.DEAD) return;
      this.timeScale = 1;
      this.hud.show(false);
      this.screens.show('defeat', { levelName: this.level.name });
    }, 1200);
  }

  onBossPhase(phase, index) {
    this.hud.setBossPhase(phase.name);
    this.hud.banner1(phase.name, 'PHASE ' + (index + 1), '#ff5ea8');
    this.audio.bossPhase();
    this.cameraRig.addShake(0.6);
    this.fx.effects.screenFlash('#ff5ea8', 0.3, 0.45);
    this.fx.effects.ring(this.boss.x, this.boss.floorY + 0.3, this.boss.z, phase.color, 3, 40, 0.8);
    this.timeScale = CONFIG.feel.slowMoScale;
    this._slowMoT = 0.35;
  }

  onBossDead() {
    this.bossKilled = true;
    this.boss.playDeath();
    this.hud.hideBoss();
    this.timeScale = CONFIG.feel.slowMoScale;
    this._slowMoT = 1.1;
    this.addCoins(CONFIG.economy.coinsPerBoss);
    setTimeout(() => this._checkVictory(), 2400);
  }

  _checkVictory() {
    if (this.state !== STATE.PLAYING) return;
    if (this.enemies.aliveCount > 0) return;
    if (this.level.boss && !this.bossKilled) return;
    this._victory();
  }

  _victory() {
    this.state = STATE.RESULTS;
    this.timeScale = CONFIG.feel.slowMoScale;
    this._slowMoT = 1.2;
    this.hud.banner1('CLEAR', this.level.name, '#3dffa0');
    this.fx.effects.screenFlash('#ffffff', 0.55, 0.7);
    this.cameraRig.addShake(0.6);
    this.cameraRig.kickFov(6);
    this.audio.ui('reward');
    this.music.duckFor(1.2);
    this.haptic([20, 50, 20, 50, 80]);

    const coins = Math.round(
      this.levelCoins + CONFIG.economy.levelClearBonus * (1 + this.levelIndex * 0.35)
      + this.combat.peakCombo * CONFIG.economy.comboCoinBonus
    );
    this.save.addCoins(coins - this.levelCoins);
    this.save.data.maxLevelReached = Math.max(this.save.data.maxLevelReached, Math.min(LEVELS.length - 1, this.levelIndex + 1));
    this.save.data.levelIndex = Math.min(LEVELS.length - 1, this.levelIndex + 1);
    this.save.recordRun({
      kills: this.combat.kills, bounces: this.bullets.stats.bounces,
      damage: this.combat.totalDamage, bestCombo: this.combat.peakCombo,
    });
    this.save.save();

    setTimeout(() => {
      this.timeScale = 1;
      this.hud.show(false);
      this.hud.hideBoss();
      this.music.stop(1.2);
      this.monetization.maybeInterstitial();
      this.screens.show('results', {
        levelName: this.level.name,
        coins,
        kills: this.combat.kills,
        bestCombo: this.combat.peakCombo,
        bossKilled: this.bossKilled,
        nextIndex: Math.min(LEVELS.length - 1, this.levelIndex + 1),
        hasNext: this.levelIndex + 1 < LEVELS.length,
      });
    }, 1750);
  }

  // ------------------------------------------------------------------- loop

  start() {
    this.startAttract();
    this.screens.show('title');
    this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const raw = Math.min(0.05, this._clock.getDelta());
    this.time += raw;

    // hit stop then slow motion: the two levers that make big moments land
    if (this.combat.hitStop > 0) {
      this.combat.hitStop -= raw;
      this._render();
      return;
    }
    if (this._slowMoT > 0) {
      this._slowMoT -= raw;
      if (this._slowMoT <= 0) this.timeScale = 1;
    } else if (this.timeScale < 1) {
      this.timeScale = damp(this.timeScale, 1, 4, raw);
      if (this.timeScale > 0.985) this.timeScale = 1;
    }

    const dt = raw * this.timeScale;
    const inMenu = this.state === STATE.MENU && this.attract;
    const playing = this.state === STATE.PLAYING || this.state === STATE.DEAD || this.state === STATE.RESULTS;

    if (inMenu) this._driveAttract(dt);

    if (playing || inMenu) {
      this.player.update(dt, this.time);
      this.enemies.update(dt, this.time);
      if (this.boss.group.visible) this.boss.update(dt, this.time);
      this.bullets.update(dt, this.time);
      this.combat.update(dt);
      this.arena.update(dt, this.time);
      this._ambient(dt);
      if (playing) this._bossTrigger();
      this._intensity(dt);
      if (playing) this.hud.update(raw);
    } else {
      this.arena.update(dt, this.time);
    }

    this.cameraRig.update(raw, this.player, this.player.vx);
    this.sky.position.copy(this.camera.position);
    this.skyUniforms.uTime.value = this.time;
    this.fx.particles.update(raw);
    this.fx.effects.update(raw);
    this.fx.damageNumbers.update(raw, !(playing || inMenu));

    this._render();
    this._autoQuality(raw);
  }

  _render() {
    if (this.useBloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Drifting ambience plus the equipped bullet aura. */
  _ambient(dt) {
    const t = this.theme;
    if (!t) return;
    const rate = t.moteRate * (this.quality.low ? 18 : 36);
    if (Math.random() < dt * rate) {
      const b = this.arena.bounds;
      const x = b.minX + Math.random() * (b.maxX - b.minX);
      const z = this.player.z - 20 + Math.random() * 90;
      this.fx.particles.mote(x, this.arena.floorAt(z) + Math.random() * 12, z, t.ambientMotes, 0.5 + Math.random() * 0.6, 3 + Math.random() * 3);
    }

    const aura = this.aura;
    if (aura && aura.particles > 0) {
      const list = this.bullets.pool.active;
      const n = Math.min(list.length, this.quality.low ? 6 : 16);
      const budget = dt * 60 * aura.particles;
      for (let i = 0; i < n; i++) {
        if (Math.random() > budget / n * 2) continue;
        const b = list[(Math.random() * list.length) | 0];
        if (!b) continue;
        let c = aura.color;
        if (aura.rainbow) c = new THREE.Color().setHSL((this.time * 0.35 + b.age) % 1, 1, 0.6).getHex();
        else if (aura.shift) c = new THREE.Color().setHSL((0.78 + Math.sin(this.time + b.age * 3) * 0.12) % 1, 0.9, 0.65).getHex();
        this.fx.particles.spawn(b.x, b.y, b.z,
          (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3,
          c, 0.32, 0.36, { gravity: -1, drag: 3 });
      }
    }
  }

  _bossTrigger() {
    if (!this.bossChamber || this.bossSpawned) return;
    if (this.player.z < this.bossChamber.z0 + 10) return;
    this.bossSpawned = true;
    const c = this.bossChamber;
    const z = c.z0 + (c.z1 - c.z0) * 0.62;
    this.boss.spawn(0, z, c.floorY, this.level.bossHpMult || 1);
    this.hud.showBoss(BOSS_DEF.name, BOSS_DEF.phases[0].name);
    this.hud.banner1(BOSS_DEF.name, 'DESTROY IT', '#ff5ea8');
    this.cameraRig.zoom = 22;
    this.cameraRig.addShake(0.8);
    this.fx.effects.screenFlash('#ff5ea8', 0.4, 0.6);
    this.audio.bossPhase();
    this.music.setIntensity(0.9);
    this.timeScale = CONFIG.feel.slowMoScale;
    this._slowMoT = 0.7;
    setTimeout(() => { this.cameraRig.zoom = 15; }, 2600);
  }

  /** Music and particle intensity track how dense the swarm has become. */
  _intensity(dt) {
    const n = this.bullets.count;
    const combo = this.combat.combo;
    const i = clamp(n / 90, 0, 1) * 0.65 + clamp(combo / 120, 0, 1) * 0.35;
    this.music.setIntensity(clamp(i + (this.boss.alive ? 0.25 : 0), 0, 1));
    this.audio.setIntensity(i);
    this.fx.particles.setIntensity(0.8 + clamp(i, 0, 1) * 0.3 + (this.combat.overdriveT > 0 ? 0.25 : 0));
    if (this.bloom) {
      const target = this.quality.bloomStrength * (this.theme?.bloom ?? 1) * (1 + i * 0.35 + (this.combat.overdriveT > 0 ? 0.3 : 0));
      this.bloom.strength = damp(this.bloom.strength, target, 3, dt);
    }
  }

  /** If the device cannot hold a playable frame rate, step quality down once. */
  _autoQuality(dt) {
    if (this._autoQualityChecked || this.save.data.settings.quality) return;
    if (this.state !== STATE.PLAYING) return;
    this._fpsSamples.push(dt);
    if (this._fpsSamples.length < 180) return;
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    this._fpsSamples.length = 0;
    const fps = 1 / avg;
    if (fps < 42 && this.qualityName !== 'low') {
      this.applyQuality(this.qualityName === 'high' ? 'medium' : 'low');
      if (this.qualityName === 'low') this._autoQualityChecked = true;
    } else {
      this._autoQualityChecked = true;
    }
  }
}

// ----------------------------------------------------------------- bootstrap

async function boot() {
  const bootEl = document.getElementById('boot');
  const bar = bootEl.querySelector('.boot-bar i');
  const status = bootEl.querySelector('.boot-status');
  const step = (p, text) => { bar.style.width = p + '%'; if (text) status.textContent = text; };

  step(15, 'loading fonts');
  try { await document.fonts.ready; } catch { /* fonts are optional */ }

  step(45, 'building systems');
  const game = new Game();
  window.__BOUNCEFIRE__ = game;

  step(75, 'warming shaders');
  game._resize();
  game._render();
  await new Promise((r) => requestAnimationFrame(r));

  step(100, 'ready');
  game.start();
  setTimeout(() => {
    bootEl.classList.add('hidden');
    setTimeout(() => bootEl.remove(), 600);
  }, 260);
}

boot().catch((err) => {
  console.error(err);
  const s = document.querySelector('.boot-status');
  if (s) { s.textContent = 'failed to start: ' + err.message; s.style.color = '#ff6b8a'; }
});
