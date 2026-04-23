# Axiom — Design Document

## Design Philosophy

Axiom does not look like a productivity app, an AI chatbot,
or an edtech product. It looks like nothing the user has seen
before in this category.

The visual language is built around one feeling: you are inside
something that knows more than you do. Dark, considered, with
depth and weight. Every surface feels physical. Every interaction
feels deliberate. Nothing is decorative — every visual decision
serves the product's core mechanic.

Three principles govern every design decision:

### 1. Depth Over Flatness
Axiom exists in perceived 3D space. Surfaces float. Light
catches edges. The grain texture gives the void behind everything
a physical quality. The user should never feel like they are
looking at a screen — they should feel like they are inside
a space.

### 2. Restraint Over Decoration
The gold accent appears in exactly four places: Axiom's name,
highlighted nodes, active experiments, and warning states.
Nowhere else. Its rarity is what gives it meaning. Every element
that is not necessary is removed. What remains carries weight
precisely because nothing competes with it.

### 3. Axiom Feels Different From The Interface
The UI is cold, geometric, precise — Neue Montreal, dark glass,
sharp edges. Axiom's voice is warm, weighted, editorial — Canela
serif, off-white, gold left border. The visual contrast between
the interface and Axiom's words is intentional. It makes Axiom
feel like a presence inside the product, not a feature of it.

---

## ICP Design Principles

Axiom is built for 18-28 year olds who are building something
or want to. They wear mostly black. They think in systems.
They find most apps patronizing. They notice details others miss.
Every design decision is filtered through this person.

### No Hand-Holding
No onboarding tooltips. No empty states with illustrations.
No "welcome to Axiom" overlays. The product assumes intelligence.
The sphere is immediately there. Axiom speaks first. The user
figures out the rest — and respects the product for assuming
they can.

### Density Over Whitespace
This ICP reads Dense products as serious. Excessive whitespace
reads as emptiness. Glass cards feel full. Every visible element
means something. Think Bloomberg Terminal meets high-end
editorial design.

### Micro-Details They'll Notice
- The grain texture on the background
- The sphere breathing on a 4 second cycle
- The edge glow on glass catching ambient light
- A new node igniting rather than appearing
- The gold left border on Axiom's messages
  shifting in gradient as they scroll
These details are for the person who notices them and
tells someone else. That person is the entire marketing plan.

### Session Feels Like A Private Room
When a session opens the sphere recedes — scales down,
blurs into the corner. The glass session surface comes forward.
The world mutes. No navigation visible. No distractions.
Just the conversation. Navigation only returns when the user
explicitly signals they want to leave.

### Status Indicators Feel Like Mission Control
Active experiments: pulsing amber standby light — not a green dot.
Maturity stage: single word in small caps, bottom corner — not
a progress bar. Status communicated through restraint, not emphasis.

---

## Color System & Texture

### Background — Grainy Void
The background is not a color. It is a surface.
Base: #080808
Grain: tileable 200×200px noise PNG at 8% opacity,
  fixed attachment — does not scroll with content
Vignette: CSS radial gradient overlay, edges darken
  toward #000000 at 15% opacity, center at base

```css
body {
  background-color: #080808;
  background-image: url('/textures/grain.png');
  background-repeat: repeat;
  background-attachment: fixed;
}

body::after {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(
    ellipse at center,
    transparent 40%,
    rgba(0, 0, 0, 0.45) 100%
  );
  pointer-events: none;
  z-index: 0;
}
```

### Color Tokens

#### Neutrals
```css
--bg:           #080808
--surface:      #0E0E0E
--border-top:   rgba(255, 255, 255, 0.08)
--border-left:  rgba(255, 255, 255, 0.05)
--border-right: rgba(255, 255, 255, 0.03)
--border-bot:   rgba(255, 255, 255, 0.02)
--text-primary: #EDEDEC
--text-muted:   #6B6B6B
--text-axiom:   #EDEDEC
```

#### Gold — Amber Glass
```css
--gold-core:      #D4A843
--gold-mid:       #C9943A
--gold-edge:      #B8832E
--gold-highlight: #E8C56A

--gold-gradient: radial-gradient(
  ellipse at 30% 20%,
  #E8C56A 0%,
  #D4A843 35%,
  #C9943A 65%,
  #B8832E 100%
)

--gold-glow: 0 0 24px rgba(212, 168, 67, 0.12),
             0 0 48px rgba(184, 131, 46, 0.06)
```

