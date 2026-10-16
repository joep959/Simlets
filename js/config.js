'use strict';
// Fixed world constants and the tunable parameters shown as sliders in the UI.

const WORLD_W = 200, WORLD_H = 125;   // map size in tiles; all positions are in tile units

const TERRAIN = { GRASS: 0, FERTILE: 1, FOREST: 2, WATER: 3 };
const TERRAIN_INFO = [
  { name: 'Grassland', color: '#d6cf98' },
  { name: 'Fertile',   color: '#6aa84f' },
  { name: 'Forest',    color: '#3d6b45' },
  { name: 'Water',     color: '#4a86c0' },
];

// Fixed behaviour constants (not worth a slider yet)
const THINK_INTERVAL = 5;     // ticks between decisions
const MATURE_AGE = 600;       // ticks before a simlet can breed
const BREED_COOLDOWN = 400;
const MATE_WAIT = 300;        // ticks a sexual breeder searches for a mate before falling back to asexual
const ATTACK_COOLDOWN = 30;
const FARM_GROW_TIME = 300;   // ticks before farmed food is edible
const CORPSE_ROT = 1500;      // ticks for a corpse to fully decay
const MEAT_BITE = 2;          // energy per tick taken from a corpse (meat is quick to eat)
const SOIL_MIN = 0.3;          // soil nutrients below this = dormant: no farming, no wild growth
const SOIL_PER_ENERGY = 0.02;  // nutrients returned to the soil per unit of energy that rots there
const VISION_AREA = 200;      // tiles² every simlet can see; the FOV gene only reshapes it (wide+short vs narrow+long)

// [section, key, label, min, max, step, default]
const PARAM_DEFS = [
  ['Evolution',  'mutationRate',     'Mutation rate (per gene)',        0,    0.5,  0.01,  0.06],
  ['Evolution',  'mutationSize',     'Mutation size (σ)',               0,    0.3,  0.01,  0.08],
  ['Evolution',  'speciesThreshold', 'Species similarity threshold',    0.4,  0.95, 0.01,  0.7],
  ['Evolution',  'brainMutSize',     'Brain mutation size (hybrid)',    0,    1,    0.01,  0.2],
  ['Food',       'fertileSpawn',     'Fertile spawn ‰ /tile/tick',      0,    5,    0.05,  1.5],
  ['Food',       'grassSpawn',       'Grassland spawn ‰ /tile/tick',    0,    1,    0.01,  0.2],
  ['Food',       'bustFactor',       'Bust food multiplier',            0,    1,    0.01,  0.25],
  ['Food',       'plantEnergy',      'Plant food energy',               1,    30,   1,     10],
  ['Food',       'rotTime',          'Plant rot time (ticks)',          200,  6000, 100,   2000],
  ['Food',       'plantBite',        'Plant eating speed (energy/tick)', 0.1,  3,    0.1,   0.5],
  ['Food',       'cropKeep',         'Crop storage (rot time ×)',       1,    10,   0.5,   4],
  ['Food',       'soilRecovery',     'Soil recovery time (ticks)',      500,  20000, 250,  4000],
  ['Food',       'forestSpawn',      'Forest spawn ‰ /tile/tick',       0,    1,    0.01,  0.1],
  ['Food',       'tileCap',          'Max wild food per tile',          1,    6,    1,     2],
  ['Time',       'seasonLength',     'Season length (ticks)',           500,  10000,100,   3000],
  ['Time',       'dayLength',        'Day length (ticks)',              200,  4000, 50,    1000],
  ['Food',       'scentFade',        'Scent half-life (ticks)',         50,   3000, 50,    600],
  ['Winter',     'iceReach',         'Ice reach (tiles from shore)',    0,    10,   0.5,   3],
  ['Winter',     'winterCold',       'Winter cold (extra idle drain)',  0,    1,    0.05,  0.5],
  ['Winter',     'forestShelter',    'Forest shelter from cold',        0,    1,    0.05,  0.7],
  ['Costs',      'idleCost',         'Idle drain',                      0,    0.1,  0.002, 0.015],
  ['Costs',      'moveCost',         'Movement cost',                   0,    0.2,  0.005, 0.02],
  ['Costs',      'sprintMult',       'Sprint speed ×',                  1,    3,    0.1,   1.8],
  ['Costs',      'waterCost',        'Water movement cost ×',           1,    15,   0.5,   6],
  ['Costs',      'attackCost',       'Attack cost',                     0,    10,   0.5,   2],
  ['Costs',      'bodyCost',         'Body energy (per unit mass)',     1,    20,   0.5,   5],
  ['Costs',      'breedCost',        'Breeding overhead',               0,    30,   1,     6],
  ['Costs',      'farmCost',         'Farming cost',                    1,    40,   1,     8],
  ['Costs',      'farmYieldFertile', 'Farm yield on fertile ×',         0,    4,    0.1,   2.0],
  ['Costs',      'farmYieldGrass',   'Farm yield on grassland ×',       0,    4,    0.1,   1.4],
  ['Immigration', 'immigration',     'New tribe every N ticks (0 = off)', 0,   20000, 500,  0],
  ['Population', 'tribes',           'Starting tribes',                 1,    20,   1,     8],
  ['Population', 'tribeSize',        'Simlets per tribe',               2,    60,   1,     20],
  ['Population', 'maxPop',           'Population cap',                  100,  3000, 50,    1500],
];

