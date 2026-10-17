'use strict';
// The chromosome: 27 genes, each stored 0..1 and scaled to a real quantity in simlet.js.

const GENES = [
  { key: 'size', group: 'Body', label: 'Size',
    tip: 'Body size. Bigger = more energy storage and stronger in fights, but drains energy faster (in proportion to mass), is easier to spot, matures later, and its children cost more to build.' },
  { key: 'speed', group: 'Body', label: 'Max speed',
    tip: 'Top walking speed. Movement cost scales with mass × speed², so being fast is expensive. Sprinting multiplies this speed by the sprint slider.' },
  { key: 'camo', group: 'Body', label: 'Camouflage',
    tip: 'Chance of going unseen by others. Only works when still: it fades to nothing as speed rises. Forest adds a boost; big bodies show more. Cost: shrinks own vision range by up to 40%.' },
  { key: 'diet', group: 'Body', label: 'Diet (meat)',
    tip: '0 = plants only, 1 = meat only. Plants are digested at (1 − diet) efficiency and meat at (diet), so specialists beat generalists at their own food.' },
  { key: 'lifespan', group: 'Body', label: 'Lifespan',
    tip: 'Maximum age, 5,000 to 20,000 ticks. A longer life raises idle energy drain by up to 50%.' },
  { key: 'fov', group: 'Senses', label: 'FOV width',
    tip: 'Width of the vision cone, 45° to 342°. Every simlet sees the same total area; this gene only reshapes it. Narrow = long and sharp straight ahead (about 22 tiles, sees through camouflage). Wide = all-round but short (about 8 tiles) and blurry, so camouflaged simlets slip past.' },
  { key: 'smell', group: 'Senses', label: 'Smell',
    tip: 'Sensitivity of the nose. Plant-eaters leave fading scent trails; a better nose detects fainter, older trails and can follow them (the TRACK action, mostly used by hungry meat-eaters). Cost: a little extra idle drain.' },
  { key: 'memory', group: 'Senses', label: 'Memory',
    tip: 'How many food spots it remembers (1 to 5) and for how long. Lets it return to food it saw earlier. Costs a little idle energy (brains are expensive).' },
  { key: 'wander', group: 'Movement', label: 'Wander',
    tip: 'Urge to explore when nothing more pressing is going on, and how fast it roams. Low = sits still and waits.' },
  { key: 'sprint', group: 'Movement', label: 'Sprint urge',
    tip: 'Chance of sprinting when fleeing, or when closing on prey within 6 tiles. Faster but far costlier (cost rises with speed²). Sprinting predators can pounce from further away.' },
  { key: 'stamina', group: 'Movement', label: 'Stamina',
    tip: 'Size of the sprint meter (40 to 300 ticks of sprinting) and how fast it refills (faster when resting). An empty meter means no sprinting until it is 30% full again. Cost: muscle upkeep raises idle drain by up to 30%.' },
  { key: 'waterAversion', group: 'Movement', label: 'Water aversion',
    tip: 'How strongly it steers away from water ahead. High avoids costly swims but can trap it behind rivers.' },
  { key: 'rest', group: 'Movement', label: 'Rest',
    tip: 'Tendency to stop and save energy (idle drain drops to 40%). Stronger at night and when nothing is in view. Resting keeps camouflage intact.' },
  { key: 'hunger', group: 'Feeding', label: 'Hunger thresh.',
    tip: 'Energy level (25% to 90%) below which finding food becomes urgent. Above it, food is only eaten when nothing else matters more.' },
  { key: 'thrift', group: 'Feeding', label: 'Thrift',
    tip: 'How strongly it saves the family food store for later. Thrifty simlets eat wild food first and only draw on the store when there is none about or they are close to starving. 0 = eats from the store whenever hungry.' },
  { key: 'scavenge', group: 'Feeding', label: 'Scavenge',
    tip: 'Preference for corpses over other food. Makes carrion more attractive; it does not change how well meat is digested.' },
  { key: 'flee', group: 'Social', label: 'Flee',
    tip: 'Urge to run from a visible simlet: flee gene × how genetically different it is × how big it is relative to me × how much of a meat-eater it is (plant-eaters are barely scary).' },
  { key: 'aggression', group: 'Social', label: 'Aggression',
    tip: 'Urge to attack genetically different simlets, stronger against smaller ones and against plant-eaters (other meat-eaters are risky, unattractive prey). Hungry meat-eaters also hunt regardless. Attacks cost energy and can fail.' },
  { key: 'kinPull', group: 'Social', label: 'Kin pull',
    tip: 'Attraction towards genetically similar simlets, which forms groups. Groups share warnings and donations, but crowds compete for food.' },
  { key: 'donation', group: 'Social', label: 'Donation',
    tip: 'Chance to give 15% of its own energy to a nearby starving relative (80% arrives), but only when it is above 60% energy itself.' },
  { key: 'alarm', group: 'Social', label: 'Alarm',
    tip: 'Chance, when fleeing, to warn relatives within 12 tiles. Costs energy and drops its own camouflage to zero for a while, so the caller often becomes the target.' },
  { key: 'farming', group: 'Social', label: 'Farming',
    tip: 'Tendency to spend energy planting food on fertile land or grassland (better yield on fertile). The crop takes 300 ticks to grow, keeps longer than wild food, and anyone can eat it. Farmers remember their field and drift back to it (stronger with this gene); children inherit the family field.' },
  { key: 'building', group: 'Social', label: 'Building',
    tip: 'Tendency to build and extend family shelters (paid in energy and time). Relatives join an unfinished or growable shelter before starting a new one. Inside a shelter: very low energy drain, no winter cold, hidden from predators; it also stores nearby crops.' },
  { key: 'breedThreshold', group: 'Breeding', label: 'Breed thresh.',
    tip: 'Energy level (35% to 95%) it must reach before seeking a mate. High = breeds less often but gives each litter more energy.' },
  { key: 'broodSize', group: 'Breeding', label: 'Brood size',
    tip: 'Maximum litter size, 1 to 6. The parents\' energy is split across the litter, so big litters mean weak young. The litter shrinks if the energy can\'t build that many bodies.' },
  { key: 'sexuality', group: 'Breeding', label: 'Sexuality',
    tip: 'Chance each breeding is sexual rather than asexual. Sexual: needs a compatible mate, partners share the cost, and the child mixes both genomes. Asexual: no mate needed, the parent pays the whole cost, and the child is a mutated clone. If no mate turns up within 300 ticks, it breeds asexually anyway.' },
  { key: 'choosiness', group: 'Breeding', label: 'Choosiness',
    tip: 'How genetically similar a mate must be (30% to 95%). Picky simlets find fewer mates, but pickiness is what lets populations split into separate species.' },
];
const NG = GENES.length;
const G = {};                      // gene key -> index, e.g. g[G.size]
GENES.forEach((gene, i) => { G[gene.key] = i; });

