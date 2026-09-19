# BOUNCEFIRE — redesign notes

What changed in the rebuild, and what was deliberately taken out.

## The one rule

The old build had many multipliers feeding each other. Now there is exactly one:

> A bounced round hits harder and pays for itself.

Every wall bounce adds a charge, hard-capped at **three** (`×1.0 / ×1.4 / ×1.8 /
×2.2`). A round that bounced at least once and then connects is returned to the
magazine; a straight shot and a miss each cost a round. The magazine is six and
reloads one at a time, so a fight is shaped by whether you can find an angle
instead of a line. Charge is shown on the round, on the aim line and in the
bounce sound — nothing is hidden.

The three-stack cap is the same number everywhere: charge stacks to 3, the POWER
panel adds charge but cannot push past 3, and a round can carry at most one
shape modifier.

## Enemies

Five opponents, each built from six to ten meshes (legs, plates, cores, arms,
eyes) merged down to three or four instanced draw calls. They read by silhouette
before colour, and all share one four-beat grammar: **engage → wind → act →
recover**.

| Enemy   | Threat | Reads as |
| ------- | ------ | -------- |
| SKITTER | 1 | six legs, closes fast, lunges in a straight line |
| HORNET  | 2 | hovers at range, then dives through you |
| LANCER  | 3 | tripod, holds distance, fires a slow aimed bolt |
| WARDEN  | 4 | a slab of shield facing you — straight shots deflect |
| ANVIL   | 5 | raises both arms and slams a wide ring of floor |

Telegraph grammar is consistent: a **ring** is a ground area, a **line** is a
lane. Every attack paints where it will land before it lands, and each enemy
carries a flat signal plate on top so the wind-up is visible from the camera's
angle.

HP came down and threat went up. Contact damage is no longer "you stood near
me": a Skitter only hurts you on its lunge, a Hornet only on its dive. Walking
past one is a decision you are allowed to make. The Warden is the exception —
being in the way is its whole job, and it is slow enough to walk around. It is
also the rule in enemy form: it deflects anything arriving inside a 50° cone of
its front, so the only way through is off a wall.

THE FOUNDRY, the boss, is a drum behind four quadrant plates. Hits land on the
plate covering the angle they arrive from and the core takes a quarter damage
until that plate breaks, so the fight is about moving around it rather than
out-damaging a health bar.

## Movement, aiming and firing

- **Autofire is gone.** You choose every shot. Mouse or right-thumb stick aims
  and fires; the aim line draws both the direct leg and the first bounce.
- **WASD was genuinely reversed.** The camera looks down +Z, so world +X renders
  on the *left* of the screen — proven by projecting world points to screen
  coordinates rather than trusting the code's naming. Every input-to-world
  conversion now goes through a single constant, and D moves right.
- No auto-advance, no tilting platform. You move across the arena; the camera
  follows you.
- Acceleration is firm rather than slippery, with a short lead on the camera in
  the direction you are aiming.

## Health

The shield system, the bubble, and the regeneration tiers are gone. There is a
plain health bar. Damage is meaningful (an Anvil slam is a quarter of your
health) but always telegraphed, and clearing a room heals a little. Getting hit
flashes the player white for a frame and pulses a floor ring for the invulnerable
window — no more turning pink for a second.

## Readability

- Arenas shrank from 46 units wide to 24–28. The camera at 57° and this distance
  shows about 19 world units across a portrait phone; the old arenas were more
  than twice that, which is why enemies could stand beside you off-screen.
- Mazes are now rails and pockets that create bounce angles rather than corridors
  that hide you. Floors extend well past the kerbs so there is no void behind the
  near wall, and risers between rooms are full-width.
- Fog pulled in, floors and walls lifted in value, so the player silhouette sits
  against a lighter ground.
- No glow or halo was added to solve visibility. The camera, the arena scale and
  the contrast were changed instead.

## Modifier walls

Four panels, unlocked one per level so the first game teaches one idea at a time:
POWER (+1 charge) at level 1, SPLIT (becomes three, once) at 2, PIERCE (through
two enemies) at 3, BURST (one small explosion) at 4. A panel affects a round
once, then goes quiet for a few seconds, and a round carries at most one shape
modifier — one shot can never cascade into a screen of projectiles.

## Tutorial

Six steps in a purpose-built training room, each one a thing you do rather than a
thing you read: move to the marker, fire at two targets, bank a shot off the rail,
get past a Warden's shield, use the POWER panel, then a short live fight. The
bank lesson enforces itself — kill a target with a straight shot and it comes
back with a "BANK IT" prompt. Labels are three or four words; there is no wall of
text.

## Visual direction

Away from neon sci-fi. Warm off-white paper, near-black ink, a single amber
accent, gold for reward, muted red and green for bad and good. Condensed type,
flat panels, an SVG wordmark that dominates the title screen. Bloom, emissive
outlines and holographic panels are gone; colour is used to say what a thing is,
not to look energetic.

## Menus, profile, cosmetics

The title screen is a wordmark and a 3D showcase of your character on a plinth
with four large buttons: PLAY, TUTORIAL, PROFILE, LOCKER. PROFILE shows the
character and weapon you are actually using, at size, with the equipped skins on
them, plus lifetime stats. Crates hold **cosmetics only** — character skins and
weapon skins. Duplicates convert to scrap. The opening is one card, one item, one
sound.

## Progression

Four upgrades, none of which multiplies another: damage, magazine, reload speed,
vitality. Each is a flat, legible step.

## Audio

Four fixed-level buses — ALERT 1.0, ACTION 0.6, SELF 0.34, TEXTURE 0.16 — so an
enemy wind-up is always louder than your own shot and far louder than an impact
tick. Texture ducks under alerts. The music is three written melodic tracks at
84–104 bpm with actual tunes, not a procedural combat texture.

## Deliberately removed

Autofire · shields, shield bubbles and shield regeneration tiers · combo meter
and combo scaling · crits · overdrive · elemental damage · chain effects ·
amplifiers and auras · bullet splitting beyond the one-shot SPLIT panel ·
stacking temporary buffs · damage numbers · screen-space bloom and the
postprocessing chain · floating world text labels · gameplay rewards from crates
· the old multi-branch upgrade tree.

## Deliberately simplified

Particle counts and screen shake (both now tied to what happened, not to
intensity) · enemy HP (down, with threat moved into attacks) · maze density ·
modifier count (from many to four, unlocked over four levels) · the economy (one
currency, scrap) · the HUD (health, magazine, charge, objective — nothing else).

## Save data

Saves are versioned (`bouncefire.save.v2`). A `v1` save migrates on first load:
scrap, settings and lifetime stats carry over, and anything bought in a system
that no longer exists — the old upgrade tree, amplifiers, auras — is refunded as
scrap rather than silently dropped. An absent or corrupt save falls back to
defaults instead of throwing.
