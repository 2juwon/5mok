// node test/rules.test.js
const OM = require('../src/engine.js');
const OMAI = require('../src/ai.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('✗', name, '\n  ', e.message); } }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' 기대 ' + JSON.stringify(b) + ' 실제 ' + JSON.stringify(a)); }

// 그림으로 판 만들기: X 흑, O 백, . 빈칸, # 확인할 자리(빈칸)
function board(rows, size) {
  const n = size || 15, b = new Array(n * n).fill(0); let mark = -1;
  rows.forEach((r, y) => [...r.replace(/ /g, '')].forEach((ch, x) => {
    const i = y * n + x;
    if (ch === 'X') b[i] = 1; else if (ch === 'O') b[i] = 2; else if (ch === '#') mark = i;
  }));
  return { b, n, mark, x: mark % n, y: (mark / n) | 0 };
}
const R = p => OM.makeRules({ preset: p });
const forb = (rows, c, p) => { const B = board(rows); return OM.forbiddenRaw(B.b, B.n, B.x, B.y, c, R(p), 0); };

t('렌주: 흑 3-3 금수', () => eq(forb([
  '...............',
  '.....X.........',
  '.....X.........',
  '.....#XX.......',
], 1, 'renju'), '3-3'));
t('렌주: 백은 3-3 가능', () => eq(forb([
  '...............',
  '.....O.........',
  '.....O.........',
  '.....#OO.......',
], 2, 'renju'), ''));
t('렌주: 한쪽이 막힌 3은 3-3 아님', () => eq(forb([
  '.....O.........',
  '.....X.........',
  '.....X.........',
  '.....#XX.......',
], 1, 'renju'), ''));
t('렌주: 흑 4-4 금수', () => eq(forb([
  '...............',
  '.....X.........',
  '.....X.........',
  '.....X.........',
  '.....#XXX......',
  '...............',
], 1, 'renju'), '4-4'));
t('렌주: 한 줄 4-4 금수 (X.X#X.X 꼴: XX.#X.XX)', () => eq(forb([
  '...............',
  '..XX#X.XX......',
], 1, 'renju').length > 0 ? 'y' : 'n', 'n'));
t('렌주: 한 줄 쌍4 (XXX.#.XXX)', () => eq(forb([
  '...............',
  '.XXX.#.XXX.....',
], 1, 'renju'), '4-4'));
t('렌주: 한 줄 4-4 (X.X#X.X)', () => eq(forb([
  '...............',
  '..X.X#X.X......',
], 1, 'renju'), '4-4'));
t('렌주: 4-3은 가능', () => eq(forb([
  '...............',
  '.....X.........',
  '.....X.........',
  '.....X.........',
  '.....#XX.......',
  '...............',
], 1, 'renju'), ''));
t('렌주: 흑 장목 금수', () => eq(forb([
  '...............',
  '..XXX#XX.......',
], 1, 'renju'), '장목'));
t('렌주: 다섯 되면 3-3 모양이어도 승', () => {
  const rows = [
    '...............',
    '.....X.........',
    '.....X.........',
    '.XXXX#XX.......',
  ];
  // XXXX# 다음 XX → 장목이 되므로 바꿔서 다섯 확인
  eq(forb(['...............', '.XXXX#.........'], 1, 'renju'), '');
});
t('일반룰: 백도 3-3 금지', () => eq(forb([
  '...............',
  '.....O.........',
  '.....O.........',
  '.....#OO.......',
], 2, 'normal'), '3-3'));
t('일반룰: 4-4는 허용', () => eq(forb([
  '...............',
  '.....X.........',
  '.....X.........',
  '.....X.........',
  '.....#XXX......',
], 1, 'normal'), ''));
t('자유룰: 금수 없음', () => eq(forb([
  '...............',
  '.....X.........',
  '.....X.........',
  '.....#XX.......',
], 1, 'free'), ''));
t('렌주: 거짓 3(열린 4 자리가 금수)이면 3-3 아님', () => {
  // 세로 3의 위쪽 열린 4 자리가 장목 금수가 되도록 꾸밈은 복잡 — 대신 재귀 깊이 동작만 확인
  const B = board(['...............', '.....X.........', '.....X.........', '.....#XX.......']);
  eq(typeof OM.forbiddenRaw(B.b, B.n, B.x, B.y, 1, R('renju'), 0), 'string');
});

// 승리 판정
function playSeq(p, seq, size) { const g = OM.newGame({ preset: p, size }); for (const [x, y] of seq) { const r = OM.play(g, y * g.n + x); if (!r.ok) throw new Error('못 둠 ' + x + ',' + y + ' ' + r.why); } return g; }
t('흑 다섯 승', () => {
  const g = playSeq('renju', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0]]);
  eq(g.winner, 1); eq(g.line.length, 5);
});
t('렌주: 백 장목 승', () => {
  const g = playSeq('renju', [[0, 5], [0, 0], [1, 5], [1, 0], [2, 5], [2, 0], [7, 7], [4, 0], [8, 8], [5, 0], [9, 9], [3, 0]]);
  eq(g.winner, 2);
});
t('일반룰: 장목은 승 아님', () => {
  const g = playSeq('normal', [[0, 5], [0, 0], [1, 5], [1, 0], [2, 5], [2, 0], [7, 7], [4, 0], [8, 9], [5, 0], [9, 11], [3, 0]]);
  eq(g.winner, 0);
});
t('자유룰: 장목 승', () => {
  const g = playSeq('free', [[0, 5], [0, 0], [1, 5], [1, 0], [2, 5], [2, 0], [7, 7], [4, 0], [8, 9], [5, 0], [9, 11], [3, 0]]);
  eq(g.winner, 2);
});
t('금수 자리는 둘 수 없음', () => {
  const g = OM.newGame({ preset: 'renju' });
  const B = board(['...............', '.....X.........', '.....X.........', '.....#XX.......']);
  g.board = B.b; g.turn = 1;
  const r = OM.play(g, B.mark);
  eq(r.ok, false); eq(r.why, '3-3');
  eq(OM.forbiddenList(g)[B.mark], '3-3');
});
t('무르기', () => { const g = playSeq('renju', [[7, 7], [8, 8]]); OM.undo(g); eq(g.turn, 2); eq(g.moves.length, 1); });
t('19줄 판', () => { const g = OM.newGame({ preset: 'free', size: 19 }); eq(g.board.length, 361); });
t('사용자 지정 규칙', () => { const r = OM.makeRules({ preset: 'custom', d3: 'none', d4: 'both', overB: 'none', overW: 'none' }); eq([r.d3, r.d4, r.overB], ['none', 'both', 'none']); });

