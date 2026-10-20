/* 오목 규칙 엔진 — OM
 * 돌: 0 빈칸, 1 흑, 2 백. 칸 번호 i = y*n + x
 * 규칙: overB/overW = 'win'(장목도 승) | 'none'(장목은 승 아님) | 'forbid'(장목 금수)
 *       d3 / d4 = 'none' | 'black' | 'both'  (3-3, 4-4 금지 대상)
 */
(function (root) {
  'use strict';
  const BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const PRESETS = {
    renju:  { overB: 'forbid', overW: 'win',  d3: 'black', d4: 'black' },
    normal: { overB: 'none',   overW: 'none', d3: 'both',  d4: 'none' },
    free:   { overB: 'win',    overW: 'win',  d3: 'none',  d4: 'none' },
  };
  const KEYS = ['overB', 'overW', 'd3', 'd4'];
  const OK = { overB: ['win', 'none', 'forbid'], overW: ['win', 'none'], d3: ['none', 'black', 'both'], d4: ['none', 'black', 'both'] };

  function makeRules(o) {
    o = o || {};
    const preset = (o.preset === 'custom' || PRESETS[o.preset]) ? o.preset : 'renju';
    const base = PRESETS[preset] || PRESETS.renju;
    const r = { preset, size: o.size === 19 ? 19 : 15 };
    for (const k of KEYS) r[k] = (preset === 'custom' && OK[k].includes(o[k])) ? o[k] : base[k];
    return r;
  }
  const overOf = (r, c) => (c === BLACK ? r.overB : r.overW);
  const exact = (r, c) => overOf(r, c) !== 'win';
  const has3 = (r, c) => r.d3 === 'both' || (r.d3 === 'black' && c === BLACK);
  const has4 = (r, c) => r.d4 === 'both' || (r.d4 === 'black' && c === BLACK);
  const restricted = (r, c) => overOf(r, c) === 'forbid' || has3(r, c) || has4(r, c);

  function runLen(b, n, x, y, dx, dy, c) {
    let k = 1, i = x + dx, j = y + dy;
    while (i >= 0 && j >= 0 && i < n && j < n && b[j * n + i] === c) { k++; i += dx; j += dy; }
    i = x - dx; j = y - dy;
    while (i >= 0 && j >= 0 && i < n && j < n && b[j * n + i] === c) { k++; i -= dx; j -= dy; }
    return k;
  }
  // (x,y)에 c가 놓였다고 보고, 이기는 줄(칸 목록)을 돌려줌
  function fiveLine(b, n, x, y, c, ex) {
    for (const [dx, dy] of DIRS) {
      const k = runLen(b, n, x, y, dx, dy, c);
      if (k === 5 || (!ex && k > 5)) {
        let i = x, j = y;
        while (i - dx >= 0 && j - dy >= 0 && i - dx < n && j - dy < n && b[(j - dy) * n + i - dx] === c) { i -= dx; j -= dy; }
        const out = [];
        for (let t = 0; t < k; t++) out.push((j + t * dy) * n + i + t * dx);
        return out;
      }
    }
    return null;
  }
  function isOver(b, n, x, y, c) {
    for (const [dx, dy] of DIRS) if (runLen(b, n, x, y, dx, dy, c) > 5) return true;
    return false;
  }
  // (x,y)에 c가 있을 때, 한 방향에서 (x,y)를 포함한 다섯을 만드는 빈칸들(오프셋)
  function fivePoints(b, n, x, y, dx, dy, c, ex) {
    const out = [];
    const k0 = runLen(b, n, x, y, dx, dy, c);
    for (let o = -4; o <= 4; o++) {
      if (!o) continue;
      const i = x + o * dx, j = y + o * dy;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const q = j * n + i;
      if (b[q] !== 0) continue;
      b[q] = c;
      const k = runLen(b, n, x, y, dx, dy, c);
      b[q] = 0;
      if (k > k0 && (k === 5 || (!ex && k >= 5))) out.push(o);
    }
    return out;
  }
  function fourCount(pts) {
    if (!pts.length) return 0;
    if (pts.length === 2 && Math.abs(pts[0] - pts[1]) === 5) return 1; // 열린 4는 하나
    return Math.min(pts.length, 2);
  }
  const straight = pts => pts.length === 2 && Math.abs(pts[0] - pts[1]) === 5;

  // 한 방향에 '진짜 열린 3'이 있는지: 한 수 더 두면 열린 4가 되고, 그 자리가 금수가 아니어야 함
  function openThree(b, n, x, y, dx, dy, c, r, depth) {
    const ex = exact(r, c);
    if (fivePoints(b, n, x, y, dx, dy, c, ex).length) return false; // 이미 4인 줄
    for (let o = -4; o <= 4; o++) {
      if (!o) continue;
      const i = x + o * dx, j = y + o * dy;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const q = j * n + i;
      if (b[q] !== 0) continue;
      b[q] = c;
      const pts = runLen(b, n, x, y, dx, dy, c) >= 5 ? [] : fivePoints(b, n, x, y, dx, dy, c, ex);
      b[q] = 0;
      if (straight(pts) && !forbiddenRaw(b, n, i, j, c, r, depth + 1)) return true;
    }
    return false;
  }

  // (x,y)가 빈칸일 때 c가 두면 금수인지. 이유 문자열('3-3','4-4','장목') 또는 ''
  function forbiddenRaw(b, n, x, y, c, r, depth) {
    depth = depth || 0;
    if (depth > 2) return '';
    const ov = overOf(r, c), a3 = has3(r, c), a4 = has4(r, c);
    if (ov !== 'forbid' && !a3 && !a4) return '';
    const idx = y * n + x;
    if (b[idx] !== 0) return '';
    b[idx] = c;
    let res = '';
    const ex = ov !== 'win';
    if (fiveLine(b, n, x, y, c, ex)) res = '';
    else if (ov === 'forbid' && isOver(b, n, x, y, c)) res = '장목';
    else {
      if (a4) {
        let f = 0;
        for (const [dx, dy] of DIRS) f += fourCount(fivePoints(b, n, x, y, dx, dy, c, ex));
        if (f >= 2) res = '4-4';
      }
      if (!res && a3) {
        let t = 0;
        for (const [dx, dy] of DIRS) if (openThree(b, n, x, y, dx, dy, c, r, depth)) t++;
        if (t >= 2) res = '3-3';
      }
    }
    b[idx] = 0;
    return res;
  }

  function newGame(opts) {
    const rules = makeRules(opts);
    const n = rules.size;
    return { rules, n, board: new Array(n * n).fill(0), moves: [], turn: BLACK, winner: 0, line: null };
  }
  function forbiddenAt(g, i, c) {
    c = c || g.turn;
    if (g.board[i]) return '';
    return forbiddenRaw(g.board, g.n, i % g.n, (i / g.n) | 0, c, g.rules, 0);
  }
  function play(g, i) {
    const n = g.n;
    if (g.winner) return { ok: false, why: '이미 끝난 판이에요' };
    if (!(i >= 0 && i < n * n) || g.board[i]) return { ok: false, why: '빈 자리가 아니에요' };
    const f = forbiddenAt(g, i);
    if (f) return { ok: false, why: f, forbidden: true };
    const c = g.turn;
    g.board[i] = c;
    g.moves.push(i);
    const line = fiveLine(g.board, n, i % n, (i / n) | 0, c, exact(g.rules, c));
    if (line) { g.winner = c; g.line = line; }
    else if (g.moves.length === n * n) g.winner = 3;
    g.turn = 3 - c;
    if (!g.winner && !hasLegal(g)) g.winner = 3;
    return { ok: true, win: !!line };
  }
  function hasLegal(g) {
    for (let i = 0; i < g.board.length; i++) if (!g.board[i] && !forbiddenAt(g, i)) return true;
    return false;
  }
  function undo(g) {
    if (!g.moves.length) return false;
    const i = g.moves.pop();
    g.turn = g.board[i];
    g.board[i] = 0;
    g.winner = 0; g.line = null;
    return true;
  }
  // 지금 차례 돌의 금수 자리 목록 {칸: 이유}
  function forbiddenList(g) {
    const out = {};
    const c = g.turn, n = g.n, b = g.board;
    if (g.winner || !restricted(g.rules, c)) return out;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (b[i]) continue;
      // 근처(4칸 안)에 같은 색 돌이 2개 이상일 때만 따져 봄
      let k = 0;
      for (let yy = Math.max(0, y - 4); yy <= Math.min(n - 1, y + 4) && k < 2; yy++)
        for (let xx = Math.max(0, x - 4); xx <= Math.min(n - 1, x + 4); xx++) if (b[yy * n + xx] === c && ++k >= 2) break;
      if (k < 2) continue;
      const f = forbiddenRaw(b, n, x, y, c, g.rules, 0);
      if (f) out[i] = f;
    }
    return out;
  }

  const OM = { BLACK, WHITE, DIRS, PRESETS, makeRules, overOf, exact, has3, has4, restricted, runLen, fiveLine, fivePoints,
    forbiddenRaw, newGame, forbiddenAt, play, undo, forbiddenList, hasLegal };
  root.OM = OM;
  if (typeof module !== 'undefined' && module.exports) module.exports = OM;
})(typeof self !== 'undefined' ? self : this);
