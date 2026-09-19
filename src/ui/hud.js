import { formatNumber, clamp } from '../core/utils.js';
import { el } from './components.js';

/**
 * Combat HUD.
 *
 * Four things, and nothing else: how much health you have, how many rounds you
 * have, how much of the room is left, and — during the tutorial — what you are
 * being asked to do. The old HUD also carried a combo counter, a live damage
 * multiplier, a bullet count and a shield pip row, which between them told the
 * player almost nothing they could act on.
 *
 * Health and ammo are the two numbers a decision depends on, so they get the
 * bottom of the screen where the thumbs already are. Everything else is small
 * and at the top.
 */
export class HUD {
  constructor(root, game) {
    this.game = game;
    this.node = el('div', { id: 'hud' });

    // --- top bar
    this.pauseBtn = el('button', { class: 'icon-btn', 'aria-label': 'Pause' }, iconSvg('pause'));
    this.roomFill = el('i');
    this.roomName = el('b');
    this.roomCount = el('span');
    this.scrapValue = el('span', {}, '0');
    this.scrapChip = el('div', { class: 'chip' }, [iconSvg('scrap'), this.scrapValue]);

    const room = el('div', { class: 'hud-room' }, [
      el('div', { class: 'label' }, [this.roomName, this.roomCount]),
      el('div', { class: 'bar' }, [this.roomFill]),
    ]);
    this.topRow = el('div', { class: 'row' }, [this.pauseBtn, room, this.scrapChip]);

    // --- boss bar
    this.bossFill = el('i');
    this.bossGhost = el('div', { class: 'ghost' });
    this.bossName = el('div', { class: 'name' });
    this.bossPlates = el('div', { class: 'plates' });
    this.bossBar = el('div', { id: 'bossbar' }, [
      this.bossName,
      el('div', { class: 'bar' }, [this.bossGhost, this.bossFill]),
      this.bossPlates,
    ]);

    // --- objective (tutorial)
    this.objGlyph = el('div', { class: 'g' });
    this.objText = el('div', { class: 't' });
    this.objStep = el('div', { class: 's' });
    this.objProgress = el('div', { class: 'p' });
    this.objective = el('div', { id: 'objective' }, [
      this.objGlyph,
      el('div', { class: 'body' }, [this.objText, this.objProgress]),
      this.objStep,
    ]);

    // --- bottom: health then ammo
    this.hpFill = el('i');
    this.hpChip = el('span', { class: 'n' }, '100');
    this.health = el('div', { id: 'health' }, [
      el('div', { class: 'bar' }, [this.hpFill]),
      this.hpChip,
    ]);

    this.ammoRow = el('div', { class: 'pips' });
    this.ammo = el('div', { id: 'ammo' }, [this.ammoRow]);

    this.bottom = el('div', { id: 'hudbottom' }, [this.health, this.ammo]);

    this.banner = el('div', { id: 'banner' });
    this.toastWrap = el('div', { id: 'toasts' });
    this.sticks = el('div', { id: 'sticks' });

    this.node.append(this.topRow, this.bossBar, this.objective, el('div', { class: 'spacer' }), this.bottom);
    root.append(this.sticks, this.node, this.banner, this.toastWrap);

    this.pauseBtn.addEventListener('click', () => game.pause());

    this._lastScrap = -1;
    this._lastHp = -1;
    this._lastAmmo = -1;
    this._lastMax = -1;
    this._bossGhostFrac = 1;
    this._stickEls = { move: null, aim: null };
  }

  show(on) { this.node.classList.toggle('on', on); if (!on) this._clearSticks(); }

  setLevel(name, total) {
    this.roomName.textContent = name;
    this._total = Math.max(1, total);
  }

  // ------------------------------------------------------------------- boss

  showBoss(name) {
    this.bossBar.classList.add('on');
    this.bossName.textContent = name;
    this._bossGhostFrac = 1;
  }
  hideBoss() { this.bossBar.classList.remove('on'); }