#### Red — Garnet Glass
```css
--red-core:      #9B2335
--red-mid:       #7D1A2A
--red-edge:      #5C1020
--red-highlight: #B83348

--red-gradient: radial-gradient(
  ellipse at 30% 20%,
  #B83348 0%,
  #9B2335 35%,
  #7D1A2A 65%,
  #5C1020 100%
)

--red-glow: 0 0 24px rgba(155, 35, 53, 0.15),
            0 0 48px rgba(92, 16, 32, 0.08)
```

#### Pillar Colors — Glass Gradients
No pillar uses a flat color anywhere in the product.
Every pillar color has core, edge, highlight, and glow.

The Money Game — Amber:
```css
--pillar-money-core:      #D4A843
--pillar-money-edge:      #B8832E
--pillar-money-highlight: #E8C56A
--pillar-money-glow:      rgba(212, 168, 67, 0.20)
```

The Human Mind — Amethyst:
```css
--pillar-mind-core:      #9B59B6
--pillar-mind-edge:      #6C3483
--pillar-mind-highlight: #C39BD3
--pillar-mind-glow:      rgba(155, 89, 182, 0.20)
```

How Companies Win — Sapphire:
```css
--pillar-companies-core:      #2E86C1
--pillar-companies-edge:      #1A5276
--pillar-companies-highlight: #7FB3D3
--pillar-companies-glow:      rgba(46, 134, 193, 0.20)
```

What's Coming — Emerald:
```css
--pillar-future-core:      #27AE60
--pillar-future-edge:      #1A7A44
--pillar-future-highlight: #7DCEA0
--pillar-future-glow:      rgba(39, 174, 96, 0.20)
```

Think Sharper — Moonstone:
```css
--pillar-think-core:      #EDEDEC
--pillar-think-edge:      #AAAAAA
--pillar-think-highlight: #FFFFFF
--pillar-think-glow:      rgba(237, 237, 236, 0.15)
```

Move People — Garnet:
```css
--pillar-move-core:      #9B2335
--pillar-move-edge:      #5C1020
--pillar-move-highlight: #B83348
--pillar-move-glow:      rgba(155, 35, 53, 0.20)
```

### Depth Layer System

Layer 0 — The Void:
  Grainy black background with vignette.
  Nothing interactive lives here.

Layer 1 — The Sphere:
  Three.js canvas floating in the void.
  Self-illuminated. No drop shadow —
  the sphere is the light source.

Layer 2 — Glass Surfaces:
  Session UI, cards, text bar, node tap panels.
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              inset 0 1px 0 rgba(255, 255, 255, 0.05)

Layer 3 — Active Elements:
  Highlighted nodes, gold accents, opening read,
  warning text. Always closest to the user.
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.9)
  z-index: always above Layer 2

### Additional Depth Techniques

Radial Vignette:
  CSS radial gradient overlay on root.
  Edges darken 15% toward black.
  Creates perceived light source at screen center.

Surface Micro-Highlights:
  Asymmetric borders simulate light from above.
  Top edge brightest. Bottom edge darkest.
  Applied to every glass component.

Gold Accent Glow:
  Anywhere gold appears — faint radial glow behind it.
  Candlelight intensity. Not neon.
  box-shadow includes gold glow token always.

Ambient Sphere Light:
  Light source above and behind camera.
  Nodes near the top of the sphere are
  very slightly brighter than nodes below.
  Creates genuine depth inside 3D space.

---

## Typography

### Typefaces
Two typefaces only. Nothing else introduced
without explicit instruction.

**Neue Montreal** — UI layer
Used for: navigation, labels, node names, pillar tags,
  buttons, metadata, timestamps, status indicators,
  maturity stage labels, experiment countdowns
Character: refined, neutral, geometric, premium.
  Cold precision. Serious without announcing itself.
Weights: 400 (regular), 500 (medium), 600 (semibold)
Source: Pangram Pangram — licensed, self-hosted

**Canela** — Axiom's voice layer
Used for: every Axiom message, opening read, experiment
  text, warning messages, onboarding questions,
  reapplication question
Character: high-contrast editorial serif. Warm, weighted,
  authoritative. Makes words feel worth reading.
Weights: 300 (light), 400 (regular)
Source: Commercial Type — licensed, self-hosted

