# BOUNCEFIRE

A portrait-first 3D mobile arcade shooter. You drag one thumb to move up through a
branching maze; the gun fires itself. Every bullet ricochets off the walls, and
bouncing is what keeps bullets alive — so the maze is the weapon, not the obstacle.

**Play:** open `index.html` from any static web server.

```
npx http-server -p 8080 .
```

Nothing to build. Three.js is vendored under `vendor/`, so the game runs offline.

## The core rule

Each bullet carries a hidden "damage life" pool:

- hitting an enemy **drains** it
- hitting a wall **recharges** it

That number is never shown. It is communicated entirely through the bullet's
glow size, trail length and colour, so players learn "bouncing keeps my bullets
alive" by watching rather than by reading a tooltip. Bullets also hard-expire at
15 seconds and are recycled once they drift out of the fight, which keeps the
visible swarm dense instead of scattered across cleared corridors.

## Modifier walls

Some wall segments are built into the maze as modifiers. A bullet that hits one
is transformed: `×2`/`×3 BULLETS`, `+50%`/`+100% DAMAGE`, `RAPID FIRE`, `CRIT`,
`FIRE`, `ICE`, `BOLT`, `PIERCE`, `SPLIT`, `CHARGE`, `BOOM`, `BIG`. Modifier
colours stay consistent across every theme so they remain readable as gameplay
information rather than decoration.

## Layout

```
index.html              shell, import map, boot screen
src/
  core/                 config, save, pooling/math helpers, monetization hooks
  data/                 levels, themes, modifiers, progression tables
  world/                arena builder, collision grid, shared geometry/textures
  game/                 player, bullets, enemies, boss, combat & combo
  fx/                   GPU particles, pooled effects, damage numbers, camera rig
  audio/                synthesised SFX and the step-sequenced score
  ui/                   HUD, screens, components, stylesheet
vendor/three/           pinned Three.js r169 + the four postprocessing addons
```

Tuning lives in `src/core/config.js`, `src/data/levels.js`, `src/data/themes.js`
and `src/data/modifiers.js`. Gameplay code reads those tables and holds no magic
numbers of its own, so the game can be rebalanced without touching systems.

## Design notes

**Planar combat, 3D presentation.** Bullets, enemies and the player all move in
the XZ plane, which makes ricochets cheap and predictable to debug. The floor
still climbs chamber by chamber, so the player is genuinely travelling upward,
and walls are authored low enough that a ~50° chase camera never loses the maze
behind them.

**Enemies hold their chamber.** They engage when the player comes close and
return to post otherwise. Global chasing strung enemies out behind the player
and turned "clear the level" into backtracking. Stragglers rally to the player
once only a handful remain, so a level can always be finished.

**No asset pipeline.** Every texture, sound and piece of music is generated at
runtime — canvas textures for wall labels and floors, WebAudio synthesis for the
score and every effect.

## Performance

Measured in-browser with a saturated swarm (300 bullets, 56 enemies, combo 180):

| | |
|---|---|
| simulation per frame | 0.9 ms median, 2.0 ms p95 |
| draw calls | ~80 |
| triangles | ~35k |

Bullets, enemies and particles are pooled; bullet cores, glows and trail ghosts
are three instanced meshes with matrices written straight into the instance
buffers. Particles are animated entirely in the vertex shader. Quality
(`low`/`medium`/`high`) is detected from the device and steps itself down once if
the frame rate does not hold.

## Monetization

`src/core/monetization.js` is a stub with one call site per placement — rewarded
revive, rewarded 2× level rewards, rewarded chest, and an interstitial that only
ever fires between levels. Swapping in a real SDK is a single-file change, and
nothing in the game is gated behind it.
