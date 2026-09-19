// If anything below this throws before the game takes over the boot screen,
// say so on the boot screen. A silent boot screen that never finishes is the
// worst failure this page can have: it looks identical to a slow network and
// tells whoever is looking at it nothing at all.
const show = (what) => {
  const el = document.querySelector('.boot-status');
  if (el) { el.textContent = what; el.classList.add('boot-failed'); }
};
addEventListener('error', (e) => {
  if (e.target && e.target !== window && e.target.src) show(`could not load ${new URL(e.target.src).pathname}`);
  else if (e.message) show(e.message);
}, true);
addEventListener('unhandledrejection', (e) => show(String(e.reason && e.reason.message || e.reason)));
