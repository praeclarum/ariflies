# Ari and the Fireflies

A realtime WebGPU browser game and rendering demo where a stylized black cat named **Ari** hunts glowing fireflies in a moonlit backyard at night.

This project is **rendering-first** and **gameplay-second**. The point is to create a visually impressive, interactive, realtime ray-marched / ray-traced experience in the browser using **JavaScript + WebGPU**. The game layer exists to make the renderer feel alive, memorable, and judge-friendly.

The expected delivery window is about **two weeks**, with implementation done **almost entirely via AI coding agents**. Scope discipline is critical.

---

## Primary Goal

Build a **dreamy, beautiful, playable nighttime scene** that immediately impresses judges through:

* realtime ray marching / ray tracing
* atmospheric moonlit rendering
* a cute stylized cat character
* glowing moving fireflies
* a small but roamable backyard
* simple, responsive interaction

This is **not** a deep game. It is a polished visual demo with a light score-attack game wrapper.

---

## Non-Negotiable Requirements

1. **Runs in the browser**

   * JavaScript
   * WebGPU required
   * Hosted on GitHub Pages (purely static, no server-side code)

2. **Realtime**

   * Target smooth play on Apple Silicon laptops/desktops
   * 60 fps is great, but lower cinematic frame rates are acceptable if the visuals are strong and interaction remains responsive

3. **Ray marching / ray tracing is central**

   * The rendering technique must be clearly part of the identity of the project
   * The scene should visibly benefit from it: fog, shadows, emissive fireflies, moonlight, smooth SDF blending, etc.

4. **Interactive**

   * Not just a passive demo
   * The player must control Ari and catch fireflies

5. **Features Ari, a black cat**

   * Ari is the central on-screen character
   * Stylized and cute is more important than realistic anatomy

---

## Product Vision

The player explores a moonlit backyard as Ari, a black cat, moving through grass, bushes, elevation changes, and a red-painted deck while hunting fireflies. The moon is visible in the sky. Fog and lighting create a dreamy mood. The scene should feel like a small interactive nighttime vignette that could stand on its own as a visually striking art piece.

---

## Core Pillars

### 1. Dreamy Night Rendering

The first impression matters most. The scene must look beautiful within seconds.

Prioritize:

* visible moon
* cool moonlight
* soft atmospheric depth
* warm local light near the house/deck
* emissive fireflies
* readable silhouettes
* rich contrast between dark cat, glowing bugs, and moonlit yard

### 2. Ari as a Stylized Character

Ari should feel alive and appealing even with simple geometry.

Prioritize:

* smooth blended SDF body
* readable silhouette
* cute body motion
* pounce/jump behavior
* tail and body animation over anatomical perfection

### 3. Playable, Not Complex

Interaction should be immediate and satisfying.

Prioritize:

* movement feels responsive
* camera mostly behaves
* catching fireflies is understandable
* score attack session structure is clear

### 4. Scope Discipline

Do not let the project become a general-purpose engine or an open-ended graphics research project.

---

## Gameplay Summary

### Session Structure

* A **2-minute score attack**
* Catch as many fireflies as possible before time runs out
* Display score during play and at the end

### Player Controls

Required:

* **WASD**: move Ari
* **Mouse / trackpad scrolling or gesture**: rotate camera
* **Click**: move Ari toward a target point and/or select a target firefly
* **Jump / pounce button**: likely Spacebar

Control design goals:

* WASD should be the most reliable direct-control input
* click-to-move is allowed as a secondary convenience feature
* jumping and pouncing can share a unified action if that simplifies implementation
* if Ari is near a target firefly and the player jumps/pounces, it should attempt a catch

### Firefly Interaction

* Fireflies are individually tracked glowing agents
* They move in 3D space, not just as shader-only effects
* They should hover, wander, and cluster in appealing ways
* Catching a firefly increments score
* Misses may cause scattering as a stretch goal

---

## World Design

### World Size

