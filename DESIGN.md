# Simlets: design and mechanics

How the model actually works, with the real formulas from the code. Units: positions in **tiles**, time in **ticks**, energy in arbitrary units. The map is 200 × 125 tiles.

## 1. The core idea

There is **no fitness function**. Selection happens on its own: energy comes only from food, everything costs energy, zero energy means death, and breeding needs spare energy plus (usually) a mate. Behaviour is **hard-coded rules weighted by genes** (v1). Evolution tunes the weights; it does not invent new rules.

## 2. The tick loop (`Sim.step`)

1. Spawn wild food (fertile and grassland tiles, scaled by season).
2. Every 25 ticks: rot plants and decay corpses.
3. Immigration check (if the slider is on).
4. Rebuild the spatial grid (10-tile cells) for neighbour queries.
5. For each simlet: age it, tick its timers, **think** (every 5 ticks or when flagged), **act** (every tick), check for death.
6. Remove the dead (they become corpses) and add the newborns.
7. Every 50 ticks: recluster species. At each history interval: record stats for the charts.

## 3. Body (derived from genes, `Simlet.derive`)

| Quantity | Formula |
|---|---|
| Mass | 0.5 + 2.5·size |
| Radius | 0.35 + 0.75·size tiles |
| Max energy | 40·mass |
| Top speed | 0.04 + 0.14·speed tiles/tick; sprint = × `sprintMult` (1.8) |
| FOV angle | (0.25 + 1.65·fov)·π (45°–342°) |
| Vision range | **Fixed vision budget:** √(2·VISION_AREA / angle) · (1 − 0.4·camo), with VISION_AREA = 200 tiles² (≈22.6 tiles at 45°, ≈8.2 at 342°); ×0.6 at night; ×0.6 inside forest |
| Acuity | 1 − 0.7·fov |
| Max age | 5,000 + 15,000·lifespan |
| Idle drain multiplier | mass·(1 + 0.5·lifespan)·(1 + 0.3·stamina) + 0.3·memory |
| Sprint meter | 40 + 260·stamina ticks; refills 0.3 + 0.7·stamina per tick (×2 resting); empty = no sprint until 30% full |
| Mature age | 600·(0.6 + 0.8·size) |
| Breeds above | 35%–95% energy (breedThreshold) |
| Hungry below | 25%–90% energy (hunger) |
| Max litter | 1 + round(5·broodSize) |
| Min mate similarity | 0.3 + 0.65·choosiness |
| Digestion | plants (1 − diet), meat (diet) |

## 4. Energy

- **Idle:** `idleCost · drainMult` per tick, ×0.4 while resting or farming.
- **Movement:** `moveCost · mass · (v / 0.1)²` per tick, × `waterCost` in water (where speed is also halved).
- **Eating:** a simlet takes `plantBite` (default 0.5) energy per tick from a plant and `MEAT_BITE` (2) per tick from a corpse, multiplied by its digestion efficiency. Energy is capped at max.
- **Attack:** costs `attackCost · mass^0.75`. A target that survives loses `attackCost · 0.5`.
- **Breeding:** see section 8. **Farming:** `farmCost`. **Alarm:** 2·mass^0.75.
- **Conservation rule:** a corpse holds `BODY_COST(5)·mass·0.9 + 0.8·remaining energy`, and building a child's body costs `BODY_COST·mass`. So a corpse never holds more energy than went into making it. Keep this property when changing anything.

## 5. Perception (`think`, sensing part)

- Candidates must be within range and inside the vision cone (dot-product test). Anything within touching distance (radius + 1.5) is sensed regardless of the cone.
- **Camouflage check (other simlets only):** `pDetect = 1 − camoEff · (1.1 − acuity) · (0.5 + 0.5·d/range)`.
- **Effective camouflage:** `camo·0.85·(1 − 0.4·size)`, +0.3 in forest, × (1 − min(1, v/0.12)) (so movement breaks it), and 0 while raising an alarm.
- **Kin:** `similarity(a, b) = clamp(1 − rmsGeneDistance/0.45, 0, 1)` over the whole genome. Two random genomes score about 0.1; close relatives about 0.9.