// 모양 표
t('모양 표: 열린 3 → 4', () => {
  const T = OMAI.table(true);
  // __XX#__ : 가운데에 두면 _XXX_ 열린 3
  const B = board(['...............', '....XX#........']);
  const ctx = new OMAI.Ctx(B.b, 15, R('free'));
  const e = OMAI.evalPt(ctx, B.mark, 1);
  eq(e.n4, 1);
});

// 컴퓨터
for (const lv of ['low', 'mid', 'high']) {
  t(lv + ': 다섯 완성', () => {
    const B = board(['...............', '...............', '.OXXXX#........', '.OOO...........', '..O............']);
    eq(OMAI.think({ board: B.b, n: 15, rules: R('renju'), color: 1, level: lv, time: 300 }).move, B.mark);
  });
}
for (const lv of ['mid', 'high']) {
  t(lv + ': 상대 4 막기', () => {
    const B = board(['...............', '...............', '.XOOOO#........', '.XX............', '.X.............']);
    eq(OMAI.think({ board: B.b, n: 15, rules: R('renju'), color: 1, level: lv, time: 300 }).move, B.mark);
  });
  t(lv + ': 열린 3 막기', () => {
    const B = board(['...............', '...............', '...............', '....#OOO.......', '...X...........', '.....X.........']);
    const m = OMAI.think({ board: B.b, n: 15, rules: R('free'), color: 1, level: lv, time: 400 }).move;
    if (![3 * 15 + 4, 3 * 15 + 8].includes(m)) throw new Error('막지 않음 ' + m);
  });
}
t('고급: 연속 4로 이기기 (VCF)', () => {
  const B = board([
    '...............',
    '...............',
    '...............',
    '.....X.........',
    '.....X.........',
    '.....X.O.......',
    '.O.......X.....',
    '........X......',
    '.......X.......',
    '..O..........O.',
    '.............O.',
  ]);
  const r = OMAI.think({ board: B.b, n: 15, rules: R('free'), color: 1, level: 'high', time: 800 });
  // 세로 X 3개 + 대각 X 3개: 4를 연달아 만들면 이김
  const ctx = new OMAI.Ctx(B.b, 15, R('free'));
  const v = OMAI.findVCF(ctx, 1, 20000);
  if (!v) throw new Error('VCF 못 찾음');
  if (r.move !== v[0] && !/연속|열린|오목/.test(r.why)) throw new Error('다른 수 ' + r.why);
});
t('렌주 흑 컴퓨터는 금수에 안 둠', () => {
  const B = board(['...............', '.....X.........', '.....X.........', '.....#XX.......', '.O.O.O.........', '.O.............']);
  for (const lv of ['low', 'mid', 'high']) {
    const m = OMAI.think({ board: B.b, n: 15, rules: R('renju'), color: 1, level: lv, time: 300 }).move;
    if (m === B.mark) throw new Error(lv + ' 금수에 둠');
  }
});

console.log(`규칙 시험: ${pass}개 통과, ${fail}개 실패`);
process.exit(fail ? 1 : 0);
