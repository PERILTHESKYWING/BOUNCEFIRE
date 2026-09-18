import { CONFIG } from '../core/config.js';
import { formatNumber, clamp } from '../core/utils.js';
import { el, frag } from './components.js';

/**
 * Combat HUD. Everything animates on change — counters bump, the combo ticks,
 * the boss bar leaves a ghost trail behind the damage — because the feedback is
 * the feature, not decoration.
 */
export class HUD {
  constructor(root, game) {
    this.game = game;
    this.node = el('div', { id: 'hud' });

    // --- top row: pause, level progress, coins
    this.pauseBtn = el('button', { class: 'icon-btn', 'aria-label': 'Pause' }, '❚❚');
    this.progressFill = el('i');
    this.progressName = el('b');
    this.progressCount = el('span');
    this.coinChip = el('div', { class: 'chip' }, [el('span', { class: 'ic' }, '◈'), this.coinValue = el('span', {}, '0')]);

    const progress = el('div', { class: 'hud-progress' }, [
      el('div', { class: 'label' }, [this.progressName, this.progressCount]),
      el('div', { class: 'bar' }, [this.progressFill]),
    ]);

    this.topRow = el('div', { class: 'row' }, [this.pauseBtn, progress, this.coinChip]);

    // --- boss bar
    this.bossGhost = el('div', { class: 'ghost' });
    this.bossFill = el('i');
    this.bossName = el('div', { class: 'name' });
    this.bossHpNum = el('div', { class: 'hpnum' });
    this.bossBar = el('div', { id: 'bossbar' }, [
      this.bossName,
      el('div', { class: 'barwrap' }, [
        el('div', { class: 'bar' }, [this.bossGhost, this.bossFill]),
      ]),
      this.bossHpNum,
    ]);

    // --- combo readout
    this.comboN = el('span', { class: 'n' }, '0');
    this.comboMult = el('div', { class: 'mult' }, '×1.00');
    this.comboDecay = el('i');
    this.combo = el('div', { id: 'combo' }, [
      this.comboN,
      el('div', { class: 't' }, 'COMBO'),
      this.comboMult,
      el('div', { class: 'decay' }, [this.comboDecay]),
    ]);

    // --- bottom strip
    this.shieldWrap = el('div', { id: 'shields' });
    this.bulletStat = this._stat('BULLETS', '0');
    this.dmgStat = this._stat('DAMAGE', '×1.0');
    this.bottom = el('div', { id: 'hudbottom' }, [
      this.bulletStat.node,
      el('div', { class: 'stat' }, [this.shieldWrap, el('span', {}, 'SHIELD')]),
      this.dmgStat.node,
    ]);

    this.banner = el('div', { id: 'banner' });
    this.modToast = el('div', { id: 'modtoast' });

    this.node.append(this.topRow, this.bossBar, el('div', { class: 'spacer', style: 'flex:1' }), this.bottom);
    root.append(this.node, this.combo, this.banner, this.modToast);

    this.pauseBtn.addEventListener('click', () => game.pause());

    this._lastBullets = -1;
    this._lastCoins = -1;
    this._lastCombo = -1;
    this._lastShield = -1;
    this._bossGhostFrac = 1;
    this._shownCombo = 0;
  }

  _stat(label, value) {
    const b = el('b', {}, value);
    const node = el('div', { class: 'stat' }, [b, el('span', {}, label)]);
    return { node, b, last: value };
  }

  show(on) { this.node.classList.toggle('on', on); this.combo.classList.toggle('on', on && this._shownCombo > 0); }

  setLevel(name, total) {
    this.progressName.textContent = name;
    this._total = total;
  }

  showBoss(name, phase) {
    this.bossBar.classList.add('on');
    this.bossName.innerHTML = '';
    this.bossName.append(name, el('span', {}, phase || ''));
    this._bossGhostFrac = 1;
  }
  hideBoss() { this.bossBar.classList.remove('on'); }
  setBossPhase(p) {
    const s = this.bossName.querySelector('span');
    if (s) s.textContent = p;
  }

