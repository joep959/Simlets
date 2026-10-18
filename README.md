# Simlets

An evolving ecosystem you can watch in the browser. Simlets are small creatures with a 28-gene chromosome. They eat, hunt, flee, farm, share and breed on a map you paint yourself. Nobody scores them: the ones that survive long enough to breed pass their genes on, and the world decides what "fit" means.

It's a play and learning project about genetic algorithms, agent-based simulation and evolution.

## Running it

Double-click `index.html`. There's nothing to install and no server; it runs in Edge or Chrome straight from the folder.

**On your phone:** serve the folder from the PC and open it on the phone over the same Wi-Fi:
1. On the PC, in the project folder: `python -m http.server 8000`. Allow it through the Windows firewall when asked (private networks).
2. Find the PC's address with `ipconfig` (the IPv4 address, e.g. 192.168.1.20).
3. On the phone, open `http://192.168.1.20:8000`.

The simulation runs on the phone (the PC only hands over the files), so phones start with a lower population cap (600; the slider still goes higher). On a phone: tap a simlet to inspect it, drag to pan, pinch to zoom, use the bottom tabs for the sections, tap empty map to close a sheet, and press and hold anything for its explanation.

## Quick start

1. The app opens on a **blank, dry map** in **Edit map** mode (or press **Random** for a ready-made one).
2. Paint **Water**: land near it turns fertile by itself. Add **Plant forest** for cover and **Enrich soil** for extra fertile patches.
3. Press **Run**. Tribes are dropped in and the clock starts.
4. Use **Speed** to go faster (up to Max). Click any simlet to inspect it. Hover anything in the right panel or on a slider for an explanation.

## The screen

| Area | What's there |
|---|---|
| **Top bar** | Play/pause, Step, speed, day, tick and season, then the **at-a-glance** numbers: population (● herbivores ◆ omnivores ▲ carnivores), species, fertile and forest share, and a chip for each running event. On the right: charts, right panel and **full screen** buttons |
| **Icon rail + drawer (left)** | Four sections, one at a time: **Simulation** (brain rules / Hybrid, air-drop, restart, save / load world, full statistics), **Map** (run / edit, brushes, new / random / saved maps), **Events** (trigger buttons and the event log), **Settings** (every slider, with a **search box**; a dot marks sliders changed from their default). Click the open section's icon again to close the drawer |
| **Map** | Scroll or pinch to zoom, drag (or two fingers) to pan, click or tap a simlet to select it. The map key is collapsed under **Key ▸**. Default **Colour: species**; the legend button cycles species → lineage → diet. Brown furrowed tiles = farmland |
| **Right panel** | Nothing selected: the **species list**. Simlet selected: **Highlight Family / Species** (gold parents, teal children, white siblings, lilac species-mates; click an ID to jump to it), vitals, body stats, brain and all genes |
| **Charts (bottom)** | Population by diet (with faint bands where events ran) · Species over time · Mean of any gene ± spread · Land over time (fertile / grassland / forest share) · Diet histogram. They show the last 30,000 ticks by default (**Display → Chart history**; 0 = the whole run). **⤢** expands any chart over the map; the chart button in the top bar shrinks the strip to titles only (click a title to expand that chart). |
| **Full screen** | Just the map and a small summary (play/pause, day, season, numbers, events). Press **F** or the button; **F** or **Esc** leaves |

**Keyboard:** Space = play/pause · **[** = drawer · **]** = right panel · **C** = charts · **F** = full screen · Esc = cancel / close an expanded chart. The layout you choose is remembered.

**Reading a simlet on the map**
- Shape shows diet: green round teardrop = herbivore, blue diamond = omnivore, orange arrowhead = carnivore.
- Faded = camouflaged. Dim = resting. Trail = sprinting. White ring = alarm call.
- Zoom in to see **markings**: plain, spots, stripes, mask or a spine stripe, in a dark shade of the lineage colour. They come from the genome, so families share them. Long, slim body = fast; thick outline = aggressive.

**Map editing:** brushes are **Water**, **Land**, **Plant forest** and **Enrich soil** (the last two are godly nudges; switch to Edit map mid-run to use them, and the clock pauses). **Clear**, **Random** and **Load…** start a fresh world (no simlets, tick 0); press **Run** to drop tribes in. Painting on its own doesn't reset anything. **Save…** downloads your map (water, trees and soil) as JSON; old map files still load.

## The world

- **Living land:** you only paint water and land. The rest forms by itself and keeps changing:
  - **Moisture** comes from nearby water. Moist land can hold rich soil and grow forest; dry land stays grassland.
  - **Fertile** = rich soil. Wild plants use soil up as they grow; it returns if they rot but leaves with whoever eats them. So heavily grazed land wears out (paler green), and rested land recovers. Corpses and rotting food enrich it.
  - **Forest** = enough trees. Forest creeps about a tile a year onto moist land nearby. Grazers browse young trees back, farming and building clear them, so inhabited land stays open and abandoned land goes back to forest. Dry-land forests don't spread.
  - **Land fertile / forest** in the stats panel tracks the balance.