  // --------------------------------------------------------------- messages

  /** One line, centre screen, gone in a second. Used sparingly. */
  bannerLine(text, sub) {
    const item = el('div', { class: 'banner-item' }, sub ? [text, el('span', { class: 'sub' }, sub)] : [text]);
    this.banner.append(item);
    setTimeout(() => item.remove(), 1100);
  }

  /** Small corner note: which panel a round just picked up. */
  toast(text, color) {
    const t = el('div', { class: 'toast', style: `--c:${color}` }, text);
    this.toastWrap.append(t);
    while (this.toastWrap.children.length > 2) this.toastWrap.firstChild.remove();
    setTimeout(() => t.remove(), 1400);
  }

  flashAmmo() {
    this.ammo.classList.remove('empty'); void this.ammo.offsetWidth;
    this.ammo.classList.add('empty');
  }

  // -------------------------------------------------------------- objective

  setObjective(o) {
    if (!o) { this.objective.classList.remove('on'); return; }
    this.objective.classList.add('on');
    this.objective.classList.remove('done');
    this.objGlyph.innerHTML = '';
    this.objGlyph.append(iconSvg(o.glyph));
    this.objText.textContent = o.text;
    this.objStep.textContent = `${o.index}/${o.count}`;
    this.objProgress.textContent = '';
  }

  setObjectiveProgress(done, total) {
    this.objProgress.textContent = total > 1 ? `${done} / ${total}` : '';
  }

  objectiveDone() { this.objective.classList.add('done'); }

  // ------------------------------------------------------------------ frame

  update(dt) {
    const g = this.game;
    const p = g.player;

    if (this._total) {
      const left = g.enemies.aliveCount;
      const done = clamp(1 - left / this._total, 0, 1);
      this.roomFill.style.width = (done * 100).toFixed(1) + '%';
      this.roomCount.textContent = left ? `${left} LEFT` : 'CLEAR';
    }

    const scrap = g.save.data.scrap;
    if (scrap !== this._lastScrap) {
      this.scrapValue.textContent = formatNumber(scrap);
      this._lastScrap = scrap;
    }

    // health: a bar that empties, a number that agrees with it
    const hp = Math.ceil(p.hp);
    if (hp !== this._lastHp || p.maxHp !== this._lastMaxHp) {
      this._lastHp = hp; this._lastMaxHp = p.maxHp;
      const frac = clamp(p.hp / p.maxHp, 0, 1);
      this.hpFill.style.width = (frac * 100).toFixed(1) + '%';
      this.hpChip.textContent = String(hp);
      this.health.classList.toggle('low', frac <= 0.3);
    }

    // ammo: one pip per round, and the one being reloaded fills up
    if (p.maxAmmo !== this._lastMax) {
      this._lastMax = p.maxAmmo;
      this.ammoRow.innerHTML = '';
      this._pips = [];
      for (let i = 0; i < p.maxAmmo; i++) {
        const pip = el('i');
        this.ammoRow.append(pip);
        this._pips.push(pip);
      }
      this._lastAmmo = -1;
    }
    if (p.ammo !== this._lastAmmo) {
      this._lastAmmo = p.ammo;
      for (let i = 0; i < this._pips.length; i++) {
        this._pips[i].classList.toggle('on', i < p.ammo);
      }
      this.ammo.classList.toggle('low', p.ammo === 0);
    }
    const reloading = p.ammo < p.maxAmmo;
    const next = this._pips?.[p.ammo];
    if (next) {
      next.style.setProperty('--fill', reloading
        ? clamp(p.reloadT / Math.max(0.2, p.stats.reloadPerShot), 0, 1).toFixed(3) : '0');
    }

    if (g.boss && this.bossBar.classList.contains('on')) {
      const f = g.boss.hpFrac;
      this.bossFill.style.width = (f * 100).toFixed(2) + '%';
      this._bossGhostFrac += (f - this._bossGhostFrac) * Math.min(1, dt * 2.6);
      this.bossGhost.style.width = (Math.max(f, this._bossGhostFrac) * 100).toFixed(2) + '%';
      const left = g.boss.platesLeft;
      if (left !== this._lastPlates) {
        this._lastPlates = left;
        this.bossPlates.innerHTML = '';
        for (let i = 0; i < g.boss.plates.length; i++) {
          this.bossPlates.append(el('i', { class: i < left ? 'on' : '' }));
        }
      }
    }

    this._drawSticks(p);
  }