### Type Scale
```css
/* Neue Montreal — UI */
--text-xs:   11px / 1.4   /* timestamps, metadata */
--text-sm:   13px / 1.5   /* labels, pillar tags */
--text-base: 15px / 1.6   /* body, buttons */
--text-lg:   17px / 1.5   /* card titles */
--text-xl:   20px / 1.4   /* screen titles */

/* Canela — Axiom voice */
--axiom-sm:  18px / 1.6   /* experiment text */
--axiom-md:  24px / 1.5   /* standard responses */
--axiom-lg:  28px / 1.4   /* opening read */
--axiom-xl:  32px / 1.3   /* onboarding questions */
--axiom-2xl: 40px / 1.2   /* reapplication question */
```

### Type Rules
- Axiom messages: Canela 400, --axiom-md, --text-primary
- User messages: Neue Montreal 400, --text-base, --text-muted
- Onboarding questions: Canela 300, --axiom-xl, centered
- Onboarding answers: Neue Montreal 500, --text-base, left
- Opening read: Canela 300, --axiom-lg, centered, max-width 480px
- Node labels: Neue Montreal 500, --text-xs, pillar color,
  all caps, letter-spacing: 0.08em
- Maturity stage: Neue Montreal 600, --text-sm, --text-muted,
  small caps, letter-spacing: 0.12em
- Warning text: Canela 400, --axiom-md, gold left border
- Reapplication question: Canela 400, --axiom-2xl, centered,
  pure black background, no grain

### Axiom Message Visual Treatment
```css
.axiom-message {
  font-family: 'Canela', serif;
  font-size: var(--axiom-md);
  line-height: 1.5;
  color: var(--text-axiom);
  border-left: 2px solid;
  border-image: var(--gold-gradient) 1;
  padding-left: 20px;
  background: transparent;
  /* No bubble. No background.
     Just text and gold border. */
}
```

User messages: flush right, Neue Montreal, --text-muted.
Visual hierarchy makes Axiom's words feel more considered.

---

## Glass Component System

### Base Glass Token
```css
.glass {
  background: rgba(12, 12, 12, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.02);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              inset 0 1px 0 rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}
```

### Component Variants

#### Session Cards
```css
.card-session {
  background: rgba(12, 12, 12, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.02);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              inset 0 1px 0 rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 20px 24px;
}
```

#### Onboarding Answer Buttons
Sharp edges. No radius. Serious and deliberate.
```css
.btn-onboarding {
  background: rgba(14, 14, 14, 0.65);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.02);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              inset 0 1px 0 rgba(255, 255, 255, 0.05);
  border-radius: 0px;
  padding: 16px 24px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: all 150ms ease;
}

.btn-onboarding:hover {
  background: rgba(18, 18, 18, 0.80);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.btn-onboarding:active {
  background: rgba(8, 8, 8, 0.90);
  transform: scale(0.97);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.8),
              inset 0 1px 0 rgba(255, 255, 255, 0.03);
  transition: all 80ms ease;
}

.btn-onboarding.selected {
  border-top: 1px solid rgba(201, 168, 67, 0.25);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              0 0 24px rgba(212, 168, 67, 0.08),
              inset 0 1px 0 rgba(201, 168, 67, 0.12);
}
```

#### Bottom Text Bar
```css
.text-bar {
  background: rgba(12, 12, 12, 0.80);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.02);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              inset 0 1px 0 rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 14px 18px;
  position: fixed;
  bottom: 24px;
  left: 24px;
  right: 24px;
  font-family: 'Neue Montreal', sans-serif;
  font-size: var(--text-base);
  color: var(--text-primary);
  caret-color: var(--gold-core);
}

.text-bar::placeholder {
  color: var(--text-muted);
}

.text-bar:focus {
  outline: none;
  border-top: 1px solid rgba(201, 168, 67, 0.20);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              0 0 24px rgba(212, 168, 67, 0.06),
              inset 0 1px 0 rgba(201, 168, 67, 0.10);
}
```

#### Node Tap Panel
```css
.node-panel {
  background: rgba(10, 10, 10, 0.75);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  border-bottom: none;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.6),
              inset 0 1px 0 rgba(255, 255, 255, 0.05);
  border-radius: 4px 4px 0 0;
  padding: 24px 28px 40px;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
}
```

