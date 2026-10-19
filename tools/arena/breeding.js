// node breeding.js <results.jsonl>: per arm, survival plus breeding diagnostics and the energy ledger (medians over runs)
const fs = require('fs');
const R = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l));
const med = a => { a = a.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
const f = x => isNaN(x) ? '-' : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2);
const sum = (A, k) => A.reduce((a, r) => a + (r[k] || 0), 0);
console.log('arm            alive grew medLife births/fdr litters conc parentDied/litter stillborn/litter matured eligShare | per 1k carn-ticks: intake upkeep breeding attacks');
for (const arm of [...new Set(R.map(r => r.arm))]) {
  const A = R.filter(r => r.arm === arm), L = A.map(r => r.ledger || {}), k = A.map(r => r.carnTicks / 1000);
  const per = key => f(med(L.map((l, i) => (l[key] || 0) / k[i])));
  const lit = sum(A, 'litters');
  console.log(`${arm.padEnd(14)} ${String(A.filter(r => r.aliveEnd > 0).length).padStart(3)}/${A.length} ${String(A.filter(r => r.aliveEnd > r.K).length).padStart(3)}  ${f(med(A.map(r => r.extinctAt || r.T))).padStart(6)}  ${f(med(A.map(r => r.births / r.K))).padStart(6)}  ${String(lit).padStart(5)} ${String(sum(A, 'conceptions')).padStart(4)}  ${f(lit ? sum(A, 'parentDeathAfterBreed') / lit : NaN).padStart(6)}  ${f(lit ? sum(A, 'stillborn') / lit : NaN).padStart(6)}  ${String(sum(A, 'matured')).padStart(4)}  ${f(med(A.map(r => r.eligShare))).padStart(5)} | ${per('intake')} ${per('upkeep')} ${per('breeding')} ${per('attacks')}`);
  console.log(`${''.padEnd(14)} lives: ${A.sort((x, y) => x.id - y.id).map(r => (r.extinctAt || 'ALIVE:' + r.aliveEnd) + ' b' + r.births).join(' | ')}`);
}