* Small but roamable backyard
* Large enough that Ari takes about **10 seconds at full run** to cross it
* Not a tiny diorama, not an open world

### Layout

Design a compact backyard stage with strong composition and visual variety:

* **house wall** on one side
* **red-painted backyard deck** attached to house
* **fence** on another side
* **bushes / shrubs** on another side
* some **open yard** space
* implied world beyond edges without needing to model it fully

### Terrain

Terrain and elevation are important.

Requirements:

* uneven ground
* visible vertical variation
* enough slope / height changes to make the space feel truly 3D

Recommended implementation:

* use a terrain texture / map where channels encode height and surface metadata

Suggested terrain texture encoding:

* **R**: height
* **G**: ground type / grass density / terrain class
* **B**: detail mask / dampness / bush influence / path data
* **A**: optional reserved channel

### Surface Variety

The yard should have at least a few materially distinct zones:

* mowed lawn / grass
* bushes / organic blobs
* red-painted slatted deck
* house wall
* one or more specular / metallic props if achievable

---

## Rendering Direction

### Rendering Style

Dreamy, beautiful, nighttime, soft, atmospheric.

Not horror. Not photorealism-at-all-costs. Not arcade bright.

Visual priorities:

* moon visible in sky
* cool moonlight as the dominant directional source
* warm accent light from house / deck area
* fog / atmospheric participation along the ray
* emissive fireflies
* silhouettes and depth
* attractive screenshots from normal gameplay

### Ray Marching / Ray Tracing Expectations

The renderer should visibly justify the chosen technique.

Expected strengths to exploit:

* signed distance fields for world forms and Ari
* smooth blending of cat body parts
* atmospheric fog integrated into ray traversal
* soft shadows or approximate soft shadows
* emissive glow / lighting contribution from fireflies
* procedural repetition where it actually helps

### Fog

Fog is important, but do not let it become a research project.

Target:

* **single-scattering style atmospheric fog integrated into the ray march**
* enough to show moonbeams, depth, softness, and atmosphere
* tuned for beauty, not physical completeness

Avoid:

* ambitious multi-scattering cloud systems
* expensive volumetric simulation that jeopardizes delivery

### Moon

The moon should be **visible**, not only implied as an offscreen light.

Requirements:

* visible in the sky during normal play
* contributes strongly to composition
* can have glow / halo if cheap enough

### Lighting

Required minimum:

* one directional moonlight
* one warm local light source near the house/deck
* emissive fireflies

Stretch:

* subtle specular highlights on wet grass / metallic prop
* light shafts enhanced by fog

---

## Ari Character Design

### Modeling

Ari should be built from **smooth blended SDF forms**, not visibly disconnected hard primitives.

Recommended composition:

* body: stretched sphere / capsule / blob
* head: rounded blob
* ears: tapered forms blended into head
* legs: simplified capsules or soft forms
* tail: tapered segmented or curved form

The black-cat-at-night concept is an advantage. Lean into silhouette and motion rather than surface detail.

### Animation

Animation should be stylized and parameter-driven.

Prioritize:

* body bob
* tail sway
* head / body orientation toward motion
* crouch pose
* jump / pounce arc
* landing compression

Do **not** spend the project trying to build perfect cat locomotion or full IK unless it is unexpectedly trivial.

Cute and readable beats realistic.

---

## Camera

### Camera Goals

* third-person follow camera
* player-rotatable
* works well with trackpad users
* always supports attractive composition

### Expected Behavior

* follows Ari from behind and above
* player can rotate around Ari
* gentle smoothing is desirable
* camera can slowly self-reorient when player stops steering it
* camera does not need to be physically perfect

Camera quality bar:

* should vaguely point where the player wants
* should not constantly fight the player
* should not become a major project

Avoid:

* full cinematic camera system
* complex collision handling if not necessary
* spending excessive time on perfect camera physics

---

## Fireflies

### Design

Fireflies are central to both visuals and gameplay.

Requirements:

* individually tracked agents
* move in 3D space
* emit visible glow
* clearly readable against dark environment