#### Warning Overlay
```css
.warning-overlay {
  background: rgba(8, 8, 8, 0.92);
  backdrop-filter: blur(28px) saturate(200%);
  -webkit-backdrop-filter: blur(28px) saturate(200%);
  border-top: 1px solid rgba(155, 35, 53, 0.30);
  border-left: 1px solid rgba(155, 35, 53, 0.15);
  border-right: 1px solid rgba(155, 35, 53, 0.10);
  border-bottom: 1px solid rgba(92, 16, 32, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8),
              0 0 48px rgba(92, 16, 32, 0.08),
              inset 0 1px 0 rgba(155, 35, 53, 0.15);
  border-radius: 0px;
  padding: 32px 36px;
}
```

#### Opening Read Container
```css
.opening-read {
  background: rgba(8, 8, 8, 0.50);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-left: 1px solid rgba(255, 255, 255, 0.04);
  border-right: 1px solid rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.01);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.04);
  border-radius: 4px;
  padding: 28px 36px;
  max-width: 480px;
  text-align: center;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
```

### Active / Gold State Modifier
```css
.glass--gold {
  border-top: 1px solid rgba(212, 168, 67, 0.25);
  border-left: 1px solid rgba(201, 148, 58, 0.15);
  border-right: 1px solid rgba(184, 131, 46, 0.10);
  border-bottom: 1px solid rgba(184, 131, 46, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              0 0 24px rgba(212, 168, 67, 0.08),
              inset 0 1px 0 rgba(232, 197, 106, 0.12);
}
```

### Active Experiment Indicator
```css
.experiment-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--gold-gradient);
  box-shadow: var(--gold-glow);
  animation: standby 3s ease-in-out infinite;
}

@keyframes standby {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50%       { opacity: 1;   transform: scale(1.2); }
}
```

---

## Founder Brain — 3D Sphere & Animation System

### Node Geometry & Material
```javascript
const geometry = new THREE.SphereGeometry(0.12, 64, 64)

const material = new THREE.MeshPhysicalMaterial({
  color: pillarCoreColor,
  emissive: pillarCoreColor,
  emissiveIntensity: 0.15,
  metalness: 0.3,
  roughness: 0.2,
  transmission: 0.1,
  thickness: 0.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.1,
  transparent: true,
  opacity: 1.0,
})

const dimMaterial = material.clone()
dimMaterial.opacity = 0.4
dimMaterial.emissiveIntensity = 0.05
dimMaterial.transmission = 0.05
```

### Scene Lighting
```javascript
const ambient = new THREE.AmbientLight(0xffffff, 0.08)

const keyLight = new THREE.DirectionalLight(0xfff5e0, 0.6)
keyLight.position.set(2, 4, 2)

const rimLight = new THREE.DirectionalLight(0xc0d8ff, 0.3)
rimLight.position.set(-3, -2, -3)

// Per bright node — created dynamically on brighten
const nodeLight = new THREE.PointLight(pillarCoreColor, 0.4, 2.0)
nodeLight.position.copy(node.position)
```

### Sphere Breathing
```javascript
// In animation loop — 4 second cycle
const breathe = (time) => {
  const pulse = Math.sin(time * 0.25) * 0.015
  keyLight.intensity = 0.6 + pulse
  ambient.intensity = 0.08 + (pulse * 0.3)
}
```

### App Open — Return Visit (3.0s tap to ready)
```
0.00s  Grain + vignette appear instantly
       Camera inside sphere
       Node ignition wave 1 — closest nodes to camera

0.20s  Node ignition wave 2 — outer nodes
       Two waves create depth, not loading feel

0.40s  All edges begin drawing simultaneously
       Chronological order of creation

0.80s  Edges complete
       Sphere auto-rotate begins — 1 full rotation
       Sphere breathing active

1.80s  Auto-rotate stops
       Opening read fades in — word by word, 0.6s
       Highlighted nodes begin pulse simultaneously
       Gold beams extend toward highlighted nodes, 0.4s

2.60s  "Start here today" labels fade in
       Bottom text bar slides up — spring settle, 0.4s

3.00s  Everything live
```

### App Open — First Ever Open (cinematic, 3.0s)
Plays once only — on account creation.
```
0.00s  Grain + vignette appear
       Camera outside sphere at z:8
       Nodes ignite simultaneously — full burst
       User sees full brain from outside

1.00s  Camera pulls inward through sphere surface
       cubic-bezier(0.4, 0, 0.2, 1) easing
       Slow start, fast middle, slow arrival

1.80s  Camera arrives inside
       Continues with return visit timeline
```

