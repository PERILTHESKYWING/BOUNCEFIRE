import { el, button, toggle, segmented, countUp } from './components.js';
import { iconSvg } from './hud.js';
import { UPGRADES, UPGRADE_ORDER, CHARACTER_SKINS, WEAPON_SKINS, CRATE } from '../data/progression.js';
import { RARITY } from '../data/modifiers.js';
import { ENEMY_TYPES, ENEMY_BLURB } from '../data/enemies.js';
import { LEVELS } from '../data/levels.js';
import { formatNumber, clamp } from '../core/utils.js';

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

/**
 * Screens.
 *
 * The title is a title screen now: one enormous wordmark, one PLAY, and four
 * drawn icons. The old menu put six equal text buttons in a grid under a small
 * logo, which read as a settings page for a game rather than the front of one.
 *
 * Everywhere a cosmetic appears it is drawn — a figure or a weapon in that
 * skin's actual colours — instead of being listed as a name and a rarity word.
 */
export class Screens {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.current = null;
    this.name = null;
  }

  get audio() { return this.game.audio; }

  show(name, props = {}) {
    this.hide(true);
    const build = this[name];
    if (!build) return;
    const node = build.call(this, props);
    node.classList.add('screen', 'sc-' + name);
    this.root.append(node);
    this.current = node;
    this.name = name;
    // The title screen, and only the title screen, shows the equipped
    // character standing behind it. Letting it through on the profile and the
    // locker put a turning figure behind two screens that are already dense
    // with art, and the panels ended up reading as translucent.
    this.game.setShowcase(name === 'title' ? name : null);
    return node;
  }

  hide(instant = false) {
    const n = this.current;
    if (!n) return;
    this.current = null; this.name = null;
    if (instant) { n.remove(); return; }
    n.classList.add('out');
    setTimeout(() => n.remove(), 220);
  }

  _btn(label, opts) {
    return button(label, { ...opts, audio: this.audio, haptic: () => this.game.haptic(opts?.hapticMs ?? 10) });
  }

  _topbar(title, onBack, right) {
    return el('div', { class: 'topbar' }, [
      onBack
        ? button(iconSvg('back', 22), { variant: 'icon', onClick: onBack, sound: 'back', audio: this.audio })
        : el('div', { style: 'width:44px' }),
      el('div', { class: 'topbar-title' }, title),
      right || el('div', { style: 'width:44px' }),
    ]);
  }

  _scrapChip() {
    return el('div', { class: 'chip' }, [
      iconSvg('scrap', 16),
      el('span', {}, formatNumber(this.game.save.data.scrap)),
    ]);
  }

  // ------------------------------------------------------------------ title

  title() {
    const g = this.game;
    const s = g.save;
    const lvIndex = clamp(s.data.levelIndex, 0, LEVELS.length - 1);
    const lv = LEVELS[lvIndex];
    const firstTime = !s.data.tutorialDone;

    const iconBtn = (icon, label, onClick, badge) => {
      const b = el('button', { class: 'tile' }, [
        iconSvg(icon, 26),
        el('span', {}, label),
        badge ? el('i', { class: 'badge' }) : null,
      ]);
      b.addEventListener('click', () => { this.audio.ui('click'); g.haptic(10); onClick(); });
      return b;
    };

    return el('div', {}, [
      el('div', { class: 'title-top' }, [this._scrapChip()]),
      el('div', { class: 'title-mark' }, [
        wordmark('BOUNCEFIRE'),
        el('div', { class: 'wordmark-rule' }),
        el('div', { class: 'wordmark-sub' }, 'bank the shot'),
      ]),
      el('div', { class: 'title-actions' }, [
        this._btn(firstTime ? 'START' : 'PLAY', {
          big: true, sound: 'confirm', hapticMs: 18,
          sub: firstTime ? 'training' : `${lv.name} · ${lvIndex + 1} of ${LEVELS.length}`,
          onClick: () => (firstTime ? g.startTutorial() : g.startLevel(lvIndex)),
        }),
        el('div', { class: 'tile-row' }, [
          iconBtn('move', 'TRAINING', () => g.startTutorial()),
          iconBtn('person', 'PROFILE', () => this.show('profile')),
          iconBtn('crate', 'CRATE', () => this.show('crate'), s.data.scrap >= CRATE.cost),
          iconBtn('gear', 'SETTINGS', () => this.show('settings', { from: 'title' })),
        ]),
      ]),
    ]);
  }

  // ---------------------------------------------------------------- profile

  profile() {
    const g = this.game;
    const s = g.save;
    const ch = s.character();
    const wp = s.weapon();
    const col = s.collectionProgress();
    const lvIndex = clamp(s.data.maxLevelReached, 0, LEVELS.length - 1);

    const card = (kind, def, onClick) => {
      const c = el('button', { class: 'gear-card' }, [
        el('div', { class: 'art' }, [cosmeticArt(kind, def, 108)]),
        el('div', { class: 'meta' }, [
          el('div', { class: 'k' }, kind === 'character' ? 'CHARACTER' : 'WEAPON'),
          el('div', { class: 'n' }, def.name),
          el('div', { class: 'r', style: `color:${RARITY[def.rarity].color}` }, RARITY[def.rarity].name),
        ]),
      ]);
      c.addEventListener('click', () => { this.audio.ui('click'); onClick(); });
      return c;
    };

    return el('div', {}, [
      this._topbar('PROFILE', () => this.show('title'), this._scrapChip()),
      el('div', { class: 'scroll' }, [
        el('div', { class: 'gear-row' }, [
          card('character', ch, () => this.show('locker', { tab: 'character' })),
          card('weapon', wp, () => this.show('locker', { tab: 'weapon' })),
        ]),

        el('div', { class: 'panel' }, [
          el('div', { class: 'panel-head' }, 'PROGRESS'),
          statRow('Furthest level', LEVELS[lvIndex].name),
          statRow('Runs', String(s.data.stats.runs)),
          statRow('Enemies destroyed', formatNumber(s.data.stats.kills)),
          statRow('Rounds paid back by bounces', formatNumber(s.data.stats.banked)),
          el('div', { class: 'meter' }, [
            el('div', { class: 'meter-head' }, [
              el('span', {}, 'COLLECTION'),
              el('b', {}, `${col.have} / ${col.total}`),
            ]),
            el('div', { class: 'bar' }, [el('i', { style: `width:${(col.frac * 100).toFixed(0)}%` })]),
          ]),
        ]),

        el('div', { class: 'panel' }, [
          el('div', { class: 'panel-head' }, 'LOADOUT'),
          ...UPGRADE_ORDER.map((id) => {
            const u = UPGRADES[id];
            const lv = s.level(id);
            return el('div', { class: 'load-row' }, [
              el('div', { class: 'ic' }, [iconSvg(u.glyph, 18)]),
              el('div', { class: 'nm' }, u.name),
              el('div', { class: 'vl' }, u.format(lv)),
            ]);
          }),
          this._btn('UPGRADE', { variant: 'ghost', onClick: () => this.show('upgrades') }),
        ]),

        el('div', { class: 'panel' }, [
          el('div', { class: 'panel-head' }, 'KNOWN THREATS'),
          ...Object.values(ENEMY_TYPES).map((d) => el('div', { class: 'threat-row' }, [
            el('div', { class: 'dot', style: `background:${hex(d.signal)}` }),
            el('div', { class: 'meta' }, [
              el('div', { class: 'nm' }, d.name),
              el('div', { class: 'ds' }, ENEMY_BLURB[d.id]),
            ]),
          ])),
        ]),
      ]),
    ]);
  }

  // ----------------------------------------------------------------- locker

  locker({ tab = 'character' } = {}) {
    const g = this.game;
    const s = g.save;
    const wrap = el('div', { class: 'scroll' });

    const render = (which) => {
      wrap.innerHTML = '';
      const defs = which === 'character' ? CHARACTER_SKINS : WEAPON_SKINS;
      const owns = which === 'character' ? (id) => s.ownsCharacter(id) : (id) => s.ownsWeapon(id);
      const equipped = which === 'character' ? s.data.equipped.character : s.data.equipped.weapon;
      const grid = el('div', { class: 'cos-grid' });
      for (const d of Object.values(defs)) {
        const has = owns(d.id);
        const isEq = equipped === d.id;
        const rar = RARITY[d.rarity];
        const cell = el('div', {
          class: 'cos' + (has ? '' : ' locked') + (isEq ? ' equipped' : ''),
          style: `--rar:${rar.color}`,
        }, [
          el('div', { class: 'art' }, [cosmeticArt(which, d, 84)]),
          el('div', { class: 'nm' }, d.name),
          el('div', { class: 'r' }, rar.name),
          has ? null : el('div', { class: 'lockmark' }, [iconSvg('lock', 18)]),
          isEq ? el('div', { class: 'eqmark' }, [iconSvg('check', 16)]) : null,
        ]);
        if (has && !isEq) {
          cell.addEventListener('click', () => {
            if (which === 'character') s.data.equipped.character = d.id;
            else s.data.equipped.weapon = d.id;
            s.save();
            g.refreshStats();
            this.audio.ui('confirm');
            g.haptic(12);
            render(which);
          });
        }
        grid.append(cell);
      }
      wrap.append(grid);
    };

    const tabs = el('div', { class: 'tabs' });
    for (const [id, label] of [['character', 'CHARACTER'], ['weapon', 'WEAPON']]) {
      const b = el('button', { class: id === tab ? 'on' : '' }, label);
      b.addEventListener('click', () => {
        tab = id;
        for (const x of tabs.children) x.classList.toggle('on', x === b);
        this.audio.ui('click');
        render(id);
      });
      tabs.append(b);
    }
    render(tab);

    return el('div', {}, [
      this._topbar('LOCKER', () => this.show('profile'), this._scrapChip()),
      tabs,
      wrap,
    ]);
  }

  // --------------------------------------------------------------- upgrades

  upgrades() {
    const g = this.game;
    const s = g.save;
    const list = el('div', { class: 'scroll' });
    let chip = this._scrapChip();

    const render = () => {
      list.innerHTML = '';
      list.append(el('div', { class: 'note' }, 'Four upgrades. None of them multiplies another.'));
      for (const id of UPGRADE_ORDER) {
        const u = UPGRADES[id];
        const lvl = s.level(id);
        const maxed = lvl >= u.max;
        const cost = s.costOf(id);
        const affordable = s.canBuy(id);

        const pips = el('div', { class: 'lvl' });
        for (let i = 0; i < u.max; i++) pips.append(el('i', { class: i < lvl ? 'on' : '' }));

        const buy = el('button', { class: 'buy', disabled: !affordable && !maxed },
          maxed ? 'MAX' : [iconSvg('scrap', 14), el('span', {}, formatNumber(cost))]);
        if (!maxed) {
          buy.addEventListener('click', () => {
            if (!s.buy(id)) { this.audio.ui('back'); return; }
            this.audio.ui('confirm');
            g.haptic(14);
            g.refreshStats();
            const next = this._scrapChip();
            chip.replaceWith(next); chip = next;
            render();
          });
        }

        list.append(el('div', { class: 'up-row' + (maxed ? ' maxed' : '') }, [
          el('div', { class: 'ico' }, [iconSvg(u.glyph, 22)]),
          el('div', { class: 'meta' }, [
            el('div', { class: 'nm' }, u.name),
            el('div', { class: 'ds' }, u.desc),
            el('div', { class: 'now' }, u.format(lvl)),
            pips,
          ]),
          buy,
        ]));
      }
    };
    render();

    return el('div', {}, [
      this._topbar('UPGRADES', () => this.show('profile'), chip),
      list,
    ]);
  }

  // ------------------------------------------------------------------ crate

  crate() {
    const g = this.game;
    const s = g.save;
    const stage = el('div', { class: 'crate-stage' });
    const box = el('div', { class: 'crate-box' }, [iconSvg('crate', 84)]);
    stage.append(box);

    const footer = el('div', { class: 'footer' });
    const render = () => {
      footer.innerHTML = '';
      const afford = s.data.scrap >= CRATE.cost;
      footer.append(
        el('div', { class: 'note' }, 'Crates hold character and weapon skins. Nothing in one changes how you fight.'),
        this._btn('OPEN', {
          big: true, variant: 'gold', sound: 'open', disabled: !afford,
          sub: `${formatNumber(CRATE.cost)} scrap`,
          onClick: () => { s.addScrap(-CRATE.cost); s.save(); open(); },
        }),
        this._btn('FREE CRATE', {
          variant: 'ghost', sound: 'open', sub: 'watch a short video',
          onClick: async () => {
            footer.querySelectorAll('button').forEach((b) => (b.disabled = true));
            const ok = await g.monetization.showRewarded('bonus_crate');
            if (ok) open(); else render();
          },
        }),
      );
    };

    const open = () => {
      footer.innerHTML = '';
      box.classList.add('shake');
      this.audio.ui('open');
      g.haptic([12, 40, 12, 40, 30]);
      setTimeout(() => {
        box.remove();
        const r = rollCrate(s);
        s.save();
        g.refreshStats();
        this.audio.ui('reward');
        const rar = RARITY[r.rarity];
        stage.append(el('div', { class: 'reveal', style: `--rar:${rar.color}` }, [
          el('div', { class: 'art' }, [cosmeticArt(r.kind, r.def, 190)]),
          el('div', { class: 'r' }, rar.name),
          el('div', { class: 'nm' }, r.def.name),
          el('div', { class: 'k' }, r.kind === 'character' ? 'Character skin' : 'Weapon skin'),
          r.dupe ? el('div', { class: 'dupe' }, `Already owned · +${r.dupe} scrap`) : null,
        ]));
        g.haptic(18);
        setTimeout(() => {
          footer.append(
            r.dupe ? null : this._btn('EQUIP', {
              big: true, sound: 'confirm',
              onClick: () => {
                if (r.kind === 'character') s.data.equipped.character = r.def.id;
                else s.data.equipped.weapon = r.def.id;
                s.save(); g.refreshStats();
                this.show('locker', { tab: r.kind });
              },
            }),
            this._btn(r.dupe ? 'CONTINUE' : 'LATER', { variant: 'ghost', onClick: () => this.show('crate') }),
            this._btn('BACK', { variant: 'ghost', sound: 'back', onClick: () => this.show('title') }),
          );
        }, 450);
      }, 750);
    };
    render();

    return el('div', {}, [
      this._topbar('CRATE', () => this.show('title'), this._scrapChip()),
      stage,
      footer,
    ]);
  }

  // --------------------------------------------------------------- settings

  settings({ from = 'title' } = {}) {
    const g = this.game;
    const s = g.save.data.settings;
    const rows = el('div', { class: 'scroll' }, [
      row('MUSIC', toggle(s.music, (v) => { s.music = v; g.audio.setMusicEnabled(v); g.save.save(); })),
      row('SOUND EFFECTS', toggle(s.sfx, (v) => { s.sfx = v; g.audio.setSfxEnabled(v); g.save.save(); })),
      row('HAPTICS', toggle(s.haptics, (v) => { s.haptics = v; g.save.save(); })),
      row('QUALITY', segmented(
        [{ label: 'LOW', value: 'low' }, { label: 'MED', value: 'medium' }, { label: 'HIGH', value: 'high' }],
        s.quality || g.qualityName,
        (v) => { s.quality = v; g.save.save(); g.applyQuality(v); }
      )),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, 'HOW TO PLAY'),
        el('div', { class: 'howto' }, [
          line('move', 'Move with W A S D, or drag on the left'),
          line('fire', 'Aim with the mouse and hold to fire, or drag on the right'),
          line('bounce', 'A bounced round pays itself back and hits harder'),
          line('power', 'Charge caps at three. Nothing stacks past it'),
        ]),
        this._btn('REPLAY TRAINING', { variant: 'ghost', onClick: () => g.startTutorial() }),
      ]),
      el('div', { class: 'note' }, 'Progress is stored on this device.'),
      el('div', { style: 'margin-top:10px' }, [
        this._btn('RESET PROGRESS', {
          variant: 'ghost',
          onClick: (e) => {
            const btn = e.currentTarget;
            if (btn.dataset.confirm !== '1') {
              btn.dataset.confirm = '1';
              btn.textContent = 'TAP AGAIN TO CONFIRM';
              setTimeout(() => { btn.dataset.confirm = '0'; btn.textContent = 'RESET PROGRESS'; }, 3000);
              return;
            }
            g.save.reset(); g.refreshStats(); this.show('title');
          },
        }),
      ]),
    ]);
    function row(k, control) {
      return el('div', { class: 'setrow' }, [el('div', { class: 'k' }, k), control]);
    }
    function line(icon, text) {
      return el('div', { class: 'howto-row' }, [iconSvg(icon, 18), el('span', {}, text)]);
    }
    return el('div', {}, [
      this._topbar('SETTINGS', () => this.show(from === 'pause' ? 'pause' : 'title')),
      rows,
    ]);
  }

  // ------------------------------------------------------------------ pause

  pause() {
    const g = this.game;
    return el('div', {}, [
      this._topbar('PAUSED', null),
      el('div', { class: 'pause-mid' }, [
        el('div', { class: 'big' }, g.level?.name || ''),
        el('div', { class: 'sub' }, g.tutorial?.active
          ? 'Training'
          : `${g.enemies.aliveCount} enemies left`),
      ]),
      el('div', { class: 'menu-actions' }, [
        this._btn('RESUME', { big: true, sound: 'confirm', onClick: () => g.resume() }),
        this._btn('SETTINGS', { variant: 'ghost', onClick: () => this.show('settings', { from: 'pause' }) }),
        this._btn('QUIT TO MENU', { variant: 'ghost', sound: 'back', onClick: () => g.quitToMenu() }),
      ]),
    ]);
  }

  // ---------------------------------------------------------------- results

  results(props) {
    const g = this.game;
    const { levelName, scrap, kills, banked, bestStreak, nextIndex, hasNext } = props;
    let claimed = false;

    const scrapNode = el('div', { class: 'v' }, '0');
    const rows = el('div', { class: 'rows' }, [
      rrow('ENEMIES DESTROYED', String(kills), 0),
      rrow('ROUNDS BANKED', String(banked), 70),
      rrow('BEST STREAK', String(bestStreak), 140),
      el('div', { class: 'rrow total', style: 'animation-delay:220ms' }, [
        el('div', { class: 'k' }, 'SCRAP EARNED'), scrapNode,
      ]),
    ]);
    setTimeout(() => countUp(scrapNode, scrap, 0.8), 260);

    const footer = el('div', { class: 'footer' });
    const render = () => {
      footer.innerHTML = '';
      footer.append(
        claimed ? null : this._btn('DOUBLE SCRAP', {
          variant: 'gold', sub: 'watch a short video', sound: 'open',
          onClick: async (e) => {
            e.currentTarget.disabled = true;
            const ok = await g.monetization.showRewarded('double_rewards');
            if (ok) {
              claimed = true;
              g.save.addScrap(scrap); g.save.save();
              this.audio.ui('reward');
              countUp(scrapNode, scrap * 2, 0.6);
            }
            render();
          },
        }),
        hasNext
          ? this._btn('NEXT LEVEL', { big: true, sound: 'confirm', onClick: () => g.startLevel(nextIndex) })
          : this._btn('BACK TO MENU', { big: true, sound: 'confirm', onClick: () => g.quitToMenu() }),
        this._btn('MENU', { variant: 'ghost', sound: 'back', onClick: () => g.quitToMenu() }),
      );
    };
    render();

    return el('div', {}, [
      el('div', { class: 'result-hero' }, [
        el('div', { class: 'big' }, props.bossKilled ? 'FOUNDRY DOWN' : 'CLEARED'),
        el('div', { class: 'sub' }, levelName),
      ]),
      el('div', { class: 'scroll center' }, [rows]),
      footer,
    ]);

    function rrow(k, v, delay) {
      return el('div', { class: 'rrow', style: `animation-delay:${delay}ms` }, [
        el('div', { class: 'k' }, k), el('div', { class: 'v' }, v),
      ]);
    }
  }

  // ----------------------------------------------------------------- defeat

  defeat(props) {
    const g = this.game;
    const footer = el('div', { class: 'footer' });
    const canRevive = g.monetization.canRevive();
    footer.append(
      canRevive ? this._btn('REVIVE', {
        big: true, variant: 'gold', sub: 'watch a short video', sound: 'open',
        onClick: async (e) => {
          e.currentTarget.disabled = true;
          const ok = await g.monetization.showRewarded('revive');
          if (ok) { g.monetization.useRevive(); g.revive(); }
          else footer.querySelectorAll('button').forEach((b) => (b.disabled = false));
        },
      }) : null,
      this._btn('RETRY', { big: !canRevive, sound: 'confirm', onClick: () => g.startLevel(g.levelIndex) }),
      this._btn('MENU', { variant: 'ghost', sound: 'back', onClick: () => g.quitToMenu() }),
    );

    return el('div', {}, [
      el('div', { class: 'result-hero down' }, [
        el('div', { class: 'big' }, 'DOWN'),
        el('div', { class: 'sub' }, props.levelName || ''),
      ]),
      el('div', { class: 'scroll center' }, [
        el('div', { class: 'rows' }, [
          el('div', { class: 'rrow' }, [el('div', { class: 'k' }, 'ENEMIES LEFT'), el('div', { class: 'v' }, String(g.enemies.aliveCount))]),
          el('div', { class: 'rrow', style: 'animation-delay:70ms' }, [el('div', { class: 'k' }, 'BEST STREAK'), el('div', { class: 'v' }, String(g.combat.bestStreak))]),
        ]),
        el('div', { class: 'note' }, props.hint || ''),
      ]),
      footer,
    ]);
  }
}