  banner1(text, sub, color = '#7fe3ff') {
    const item = el('div', { class: 'banner-item', style: `color:${color}` },
      sub ? [text, el('span', { class: 'sub' }, sub)] : [text]);
    this.banner.append(item);
    setTimeout(() => item.remove(), 950);
  }

  toast(text, color) {
    const t = el('div', { class: 'modtoast', style: `color:${color}` }, text);
    this.modToast.append(t);
    while (this.modToast.children.length > 3) this.modToast.firstChild.remove();
    setTimeout(() => t.remove(), 1300);
  }

  update(dt) {
    const g = this.game;

    // level progress
    if (this._total) {
      const left = g.enemies.aliveCount;
      const done = clamp(1 - left / this._total, 0, 1);
      this.progressFill.style.width = (done * 100).toFixed(1) + '%';
      this.progressCount.textContent = `${left} LEFT`;
    }

    // coins
    const coins = g.save.data.coins;
    if (coins !== this._lastCoins) {
      this.coinValue.textContent = formatNumber(coins);
      this.coinChip.classList.remove('bump'); void this.coinChip.offsetWidth;
      this._lastCoins = coins;
    }

    // combo
    const c = g.combat;
    if (c.combo !== this._lastCombo) {
      this._lastCombo = c.combo;
      this.comboN.textContent = String(c.combo);
      this.comboMult.textContent = '×' + c.comboMult.toFixed(2);
      this.combo.classList.remove('pop'); void this.combo.offsetWidth;
      this.combo.classList.add('pop');
      this.combo.classList.toggle('hot', c.combo >= 50);
    }
    this._shownCombo = c.combo;
    this.combo.classList.toggle('on', c.combo > 0 && this.node.classList.contains('on'));
    this.comboDecay.style.width = (clamp(c.comboT / CONFIG.combo.window, 0, 1) * 100).toFixed(0) + '%';

    // bullets in play
    const n = g.bullets.count;
    if (n !== this._lastBullets) {
      this.bulletStat.b.textContent = String(n);
      this.bulletStat.node.classList.remove('bump'); void this.bulletStat.node.offsetWidth;
      if (n > this._lastBullets) this.bulletStat.node.classList.add('bump');
      this._lastBullets = n;
    }

    // damage multiplier
    const dm = (g.player.stats.damageMult * c.damageScale);
    const dmText = '×' + dm.toFixed(1);
    if (dmText !== this.dmgStat.last) {
      this.dmgStat.b.textContent = dmText;
      this.dmgStat.last = dmText;
      this.dmgStat.node.classList.remove('bump'); void this.dmgStat.node.offsetWidth;
      this.dmgStat.node.classList.add('bump');
      this.dmgStat.b.style.color = c.overdriveT > 0 ? '#ffc13d' : '';
    }

    // shields
    const sh = g.player.shield;
    if (sh !== this._lastShield) {
      this._lastShield = sh;
      this.shieldWrap.innerHTML = '';
      for (let i = 0; i < g.player.maxShield; i++) {
        this.shieldWrap.append(el('i', { class: i < sh ? '' : 'off' }));
      }
    }

    // boss bar with a trailing ghost so big hits read as chunks
    if (g.boss && this.bossBar.classList.contains('on')) {
      const f = g.boss.hpFrac;
      this.bossFill.style.width = (f * 100).toFixed(2) + '%';
      this._bossGhostFrac += (f - this._bossGhostFrac) * Math.min(1, dt * 2.6);
      this.bossGhost.style.width = (Math.max(f, this._bossGhostFrac) * 100).toFixed(2) + '%';
      this.bossHpNum.textContent = `${formatNumber(Math.max(0, g.boss.hp))} / ${formatNumber(g.boss.maxHp)}`;
    }
  }

  setOverdrive(on) {
    document.getElementById('vignette').classList.toggle('overdrive', on);
  }

  hurt() {
    const v = document.getElementById('vignette');
    v.classList.add('hurt');
    setTimeout(() => v.classList.remove('hurt'), 220);
  }
}