### Edge Rendering
```javascript
const curve = new THREE.QuadraticBezierCurve3(
  nodeA.position,
  midpoint,        // curves slightly from sphere center
  nodeB.position
)

const tube = new THREE.TubeGeometry(curve, 32, 0.008, 8, false)

const edgeMaterial = new THREE.MeshBasicMaterial({
  color: blendColors(pillarA.core, pillarB.core, 0.5),
  transparent: true,
  opacity: 0.20,
})

// Unread insight — pulsing opacity 0.20 → 0.60 → 0.20
// 2s loop. Stops after user taps the edge.
```

### Node State Transitions

#### New Node — Star Ignition (0.8s)
```javascript
const igniteNode = async (node) => {
  node.scale.set(0.01, 0.01, 0.01)
  node.material.emissiveIntensity = 2.0        // flash
  animateScale(node, 0.01, 1.0, 600, 'easeOutBack')
  animateEmissive(node, 2.0, targetIntensity, 200)
  // UnrealBloomPass active during expansion
}
```

#### Node Brightening — Experiment Completed (1.2s)
```javascript
const brightenNode = async (node) => {
  animateOpacity(node.material, 0.4, 1.0, 400)
  animateEmissive(node.material, 0.05, 0.15, 400)
  animateTransmission(node.material, 0.1, 0.3, 200)
  setTimeout(() =>
    animateTransmission(node.material, 0.3, 0.1, 200), 400)
  animateClearcoat(node.material, 1.0, 1.5, 800)

  // Signal pulse travels outward along edges
  node.edges.forEach(edge => {
    animateEdgePulse(edge, node.position, 400)
  })

  // Point light activates
  const light = new THREE.PointLight(pillarColor, 0, 2.0)
  scene.add(light)
  light.position.copy(node.position)
  animateLightIntensity(light, 0, 0.4, 600)
}
```

### Highlighted Node — Axiom Suggestion
```javascript
// Scale pulse — 1.5s loop
// 1.0 → 1.3 → 1.0

// Gold beam from camera to node
const beam = new THREE.CylinderGeometry(0.004, 0.012, distance, 8)
const beamMaterial = new THREE.MeshBasicMaterial({
  color: 0xD4A843,
  transparent: true,
  opacity: 0.15,
})

// "Start here today" label
// CSS2DRenderer, Neue Montreal 500, 11px
// Gold, all caps, letter-spacing 0.08em
// Fades in 0.3s after beam appears
```

### Node Tap Interaction
```javascript
// 0.00s — tap registers
node.scale.set(0.97, 0.97, 0.97)  // compress, 80ms
// Gold ripple from tap point, fades 0.30s

// 0.08s — snap back to 1.0

// 0.20s — node tap panel slides up
// translateY(100%) → translateY(0), 300ms
// Spring overshoot 6px, settles 100ms

// Second tap / "Begin session":
// Panel slides down 200ms
// Sphere scales to 30%, moves to top-left, blurs, 400ms
// Session interface slides up from below, 400ms
// Axiom first message streams immediately
```

### Session Interface — Sphere State
```javascript
// During session
sphere.scale = 0.30
sphere.position = topLeftCorner
sphereCanvas.style.filter = 'blur(8px)'
// Still breathing. Still visible. Never hidden.

// On session close
// Sphere expands back — 400ms
// Blur lifts — 400ms
// New nodes ignite if created
// New edges draw if created
```

### LOD — Performance
```javascript
// Within 3 units — full detail
// SphereGeometry(0.12, 64, 64), MeshPhysicalMaterial

// 3 to 6 units — simplified
// SphereGeometry(0.10, 16, 16), MeshStandardMaterial

// Beyond 6 units — point
// THREE.Points, PointsMaterial, size: 0.04

// Labels — visible within 3 units or when highlighted
// Edges — only rendered when both nodes within 5 units

// Target: 60fps at 500 nodes on mid-range hardware
```

### Post-Processing Stack
```javascript
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

const bloom = new UnrealBloomPass(
  new THREE.Vector2(width, height),
  0.4,   // strength
  0.3,   // radius
  0.85   // threshold
)
composer.addPass(bloom)

const fxaa = new ShaderPass(FXAAShader)
fxaa.uniforms.resolution.value.set(1/width, 1/height)
composer.addPass(fxaa)

const vignette = new ShaderPass(VignetteShader)
vignette.uniforms.offset.value = 0.85
vignette.uniforms.darkness.value = 1.4
composer.addPass(vignette)
```