Behavior goals:

* hover and drift organically
* loosely congregate around bushes, yard features, or lights
* feel alive and tempting to chase

Implementation guidance:

* update as lightweight stateful agents on CPU or GPU
* simple stochastic movement is acceptable
* flocking / boids-level complexity is optional, not required
* visual beauty matters more than biological realism

---

## Technical Architecture Guidance

This section is guidance, not a prison. Agents may choose reasonable alternatives that preserve project goals.

### Recommended High-Level Architecture

* WebGPU renderer with fullscreen ray-marched scene pass
* CPU and/or compute-updated game state buffers
* shared scene uniforms / buffers for:

  * Ari state
  * camera state
  * firefly state array
  * terrain / material params
  * time / score / session state

### World Representation

Suggested combination:

* terrain from heightmap-like data texture
* house, deck, fence, bushes as SDF or procedural primitives
* Ari as blended SDF model
* fireflies as explicit dynamic agents passed to renderer

### Gameplay State

Keep the state simple and inspectable.

Likely state categories:

* game timer
* current score
* Ari locomotion / pose state
* camera orbit state
* firefly positions / velocities / behavior seeds
* terrain/material data

---

## Priorities for AI Coding Agents

When making decisions, optimize in this order:

1. **A working beautiful first impression**
2. **Stable playable loop**
3. **Ari looking cute in motion**
4. **Atmospheric rendering quality**
5. **Extra polish**
6. **Only then extra features**

If forced to choose between a better rendering effect and a deeper gameplay mechanic, prefer the **better rendering effect**, provided the result remains interactive.

---

## Acceptance Criteria for a Good Submission

The project is successful if:

* it runs in the browser via WebGPU
* it is clearly realtime
* Ari is controllable
* Ari can catch fireflies
* the moonlit backyard looks beautiful and intentional
* the ray-marched / ray-traced nature of the rendering is apparent
* the scene has depth, atmosphere, and strong mood
* the experience feels polished enough to show judges for a short demo

The project does **not** need:

* deep progression
* polished enemy AI
* complex narrative
* sophisticated pathfinding
* advanced physics
* general-purpose engine abstractions beyond what the demo needs

---

## Stretch Goals

Only attempt these after the core loop and visual quality are solid.

### Stretch Tier 1

- [ ] fireflies scatter when Ari misses a pounce
- [x] subtle moon halo / glow (basic halo implemented)
- [ ] drifting cloud band near moon
- [ ] improved soft shadows
- [ ] puddle / dew specular accents
- [ ] better deck traversal presentation
- [ ] beauty-tuned post effects if cheap and tasteful

### Stretch Tier 2

- [ ] decorative extra cats (golden rival, black-and-white neutral)
- [ ] decorative perches on fence or deck
- [ ] additional material richness

### Stretch Tier 3

- [ ] more advanced flocking
- [ ] richer environmental interactions
- [ ] more complex scoring systems

---

## Explicit Anti-Goals

Do **not** let the project drift into any of the following unless the core is already excellent:

* full volumetric cloud simulation
* multiple-scattering atmospheric research
* realistic skeletal/IK cat animation system
* large open-world yard
* many NPC creatures
* advanced pathfinding/navigation
* generic engine architecture over-delivery
* physically exhaustive realism that reduces beauty or threatens schedule

---

## Implementation Heuristics

Use these rules when uncertain:

* Prefer **beautiful cheats** over expensive realism
* Prefer **readability** over complexity
* Prefer **strong silhouettes** over fine detail
* Prefer **small polished spaces** over large sparse worlds
* Prefer **parameter-driven animation** over rig complexity
* Prefer **data-driven terrain/material masks** over hand-coded scene clutter
* Prefer **one memorable interaction done well** over many shallow systems

---

## Suggested Milestone Order

### Milestone 1: Skeleton ✅

- [x] WebGPU app bootstrapped
- [x] camera basic follow/orbit
- [x] placeholder terrain (flat ground plane at y=0)
- [x] placeholder Ari movement
- [x] timer and score skeleton

