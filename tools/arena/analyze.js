// node analyze.js <results.jsonl>: survival by world / placement, stage rates, gene effects (Spearman vs persistence)
const fs = require('fs');
const R = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l));
const GENES = ['size','speed','camo','diet','lifespan','fov','smell','memory','wander','sprint','stamina','waterAversion','rest','hunger','thrift','scavenge','flee','aggression','kinPull','donation','alarm','farming','building','breedThreshold','broodSize','sexuality','choosiness','resistance'];
const med = a => { a = a.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
const f2 = x => isNaN(x) ? '-' : (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));
for (const r of R) {
  r.life = r.extinctAt || r.T;                                  // ticks the lineage lasted
  r.score = r.life + 500 * Math.log2(1 + r.aliveEnd);           // persistence: lasting, then growing
  r.enc = r.thinks ? r.realPrey / r.thinks : 0;
  r.cap = r.attacks ? r.kills / r.attacks : NaN;
  r.killRate = r.carnTicks ? 1000 * r.kills / r.carnTicks : 0;  // kills per 1000 carnivore-ticks
  r.perKill = r.kills ? r.meatE / r.kills : NaN;
  r.meatRate = r.carnTicks ? 1000 * (r.meatE + r.plantE) / r.carnTicks : 0;
  r.atkShare = r.meatE ? r.atkE / r.meatE : NaN;
  r.util = r.corpseE ? r.eatSelf / r.corpseE : NaN;
  r.bpf = r.births / r.K;
}
const row = (name, A) => console.log(`${name.padEnd(14)} n=${String(A.length).padStart(3)}  alive@6k ${String(A.filter(r => r.aliveEnd > 0).length).padStart(3)}  grew ${String(A.filter(r => r.aliveEnd > r.K).length).padStart(3)}  medLife ${f2(med(A.map(r => r.life)))}  enc ${f2(med(A.map(r => r.enc)))}  capture ${f2(med(A.map(r => r.cap)))}  kills/1k ${f2(med(A.map(r => r.killRate)))}  E/kill ${f2(med(A.map(r => r.perKill)))}  intake/1k ${f2(med(A.map(r => r.meatRate)))}  atkCost/meat ${f2(med(A.map(r => r.atkShare)))}  util ${f2(med(A.map(r => r.util)))}  births/founder ${f2(med(A.map(r => r.bpf)))}`);
console.log('== all'); row('all', R);
console.log('== by world'); for (const s of [...new Set(R.map(r => r.snap))].sort()) row(s, R.filter(r => r.snap === s));
console.log('== by placement'); for (const p of ['in', 'edge', 'far']) row(p, R.filter(r => r.place === p));
// Spearman rank correlation of each gene with the persistence score
const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); idx.forEach(([, i], k) => r[i] = k); return r; };
const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const ys = rank(R.map(r => r.score));
const eff = GENES.map((g, k) => [g, corr(rank(R.map(r => r.genome[k])), ys)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
console.log(`== gene vs persistence (Spearman; |rho| > ${(2 / Math.sqrt(R.length)).toFixed(2)} ~ significant)`);
console.log(eff.map(([g, c]) => `${g} ${c >= 0 ? '+' : ''}${c.toFixed(2)}`).join(', '));
// top vs bottom quintile mean genes
const S = R.slice().sort((a, b) => b.score - a.score), q = Math.max(1, (R.length / 5) | 0), top = S.slice(0, q), bot = S.slice(-q);
console.log('== top vs bottom fifth, mean gene (only genes differing > 0.12)');
console.log(GENES.map((g, k) => [g, top.reduce((a, r) => a + r.genome[k], 0) / q, bot.reduce((a, r) => a + r.genome[k], 0) / q]).filter(([, a, b]) => Math.abs(a - b) > 0.12).map(([g, a, b]) => `${g} ${a.toFixed(2)} vs ${b.toFixed(2)}`).join(', '));
const best = S.slice(0, 5).map(r => `id ${r.id} ${r.snap} ${r.place} life ${r.life} alive ${r.aliveEnd} births ${r.births} kills ${r.kills}`);
console.log('== best runs'); console.log(best.join('\n'));
const deaths = {}; for (const r of R) for (const [k, v] of Object.entries(r.deaths)) deaths[k] = (deaths[k] || 0) + v;
console.log('== lineage deaths', JSON.stringify(deaths));
