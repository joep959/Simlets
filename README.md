# Simlets

An evolving ecosystem you can watch in the browser. Simlets are small creatures with a 25-gene chromosome. They eat, hunt, flee, farm, share and breed on a map you paint yourself. Nobody scores them: the ones that survive long enough to breed pass their genes on, and the world decides what "fit" means.

It's a play and learning project about genetic algorithms, agent-based simulation and evolution.

## Running it

Double-click `index.html`. There's nothing to install and no server; it runs in Edge or Chrome straight from the folder.

## Quick start

1. The app opens on a **blank grassland map** in **Edit map** mode.
2. Paint **Fertile** land (where food grows), plus some **Forest** (cover) and **Water** (costly to cross).
3. Press **Run**. Tribes are dropped in and the clock starts.
4. Use **Speed** to go faster (up to Max). Click any simlet to inspect it. Hover anything in the right panel or on a slider for an explanation.

## The screen

| Area | What's there |
|---|---|
| **Left panel** | Play/pause, speed, day and season clock, live stats, Run/Edit map, **Brain: rules / Hybrid**, **Air-drop tribe**, **Restart simulation**, **Restore default settings**, and all world sliders (hover a slider for what it does) |
| **Map** | Scroll to zoom, drag to pan, click a simlet to select it. The map key is collapsed under **Key ▸**. Default **Colour: species**; the legend button cycles species → lineage → diet. Brown furrowed tiles = farmland |
| **Right panel** | Nothing selected: the **species list**. Simlet selected: **Highlight Family / Species** (gold parents, teal children, white siblings, lilac species-mates; click an ID to jump to it), vitals, body stats, brain and all genes |
| **Bottom charts** | Population by diet · Species over time · Mean of any gene ± spread · Diet histogram |

**Reading a simlet on the map**
- Shape shows diet: green round teardrop = herbivore, blue diamond = omnivore, orange arrowhead = carnivore.
- Faded = camouflaged. Dim = resting. Trail = sprinting. White ring = alarm call.

**Map editing:** **Clear**, **Random** and **Load…** start a fresh world (no simlets, tick 0); press **Run** to drop tribes in. Painting on its own doesn't reset anything. **Save…** downloads your map as JSON.

## The world

- **Terrain:**
  - Fertile: food spawns often.
  - Grassland: food spawns rarely, but simlets can farm it.
  - Forest: boosts camouflage, cuts vision.
  - Water: crossable, but movement costs about 6× and speed is halved.
- **Seasons:** boom and bust alternate. In bust, fertile and grassland food grows at 25% of the boom rate, it's **cold** (higher energy drain, except under forest cover), and **ice** grows out from the shores, so narrow rivers become crossable bridges (Winter sliders).
- **Food ladder:** fertile land gives the most food, grassland second, forest the least. But forest food is steady all year, while fertile and grassland drop to a quarter in bust.
- **Forest:** low but steady food all year, plus shelter from the cold. It's the winter refuge.
- **Day/night:** night cuts vision range by 40% and makes resting more attractive.
- **Food:** wild plants rot. Farmed crops take 300 ticks to grow, keep 4× longer than wild plants (Crop storage slider) and anyone can eat them. Corpses are meat and decay over time.
- **Soil:** farming exhausts the ground. Exhausted (pale, "fallow") tiles grow nothing until they recover (Soil recovery slider), and rotting corpses and food fertilise the soil. Farmers on spent land walk to fresh soil.
- **Settling:** a farmer remembers its field and drifts back to it, and its children inherit the field. Families clustering round their fields are the start of villages.

## Brains

- **Rules:** simlets score each action with hand-written formulas weighted by their genes, and the best score wins.
- **Hybrid** (default): each simlet also carries a small neural network. It adds a learned correction to every score.
  - It starts at zero, so nothing changes at first. Over generations, evolution tunes it and it can come to override the rules.
  - Select a simlet to see the rules-vs-brain scores and a "wiring" heat-map of what its brain has learned.

## The genes (all 0 to 1)

| Group | Genes |
|---|---|
| Body | Size, Max speed, Camouflage, Diet (0 plants … 1 meat), Lifespan |
| Senses | FOV width (wide = short-sighted, low acuity), Smell (follow plant-eater scent trails), Memory |
| Movement | Wander, Sprint urge, Stamina (sprint meter), Water aversion, Rest |
| Feeding | Hunger threshold, Scavenge |
| Social | Flee, Aggression, Kin pull, Donation, Alarm, Farming |
| Breeding | Breed threshold, Brood size, Sexuality (sexual vs clone), Choosiness (mate similarity) |

Every gene has a cost or a trade-off. Hover a gene in the inspector for the specifics. `DESIGN.md` has the full mechanics and formulas.

## Things to try

- Paint a river splitting two fertile zones. Switch to **Colour: species** and watch whether the two sides drift apart.
- Let the world settle, then **air-drop** a tribe into the middle of a herd.
- **Immigration** is on by default (a new random tribe every 3,000 ticks), so each arrival is another chance for predators to establish. Set it to 0 for a closed world.
- Drag **Plant eating speed** low or high and compare how often predators appear.
- Raise the **Species similarity threshold** to see finer splits.

## Where these ideas show up elsewhere

- **Evolutionary optimisation** (GA, CMA-ES): antenna and filter design, Helmholtz coil geometry, tuning modem or test parameters with no clean gradient.
- **Agent-based modelling:** network and traffic contention, multi-terminal satcom behaviour.
- **Clustering without knowing k** (the species method): grouping unlabelled test failures or telemetry anomalies.
- **Debugging simulations:** check conservation first. The two worst bugs in this project were both "energy from nothing".

## Files

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Page layout and styling |
| `js/config.js` | World constants and every slider (with its hover text) |
| `js/brain.js` | The hybrid neural brain (network, mutation, crossover, inspector heat-map data) |
| `js/genome.js` | The 25 genes, mutation, crossover, similarity, colour |
| `js/species.js` | Species clustering (NEAT-style) |
| `js/world.js` | Terrain, map generation, save/load, food storage, seasons, day/night |
| `js/simlet.js` | A simlet's body, and its sense → decide → act behaviour |
| `js/sim.js` | The tick loop, seeding, air-drops/immigration, breeding, stats history |
| `js/render.js`, `js/charts.js`, `js/ui.js`, `js/main.js` | Drawing, charts, panels and controls, main loop |
| `tools/headless.js` | Runs the sim in Node without a browser, for balance tests |
| `DESIGN.md` | How the model works, the formulas, and the tuning history |
| `CLAUDE.md` | Working notes for Claude Code sessions on this project |