## 6. Decisions: utility scores (highest wins)

| Action | Score |
|---|---|
| flee | 1.6 · flee · dissimilarity · min(sizeRatio, 3) · closeness · (0.3 + 0.7·their diet) (or 0.8·flee if warned by an alarm) |
| hunt | dissim · min(1/sizeRatio, 2) · closeness · (1 − 0.7·their diet) · (0.6·aggression·(0.4 + hunger) + 0.9·meatEff·drive), ×0.6 during attack cooldown |
| eat | 1.2 · drive · worth, where worth = clamp(net / (0.5·plantEnergy), 0, 1). **Optimal foraging:** net = digestion·energy − travel time·moving burn − handling time·idle burn. The item with the best net per tick is chosen; items with net ≤ 0 are ignored. Corpses are weighted by (0.5 + scavenge) |
| recall | 0.6 · drive · memory (no food visible, a remembered spot exists) |
| breed | 1.3 if seeking a mate and a compatible one is visible |
| clone | 1.3 · danger, if breeding asexually this cycle (or the mate wait has expired) |
| farm | 0.9 · farming · (0.5 if food visible) · (0.1 if energy ≤ 50%) · danger. **Hard limits only:** on fertile or grassland, and energy ≥ 1.5 × farmCost |
| rest | rest · (1.2 at night, else 0.5) · (0.3 if food or threat visible) |
| wander | 0.1 + 0.4·wander (+0.3 if seeking a mate and none is visible) |

- `danger` = 1 / (1 + 4·threatScore): about 1 when only harmless strangers are about, small when a real threat is close. It's a soft penalty, so the hybrid brain can learn to overrule it (previously any visible threat blocked farming and cloning outright).
- `drive` = 1 + (hungerAt − energy fraction) when below the hunger threshold, otherwise 0.1 + 0.5·(1 − energy fraction).
- `closeness` = 1 − 0.5·d/range.
- **Side actions on a think:**
  - Alarm: when fleeing, with chance 0.5·alarm. Warns relatives (>50% similar) within 12 tiles.
  - Donation: chance 0.3·donation. Gives 15% of own energy (80% arrives) to a nearby relative below 30% energy, only when the donor is above 60%.

## 7. Movement

- The primary direction comes from the chosen action. Steering forces are added on top:
  - kin pull (not while fleeing or hunting)
  - separation from bodies that overlap
  - water aversion (3 probes 2.5 tiles ahead, ±0.5 rad)
  - soft walls 3 tiles from the edge
- Wandering = current heading + Gaussian wobble (σ 0.25 rad), ×1.5 speed when hungry.
- Turn rate is capped at 0.3 rad/tick.
- **Attack reach:** radius sum + 0.3, or + 1.2 when sprinting (a pounce).
- **Attack success:** `sa/(sa + sd)`, where strength = mass·(0.5 + 0.5·energy fraction).
- **Mid-meal shortcut:** a simlet already eating doesn't rescan for food. This is a large performance win.

## 8. Breeding

- **Readiness:** mature, off cooldown (400 ticks), energy ≥ breedAt.
- On becoming ready it rolls once: **sexual** with probability = sexuality gene, otherwise **asexual**. A sexual breeder that finds no mate within `MATE_WAIT` (300 ticks) clones instead.
- **Sexual:**
  - Both must accept each other's similarity (choosiness), and the mate must be mature, off cooldown and above 30% energy.
  - The initiator gives 50% of its energy + overhead; the mate gives 30% + half the overhead.
  - Child = uniform crossover of both genomes, then mutation.