  /** Touch sticks are drawn where the thumbs actually are, not in fixed corners. */
  _drawSticks(p) {
    for (const key of ['move', 'aim']) {
      const s = p.sticks[key];
      let node = this._stickEls[key];
      if (!s) {
        if (node) { node.remove(); this._stickEls[key] = null; }
        continue;
      }
      if (!node) {
        node = el('div', { class: 'stick ' + key }, [el('i')]);
        this.sticks.append(node);
        this._stickEls[key] = node;
      }
      node.style.setProperty('--r', s.r + 'px');
      node.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
      const dx = clamp(s.x - s.ox, -s.r, s.r);
      const dy = clamp(s.y - s.oy, -s.r, s.r);
      node.firstChild.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  _clearSticks() {
    for (const key of ['move', 'aim']) {
      if (this._stickEls[key]) { this._stickEls[key].remove(); this._stickEls[key] = null; }
    }
  }

  hurt() {
    const v = document.getElementById('vignette');
    v.classList.add('hurt');
    setTimeout(() => v.classList.remove('hurt'), 260);
  }
}

/**
 * Icons are drawn, not typed. The old UI leaned on glyph characters like ◈ and
 * ≫, which render differently on every platform and read as debug output.
 */
export function iconSvg(name, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('icon');
  for (const d of ICONS[name] || ICONS.dot) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

const ICONS = {
  dot: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  pause: ['M9 5v14', 'M15 5v14'],
  play: ['M8 5l11 7-11 7z'],
  scrap: ['M12 3l8 5v8l-8 5-8-5V8z', 'M12 9v6'],
  move: ['M12 3v18', 'M3 12h18', 'M12 3l-3 3', 'M12 3l3 3', 'M3 12l3-3', 'M3 12l3 3', 'M21 12l-3-3', 'M21 12l-3 3', 'M12 21l-3-3', 'M12 21l3-3'],
  fire: ['M3 12h11', 'M17 12h4', 'M14 8l4 4-4 4'],
  bounce: ['M3 6l8 7-8 7', 'M11 13h10', 'M18 9l3 4-3 4'],
  shield: ['M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z'],
  power: ['M6 16l6-5 6 5', 'M6 11l6-5 6 5'],
  threat: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17v.5'],
  heart: ['M12 20s-7-4.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.5-7 9-7 9z'],
  rounds: ['M7 4h3v10l-1.5 3L7 14z', 'M14 4h3v10l-1.5 3L14 14z'],
  cycle: ['M4 12a8 8 0 0 1 13.6-5.7L20 8', 'M20 4v4h-4', 'M20 12a8 8 0 0 1-13.6 5.7L4 16', 'M4 20v-4h4'],
  chevrons: ['M6 15l6-5 6 5', 'M6 10l6-5 6 5'],
  person: ['M12 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M5 20c0-4 3.5-6 7-6s7 2 7 6'],
  crate: ['M3 8l9-4 9 4v8l-9 4-9-4z', 'M3 8l9 4 9-4', 'M12 12v8'],
  gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M12 2l1.5 3 3.3-.6 1 3.2 3 1.6-1.6 2.9 1.6 2.9-3 1.6-1 3.2-3.3-.6L12 22l-1.5-3-3.3.6-1-3.2-3-1.6L4.8 12 3.2 9.1l3-1.6 1-3.2 3.3.6z'],
  back: ['M15 5l-7 7 7 7'],
  check: ['M5 13l4 4 10-10'],
  lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
};