### Milestone 2: Playable Core 🔶

- [x] Ari controllable with WASD
- [x] Ari controllable with drag on mobile devices and tap to jump/pounce
- [x] fireflies moving and catchable
- [x] 2-minute score attack loop functional

### Milestone 3: Renderer Identity ✅

- [x] moon visible (with glow and halo)
- [x] atmospheric fog added
- [x] strong moonlight + warm house light
- [x] basic attractive night palette

### Milestone 4: Ari Appeal 🔶

- [x] smooth blended cat model (SDF: body, head, ears, tail, legs)
- [x] cute movement (body bob from animPhase)
- [x] jump/pounce action
- [x] tail sway animation
- [ ] improved silhouette and animation parameters (crouch pose, landing squash, walk cycle)

### Milestone 5: World Beauty ❌

- [ ] terrain texture height variation
- [ ] terrain texture data material variation
- [ ] deck, fence, bushes, house wall integrated
- [x] firefly congregation zones (partial: they have home positions but no variety by zone)
- [ ] composition improved for screenshots

### Milestone 6: Polish 🔶

- [ ] readability tuning
- [x] camera smoothing / recenter tuning
- [x] score/timer UI cleanup
- [ ] bug fixes
- [ ] performance tuning (configurable render scale exists but not tuned)

---

## Final Instruction to Agents

Treat this as a **judge-facing visual experience** first and a game second.

When in doubt, ask:

> Does this make the first 10 seconds more beautiful, memorable, and playable?

If yes, it is likely worth doing.
If no, it is probably scope creep.

---

## Implementation Decisions (Resolved)

These decisions are final. Do not revisit or second-guess them.

### Language: JavaScript with JSDoc Types

* **JavaScript**, not TypeScript
* All `.js` files use `// @ts-check` at the top
* Type annotations via JSDoc (`@param`, `@returns`, `@typedef`, etc.)
* `jsconfig.json` with `checkJs: true` and `strict: true` enables full type checking in VS Code
* `tsc --noEmit` runs in CI to gate deploys — zero runtime build step
* WebGPU types via `@webgpu/types` devDependency

### No Bundler, No Build Step

* ES modules served directly to the browser (`<script type="module">`)
* `import`/`export` between `.js` files using relative paths with `.js` extensions
* WGSL shader files in `src/shaders/`, loaded at runtime via `fetch()`
* No webpack, no esbuild, no rollup, no vite — the repo root **is** the deployable site

### Project Structure

```
index.html          ← entry point (canvas + UI overlay + inline init script)
editor.html         ← level editor (terrain painting, JSON editing, live preview)
jsconfig.json       ← type checking config
package.json        ← dev scripts only (live-server, tsc)
levels/
  level0.json       ← default level metadata (entities, lights, spawn zones)
  level0.png        ← default level terrain (256×256 RGBA heightmap/material)
src/
  buffers.js        ← GPU buffer creation, struct sizes, staging readback
  compute.js        ← 3 compute pipelines, shader loading, dispatch
  editor.js         ← level editor: terrain canvas, JSON editor, file I/O
  engine.js         ← reusable engine: WebGPU init, frame loop, level loading
  game.js           ← session flow, timer, score readback, DOM updates
  input.js          ← DOM event capture → input uniform buffer
  levels.js         ← level data loading, terrain texture, firefly zone expansion
  renderer.js       ← fullscreen ray march render pipeline
  shaders/
    camera_compute.wgsl
    ari_compute.wgsl
    firefly_compute.wgsl
    raymarch.wgsl
.github/
  workflows/
    deploy.yml      ← GitHub Pages deployment
```

### Deployment: GitHub Pages via Actions

* Repo: `github.com/praeclarum/ariflies`
* URL: `praeclarum.org/ariflies`
* Deploy workflow: push to `main` → typecheck → upload repo root → deploy-pages
* No build artifacts, no `dist/` folder — the repo root is uploaded directly
* All asset paths must be **relative** (no leading `/`) to work under the `/ariflies/` subpath