### Shareable Brain Snapshot
```javascript
const offscreen = new THREE.WebGLRenderer({
  preserveDrawingBuffer: true,
  antialias: true,
})
offscreen.setSize(1200, 1200)
offscreen.setPixelRatio(2)  // retina

// Camera slightly outside sphere — z:7
// Slight angle — y:0.3, more dynamic than straight on
offscreen.render(scene, snapshotCamera)

offscreen.domElement.toBlob(async (blob) => {
  // POST to FastAPI /brain/snapshot
  // Upload to Supabase Storage
  // Return public URL
}, 'image/png', 1.0)
```

### Animation Speed Reference
| Interaction | Duration | Easing |
|---|---|---|
| Grain + vignette appear | instant | — |
| Node ignition wave 1 | 0ms | — |
| Node ignition wave 2 | 200ms offset | — |
| Node ignition expand | 600ms | easeOutBack |
| Node ignition settle | 200ms | easeInOut |
| Edge draw | 400ms | linear |
| Auto-rotate phase | 1000ms | — |
| Opening read fade | 600ms | easeOut |
| Highlight beam extend | 400ms | easeOut |
| Label fade in | 200ms | easeOut |
| Text bar slide up | 400ms | spring |
| Node press compress | 80ms | linear |
| Gold ripple | 300ms | easeOut |
| Node tap panel slide up | 300ms | cubicBezier |
| Panel spring settle | 100ms | spring |
| Session slide up | 400ms | cubicBezier |
| Sphere shrink to corner | 400ms | cubicBezier |
| Sphere expand on close | 400ms | cubicBezier |
| Node brighten total | 1200ms | — |
| New node ignition total | 800ms | — |
| Edge pulse loop | 2000ms | easeInOut |
| Sphere breathing cycle | 4000ms | sine |
| Glass hover | 150ms | easeOut |
| Glass press | 80ms | linear |
| Glass press release | 150ms | easeOut |

---

## Screen Layouts & Interaction Rules

### Screen 1 — Founder Brain (Home)
- Three.js canvas: full screen, z-index 0
- Grain + vignette: full screen, z-index 1,
  pointer-events: none
- Opening read container: centered, z-index 2,
  max-width 480px, appears at 1.80s
- Bottom text bar: fixed, bottom 24px,
  left 24px, right 24px, z-index 3
- Maturity stage: fixed, bottom 28px, right 28px,
  z-index 3, Neue Montreal 600, 11px, --text-muted,
  small caps, letter-spacing 0.12em
- Pillar legend: fixed, top 24px, left 24px,
  z-index 3 — 6 colored dots with pillar names,
  Neue Montreal 400, 11px, --text-muted
  Appears only after 3s of inactivity on home screen

No navigation bar. No header. No logo.
The sphere is the entire screen.

### Screen 2 — Onboarding
- Background: #080808, grain, vignette
- Question: Canela 300, --axiom-xl, centered,
  floats directly on void — no glass container
- Answer buttons: stacked, 12px gap, full width,
  glass, 0px radius, left-aligned
- Progress: top right, fixed, "4 / 10",
  Neue Montreal 400, 11px, --text-muted
  Never a progress bar.
- No back button — Axiom doesn't let you redo
  first impressions

Question transitions:
- Current question: slides left + fades out, 200ms
- Next question: slides in from right, 200ms, 50ms delay
- Selected answer: gold glass state instantly,
  200ms pause, then transition fires
  The pause lets the choice land.

### Screen 3 — Session Interface
- Sphere: 30% scale, top-left corner,
  blur(8px), still breathing
- Session surface: glass card, fills remaining screen,
  bottom 0, left 0, right 0,
  top: sphere bottom + 16px,
  border-radius: 4px 4px 0 0
- Message list: scrollable, padding 24px
- Axiom messages: Canela 400, --axiom-md,
  gold left border 2px gradient, padding-left 20px,
  no bubble, no background
- User messages: Neue Montreal 400, --text-base,
  --text-muted, right-aligned, no bubble
- Input: glass, fixed to session surface bottom,
  4px radius, caret gold
- Close: X appears top-right after 2s inactivity,
  fades in 300ms, Neue Montreal 400, --text-muted

No navigation during session. Ever.

### Screen 4 — Node Tap Panel
- Panel: fixed, bottom 0, left 0, right 0,
  glass, border-radius 4px 4px 0 0,
  padding 24px 28px 40px
- Drag handle: centered top, 32×4px,
  rgba(255,255,255,0.15), border-radius 2px
