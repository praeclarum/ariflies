# Ari and the Fireflies

A realtime WebGPU browser game and rendering demo where a stylized black cat named **Ari** hunts glowing fireflies in a moonlit backyard at night.

This project is **rendering-first** and **gameplay-second**. The point is to create a visually impressive, interactive, realtime ray-marched / ray-traced experience in the browser using **JavaScript or TypeScript + WebGPU**. The game layer exists to make the renderer feel alive, memorable, and judge-friendly.

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

   * JavaScript or TypeScript
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

* fireflies scatter when Ari misses a pounce
* subtle moon halo / drifting cloud band
* improved soft shadows
* puddle / dew specular accents
* better deck traversal presentation
* beauty-tuned post effects if cheap and tasteful

### Stretch Tier 2

* decorative extra cats

  * golden rival cat
  * black-and-white neutral cat
* decorative perches on fence or deck
* additional material richness

### Stretch Tier 3

* more advanced flocking
* richer environmental interactions
* more complex scoring systems

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

### Milestone 1: Skeleton

* WebGPU app bootstrapped
* camera basic follow/orbit
* placeholder terrain
* placeholder Ari movement
* timer and score skeleton

### Milestone 2: Playable Core

* Ari controllable with WASD
* click interaction basics
* fireflies moving and catchable
* 2-minute score attack loop functional

### Milestone 3: Renderer Identity

* moon visible
* atmospheric fog added
* strong moonlight + warm house light
* basic attractive night palette

### Milestone 4: Ari Appeal

* smooth blended cat model
* cute movement
* jump/pounce action
* improved silhouette and animation parameters

### Milestone 5: World Beauty

* terrain texture data driving height/material variation
* deck, fence, bushes, house wall integrated
* firefly congregation zones
* composition improved for screenshots

### Milestone 6: Polish

* readability tuning
* camera smoothing / recenter tuning
* score/timer UI cleanup
* bug fixes
* performance tuning

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
index.html          ← entry point (canvas + UI overlay)
jsconfig.json       ← type checking config
package.json        ← dev scripts only (live-server, tsc)
src/
  main.js           ← app entry, WebGPU init
  shaders/          ← .wgsl files loaded via fetch()
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