### Dev Server: live-server

* `npm start` runs `live-server --port=8080 --no-browser`
* Auto-refreshes browser on any file change
* Zero config needed

### GPU-First Architecture

* **CPU does only**: gather user input (DOM events), manage the game timer, update the DOM (score/timer text)
* **GPU compute shaders do everything else**: camera orbit, Ari movement/physics, firefly simulation, catch detection
* Three separate compute passes per frame in dependency order: camera → Ari → firefly
* Separate passes provide implicit storage barriers for correct data flow
* Score readback via async `mapAsync` on a staging buffer (1-frame latency, imperceptible)

### Coordinate System & Math Conventions

**This section is critical. Read it carefully before writing any transformation code.**

#### World Coordinates

* **Right-handed coordinate system**
* **Y is up**
* **+X is right** (when looking toward -Z)
* **+Z is "out of the screen"** / toward the initial camera

#### Vector Math Over Angles

**Do NOT use Euler angles for orientations.** Store directions as unit vectors.

* Ari's facing direction is stored as a 2D unit vector `(forwardX, forwardZ)` in the XZ plane
* Camera direction is derived from `lookAt - eye`, not from yaw/pitch angles
* When you need a basis (right, up, forward), compute it from vectors using cross products:
  - `forward = normalize(lookAt - eye)`
  - `right = normalize(cross(forward, worldUp))` or equivalently `forward × up`
  - `up = cross(right, forward)`

**Why no angles?**

* Angles require sin/cos which are easy to get wrong (signs, quadrants, wrapping)
* Angles require `atan2` to recover, which has its own sign conventions
* Vector math is self-documenting: `forward × up` clearly gives `right`
* Interpolating vectors with `normalize(mix(a, b, t))` is simpler than angle wrapping

#### Cross Product Convention (Right-Handed)

```
forward × up = right     (in 3D: (fx,fy,fz) × (0,1,0) = (-fz, 0, fx) when fy=0)
up × forward = -right    (reversed order gives opposite direction)
```

In 2D XZ plane where forward = `(fx, fz)`:
* `right = (-fz, fx)` — this is `forward × up` projected to XZ

#### World→Local Transformation for Ari

Ari looks toward local +Z. Given Ari's world forward vector `(fx, fz)`:

```
right = (-fz, fx)   // forward × up, projected to XZ

World→Local rotation (rows are right, up, forward):
  | -fz   0   fx |     local.x = dot(right, worldPoint)
  |  0    1   0  |     local.y = worldPoint.y
  |  fx   0   fz |     local.z = dot(forward, worldPoint)
```

This matrix rotates world coordinates into Ari's local frame where +Z is forward.

#### Camera Movement Mapping

WASD maps to camera-relative directions:
* W/S: move along camera's forward/back (XZ projection)
* A/D: move along camera's left/right (XZ projection)

Derive camera basis from `lookAt - eye`, then:
* `camForward = normalize((lookAt - eye).xz)` — 2D in XZ plane
* `camRight = (-camForward.z, camForward.x)` — 90° rotation via `forward × up`

World movement = `inputX * camRight + inputZ * camForward`

#### Facing Direction Update

Ari should face the direction of actual movement (velocity), not input direction:

```wgsl
if (speed > threshold) {
  forward = normalize(mix(forward, velocityDir, lerpT));
}
```

This ensures the cat faces where it's going, with no lag between input and facing.

### GPU Buffers

Six GPU buffers hold all game state. See code for exact struct layouts.

* **InputUniforms** (uniform, CPU→GPU): keyboard state, mouse delta, dt, time, resolution
* **CameraState** (storage, GPU r/w): eye position, lookAt target, orbit params, fov
* **AriState** (storage, GPU r/w): position, forward direction (as vector!), velocity, pose/animation state
* **FireflyArray** (storage, GPU r/w): array of ~50 fireflies with position, velocity, phase, home position
* **GameState** (storage, GPU r/w + staging readback): score (atomic), game phase, time remaining
* **SceneParams** (uniform, CPU→GPU): lighting parameters (moon direction/color, house light, fog, ambient)

