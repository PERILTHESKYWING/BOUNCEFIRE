# BOUNCEFIRE

A portrait-first 3D arcade shooter about banking shots off walls. You move with
one thumb, aim and fire with the other, and the walls are how you hit things
that a straight line cannot reach.

**Play:** open `index.html` from any static web server.

```
npx http-server -p 8080 .
```

Nothing to build. Three.js is vendored under `vendor/`, so the game runs offline.

## The core rule

There is one rule, and the whole game is built on it:

> **A bounced round hits harder and pays for itself.**

- Every wall bounce adds one **charge**, up to **three**.
- Charge is the only damage multiplier in the game: `×1.0 / ×1.4 / ×1.8 / ×2.2`.
- A round that has bounced at least once and then connects is **returned to the
  magazine**. A straight shot, and a miss, each cost one round.

The magazine is six and reloads one round at a time, so the shape of a fight is
decided by how often you can find an angle instead of a line. Charge is shown on
the round itself (it brightens and lengthens), on the aim line, and in the sound
of the bounce — there are no hidden pools.

Nothing else multiplies anything. There are no combos, no crits, no overdrive,
no elemental damage and no chain effects.

## Modifier walls

Four panels, unlocked one level at a time so the first game teaches one idea at
a time:

| Panel  | Level | Effect                                        |
| ------ | ----- | --------------------------------------------- |
| POWER  | 1     | +1 charge (still capped at three)             |
| SPLIT  | 2     | the round becomes three, once                 |
| PIERCE | 3     | passes through two enemies                    |
| BURST  | 4     | one small explosion on the next enemy it hits |

Each panel affects a round **once**, then goes quiet for a few seconds. A round
can carry at most one shape modifier, so a single shot can never cascade into a
screen full of projectiles.

## The cast

Five enemies, built from multiple meshes with animated parts so each one reads
by silhouette before you read its colour. All of them use the same four-beat
grammar — engage, wind up, act, recover — and every attack paints its area on
the floor before it lands.

| Enemy  | Threat | Reads as                                              |
| ------ | ------ | ----------------------------------------------------- |
| SKITTER | 1     | six legs, closes fast, lunges in a straight line       |
| HORNET  | 2     | hovers at range, then dives through you               |
| LANCER  | 3     | tripod, holds its distance, fires a slow aimed bolt    |
| WARDEN  | 4     | slab of a shield facing you — straight shots deflect   |
| ANVIL   | 5     | raises both arms and slams a wide ring of the floor    |

The Warden is the rule in enemy form: it always faces you, and it turns away
anything arriving inside a 50° cone of its front. The only way through is off a
wall.

THE FOUNDRY, the boss, is a drum behind four quadrant plates. Hits land on the
plate covering the angle they arrive from; the core only takes a quarter of the
damage until that plate is broken, so the fight is about moving around it.

## Progression

Four upgrades, none of which multiplies another: **damage**, **magazine**,
**reload speed**, **vitality**. Crates hold cosmetics only — character skins and
weapon skins — and duplicates convert to scrap.

## Layout

```
index.html              shell, import map, boot screen
artifact.html           the same page, flattened for publishing
src/
  core/                 config, save + migration, pooling/math, monetization hooks
  data/                 enemies, levels, themes, modifiers, progression tables
  world/                arena builder, collision grid, shared geometry/textures
  game/                 player, bullets, enemies, boss, combat, tutorial
  fx/                   GPU particles, pooled effects, camera rig
  audio/                synthesised SFX on four buses, and a written score
  ui/                   HUD, screens, components, stylesheet
vendor/three/           pinned Three.js r169
```

## Save data

Saves are versioned (`bouncefire.save.v2`). A `v1` save is migrated on first
load: scrap, settings and lifetime stats carry over, and purchases in systems
that no longer exist (the old upgrade tree, amplifiers, auras) are refunded as
scrap rather than discarded.