/**
 * The wordmark is drawn as SVG and stretched to exactly fill its box with
 * textLength. A web font can fail to load — it does on a slow connection and
 * behind a proxy — and a fallback face would otherwise either overflow the
 * screen or leave the title looking small. This way it is the same size and
 * the same shape either way.
 */
function wordmark(text) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 132');
  svg.setAttribute('class', 'wordmark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', text);
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('x', '500');
  t.setAttribute('y', '104');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('textLength', '984');
  t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  t.setAttribute('font-size', '124');
  t.textContent = text;
  svg.append(t);
  return svg;
}

function statRow(k, v) {
  return el('div', { class: 'stat-row' }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
}

/**
 * Cosmetic art.
 *
 * Skins are shown as a drawing of the thing they are — a figure or a weapon,
 * in that skin's three colours — rather than as a coloured dot next to a name.
 * It is the same silhouette everywhere it appears, so the locker, the profile
 * and the crate reveal all read as the same object.
 */
export function cosmeticArt(kind, def, size = 96) {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = size * dpr; c.height = size * dpr;
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const u = size / 100;

  if (kind === 'character') {
    const suit = hex(def.suit), trim = hex(def.trim), visor = hex(def.visor);
    // legs
    g.fillStyle = trim;
    rr(g, 34 * u, 62 * u, 13 * u, 30 * u, 4 * u);
    rr(g, 53 * u, 62 * u, 13 * u, 30 * u, 4 * u);
    // pack
    g.fillStyle = trim;
    rr(g, 28 * u, 30 * u, 44 * u, 12 * u, 5 * u);
    // torso
    g.fillStyle = suit;
    rr(g, 30 * u, 34 * u, 40 * u, 32 * u, 7 * u);
    // head
    rr(g, 37 * u, 10 * u, 26 * u, 24 * u, 7 * u);
    // visor
    g.fillStyle = visor;
    rr(g, 41 * u, 18 * u, 18 * u, 7 * u, 3 * u);
    // chest light
    rr(g, 45 * u, 44 * u, 10 * u, 5 * u, 2 * u);
  } else {
    const metal = hex(def.metal), accent = hex(def.accent), tracer = hex(def.tracer);
    g.fillStyle = metal;
    rr(g, 12 * u, 40 * u, 66 * u, 14 * u, 4 * u);   // receiver
    rr(g, 26 * u, 52 * u, 12 * u, 22 * u, 4 * u);   // grip
    rr(g, 46 * u, 52 * u, 16 * u, 16 * u, 3 * u);   // magazine
    rr(g, 12 * u, 28 * u, 26 * u, 10 * u, 3 * u);   // stock
    g.fillStyle = accent;
    rr(g, 40 * u, 34 * u, 22 * u, 8 * u, 3 * u);    // rail
    rr(g, 18 * u, 42 * u, 8 * u, 10 * u, 2 * u);
    g.fillStyle = tracer;
    rr(g, 78 * u, 43 * u, 12 * u, 8 * u, 3 * u);    // muzzle glow
  }
  return c;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}

/**
 * One item per crate, revealed large. Duplicates convert to scrap, so a pull is
 * never worthless and the player always has something to spend afterwards.
 */
function rollCrate(save) {
  const pool = [];
  for (const d of Object.values(CHARACTER_SKINS)) pool.push({ kind: 'character', def: d });
  for (const d of Object.values(WEAPON_SKINS)) pool.push({ kind: 'weapon', def: d });

  const rarity = rollRarity();
  let options = pool.filter((p) => p.def.rarity === rarity);
  // prefer something they do not own yet, at the rolled rarity
  const fresh = options.filter((p) => !(p.kind === 'character' ? save.ownsCharacter(p.def.id) : save.ownsWeapon(p.def.id)));
  if (fresh.length) options = fresh;
  if (!options.length) options = pool;

  const pick = options[(Math.random() * options.length) | 0];
  const granted = pick.kind === 'character' ? save.grantCharacter(pick.def.id) : save.grantWeapon(pick.def.id);
  const dupe = granted ? 0 : RARITY[pick.def.rarity].scrap;
  if (dupe) save.addScrap(dupe);
  return { kind: pick.kind, def: pick.def, rarity: pick.def.rarity, dupe };
}

function rollRarity() {
  const total = Object.values(RARITY).reduce((a, r) => a + r.weight, 0);
  let r = Math.random() * total;
  for (const [id, def] of Object.entries(RARITY)) {
    r -= def.weight;
    if (r <= 0) return id;
  }
  return 'common';
}
