/** Tiny DOM builders. Screens are composed from these so every panel, button
 *  and row inherits the same look without per-screen CSS. */

export function el(tag, attrs = {}, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  if (children !== undefined) append(n, children);
  return n;
}

export function append(n, children) {
  if (children === null || children === undefined) return n;
  if (Array.isArray(children)) { for (const c of children) append(n, c); return n; }
  n.append(children);
  return n;
}

export function frag(children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** A button that pulses on press and fires a UI sound. */
export function button(label, opts = {}) {
  const b = el('button', {
    class: 'btn' + (opts.variant ? ' ' + opts.variant : '') + (opts.big ? ' lg' : '')
      + (opts.shine ? ' shine' : '') + (opts.sub ? ' has-sub' : ''),
    disabled: opts.disabled,
  }, opts.sub ? [el('span', {}, label), el('span', { class: 'sub' }, opts.sub)] : label);
  if (opts.onClick) {
    b.addEventListener('click', (e) => {
      opts.audio?.ui(opts.sound || 'click');
      opts.haptic?.();
      opts.onClick(e);
    });
  }
  return b;
}

export function toggle(on, onChange) {
  const t = el('div', { class: 'toggle' + (on ? ' on' : '') }, [el('i')]);
  t.addEventListener('click', () => {
    const next = !t.classList.contains('on');
    t.classList.toggle('on', next);
    onChange(next);
  });
  return t;
}

export function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'seg' });
  const buttons = options.map((o) => {
    const b = el('button', { class: o.value === value ? 'on' : '' }, o.label);
    b.addEventListener('click', () => {
      for (const x of buttons) x.classList.remove('on');
      b.classList.add('on');
      onChange(o.value);
    });
    return b;
  });
  wrap.append(...buttons);
  return wrap;
}

/** Counts a number up with easing — used on every reward readout. */
export function countUp(node, to, duration = 0.8, format = (v) => Math.round(v).toLocaleString()) {
  const start = performance.now();
  const from = 0;
  function step(now) {
    const t = Math.min(1, (now - start) / (duration * 1000));
    const e = 1 - Math.pow(1 - t, 3);
    node.textContent = format(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
