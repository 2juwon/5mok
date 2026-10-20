// node test/sim.js [판 수] [고급 시간ms]
const OM = require('../src/engine.js');
const OMAI = require('../src/ai.js');
const N = +process.argv[2] || 6, HT = +process.argv[3] || 400;
function game(lvB, lvW, preset, size) {
  const g = OM.newGame({ preset, size });
  let maxMs = 0;
  while (!g.winner) {
    const lv = g.turn === 1 ? lvB : lvW;
    const r = OMAI.think({ board: g.board, n: g.n, rules: g.rules, color: g.turn, level: lv, time: lv === 'high' ? HT : 300 });
    maxMs = Math.max(maxMs, r.ms);
    const res = OM.play(g, r.move);
    if (!res.ok) throw new Error(`${lv} 잘못된 수 ${r.move} (${res.why}) ${preset}`);
  }
  return { w: g.winner, len: g.moves.length, maxMs };
}
const pairs = [['high', 'mid'], ['mid', 'low'], ['high', 'low']];
for (const preset of ['renju', 'normal', 'free']) {
  for (const [a, b] of pairs) {
    let wa = 0, wb = 0, d = 0, mx = 0, len = 0;
    for (let k = 0; k < N; k++) {
      const aBlack = k % 2 === 0;
      const r = game(aBlack ? a : b, aBlack ? b : a, preset, k % 3 === 2 ? 19 : 15);
      mx = Math.max(mx, r.maxMs); len += r.len;
      if (r.w === 3) d++; else if ((r.w === 1) === aBlack) wa++; else wb++;
    }
    console.log(`${preset.padEnd(6)} ${a} 대 ${b}: ${wa}승 ${wb}패 ${d}무 · 평균 ${Math.round(len / N)}수 · 가장 오래 ${mx}ms`);
  }
}