- **Asexual:** the parent gives 50% + 1.5× overhead. Child = mutated copy.
- **Litter:** min(maxLitter, floor(energy pool / (BODY_COST·mass·1.6))). Each child's share must cover its body plus 10% of its max energy, or it's stillborn.
- **Mutation:** each gene mutates with probability `mutationRate`, by Gaussian σ `mutationSize`, clamped to 0–1.
- **Diet is visible:** prey and threat judgements use the other simlet's diet (body shape), so meat-eaters are feared and avoided as prey.
- **Known asymmetry:** a mate *adds* energy, so sexual litters are better provisioned. That's the reverse of nature's twofold cost of sex, and likely why sex holds its own in tests.

## 9. Species (`species.js`)

NEAT-style clustering:
- Each species keeps a representative genome. A simlet stays in its species while it is at least `speciesThreshold` (0.7) similar to the representative. Otherwise it joins the most similar living species, or founds a new one (recording its parent species).
- Every 50 ticks: re-check everyone, drop empty species (extinct), re-pick each representative as a random living member.
- **Colours:** 8 colour slots go to species with ≥ 8 members and are kept for life. Everything else is grey "Other".
- Species is a **display-only** grouping: it doesn't affect mating. Mating uses choosiness against actual genomes.

## 9b. Farming and settlement

- **Farming** (`doFarm`): costs `farmCost`; produces `farmCost × yield` (fertile 2.0, grassland 1.4) as crop items that ripen after 300 ticks.
- **Storage:** crops rot after `rotTime × cropKeep` (default 4×) from ripening; wild plants after `rotTime`.
- **Home field:** farming sets `s.field` (keeping the old centre if within 6 tiles). It's long-term memory, forgotten after 3 × memDuration without farming or visiting.
  - While wandering, a simlet more than 5 tiles from its field is pulled home with weight 1.2·farming.
  - `recall` treats the field like a remembered food spot.
  - **Children inherit the initiating parent's field.**
- **Farmland visual:** `World.tilled` records farmed tiles (fades over 4,000 ticks). Display only.
- **Audit (Oct 2026, 3 runs per setting, 15k ticks, after field memory + storage):** no extinctions in any of the 9 runs.

  | Setting | Population settled near its field | Crops' share of food |
  |---|---|---|
  | grassSpawn 0.06 | 0–10% | 0–3% |
  | grassSpawn 0.03 | 12–72% | 2–6% |
  | grassSpawn 0.03 + fertile 1.2 | 2–49% | 0.3–6% |

  Grass default lowered to 0.03. Results depend heavily on the founders' farming genes.

## 9c. Soil nutrients (fallow land)

- `World.soil` holds nutrients from 0 to 1 per tile. A tile is **dormant** below `SOIL_MIN` (0.3): no farming and no wild growth there.
- **Farming:** yield = farmCost × land yield × soil on the farmer's tile. The farmer's tile drops to 0, and each neighbouring tile that receives a crop loses 0.5 (crops are not planted on dormant tiles).
- **Recovery:** every 25 ticks, fertile soil gains 25/`soilRecovery` (default 4,000 ticks to full); grassland gains half that.
- **Recycling:** rotting corpses and rotted food return `SOIL_PER_ENERGY` (0.02) nutrients per unit of energy to their tile.
- **Sowing:** if farming wins the decision but the ground underfoot is dormant, the simlet walks to the nearest fresh farmable tile within 6 tiles (action `sow`), or wanders if there is none.
- **Visual:** dormant tiles are drawn pale ("Fallow").
- **Audit (founders forced to farming ≈ 0.85, 2 runs each, 15k ticks):**

  | soilRecovery | Distinct fields | Dormant tiles | Crops' share of food | Settled | Population |
  |---|---|---|---|---|---|
  | 500 (≈ no depletion) | 35–41 | 30–54 | 16–24% | 70–90% | 81–135 |
  | 4,000 (default) | 4–59 | 28–81 | 3–16% | 75–100% | 4–319 |
  | 12,000 | 74–84 | 470–590 | 3.5–4.3% | 9–51% | 238–947 |

  Slow recovery spreads farming out (more fields, more fallow, slightly more on grassland) but weakens village tightness. Fast recovery gives tight, crop-dependent but small villages.

## 9d. Hybrid brain (`brain.js`)

