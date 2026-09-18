import { el, button, toggle, segmented, countUp } from './components.js';
import { UPGRADES, UPGRADE_ORDER, BULLET_SKINS, BULLET_AURAS, CHEST } from '../data/progression.js';
import { AMPLIFIERS, RARITY } from '../data/modifiers.js';
import { LEVELS } from '../data/levels.js';
import { THEMES } from '../data/themes.js';
import { formatNumber, clamp } from '../core/utils.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/**
 * Screen stack. Only one screen is mounted at a time; each is rebuilt on show
 * so it always reflects current save state, and transitions are CSS-driven.
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
    node.classList.add('screen');
    if (name === 'title') node.classList.add('attract');
    this.root.append(node);
    this.current = node;
    this.name = name;
    return node;
  }

  hide(instant = false) {
    const n = this.current;
    if (!n) return;
    this.current = null; this.name = null;
    if (instant) { n.remove(); return; }
    n.classList.add('out');
    setTimeout(() => n.remove(), 240);
  }

  _btn(label, opts) {
    return button(label, { ...opts, audio: this.audio, haptic: () => this.game.haptic(opts?.hapticMs ?? 10) });
  }

  _topbar(title, onBack, right) {
    return el('div', { class: 'topbar' }, [
      onBack ? this._btn('‹', { variant: 'ghost', onClick: onBack, sound: 'back' }) : null,
      el('div', { class: 'title', style: 'flex:1;font-size:20px;margin:0' }, title),
      right || el('div', { style: 'width:52px' }),
    ]);
  }

  _coinChip() {
    return el('div', { class: 'chip' }, [
      el('span', { class: 'ic' }, '◈'),
      el('span', {}, formatNumber(this.game.save.data.coins)),
    ]);
  }

  // ------------------------------------------------------------------ title

  title() {
    const g = this.game;
    const s = g.save;
    const lvIndex = clamp(s.data.levelIndex, 0, LEVELS.length - 1);
    const lv = LEVELS[lvIndex];

    return el('div', {}, [
      el('div', { class: 'menu-center' }, [
        el('div', { class: 'hero-title' }, 'BOUNCEFIRE'),
        el('div', { class: 'hero-sub' }, 'ricochet arcade'),
        el('div', { class: 'pill-row' }, [
          el('div', { class: 'chip' }, [el('span', { class: 'ic' }, '◈'), el('span', {}, formatNumber(s.data.coins))]),
          el('div', { class: 'chip' }, `BEST COMBO ${s.data.stats.bestCombo}`),
        ]),
      ]),
      el('div', { class: 'menu-actions' }, [
        this._btn(`PLAY`, {
          big: true, shine: true, sub: `${lv.name} · LEVEL ${lvIndex + 1}`,
          sound: 'confirm', hapticMs: 18,
          onClick: () => g.startLevel(lvIndex),
        }),
        el('div', { class: 'menu-grid' }, [
          this._btn('UPGRADE', { variant: 'ghost', onClick: () => this.show('upgrades') }),
          this._btn('LOCKER', { variant: 'ghost', onClick: () => this.show('cosmetics') }),
          this._btn('CHEST', { variant: 'ghost', onClick: () => this.show('chest') }),
        ]),
        el('div', { class: 'menu-grid' }, [
          this._btn('LEVELS', { variant: 'ghost', onClick: () => this.show('levels') }),
          this._btn('SETTINGS', { variant: 'ghost', onClick: () => this.show('settings', { from: 'title' }) }),
          this._btn('STATS', { variant: 'ghost', onClick: () => this.show('stats') }),
        ]),
        el('div', { class: 'hint' }, 'Drag anywhere to move. The gun runs itself.'),
      ]),
    ]);
  }

  // ----------------------------------------------------------------- levels

  levels() {
    const g = this.game;
    const s = g.save;
    const rows = LEVELS.map((lv, i) => {
      const locked = i > s.data.maxLevelReached;
      const theme = THEMES[lv.theme];
      const isBoss = !!lv.boss;
      const row = el('div', {
        class: 'lv-row' + (locked ? ' locked' : '') + (isBoss ? ' boss' : ''),
      }, [
        el('div', {
          class: 'num',
          style: `background:${theme.accent}22;border:1px solid ${theme.accent}66;color:${theme.accent}`,
        }, isBoss ? '☠' : String(i + 1)),
        el('div', { class: 'meta' }, [
          el('div', { class: 'nm' }, lv.name),
          el('div', { class: 'ds' }, locked ? 'Locked' : (isBoss ? 'Boss encounter' : `${lv.chambers.length} chambers`)),
        ]),
        el('div', { class: 'go' }, locked ? '🔒' : '›'),
      ]);
      if (!locked) row.addEventListener('click', () => { this.audio.ui('confirm'); g.startLevel(i); });
      return row;
    });

    return el('div', {}, [
      this._topbar('SELECT LEVEL', () => this.show('title'), this._coinChip()),
      el('div', { class: 'scroll' }, rows),
    ]);
  }

  // --------------------------------------------------------------- upgrades

  upgrades() {
    const g = this.game;
    const s = g.save;
    const list = el('div', { class: 'scroll' });
    const coinChip = this._coinChip();

    const render = () => {
      list.innerHTML = '';
      for (const id of UPGRADE_ORDER) {
        const u = UPGRADES[id];
        const lvl = s.level(id);
        const maxed = lvl >= u.max;
        const cost = s.costOf(id);
        const affordable = s.canBuy(id);

        const pips = el('div', { class: 'lvl' });
        const shown = Math.min(u.max, 12);
        for (let i = 0; i < shown; i++) {
          const on = i < Math.round((lvl / u.max) * shown);
          pips.append(el('i', { class: on ? 'on' : '' }));
        }

        const buy = el('button', { class: 'buy', disabled: !affordable && !maxed },
          maxed ? 'MAX' : [el('span', {}, '◈ ' + formatNumber(cost)), el('small', {}, `LV ${lvl}`)]);
        if (!maxed) {
          buy.addEventListener('click', () => {
            if (!s.buy(id)) { this.audio.ui('back'); return; }
            this.audio.ui('confirm');
            g.haptic(14);
            g.refreshStats();
            coinChip.replaceWith(this._coinChip());
            render();
          });
        }

        list.append(el('div', { class: 'up-row' + (maxed ? ' maxed' : '') }, [
          el('div', { class: 'ico' }, u.icon),
          el('div', { class: 'meta' }, [
            el('div', { class: 'nm' }, u.name),
            el('div', { class: 'ds' }, u.desc),
            pips,
          ]),
          buy,
        ]));
      }

      const amps = Object.entries(s.data.amplifiers).filter(([, n]) => n > 0);
      if (amps.length) {
        list.append(el('div', { class: 'subtitle', style: 'margin-top:14px' }, 'AMPLIFIERS'));
        for (const [id, n] of amps) {
          const a = AMPLIFIERS[id];
          if (!a) continue;
          list.append(el('div', { class: 'up-row' }, [
            el('div', { class: 'ico', style: `color:${RARITY[a.rarity].color};border-color:${RARITY[a.rarity].color}55;background:${RARITY[a.rarity].color}18` }, '✦'),
            el('div', { class: 'meta' }, [
              el('div', { class: 'nm' }, a.name + (n > 1 ? ` ×${n}` : '')),
              el('div', { class: 'ds' }, a.desc),
            ]),
          ]));
        }
      }
    };
    render();

    return el('div', {}, [
      this._topbar('UPGRADES', () => this.show('title'), coinChip),
      list,
    ]);
  }

  // -------------------------------------------------------------- cosmetics

  cosmetics() {
    const g = this.game;
    const s = g.save;
    const wrap = el('div', { class: 'scroll' });

    const section = (label, defs, owned, equippedId, equip) => {
      const grid = el('div', { class: 'grid' });
      for (const d of Object.values(defs)) {
        const has = owned(d.id);
        const isEq = equippedId === d.id;
        const rar = RARITY[d.rarity] || RARITY.common;
        const c = hex(d.color ?? 0x8ff2ff);
        const cell = el('div', {
          class: 'cos' + (has ? '' : ' locked') + (isEq ? ' equipped' : ''),
        }, [
          el('div', { class: 'rar', style: `color:${rar.color}` }, rar.name),
          el('div', { class: 'orb', style: `background:${c};color:${c}` }),
          el('div', { class: 'nm' }, d.name),
        ]);
        if (has) cell.addEventListener('click', () => { equip(d.id); this.audio.ui('confirm'); g.haptic(12); this.show('cosmetics'); });
        grid.append(cell);
      }
      wrap.append(el('div', { class: 'subtitle', style: 'margin-top:12px' }, label), grid);
    };

    section('BULLET SKINS', BULLET_SKINS, (id) => s.ownsSkin(id), s.data.equipped.skin, (id) => {
      s.data.equipped.skin = id; s.save(); g.refreshStats();
    });
    section('BULLET AURAS', BULLET_AURAS, (id) => s.ownsAura(id), s.data.equipped.aura, (id) => {
      s.data.equipped.aura = id; s.save(); g.refreshStats();
    });

    return el('div', {}, [
      this._topbar('LOCKER', () => this.show('title'), this._coinChip()),
      wrap,
    ]);
  }

  // ------------------------------------------------------------------ chest

  chest() {
    const g = this.game;
    const s = g.save;
    const stage = el('div', { class: 'chest-stage' });
    const box = el('div', { class: 'chest-box' }, '🎁');
    stage.append(box);

    const footer = el('div', { class: 'footer' });
    const render = () => {
      footer.innerHTML = '';
      const afford = s.data.coins >= CHEST.cost;
      footer.append(
        this._btn('OPEN CHEST', {
          big: true, variant: 'gold', shine: true, sound: 'open', disabled: !afford,
          sub: `◈ ${formatNumber(CHEST.cost)}`,
          onClick: () => { s.data.coins -= CHEST.cost; s.save(); open(false); },
        }),
        this._btn('FREE CHEST', {
          variant: 'violet', sound: 'open', sub: 'watch a short video',
          onClick: async () => {
            footer.querySelectorAll('button').forEach((b) => (b.disabled = true));
            const ok = await g.monetization.showRewarded('bonus_chest');
            if (ok) open(true); else render();
          },
        }),
        this._btn('BACK', { variant: 'ghost', onClick: () => this.show('title'), sound: 'back' }),
      );
    };

    const open = (free) => {
      footer.innerHTML = '';
      box.classList.add('shake');
      this.audio.ui('open');
      g.haptic([12, 40, 12, 40, 30]);
      setTimeout(() => {
        box.remove();
        const rewards = rollChest(s);
        this.audio.ui('reward');
        g.fx.effects.screenFlash('#ffc13d', 0.5, 0.5);
        const list = el('div', { class: 'reveal' });
        stage.append(list);
        rewards.forEach((r, i) => {
          setTimeout(() => {
            list.innerHTML = '';
            const rar = RARITY[r.rarity];
            list.append(
              el('div', { class: 'orb', style: `background:${r.color};color:${r.color}` }),
              el('div', { class: 'rar', style: `color:${rar.color}` }, rar.name),
              el('div', { class: 'nm' }, r.name),
              el('div', { class: 'ds' }, r.desc || ''),
              r.dupe ? el('div', { class: 'dupe' }, `Duplicate → +◈ ${r.dupe}`) : null,
              el('div', { class: 'hint' }, `${i + 1} / ${rewards.length}`),
            );
            this.audio.ui('reward');
            g.haptic(18);
          }, i * 950);
        });
        setTimeout(() => {
          s.save();
          g.refreshStats();
          footer.append(
            this._btn('COLLECT', { big: true, variant: 'gold', sound: 'confirm', onClick: () => this.show('chest') }),
            this._btn('BACK', { variant: 'ghost', onClick: () => this.show('title'), sound: 'back' }),
          );
        }, rewards.length * 950 + 200);
      }, 900);
    };
    render();

    return el('div', {}, [
      this._topbar('CHEST', () => this.show('title'), this._coinChip()),
      stage,
      footer,
    ]);
  }

  // -------------------------------------------------------------- settings

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
      el('div', { class: 'hint', style: 'margin-top:14px' }, 'Progress is stored on this device.'),
      el('div', { style: 'margin-top:12px' }, [
        this._btn('RESET PROGRESS', {
          variant: 'ghost',
          onClick: () => {
            const btn = event?.currentTarget;
            if (btn && btn.dataset.confirm !== '1') {
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
    return el('div', {}, [this._topbar('SETTINGS', () => this.show(from === 'pause' ? 'pause' : 'title')), rows]);
  }

  stats() {
    const s = this.game.save.data.stats;
    const rows = [
      ['RUNS', s.runs], ['ENEMIES DESTROYED', s.kills], ['WALL BOUNCES', s.bounces],
      ['TOTAL DAMAGE', formatNumber(s.damage)], ['BEST COMBO', s.bestCombo],
    ].map(([k, v], i) => el('div', { class: 'rrow', style: `animation-delay:${i * 60}ms` }, [
      el('div', { class: 'k' }, k), el('div', { class: 'v' }, String(v)),
    ]));
    return el('div', {}, [
      this._topbar('STATS', () => this.show('title')),
      el('div', { class: 'scroll' }, [el('div', { class: 'rows' }, rows)]),
    ]);
  }

  // ------------------------------------------------------------------ pause

  pause() {
    const g = this.game;
    return el('div', {}, [
      this._topbar('PAUSED', null),
      el('div', { class: 'menu-center' }, [
        el('div', { class: 'title' }, g.level?.name || ''),
        el('div', { class: 'subtitle' }, `${g.enemies.aliveCount} enemies remaining`),
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
    const { levelName, coins, kills, bestCombo, bossKilled, nextIndex, hasNext } = props;
    let claimed = false;

    const coinNode = el('div', { class: 'v' }, '0');
    const rows = el('div', { class: 'rows' }, [
      rrow('ENEMIES DESTROYED', String(kills), 0),
      rrow('BEST COMBO', String(bestCombo), 80),
      rrow('DAMAGE DEALT', formatNumber(g.combat.totalDamage), 160),
      el('div', { class: 'rrow total', style: 'animation-delay:260ms' }, [
        el('div', { class: 'k' }, 'COINS EARNED'), coinNode,
      ]),
    ]);
    setTimeout(() => countUp(coinNode, coins, 0.9, (v) => '◈ ' + Math.round(v).toLocaleString()), 300);

    const footer = el('div', { class: 'footer' });
    const render = () => {
      footer.innerHTML = '';
      footer.append(
        claimed ? null : this._btn('DOUBLE REWARDS', {
          variant: 'gold', shine: true, sub: 'watch a short video', sound: 'open',
          onClick: async (e) => {
            e.currentTarget.disabled = true;
            const ok = await g.monetization.showRewarded('double_rewards');
            if (ok) {
              claimed = true;
              g.save.addCoins(coins); g.save.save();
              this.audio.ui('reward');
              g.fx.effects.screenFlash('#ffc13d', 0.45, 0.45);
              countUp(coinNode, coins * 2, 0.7, (v) => '◈ ' + Math.round(v).toLocaleString());
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
        el('div', { class: 'big' }, bossKilled ? 'BOSS DOWN' : 'LEVEL CLEAR'),
        el('div', { class: 'subtitle', style: 'margin-top:6px' }, levelName),
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
        big: true, variant: 'violet', shine: true, sub: 'watch a short video', sound: 'open',
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
      el('div', { class: 'result-hero' }, [
        el('div', { class: 'big', style: 'background:linear-gradient(180deg,#fff,#ff6b8a 75%);-webkit-background-clip:text;background-clip:text' }, 'DOWN'),
        el('div', { class: 'subtitle', style: 'margin-top:6px' }, props.levelName || ''),
      ]),
      el('div', { class: 'scroll' }, [
        el('div', { class: 'rows' }, [
          el('div', { class: 'rrow' }, [el('div', { class: 'k' }, 'ENEMIES LEFT'), el('div', { class: 'v' }, String(g.enemies.aliveCount))]),
          el('div', { class: 'rrow', style: 'animation-delay:80ms' }, [el('div', { class: 'k' }, 'BEST COMBO'), el('div', { class: 'v' }, String(g.combat.peakCombo))]),
        ]),
      ]),
      footer,
    ]);
  }
}

/** Chest roll: rarity first, then a reward of that rarity. Duplicates convert
 *  to coins so a pull is never worthless. */
function rollChest(save) {
  const out = [];
  const pool = [];
  for (const d of Object.values(BULLET_SKINS)) pool.push({ kind: 'skin', ...d });
  for (const d of Object.values(BULLET_AURAS)) if (d.id !== 'none') pool.push({ kind: 'aura', ...d });
  for (const a of Object.values(AMPLIFIERS)) pool.push({ kind: 'amp', ...a, color: 0xffffff });

  for (let i = 0; i < CHEST.slots; i++) {
    const rarity = rollRarity();
    const options = pool.filter((p) => p.rarity === rarity);
    const pick = options.length ? options[(Math.random() * options.length) | 0] : pool[(Math.random() * pool.length) | 0];
    const rar = RARITY[pick.rarity];
    const entry = {
      name: pick.name,
      rarity: pick.rarity,
      color: hex(pick.color ?? 0xffffff),
      desc: pick.kind === 'amp' ? pick.desc : pick.kind === 'skin' ? 'Bullet skin' : 'Bullet aura',
      dupe: 0,
    };
    if (pick.kind === 'skin') {
      if (!save.grantSkin(pick.id)) entry.dupe = dupeValue(pick.rarity);
    } else if (pick.kind === 'aura') {
      if (!save.grantAura(pick.id)) entry.dupe = dupeValue(pick.rarity);
    } else {
      save.grantAmplifier(pick.id);
    }
    if (entry.dupe) save.addCoins(entry.dupe);
    out.push(entry);
  }
  return out;
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

function dupeValue(rarity) {
  return { common: 80, rare: 220, epic: 600, legendary: 1500 }[rarity] || 80;
}