function randomGenome() {
  const g = new Float32Array(NG);
  for (let i = 0; i < NG; i++) g[i] = Math.random();
  return g;
}

function mutateGenome(src, rate, size) {
  const g = new Float32Array(src);
  for (let i = 0; i < NG; i++) if (Math.random() < rate) g[i] = clamp(g[i] + gauss() * size, 0, 1);
  return g;
}

// Uniform crossover: each gene comes from either parent with equal chance
function crossover(a, b) {
  const g = new Float32Array(NG);
  for (let i = 0; i < NG; i++) g[i] = Math.random() < 0.5 ? a[i] : b[i];
  return g;
}

// Whole-genome similarity: 1 = identical, ~0.1 = two random genomes (RMS gene distance ≈ 0.41)
function similarity(a, b) {
  let s = 0;
  for (let i = 0; i < NG; i++) { const d = a[i] - b[i]; s += d * d; }
  return clamp(1 - Math.sqrt(s / NG) / 0.45, 0, 1);
}

// Colour from genome: project onto two fixed pseudo-random axes -> hue angle.
// Similar genomes land on similar hues, so relatives look alike.
const COLOR_AXES = (() => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const a = [], b = [];
  for (let i = 0; i < NG; i++) { a.push(rnd()); b.push(rnd()); }
  return [a, b];
})();
function genomeHue(g, axes) {
  let x = 0, y = 0;
  for (let i = 0; i < NG; i++) { const v = g[i] - 0.5; x += v * axes[0][i]; y += v * axes[1][i]; }
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function genomeColor(g) { return `hsl(${genomeHue(g, COLOR_AXES).toFixed(0)},70%,62%)`; }

// Looks (display only): markings and body proportions from the genome, so relatives look alike and a lineage
// changes pattern only when it drifts a long way. Pattern = a sector of a second fixed projection; marking colour
// = a dark shade of the lineage hue; body stretched by speed (fast = long and slim); outline weight from aggression.
const PATTERNS = ['plain', 'spots', 'stripes', 'mask', 'spine'];
const PATTERN_AXES = (() => {
  let seed = 54321;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const a = [], b = [];
  for (let i = 0; i < NG; i++) { a.push(rnd()); b.push(rnd()); }
  return [a, b];
})();
function genomeLook(g) {
  const len = 0.85 + 0.4 * g[G.speed];
  return {
    pattern: PATTERNS[Math.floor(genomeHue(g, PATTERN_AXES) / 360 * PATTERNS.length)],
    mark: `hsl(${genomeHue(g, COLOR_AXES).toFixed(0)},55%,24%)`,
    len, wid: 1 / Math.sqrt(len),
    edge: 0.6 + 1.6 * g[G.aggression],
  };
}