- **Terrain types:**
  - Fertile: food spawns often.
  - Grassland: food spawns rarely, but simlets can farm it.
  - Forest: boosts camouflage, cuts vision.
  - Water: crossable, but movement costs about 6× and speed is halved.
- **Seasons:** boom and bust alternate. In bust, fertile and grassland food grows at 25% of the boom rate, it's **cold** (higher energy drain, except under forest cover), and **ice** grows out from the shores, so narrow rivers become crossable bridges (Winter sliders).
- **Food ladder:** fertile land gives the most food, grassland second, forest the least. But forest food is steady all year, while fertile and grassland drop to a quarter in bust.
- **Forest:** low but steady food all year, plus shelter from the cold. It's the winter refuge.
- **Day/night:** night cuts vision range by 40% and makes resting more attractive.
- **Food:** wild plants rot. Farmed crops take 300 ticks to grow, keep 4× longer than wild plants (Crop storage slider) and anyone can eat them. Corpses are meat and decay over time.
- **Soil:** farming exhausts the ground (and it can stop being fertile until it recovers). Exhausted (pale, "fallow") tiles grow nothing until they recover (Soil recovery slider), and rotting corpses and food fertilise the soil. Farmers on spent land walk to fresh soil.
- **Settling:** a farmer remembers its field and drifts back to it, and its children inherit the field. Families clustering round their fields are the start of villages.

## Events

Random events shake the world up. Each can be triggered from the **Events** panel (those ending in … then need a click on the map; Esc cancels) or happens by itself (**Events → Automatic events**, on by default, plus a per-event "every" slider; 0 = never). Running events show as faint bands on the Population chart, in the event log, and on the inspector's **Status** line.

- **Plague** (about every 8 years): spreads by contact, far faster between close relatives, so it hits the commonest species hardest and breaks up monocultures. Sick simlets drain energy and can die; survivors are immune for a while. The new **Resistance** gene protects, at an energy cost.
- **Fire** (about every 2–3 years, mostly in the dry boom season): spreads through forest and scrub, kills trees, damages simlets and shelters in its path, and leaves rich ash. It keeps the slow forest spread in check.
- **Flood** (at the thaw, about every 5 years): water rises over the lowlands around a lake or river. It washes out fields, sweeps away foundations, wrecks houses (worn ones collapse into ruins), spoils food and stores, and drowns most trees. It recedes leaving bare but fertile silt.
- **Famine** (drought, about every 12 years): wild food falls to 30% on open land (forest is the refuge), fertile land dries out, and crops yield half. Stores and thrift pay off.
- **Bounty** (a mast year, about every 8 years): wild food doubles for a while, forest most, with a windfall at the start. Expect a baby boom and then a crash.
- **Radiation** (about every 15 years): a leak at a point; children conceived nearby mutate far more for a while, so new varieties and species appear.

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
| Feeding | Hunger threshold, Thrift (save the family store for later), Scavenge |
| Social | Flee, Aggression, Kin pull, Donation, Alarm, Farming, Building |
| Health | Resistance (to plague) |
| Breeding | Breed threshold, Brood size, Sexuality (sexual vs clone), Choosiness (mate similarity) |

Every gene has a cost or a trade-off. Hover a gene in the inspector for the specifics. `DESIGN.md` has the full mechanics and formulas.

## Things to try

- Plant a forest beside a river on an empty stretch and watch it creep along the bank; then air-drop a herd there and see whether their grazing holds it back.
- Enrich a patch of dry land and watch the herd find it, wear it out and move on.
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
| `js/genome.js` | The 28 genes, mutation, crossover, similarity, colour |
| `js/species.js` | Species clustering (NEAT-style) |
| `js/world.js` | Terrain, map generation, save/load, food storage, seasons, day/night |
| `js/simlet.js` | A simlet's body, and its sense → decide → act behaviour |
| `js/shelter.js` | Shelters: building, granary stores, decay into ruins |
| `js/sim.js` | The tick loop, seeding, air-drops/immigration, breeding, stats history |
| `js/events.js`, `js/events/*.js` | Random events: the framework, and one file per event |
| `js/save.js` | Save and load whole worlds (JSON) |
| `js/render.js`, `js/charts.js`, `js/ui.js`, `js/main.js` | Drawing, charts, panels and controls, main loop |
| `tools/headless.js`, `tools/landprobe.js` | Run the sim in Node without a browser, for balance and land tests (`tools/simfiles.js` reads the file list from index.html) |
| `DESIGN.md` | How the model works, the formulas, and the tuning history |
| `CLAUDE.md` | Working notes for Claude Code sessions on this project |