- **Switch:** left panel, **Brain: rules | Hybrid** (global `Brain.mode`, default Hybrid).
- **Second chromosome:** every simlet carries a brain, a 20-input → 8-hidden (tanh) → 9-output network, 241 weights. In Hybrid mode its outputs are **added to the rule scores** of the actions that are currently possible; impossible actions are set to −∞. The highest final score still wins.
- **Starts neutral:** founder brains have random input→hidden weights but **zero hidden→output weights**, so a new brain changes nothing. Tribe members share their founder's brain.
- **Evolution:** brains mutate only while Hybrid is on (rate = `mutationRate`, σ = `brainMutSize`, unclamped). In Rules mode they are copied unchanged, so they don't drift.
  - **Crossover by whole hidden neuron:** each neuron's input and output weights come from one parent. This avoids splicing two unrelated feature detectors together (the "competing conventions" problem).
- **Inputs (20):** energy, hunger, stamina, exhausted, threat score, threat nearness, prey score, prey nearness, prey size, food worth, food nearness, night, bust, kin nearby, ready to breed, age, in forest, on open water, on fresh farmable soil, bias.
- **Outputs:** corrections for flee, hunt, eat, recall, breed, clone, farm, rest, wander.
- **Species similarity ignores brains** (trait genes only).
- **Inspector:** rules / brain / final score per action, plus an input→action "wiring" heat-map (W1·W2, linearised).
- **Stats:** "Brain influence" = average |correction| per action per decision.
- **First test (4 shared maps, 24k ticks, rules vs hybrid):**
  - Brain influence grew steadily: 0.04 at 4k ticks → 0.13–0.20 at 24k.
  - The brain cut fleeing sharply (rules 13–41% of time → hybrid 2–7%) and raised resting. The rules are over-cautious.
  - Carnivores persisted for the whole run on 1 of 4 hybrid maps (80–184 carnivores); none did under rules. A browser run on the same map had none, so this is partly chance.
  - No extinctions in either mode.

## 9e. Winter: ice, cold and forest refuge

- **Ice:** `World.shoreDist` gives each water tile its distance to land, from a breadth-first search over 8 neighbours, recomputed when the map changes.
  - Every 100 ticks during bust: reach = iceReach · sin(π · bust progress), so it grows and then thaws. A water tile freezes if shoreDist + fixed smooth noise (±1.5) ≤ reach.
  - Then a 3×3 morphological **closing** (dilate, then erode, with land counted as solid) fills pinholes and joins floes.
  - Ice walks like land (no water speed or cost penalty), and water avoidance ignores it. Narrow rivers bridge; wide lakes freeze only at the rims.