// Hover explanations for the sliders
const PARAM_TIPS = {
  mutationRate: 'Chance that each gene mutates when a child is made. Higher = faster evolution, but more badly broken offspring.',
  mutationSize: 'How big a mutation is: the spread of the random nudge, on the 0 to 1 gene scale.',
  speciesThreshold: 'Two simlets count as the same species if their genomes are at least this similar (to the species representative). Lower = fewer, broader species; higher = more, finer species. Display only: it does not change who can mate.',
  brainMutSize: 'How far a brain weight moves when it mutates (Hybrid brain mode only). Uses the same per-weight chance as the Mutation rate slider. Bigger = faster but more erratic learning.',
  fertileSpawn: 'Chance per fertile tile per tick (in thousandths) that a wild plant appears, in boom season.',
  grassSpawn: 'Same as above, for grassland. Set to 0 and grassland only produces food by farming.',
  bustFactor: 'Food growth during bust as a fraction of boom. 0.25 = bust grows a quarter as much.',
  plantEnergy: 'Energy in one wild plant. Farmed crops are split into items of roughly this size.',
  rotTime: 'Ticks before an uneaten plant rots away. Stops boom-season food piling up to carry everyone through the bust.',
  plantBite: 'Handling time for plants: energy taken per tick while eating one. Low = plants are slow, poor-quality food, so herbivores spend long spells standing still eating. Meat is always eaten at 2 per tick.',
  cropKeep: 'Farmed crops last this many times longer than wild plants before rotting, like a granary. Lets a boom-season harvest carry a family through the bust.',
  soilRecovery: 'Ticks for exhausted fertile soil to fully recover (grassland takes twice as long). Farming uses up the nutrients of the tiles it plants; until a tile recovers past 30% it is dormant: no crops, no wild food. Rotting corpses and food put nutrients back.',
  forestSpawn: 'Chance per forest tile per tick (in thousandths) that a wild plant appears. Unlike fertile land and grassland, forest food is NOT reduced in bust: low but steady all year.',
  scentFade: 'Plant-eaters leave a scent trail on the tiles they walk; this is how long it takes to fade to half strength. Longer = older trails stay followable, so predators find herds from further away.',
  iceReach: 'How far ice grows out from the shore at the depth of a bust (in tiles). Narrow rivers freeze right across and become bridges; wide lakes only freeze at the edges. Ice thaws as the bust ends. 0 = water never freezes.',
  winterCold: 'Extra idle energy drain during bust, as a fraction (0.5 = +50%). Makes winter itself harsh, not just food-poor.',
  forestShelter: 'How much of the winter cold a simlet escapes while in forest (0.7 = 70% less cold).',
  tileCap: 'Maximum wild plants on one tile. Farmed crops may stack 2 higher.',
  seasonLength: 'Ticks per season. A full boom + bust cycle is twice this.',
  dayLength: 'Ticks per day-night cycle. Night cuts vision range by 40% and makes resting more attractive.',
  idleCost: 'Energy drained every tick just to stay alive. Scaled by mass, and raised by the lifespan and memory genes.',
  moveCost: 'Energy per tick for moving = this × mass × (speed / 0.1)². Water multiplies it.',
  sprintMult: 'Sprint speed as a multiple of top speed. Cost rises with the square: 1.8× speed costs about 3.2×.',
  waterCost: 'Movement cost multiplier while in water. Speed is also halved in water.',
  attackCost: 'Energy an attacker spends per attack (bigger attackers pay more). A target that survives loses half this.',
  bodyCost: 'Energy stored in a body per unit of mass. Building a child costs this much, and 90% of it comes back as meat when the body dies. Higher = babies are dearer for everyone, but corpses and prey are richer meals.',
  breedCost: 'Overhead of breeding, lost on top of the energy given to the children. The initiator pays it in full, the mate pays half.',
  farmCost: 'Energy a simlet spends each time it farms.',
  farmYieldFertile: 'Crop energy produced per unit of farming energy on fertile land. Above 1 = farming is a net gain, if the farmer gets to eat the crop.',
  farmYieldGrass: 'Same as above, on grassland.',
  immigration: 'Trickle of newcomers: every N ticks a brand-new random tribe lands somewhere on dry land. 0 = off. Newcomers are genetically foreign, so they cannot interbreed with the locals at first.',
  tribes: 'Number of founder groups dropped in when you Run a fresh map or Restart. Each tribe gets its own random genome.',
  tribeSize: 'Simlets per founder group, all close relatives of their founder. Also used for air-drops and immigrants.',
  maxPop: 'Hard population cap: at the cap, breeding is blocked. Keeps the browser responsive.',
};

const P = {};
for (const d of PARAM_DEFS) P[d[1]] = d[6];

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function gauss() {   // standard normal (Box-Muller)
  let u = 0; while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