- Pillar tag: Neue Montreal 500, 11px,
  pillar color, all caps, letter-spacing 0.08em
- Node label: Neue Montreal 600, 20px, --text-primary
- Insight text: Canela 400, --axiom-sm, --text-primary
- Begin session: full width, glass--gold, 0px radius,
  Neue Montreal 500, 15px, centered
- Dismiss: swipe down or tap outside
- Max height: 65vh, scrollable if overflow

### Screen 5 — Warning Screen
Replaces opening read. User must dismiss
before accessing home screen.

- Full screen overlay, z-index 10
- Background: rgba(0,0,0,0.96)
- Container: centered, max-width 480px,
  glass, 0px radius, garnet borders and glow,
  padding 40px
- Warning label: Neue Montreal 600, 11px,
  --red-highlight, all caps, letter-spacing 0.12em
  "WARNING 1" or "WARNING 2"
- Warning text: Canela 400, --axiom-md, --text-primary
- Dismiss: Neue Montreal 500, 13px, --text-muted,
  margin-top 32px, text: "I understand"
  No glass. No border. Just text.
  Tapping it feels like accepting a consequence.

### Screen 6 — Reapplication
Pure black. No grain. No glass. No warmth.
This is a judgment. It should feel like one.

- Background: #000000 — absolute black, no texture
- All content: centered vertically and horizontally
- Removal notice: Neue Montreal 400, 13px,
  --text-muted, margin-bottom 40px
- Removal reason: Canela 400, --axiom-sm,
  --text-primary, margin-bottom 60px
  Exact logged reason. No softening.
- Question: Canela 400, --axiom-2xl, centered,
  max-width 560px, margin-bottom 48px
  "Tell us 3 things you did in the last
  3 months to overcome that."
- Input: full width, max-width 560px,
  background: transparent,
  border: none,
  border-bottom: 1px solid rgba(255,255,255,0.12),
  border-radius: 0,
  Canela 400, --axiom-sm, --text-primary,
  padding: 16px 0, min-height 160px,
  caret: rgba(255,255,255,0.4)
- Submit: Neue Montreal 500, 13px, --text-muted,
  margin-top 32px, text: "Submit"
  Nothing more. No encouragement. No promise.
- No back. No cancel. No escape.

### Spacing System
```css
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-7:  28px
--space-8:  32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
/* Base unit: 4px grid. All spacing is a multiple of 4. */
```

### Responsive Breakpoints
```css
--bp-sm:  390px    /* iPhone 14 base */
--bp-md:  768px    /* tablet */
--bp-lg:  1024px   /* small desktop */
--bp-xl:  1440px   /* large desktop */

/* Sphere always fills full screen at all breakpoints */

/* Session surface on desktop */
/* max-width: 680px, centered */
/* Sphere recedes behind it on both sides */

/* Onboarding container */
/* mobile:  calc(100vw - 48px) */
/* desktop: 560px */
```

### Sound Design (Off By Default)
User opts in via settings. Remembered across sessions.
Generated via Web Audio API — no audio files.
Maximum volume: 15% of system volume.

| Event | Frequency | Decay |
|---|---|---|
| Node ignition | 220hz | 0.3s |
| Node brightening | 440+554hz chord | 0.8s |
| New edge forming | 110hz | 0.6s |
| Warning delivered | 80hz pulse | 1.2s |
| Session close | descending tone | 0.4s |
| Onboarding answer | 800hz click | 0.1s |

### Haptics (Native — v2)
Document now. Implement on native conversion.
Uses Apple Taptic Engine via React Native Haptics.

| Event | Haptic Type |
|---|---|
| Node tap | UIImpactFeedbackGenerator.light |
| Node brighten | UIImpactFeedbackGenerator.medium × 2, 100ms gap |
| Warning delivered | UINotificationFeedbackGenerator.warning |
| Onboarding answer | UIImpactFeedbackGenerator.light |
| Session close | UIImpactFeedbackGenerator.soft |

---

## Design Rules & Component Checklist

### The 10 Non-Negotiables

1. Every surface is glass — no flat backgrounds
   on any interactive component. Ever.

2. Gold appears in exactly four places: Axiom's name,
   highlighted nodes, active experiments, warning states.
   Nowhere else. Every additional use dilutes its meaning.

3. Axiom's messages are always Canela.
   User messages are always Neue Montreal.
   The visual distinction is never collapsed.