- **Forest food:** `forestSpawn` (default 0.1‰ per tile per tick) is **not** reduced in bust.
- **Food ladder (Joe's choice, Oct 2026):** wild food per tile per tick, boom / bust: fertile 1.5 / 0.375‰, grassland 0.2 / 0.05‰, forest 0.1 / 0.1‰. Forest is the poorest in boom but beats grassland in bust.
  - Test vs the previous 0.03 / 0.15: bust lows 2–3× higher (177–295 vs 53–168), but villages were mixed (settled 40/5/9% vs 25/8/33%), crops' share fell on 2 of 3 maps, and bust forest use dropped about 4–10 points.
- **Winter cold:** in bust, idle drain × (1 + winterCold), with winterCold default 0.5. In forest, the extra is × (1 − forestShelter), default 0.7.
- **Test (3 shared maps, 18k ticks, hybrid):**

  | | Winter off (no ice, cold or forest food) | Cold 0.25 | Cold 0.5 |
  |---|---|---|---|
  | Share of population in forest (boom / bust) | 4–8% / 4–9% | 13–24% / 20–30% | 14–20% / 22–35% |
  | Forest-dwelling species (≥10 members, >50% in forest) | 0 of 3 maps | 1 of 3 | 1 of 3 (map 3 had 4 such species) |
  | Lowest bust population | 90–159 | 125–137 | 200–341 |

  - Forest food adds energy, which more than offsets the cold. Ice formed 600–2,800 tiles at its peak, with a handful of simlets on ice at any moment. No extinctions. Default cold set to 0.5.

## 9f. Scent tracking

- **World:** `World.scent` holds one value per tile. Every simlet deposits 0.1·(1 − diet) per tick on its tile (capped at 5), so plant-eaters leave trails and pure meat-eaters leave none. It fades with half-life `scentFade` (default 600 ticks).
- **Smell gene** (Senses): detection threshold = 0.02 + 0.5·(1 − smell)², so a good nose detects faint, old trails. Cost: +0.2·smell idle drain.
- **Sniffing:** each think samples scent 3 tiles ahead at heading −0.6, 0 and +0.6 rad, and keeps the strongest. `smelt` = clamp(strongest / 1, 0, 1) if above the threshold, else 0.
- **Track action:** score 1.5 · smelt · meatEff · drive · (0.5 + smell), only when no prey is visible. Movement: head toward the strongest probe at 0.8× top speed.
- **Brain:** new input `scent` (= smelt) and new output `track`, so the network is 21 → 8 → 10.
- **Map:** "Scent: on" in the legend shows trails in purple.
- **First test:** tracking happens, and plant-eater sightings rose on 1 of 3 maps (0.3% → 8.8% of carnivore decisions), but carnivores still died out in all 6 runs. One natural run went extinct; 3 reruns of that map were healthy, so that was chance.

## 9g. Shelters (`shelter.js`)

- **Building gene** (Social). The **Build** action (score 0.9·building·(0.15 if energy ≤ 50%)·danger) goes to a site and does 40-tick work sessions.
  - Each session costs buildCost/4 energy (default 40 per tile), or ×0.6 in or next to forest (timber). Four sessions finish a tile.
  - Work on a finished tile repairs it.
- **Site choice ("join before you start"):** first a family foundation or damaged shelter within 10 tiles; then a free tile next to a family shelter (growth); then the current tile, but only if the family has no shelter within 10 tiles. Family = genome similarity ≥ 0.6 to the shelter's founder.
- **Inside (Shelter action):** 2 per tile, idle drain ×0.25, no winter cold, invisible to others (can't be seen, hunted or attacked).
- **Granary:** every 25 ticks, ripe crops within 3 tiles are pulled into the tile's store (cap 80); stored food never rots. The **Draw** action eats from a family store (2 per tick × plant digestion).
- **Decay:** an unworked foundation crumbles over 2,000 ticks. A finished tile loses health over `shelterLife` (20,000) unused, ×0.1 while occupied. On collapse it becomes a fertile ruin, drawn as rubble.
- **Deforestation:** a tile finished in forest is cleared to grassland; a ruin becomes fertile.
- **Brain:** new inputs shelterNear, storeFull, buildSite; new outputs build, shelter, draw (24 → 8 → 13).
- **First test (3 maps, 18k ticks, vs main):**

  | | Map 1 | Map 2 | Map 3 |
  |---|---|---|---|
  | Foundations started → finished | 410 → 54 | 911 → 337 | 394 → 55 |
  | Largest villages (tiles) | 2 | **17–19** (several) | 6 |
  | Food eaten from stores | 325 | 2,765 | 404 |
  | Time indoors (boom / bust) | 3% / 9% | 6% / 13% | 4% / 8% |
  | Forest tiles cleared | 10 | 87 | 15 |
  | Lowest bust population vs main | 73 vs 80 | 248 vs 263 | 87 vs 209 |

  - Joe predicted it: **most foundations are abandoned** (63–87%), because wanderers start new ones far from family. Survival is no better (sometimes worse): energy is wasted on abandoned foundations.

## 9h. Stockpiling package

- **Home memory:** simlets remember their home shelter and current building project (tile indices) and return from anywhere. Children inherit the family home. Shelter and build scores fall off with distance.
- **Shared walls:** a tile next to a finished shelter is 40% cheaper (stacks with the forest discount).
- **Asymmetric year:** `bustShare` (default **0.67**) = fraction of each 2 × seasonLength year that is bust.
- **Thrift gene** (Feeding): the Draw score is × (1 − thrift) if wild food is visible, × (1 − 0.6·thrift) if not, and unpenalised below 20% energy.
- **Brain inputs** `timeToBust` and `timeToBoom` (fraction of the current season left), so the network is 26 → 8 → 13. Stores are 200 per tile.
- **Field bonuses:** +12.5% yield per neighbouring active field (max +50%), +25% with a finished house within 2 tiles.
- **Test (3 maps, 24k ticks):**

  | | Lowest bust population | Store total (early boom → late boom → late bust) | Houses finished |
  |---|---|---|---|
  | main (no shelters, 50/50 year) | 88 / 203 / 56 | – | – |
  | Shelters, 50/50 year | 264 / 185 / 185 | builds in boom, **barely drains in bust** | 28–46% |
  | Shelters, 67% bust | 366 / 300 / 262 | e.g. 198 → 257 → 216 (one map drains) | 12–26% |

  - Survival is now better than main on 2 of 3 maps, and better still with the long winter.
  - But simlets **hoard**: stores fill and are rarely eaten, and thrift evolved to 0.33–0.92. Indoor time is still only 3–12% in bust.

- **Boom rot** (`boomRot`, default ×2): wild plants and field crops age faster in boom. Stored food never rots.
  - **Test (3 maps, ×1 vs ×2):**

    | | Map 1 | Map 2 | Map 3 |
    |---|---|---|---|
    | Lowest bust pop, ×1 / ×2 | 353 / 275 | 609 / 301 | 85 / 173 |

    - Stores: map 2 at ×1 gave the best pattern seen (535 → 1,020 → 545 through the year); ×2 drained on maps 2 and 3, and map 1 hoarded.
    - The effect is smaller than the map-to-map noise. **Kept at ×2 (Joe's choice)** for storage pressure.

## 9i. Display: chart history and looks

- **Chart history:** a sample every `interval` ticks (starts at 50), capped at 600 samples by halving the resolution. With `chartWindow` > 0 (default 30,000), samples older than the window are dropped, and the interval returns to the finest one that fits 600 samples. Charts plot against tick, not sample index, so mixed spacing draws correctly.
- **Looks (`genomeLook`, display only):**
  - Pattern: plain / spots / stripes / mask / spine, from the angle of a second fixed genome projection (like lineage colour), so relatives share a pattern.
  - Marking colour: the lineage hue at 24% lightness. Drawn only when the body is at least 4.5 px across.
  - Body length × (0.85 + 0.4·speed) and width × 1/√length; outline width 0.6 + 1.6·aggression.

## 10. Seeding and newcomers

- **Tribe** = one random founder genome × `tribeSize` copies, each mutated (rate 0.5, σ 0.05). They land in a Gaussian blob (σ 4 tiles) at 70% energy with random ages up to 1,200 ticks.
- Every tribe starts its own species.
- Seeding unique individuals doesn't work: random genomes are about 10% similar, below every possible choosiness level, so nobody can mate (tested: zero births).
- **Air-drop:** a tribe lands where you click. **Immigration:** a tribe lands on random dry land every N ticks (default 3,000, on, to give predators repeated founding chances).
- **Newcomer brains:** air-drops and immigrants get random genes, but copy the brain of the living simlet (best of 40 sampled) whose diet is closest to theirs: "local know-how". Founders still start with blank brains.

## 11. Tuning history (lessons)

| Problem seen in test runs | Cause | Fix |
|---|---|---|
| Every simlet evolved to max size | Kleiber drain (mass^0.75) plus bite ∝ mass made big strictly better | Linear drain, fixed bite, big bodies mature later |
| Carnivores took over to the population cap | Corpses held free energy (body value > cost of making a child) | `BODY_COST` charged at birth; corpse returns ≤ 90% of it |
| Then almost no births | Body cost too high, litters unaffordable | Lower `BODY_COST`, larger parental share, litter size capped by energy |
| Predators starved mid-chase | Sprint cost about 0.27/tick | `moveCost` 0.04 → 0.02 |
| Predators never found prey | Jittery random walk, tribes far apart | Smoother wander, hungry simlets search faster |
| Chases rarely ended in contact | Equal speeds | Pounce reach when sprinting; corpses keep 80% of the victim's energy |
| No gradual route to carnivory | Generalist penalty exponent 1.3 | Linear digestion efficiency |
| Carnivores grazed plants worth less than their upkeep; carnivore tribes hunted each other | Eat score ignored value-for-time; targeting used genetic difference only | Optimal-foraging food value; diet-aware threat/prey; stamina gene for sprints |
| Slowed to about 50 ticks/sec | Mid-meal simlets rescanned hundreds of food items every think | Skip the rescan while eating; dot-product cone test |

## 12. Known limitations

- **Carnivores are fragile:** they persist at low numbers in some runs and die out in others. Slower plant eating, optimal foraging and diet-aware targeting didn't fix it on their own (immigration helps sometimes).
  - **Measured bottleneck (Oct 2026 autopsy):** a carnivore has any plant-eater within vision on only 2–17% of its decisions, so it spends 40–50% of its time wandering and 17–45% resting, and hunts 0.5–6% of the time.
  - It's an **encounter-rate** problem: predators have no way to track prey beyond line of sight.
  - **Later tests (Oct 2026):**
    - Chase autopsy: hunting works when prey is seen (62–82% of the time; 24% of hunts kill).
    - Normal seeding starts carnivores 20–35 tiles from prey, beyond sight.
    - Seeding tribes close together (`seedSpread` 0.3) plus a full-energy start (`founderEnergy` 1) raised carnivore kills 2–20× but still didn't make them persist, and crowding hurt overall stability. Defaults were left at 1 / 0.7.
    - In one baseline run, carnivores boomed to about 300 and crashed the prey population: classic predator overshoot. Once established, they can thrive; founding is the hard part.
    - Lean predator founders (`leanPredators` 0.6, upkeep genes pulled toward moderate), alone and with full founder energy: no reliable improvement over 18 runs. Carnivores established in about 1 run in 9 regardless of lever (when they do, they persist and cycle, peaking near 340). Establishment looks like a **lottery**; more founding attempts (immigration, air-drops) is the realistic way to win it. Default left at 0.
- Behaviour rules are fixed; only their weights evolve. Evolved brains (neuroevolution) would be v2.
- There are no sexes, so there's no real cost of sex.

## 13. Open ideas (not built)

- Farm-site choice / crops can't grow on tiles with wild plants (to spread fields onto grassland). Parked by Joe.
- Field defence (aggression towards strangers eating your crops).
- Prey choice by expected net gain (catchable / beatable / filling). Parked by Joe.
- Highlight a selected simlet's family (parents, children, siblings) on the map.
- A cost-of-sex slider.
- A separate immigrant group size.
- A night-shading slider.
- Disturbances (droughts, fires).
- Mountains (block line of sight).
- Pure neural brain (no rule scores), or adding more brain inputs (e.g. scent, memory of prey).
- **Joe's docket (Oct 2026):**
  - **Land rework:** paint only land and water. Fertility, grassland and forest are derived from continuous per-tile fields (moisture from water, soil nutrients, tree cover that spreads to neighbours) and change with simlet use, so you can see migration and de/reforestation.
  - **Brain rework:** more raw senses (counts of food, kin and threats by direction), more weight to the brain over the rules, and memory (a recurrent brain).
  - **Build what?:** a two-level decision (build → which structure), plus more structures.
  - **Random events:** plague, drought, fire, flood, bounty.
  - **Meta-optimisation:** an outer optimiser (GA, CMA-ES or Bayesian optimisation) tunes world parameters using headless runs, scored on carnivores persisting alongside herbivores. Do it after the land rework, which resets the balance anyway.