### WGSL Shader Organization

* One `.wgsl` file per pipeline (4 files total)
* `camera_compute.wgsl`, `ari_compute.wgsl`, `firefly_compute.wgsl`, `raymarch.wgsl`
* Struct definitions are duplicated across files (WGSL has no `#include`)
* If `raymarch.wgsl` outgrows itself, split via JS string concatenation — not a preprocessor

### Frame Pipeline Order

1. `input.writeInputBuffer()` — CPU writes InputUniforms
2. `game.writeGameState()` — CPU writes time/phase into GameState
3. Compute pass 1: camera (reads Input+Ari → writes Camera)
4. Compute pass 2: ari (reads Input+Camera → writes Ari)
5. Compute pass 3: firefly (reads Input+Ari+Game → writes Fireflies+Game)
6. Render pass: ray march (reads all buffers → fullscreen triangle)
7. `copyBufferToBuffer`: GameState → staging
8. Submit command encoder
9. `game.requestScoreReadback()` — async mapAsync → update DOM

### Rendering Approach

* Fullscreen triangle (no vertex buffer — positions from `vertex_index`)
* Configurable render scale passed as uniform (allows half-res for perf tuning)
* ~50 fireflies (good balance for 2-min session)
* `atomicAdd` for thread-safe score increment in firefly compute

### Level Data System

Levels are stored as file pairs in the `/levels/` directory:

* `levels/{id}.png` — 256×256 RGBA terrain texture
* `levels/{id}.json` — level metadata (entities, lights, spawn zones, world config)

The game loads a level at startup via `?level=level0` URL parameter (defaults to `level0`).

#### Terrain Texture Encoding (256×256 RGBA PNG)

| Channel | Encoding | Range |
|---------|----------|-------|
| R | Height | 0–255 → 0.0–`maxHeight` (from JSON) |
| G | Material ID | 0=grass, 64=puddle, 128=wood, 192=concrete |
| B | Detail/variation | reserved for future use (grass density, dampness) |
| A | Reserved | 255 default |

Coordinate mapping: pixel (0,0) = world `(-worldRadius, -worldRadius)`, pixel (255,255) = world `(+worldRadius, +worldRadius)`. Height uses bilinear interpolation; material uses nearest-neighbor to avoid blending between material types.

#### Level JSON Schema

```json
{
  "name": "Backyard",
  "version": 1,
  "world": { "radius": 15.0, "maxHeight": 5.0 },
  "ari": { "startPosition": [0, 0, 0] },
  "fireflyZones": [
    { "center": [3, 1.5, 5], "radius": 3.0, "count": 15, "minHeight": 0.5, "maxHeight": 2.5 }
  ],
  "lights": {
    "moon": { "direction": [0.4, 0.35, 0.6], "color": [0.8, 0.9, 1.1] },
    "houseLight": { "position": [-8, 3, 8], "color": [1.0, 0.7, 0.3] }
  },
  "scene": { "fogDensity": 0.02, "ambientColor": [0.008, 0.01, 0.02] },
  "camera": { "initialDistance": 10.0, "initialPitch": 0.6 },
  "game": { "duration": 120 }
}
```

Fireflies are defined as **spawn zones** (center, radius, count). At load time, `levels.js` expands zones into individual home positions scattered within each zone. The firefly buffer is pre-allocated for a max of 200 fireflies; the actual count is a uniform.

#### Level Editor (`editor.html`)

A dev-only interactive editor at `/editor.html` with three panels:

1. **Terrain editor** — top-down 2D canvas for painting height and material brushes
2. **JSON editor** — textarea for editing level metadata with live validation
3. **Preview** — WebGPU canvas showing the level as it would appear in-game, updating live on edits

Level files are saved via download links (PNG + JSON). Loaded via file picker or `?level=` URL param.
