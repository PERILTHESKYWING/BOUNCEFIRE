import * as THREE from 'three';

import { CONFIG, BOSS_DEF } from './core/config.js';
import { detectQuality, clamp, damp, isTouch } from './core/utils.js';
import { Save } from './core/save.js';
import { Monetization } from './core/monetization.js';
import { LEVELS } from './data/levels.js';
import { THEMES } from './data/themes.js';
import { Arena } from './world/arena.js';
import { Particles } from './fx/particles.js';
import { Effects } from './fx/effects.js';
import { CameraRig } from './fx/cameraRig.js';
import { Bullets } from './game/bullets.js';
import { Enemies } from './game/enemies.js';
import { Player } from './game/player.js';
import { Combat } from './game/combat.js';
import { Boss } from './game/boss.js';
import { Tutorial, TUTORIAL_LEVEL } from './game/tutorial.js';
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
    this.levelScrap = 0;
    this.isTouch = isTouch();

    this.save = new Save();
    this.monetization = new Monetization();
    this.audio = new AudioEngine();
    this.music = new Music(this.audio);

    this._initRenderer();
    this._initScene();

    this.camera = new THREE.PerspectiveCamera(CONFIG.render.fov, 1, CONFIG.render.near, CONFIG.render.far);
    this.cameraRig = new CameraRig(this.camera);

    this.qualityName = this.save.data.settings.quality || detectQuality();
    this.quality = { ...CONFIG.quality[this.qualityName], low: this.qualityName === 'low' };

    this.arena = new Arena(this.scene, this.renderer);
    this.fx = {
      particles: new Particles(this.scene, this.renderer, CONFIG.quality.high.particles),
      effects: null,
    };
    this.fx.effects = new Effects(this.scene, this.renderer, this.fx.particles);

    this.combat = new Combat(this);
    this.bullets = new Bullets(this.scene, this);
    this.enemies = new Enemies(this.scene, this);
    this.player = new Player(this.scene, this);
    this.boss = new Boss(this.scene, this);
    this.tutorial = new Tutorial(this);

    this._initShowcase();

    this.uiRoot = document.getElementById('ui');
    this.hud = new HUD(this.uiRoot, this);
    this.screens = new Screens(this.uiRoot, this);

    this._bindEvents();
    this.refreshStats();
    this.applyQuality(this.qualityName);

    this._clock = new THREE.Clock();
    this._fpsSamples = [];
    this._autoQualityChecked = false;
    this._slowMoT = 0;
  }

  // ------------------------------------------------------------------ setup

  _initRenderer() {
    const canvas = document.getElementById('gl');
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    renderer.setClearColor(0x2b3641, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x3a4650, 55, 200);

    // Lighting is plain and directional: one warm key, one cool fill, and a
    // hemisphere to keep shadowed faces from going black. No coloured rim
    // lights, no point lights on the level — the environment does not glow.
    this.hemi = new THREE.HemisphereLight(0x9fb4c4, 0x3a3630, 0.85);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff0d8, 1.5);
    this.key.position.set(-24, 44, 16);
    this.scene.add(this.key);

    this.fill = new THREE.DirectionalLight(0x7d9ec4, 0.5);
    this.fill.position.set(22, 20, -26);
    this.scene.add(this.fill);

    // Sky: a soft vertical gradient and nothing else. The old starfield was
    // one more thing competing for attention above a maze nobody looks at.
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x1d2630) },
      uBottom: { value: new THREE.Color(0x4b5a63) },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(290, 18, 12),
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
          uniform vec3 uTop; uniform vec3 uBottom;
          varying vec3 vPos;
          void main() {
            float h = clamp(vPos.y * 0.5 + 0.5, 0.0, 1.0);
            gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 1.7)), 1.0);
          }
        `,
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.sky = sky;
  }

  /**
   * The menu backdrop.
   *
   * A separate little scene holding the player's own character on a plinth,
   * lit and turning slowly. It shares materials with the in-game model, so
   * equipping a skin changes what is standing on the title screen. This is
   * what replaced attract mode: a title screen should show you your character,
   * not a demo of the game playing itself behind the buttons.
   */
  _initShowcase() {
    this.showScene = new THREE.Scene();
    this.showScene.background = new THREE.Color(0x323b42);
    // Framed so the figure sits in the lower half of the screen: the camera
    // looks slightly above it, which leaves the top clear for the wordmark.
    this.showCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.showCamera.position.set(2.4, 4.4, 23.5);
    this.showCamera.lookAt(0, 2.9, 0);

    this.showScene.add(new THREE.HemisphereLight(0xcadae6, 0x45403a, 1.35));
    const k = new THREE.DirectionalLight(0xfff2de, 2.4);
    k.position.set(-5, 8, 6);
    this.showScene.add(k);
    const r = new THREE.DirectionalLight(0x9cc0da, 0.95);
    r.position.set(6, 3, -5);
    this.showScene.add(r);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.7, 0.7, 24),
      new THREE.MeshStandardMaterial({ color: 0x4a545c, roughness: 0.95 })
    );
    plinth.position.y = -0.35;
    this.showScene.add(plinth);

    this.showPivot = new THREE.Group();
    this.showPivot.rotation.y = -0.5;   // start three-quarters on, facing out
    this.showScene.add(this.showPivot);

    const model = this.player.group.clone(true);
    // drop the gameplay-only bits: the shadow and the floor ring
    for (const name of ['shadow', 'ring']) {
      const src = this.player[name];
      model.traverse((o) => { if (o.geometry === src?.geometry) o.visible = false; });
    }
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    this.showPivot.add(model);
    this.showModel = model;
    this.showcase = null;
  }

  setShowcase(name) {
    this.showcase = name;
  }

  applyQuality(name) {
    this.qualityName = name;
    const q = CONFIG.quality[name] || CONFIG.quality.medium;
    this.quality = { ...q, low: name === 'low' };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
    this.bullets.setQuality(q.trailGhosts);
    this.fx?.particles?.setLimit(q.particles);
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
      this.music.start(this.state === STATE.MENU ? 'menu' : 'field');
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
    this.camera.aspect = w / h;
    // A portrait phone needs a taller view than a desktop window, but the
    // player stays dead centre either way.
    this.cameraRig.baseFov = CONFIG.render.fov * clamp(1.42 - (w / h) * 0.4, 0.95, 1.28);
    this.cameraRig.distScale = clamp(1.0 - (w / h - 0.55) * 0.22, 0.6, 1.0);
    this.camera.fov = this.cameraRig.baseFov;
    this.camera.updateProjectionMatrix();
    // In a wide window the menu column sits on the right, so the figure is
    // framed off to the left instead of straight behind the buttons.
    this.showCamera.aspect = w / h;
    const wide = w / h > 1.25;
    this.showCamera.position.set(wide ? 1.4 : 2.4, 4.4, 23.5);
    this.showCamera.lookAt(wide ? 7.2 : 0, 2.9, 0);
    this.showCamera.updateProjectionMatrix();
  }

  haptic(pattern) {
    if (!this.save.data.settings.haptics) return;
    navigator.vibrate?.(pattern);
  }

  refreshStats() {
    Object.assign(this.player.stats, this.save.computeStats());
    this.player.maxHp = this.player.stats.maxHp;
    this.player.maxAmmo = Math.round(this.player.stats.magazine);
    this.player.applySkins(this.save.character(), this.save.weapon());
  }

  // ---------------------------------------------------------- level control

  startTutorial() {
    this._beginLevel(TUTORIAL_LEVEL, 0);
    this.tutorial.start();
    this.hud.setLevel('TRAINING', 1);
  }

  startLevel(index) {
    this.tutorial.stop();
    this.levelIndex = clamp(index, 0, LEVELS.length - 1);
    this._beginLevel(LEVELS[this.levelIndex], this.levelIndex);
  }

  _beginLevel(def, index) {
    this.level = def;
    this.difficulty = def.tutorial ? 1 : 1 + index * 0.1;
    this.bossKilled = false;
    this.bossSpawned = false;
    this.levelScrap = 0;

    this.screens.hide();
    this.setShowcase(null);
    this.arena.build(def);
    this._applyTheme(THEMES[def.theme]);

    if (def.tutorial) this.enemies.clear();
    else this.enemies.spawnFromArena(this.arena);

    this.bullets.clear();
    this.fx.particles.reset();
    this.fx.effects.reset();
    this.combat.reset();
    this.monetization.resetRun();
    this.refreshStats();

    this.player.reset(0, 8);
    this.player.y = this.arena.floorAt(8);
    this.cameraRig.zoom = 0;
    this.cameraRig.snapTo(this.player);

    this.bossChamber = def.boss ? this.arena.chambers.find((c) => c.boss) : null;
    this.boss.despawn();
    this.hud.hideBoss();

    this.hud.setLevel(def.name, Math.max(1, this.enemies.totalCount));
    this.hud.show(true);
    if (def.intro) this.hud.bannerLine(def.name, def.intro);

    this.audio.resume();
    this.music.start(def.boss ? 'boss' : 'field');

    this.state = STATE.PLAYING;
    this.timeScale = 1;
  }

  _applyTheme(t) {
    this.skyUniforms.uTop.value.setHex(t.skyTop);
    this.skyUniforms.uBottom.value.setHex(t.skyBottom);
    this.scene.fog.color.setHex(t.fog);
    this.scene.fog.near = t.fogNear;
    this.scene.fog.far = t.fogFar;
    this.renderer.setClearColor(t.bg, 1);
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiInt;
    this.key.color.setHex(t.keyColor);
    this.key.intensity = t.keyInt;
    this.fill.color.setHex(t.fillColor);
    this.fill.intensity = t.fillInt;
    this.theme = t;
    document.documentElement.style.setProperty('--accent', t.accent);
    document.documentElement.style.setProperty('--accent-2', t.accent2);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hexStr(t.bg));
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.player.releaseInput();
    this.hud.show(false);
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
    this.tutorial.stop();
    this.player.releaseInput();
    this.hud.show(false);
    this.hud.hideBoss();
    this.save.recordRun({
      kills: this.combat.kills,
      bounces: this.bullets.stats.bounces,
      banked: this.bullets.stats.banked,
    });
    this.boss.despawn();
    this.music.start('menu');
    this.screens.show('title');
  }

  revive() {
    this.screens.hide();
    this.player.revive();
    this.hud.show(true);
    this.state = STATE.PLAYING;
    this.fx.effects.ring(this.player.x, this.player.y + 0.2, this.player.z, 0x8ff0e0, 1, 22, 0.6);
    this.audio.ui('reward');
    // clear the immediate area so the revive is not instantly wasted
    this.enemies.forEachNear(this.player.x, this.player.z, 14, (e) => {
      if (e.dying > 0) return;
      this.combat.damageEnemy(e, 1e9, {});
    });
  }

  // -------------------------------------------------------------- callbacks

  addScrap(n) {
    this.levelScrap += n;
    this.save.addScrap(n);
  }

  onPlayerFired() { /* the HUD polls ammo each frame */ }
  onReload() { this.audio.reload(); }

  onRefund() {
    this.audio.refund();
    this.hud.flashAmmo();
  }

  onEnemyKilled(e, opts) {
    if (this.tutorial.active) this.tutorial.onKill(e, opts);
    if (this.state !== STATE.PLAYING) return;
    this._checkRoomClear();
    this._checkVictory();
  }

  onModifier(mod, collider) {
    this.hud.toast(mod.label, hexStr(mod.color));
    this.fx.effects.ring(collider.x, collider.baseY + 0.12, collider.z, mod.color, 1.0, 9, 0.35);
    this.fx.particles.burst(collider.x, collider.baseY + 2.2, collider.z, 8, mod.color, {
      speed: 11, size: 0.3, life: 0.35, spread: 1.2, gravity: 8,
    });
    this.audio.modifier();
    this.haptic(10);
  }

  onPlayerHit(amount) {
    this.hud.hurt();
    this.audio.playerHit();
    this.cameraRig.addShake(0.22);
    this.fx.effects.screenFlash('#c4453a', clamp(0.15 + amount / 120, 0.15, 0.4), 0.3);
    this.fx.particles.burst(this.player.x, this.player.y + 1.4, this.player.z, 8, 0xc4453a, {
      speed: 11, size: 0.3, life: 0.35, spread: 0.8,
    });
    this.haptic([25, 25, 25]);
  }

  onPlayerDead() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.DEAD;
    this.timeScale = CONFIG.feel.slowMoScale;
    this._slowMoT = 1.0;
    this.fx.effects.screenFlash('#c4453a', 0.5, 0.6);
    this.cameraRig.addShake(0.5);
    this.audio.enemyDeath(5);
    this.music.duckFor(1.4);
    setTimeout(() => {
      if (this.state !== STATE.DEAD) return;
      this.timeScale = 1;
      this.hud.show(false);
      this.screens.show('defeat', { levelName: this.level.name, hint: this._deathHint() });
    }, 1300);
  }

  /** One line, chosen from how they actually died. Not a tips carousel. */
  _deathHint() {
    if (this.bullets.stats.banked < this.bullets.stats.fired * 0.15) {
      return 'Try banking more shots — a bounce pays the round back and hits harder.';
    }
    if (this.combat.bestStreak < 5) {
      return 'Keep moving. Every attack in the game draws a mark on the floor first.';
    }
    return '';
  }

  onBossPhase(phase, index) {
    this.hud.bannerLine(phase.name, 'PHASE ' + (index + 1));
    this.audio.bossPhase();
    this.cameraRig.addShake(0.3);
  }

  onBossDead() {
    this.bossKilled = true;
    this.boss.playDeath();
    this.hud.hideBoss();
    this.timeScale = CONFIG.feel.slowMoScale;
    this._slowMoT = 1.1;
    this.addScrap(400);
    setTimeout(() => this._checkVictory(), 2200);
  }

  onTutorialComplete() {
    this.state = STATE.RESULTS;
    this.save.data.tutorialDone = true;
    this.save.addScrap(250);
    this.save.save();
    this.hud.setObjective(null);
    this.hud.bannerLine('TRAINING COMPLETE', '+250 scrap');
    this.audio.ui('reward');
    setTimeout(() => {
      this.hud.show(false);
      this.quitToMenu();
    }, 1800);
  }

  /**
   * Rooms are the pacing unit. Clearing one restores health, which is what
   * makes "push into the next room" a decision the player makes on purpose.
   */
  _checkRoomClear() {
    const c = this.arena.chamberAt(this.player.z);
    if (!c || c.cleared || !c.total) return;
    let left = 0;
    for (const e of this.enemies.pool.active) {
      if (e.dying > 0 || e.hp <= 0) continue;
      if (e.chamber === c.index) left++;
    }
    if (left > 0) return;
    c.cleared = true;
    const healed = this.player.heal(CONFIG.player.waveClearHeal);
    this.addScrap(CONFIG.economy.waveClearBonus);
    this.audio.waveClear();
    this.hud.bannerLine('ROOM CLEAR', healed > 0 ? `+${Math.round(healed)} health` : null);
    this.fx.effects.ring(this.player.x, this.player.y + 0.1, this.player.z, 0x8ff0e0, 1, 16, 0.5);
  }

  _checkVictory() {
    if (this.state !== STATE.PLAYING) return;
    if (this.level.tutorial) return;
    if (this.enemies.aliveCount > 0) return;
    if (this.level.boss && !this.bossKilled) return;
    this._victory();
  }

  _victory() {
    this.state = STATE.RESULTS;
    this.timeScale = CONFIG.feel.slowMoScale;
    this._slowMoT = 1.1;
    this.hud.bannerLine('CLEARED', this.level.name);
    this.cameraRig.addShake(0.2);
    this.audio.ui('reward');
    this.music.duckFor(1.4);
    this.haptic([20, 50, 20]);

    const bonus = Math.round(CONFIG.economy.levelClearBonus * (1 + this.levelIndex * 0.4));
    this.save.addScrap(bonus);
    this.save.data.maxLevelReached = Math.max(this.save.data.maxLevelReached, Math.min(LEVELS.length - 1, this.levelIndex + 1));
    this.save.data.levelIndex = Math.min(LEVELS.length - 1, this.levelIndex + 1);
    this.save.recordRun({
      kills: this.combat.kills,
      bounces: this.bullets.stats.bounces,
      banked: this.bullets.stats.banked,
    });
    this.save.save();

    setTimeout(() => {
      this.timeScale = 1;
      this.hud.show(false);
      this.hud.hideBoss();
      this.monetization.maybeInterstitial();
      this.screens.show('results', {
        levelName: this.level.name,
        scrap: this.levelScrap + bonus,
        kills: this.combat.kills,
        banked: this.bullets.stats.banked,
        bestStreak: this.combat.bestStreak,
        bossKilled: this.bossKilled,
        nextIndex: Math.min(LEVELS.length - 1, this.levelIndex + 1),
        hasNext: this.levelIndex + 1 < LEVELS.length,
      });
    }, 1600);
  }

  // ------------------------------------------------------------------- loop

  start() {
    this.screens.show('title');
    this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const raw = Math.min(0.05, this._clock.getDelta());
    this.time += raw;

    if (this.combat.hitStop > 0) {
      this.combat.hitStop -= raw;
      this._render();
      return;
    }
    if (this._slowMoT > 0) {
      this._slowMoT -= raw;
      if (this._slowMoT <= 0) this.timeScale = 1;
    } else if (this.timeScale < 1) {
      this.timeScale = damp(this.timeScale, 1, 5, raw);
      if (this.timeScale > 0.985) this.timeScale = 1;
    }

    const dt = raw * this.timeScale;
    const live = this.state === STATE.PLAYING || this.state === STATE.DEAD || this.state === STATE.RESULTS;

    if (live) {
      this.player.update(dt, this.time, this.camera);
      this.enemies.update(dt, this.time);
      if (this.boss.group.visible) this.boss.update(dt, this.time);
      this.bullets.update(dt, this.time);
      this.combat.update(dt);
      this.arena.update(dt, this.time);
      if (this.state === STATE.PLAYING) {
        this._bossTrigger();
        if (this.tutorial.active) this.tutorial.update(dt);
        this.hud.update(raw);
      }
      this._ambient(dt);
      this.cameraRig.update(raw, this.player, this.player.aim);
      this.sky.position.copy(this.camera.position);
      this._intensity(dt);
    }

    this.fx.particles.update(raw);
    this.fx.effects.update(raw);

    if (this.showcase) {
      this.showPivot.rotation.y += raw * 0.26;
      this.showPivot.position.y = Math.sin(this.time * 1.2) * 0.06;
    }

    this._render();
    this._autoQuality(raw);
  }

  _render() {
    if (this.showcase) this.renderer.render(this.showScene, this.showCamera);
    else this.renderer.render(this.scene, this.camera);
  }

  /** A little drifting dust, and nothing else. Ambience, not spectacle. */
  _ambient(dt) {
    const t = this.theme;
    if (!t || this.quality.low) return;
    if (Math.random() < dt * t.dustRate * 7) {
      const b = this.arena.bounds;
      const x = this.player.x + (Math.random() - 0.5) * 60;
      const z = this.player.z + (Math.random() - 0.5) * 60;
      if (x < b.minX || x > b.maxX) return;
      this.fx.particles.spawn(
        x, this.arena.floorAt(z) + Math.random() * 9, z,
        (Math.random() - 0.5) * 0.7, 0.25 + Math.random() * 0.4, (Math.random() - 0.5) * 0.7,
        t.dust, 0.09 + Math.random() * 0.08, 3.5 + Math.random() * 3, { gravity: -0.3, drag: 0.4 }
      );
    }
  }

  _bossTrigger() {
    if (!this.bossChamber || this.bossSpawned) return;
    if (this.player.z < this.bossChamber.z0 + 12) return;
    this.bossSpawned = true;
    const c = this.bossChamber;
    const z = c.z0 + (c.z1 - c.z0) * 0.58;
    this.boss.spawn(0, z, c.floorY, this.level.bossHpMult || 1);
    this.hud.showBoss(BOSS_DEF.name);
    this.hud.bannerLine(BOSS_DEF.name, 'break the plates');
    this.cameraRig.zoom = 16;
    this.cameraRig.addShake(0.35);
    this.audio.bossPhase();
    this.music.start('boss');
    setTimeout(() => { this.cameraRig.zoom = 6; }, 2400);
  }

  /** Intensity only nudges the mix. It no longer rewrites the arrangement. */
  _intensity(dt) {
    const near = clamp(this.enemies.aliveCount / 12, 0, 1);
    const i = clamp(near * 0.7 + (this.boss.alive ? 0.4 : 0), 0, 1);
    this.music.setIntensity(i);
    this.audio.setIntensity(i);
  }

  _autoQuality(dt) {
    if (this._autoQualityChecked || this.save.data.settings.quality) return;
    if (this.state !== STATE.PLAYING) return;
    this._fpsSamples.push(dt);
    if (this._fpsSamples.length < 180) return;
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    this._fpsSamples.length = 0;
    if (1 / avg < 42 && this.qualityName !== 'low') {
      this.applyQuality(this.qualityName === 'high' ? 'medium' : 'low');
      if (this.qualityName === 'low') this._autoQualityChecked = true;
    } else {
      this._autoQualityChecked = true;
    }
  }
}

function hexStr(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0'); }

// ----------------------------------------------------------------- bootstrap

async function boot() {
  const bootEl = document.getElementById('boot');
  const bar = bootEl.querySelector('.boot-bar i');
  const status = bootEl.querySelector('.boot-status');
  const step = (p, text) => { bar.style.width = p + '%'; if (text) status.textContent = text; };

  step(15, 'loading');
  try { await document.fonts.ready; } catch { /* fonts are optional */ }

  step(50, 'building');
  const game = new Game();
  window.__BOUNCEFIRE__ = game;

  step(80, 'warming up');
  game._resize();
  game._render();
  await new Promise((r) => requestAnimationFrame(r));

  step(100, 'ready');
  game.start();
  setTimeout(() => {
    bootEl.classList.add('hidden');
    setTimeout(() => bootEl.remove(), 500);
  }, 220);
}

boot().catch((err) => {
  console.error(err);
  const s = document.querySelector('.boot-status');
  if (s) { s.textContent = 'failed to start: ' + err.message; s.style.color = '#e0705a'; }
});