4. The sphere is never replaced with a flat UI.
   At any screen, any breakpoint, any loading state.
   If sphere isn't ready, grain and vignette hold.

5. No tooltips. No empty state illustrations.
   No onboarding overlays. No hand-holding copy.
   The product assumes intelligence.

6. No flat colors. Gold is amber glass. Red is garnet
   glass. Every pillar color has core, edge, highlight,
   and glow. No hex appears as a single flat fill.

7. Sound is always off by default. Never plays without
   explicit opt-in. Never above 15% system volume.

8. The reapplication screen is always pure black.
   No grain. No glass. No warmth. No exceptions.

9. Animation timing follows the speed reference table
   exactly. UI under 200ms. Sphere 400-800ms.

10. Density over whitespace. If an element doesn't
    earn its place, it gets removed.

### Before Shipping Any Component — Checklist

Visual:
- [ ] Surface uses glass token — not flat color
- [ ] Border follows asymmetric light model
- [ ] Inner highlight present (inset box-shadow)
- [ ] Drop shadow present (outer box-shadow)
- [ ] Gold or red uses gradient — not flat hex
- [ ] Grain visible through glass where applicable
- [ ] Correct border-radius for component type

Typography:
- [ ] Axiom voice: Canela — correct weight and size
- [ ] UI elements: Neue Montreal — correct weight
- [ ] No unintentional typeface mixing
- [ ] Letter-spacing on all caps (minimum 0.08em)

Animation:
- [ ] UI interaction: under 200ms
- [ ] Sphere transition: 400-800ms
- [ ] Correct easing applied
- [ ] No frame drops on mid-range hardware
- [ ] Spring animations have correct overshoot

Interaction:
- [ ] Hover state defined
- [ ] Active/pressed state defined (scale 0.97)
- [ ] Gold glass state defined for active elements
- [ ] Disabled state: opacity 0.4, pointer-events none
- [ ] Touch target minimum 44×44px

Accessibility:
- [ ] Color contrast meets WCAG AA (4.5:1 minimum)
- [ ] Focus states: gold outline 2px solid
      rgba(212,168,67,0.6)
- [ ] No interaction relies on color alone
- [ ] All images have alt text
- [ ] Sphere has ARIA label for screen readers

Performance:
- [ ] No new Three.js geometries in animation loop
- [ ] Textures disposed on unmount
- [ ] Event listeners removed on unmount
- [ ] No memory leaks in animation loops
- [ ] backdrop-filter has -webkit- prefix (Safari)

### Things That Will Make It Look Cheap
- Flat dark backgrounds on any interactive element
- White or grey borders at full opacity
- Neon glows — gold is candlelight, not RGB gaming
- Progress bars anywhere in the product
- Rounded corners beyond 4px on session elements
- Any illustration, icon set, or stock imagery
- Sans-serif for Axiom's voice — even once
- Emoji anywhere — including warnings and experiments
- Linear gradients top to bottom — Axiom uses radial
- Box shadows lighter than rgba(0,0,0,0.6)
- Transitions faster than 80ms on glass components
- Sphere at full size and opacity during a session

### Figma Component Naming
[Layer]/[Component]/[Variant]

Glass/Card/Default
Glass/Card/Gold
Glass/Button/Onboarding-Default
Glass/Button/Onboarding-Selected
Glass/Button/Onboarding-Hover
Glass/TextBar/Default
Glass/TextBar/Focus
Glass/Panel/NodeTap
Glass/Overlay/Warning-1
Glass/Overlay/Warning-2
Glass/Overlay/Reapplication
Type/Axiom/SM
Type/Axiom/MD
Type/Axiom/LG
Type/Axiom/XL
Type/UI/Base
Type/UI/SM
Type/UI/Label
Sphere/Node/Dim
Sphere/Node/Bright
Sphere/Node/Highlighted
Sphere/Edge/Default
Sphere/Edge/Unread
Sphere/Edge/Gold

### File Structure (Frontend)
```
/components
  /glass          — all glass UI components
  /sphere         — Three.js sphere components
  /session        — session interface components
  /onboarding     — onboarding flow components
  /overlays       — warning, reapplication screens
/styles
  /tokens.css     — all CSS custom properties
  /glass.css      — glass component base styles
  /typography.css — type scale and rules
  /animations.css — all keyframe animations
/textures
  /grain.png      — 200×200px noise texture
/lib
  /three          — Three.js scene setup and utils
  /animations     — tween functions and helpers
```
