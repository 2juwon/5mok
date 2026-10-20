/* 오목 컴퓨터 — OMAI
 * 모양 표: 한 방향 11칸(가운데 = 놓을 자리)을 3진수로 묶어 미리 계산한 등급
 *   7 다섯, 6 열린 4(또는 한 줄 쌍4), 5 막힌 4, 4 열린 3, 3 막힌 3, 2 열린 2, 1 막힌 2
 * 초급: 눈앞 점수 + 큰 흔들림 / 중급: 2수 앞 / 고급: 연속 4(VCF) 찾기 + 상대 VCF 막기 + 알파베타 반복 심화
 */
(function (root) {
  'use strict';
  const OM = root.OM || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const DIRS = OM.DIRS;
  const POW = []; for (let k = 0, p = 1; k < 10; k++, p *= 3) POW.push(p);
  const TABLES = {};

  function table(ex) {
    const key = ex ? 1 : 0;
    if (TABLES[key]) return TABLES[key];
    const T = new Int8Array(59049).fill(-1);
    const isF = r => r === 5 || (!ex && r > 5);
    const run = a => { let k = 1; for (let i = 6; i < 11 && a[i] === 1; i++) k++; for (let i = 4; i >= 0 && a[i] === 1; i--) k++; return k; };
    const enc = a => { let c = 0, k = 0; for (let i = 0; i < 11; i++) { if (i === 5) continue; c += a[i] * POW[k++]; } return c; };
    function lv(cd) {
      if (T[cd] >= 0) return T[cd];
      const a = new Int8Array(11);
      let x = cd;
      for (let i = 0; i < 11; i++) { if (i === 5) { a[i] = 1; continue; } a[i] = x % 3; x = (x / 3) | 0; }
      let res;
      if (isF(run(a))) res = 7;
      else {
        let W = 0, best = 0;
        for (let q = 0; q < 11; q++) {
          if (q === 5 || a[q] !== 0) continue;
          a[q] = 1;
          if (isF(run(a))) W++;
          else { const l = lv(enc(a)); if (l > best) best = l; }
          a[q] = 0;
        }
        res = W >= 2 ? 6 : W === 1 ? 5 : best === 6 ? 4 : best === 5 ? 3 : best === 4 ? 2 : best === 3 ? 1 : 0;
      }
      T[cd] = res;
      return res;
    }
    for (let cd = 0; cd < 59049; cd++) lv(cd);
    TABLES[key] = T;
    return T;
  }

  // 조브리스트 해시 (최대 19×19)
  let seed = 0x2f6b1d3;
  const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const Z1 = [null, [], []], Z2 = [null, [], []];
  for (let c = 1; c <= 2; c++) for (let i = 0; i < 361; i++) { Z1[c].push(rnd32()); Z2[c].push(rnd32() & 0xfffff); }

  function Ctx(board, n, rules) {
    this.n = n; this.rules = rules;
    this.b = Int8Array.from(board);
    this.near = new Int16Array(n * n);
    this.T = [null, table(OM.exact(rules, 1)), table(OM.exact(rules, 2))];
    this.res = [false, OM.restricted(rules, 1), OM.restricted(rules, 2)];
    this.overF = [false, OM.overOf(rules, 1) === 'forbid', OM.overOf(rules, 2) === 'forbid'];
    this.h1 = 0; this.h2 = 0; this.stones = 0;
    for (let i = 0; i < n * n; i++) if (this.b[i]) { const c = this.b[i]; this.b[i] = 0; this.place(i, c); }
  }
  Ctx.prototype.place = function (i, c) {
    const n = this.n, x = i % n, y = (i / n) | 0;
    this.b[i] = c; this.stones++;
    this.h1 ^= Z1[c][i]; this.h2 ^= Z2[c][i];
    for (let yy = Math.max(0, y - 2); yy <= Math.min(n - 1, y + 2); yy++)
      for (let xx = Math.max(0, x - 2); xx <= Math.min(n - 1, x + 2); xx++) this.near[yy * n + xx]++;
  };
  Ctx.prototype.unplace = function (i, c) {
    const n = this.n, x = i % n, y = (i / n) | 0;
    this.b[i] = 0; this.stones--;
    this.h1 ^= Z1[c][i]; this.h2 ^= Z2[c][i];
    for (let yy = Math.max(0, y - 2); yy <= Math.min(n - 1, y + 2); yy++)
      for (let xx = Math.max(0, x - 2); xx <= Math.min(n - 1, x + 2); xx++) this.near[yy * n + xx]--;
  };
  Ctx.prototype.key = function () { return this.h2 * 4294967296 + this.h1; };

  const VAL = [0, 20, 80, 180, 900, 1100, 0, 0];
  const FORB = { s: -1, forb: true, five: false, n6: 0, n5: 0, n4: 0 };

  function longRun(b, n, x, y, c) {
    for (const [dx, dy] of DIRS) {
      let k = 1, i = x + dx, j = y + dy;
      while (i >= 0 && j >= 0 && i < n && j < n && b[j * n + i] === c) { k++; i += dx; j += dy; }
      i = x - dx; j = y - dy;
      while (i >= 0 && j >= 0 && i < n && j < n && b[j * n + i] === c) { k++; i -= dx; j -= dy; }
      if (k > 5) return true;
    }
    return false;
  }

  // 빈칸 i에 c가 둘 때의 점수
  function evalPt(ctx, i, c) {
    const b = ctx.b, n = ctx.n, T = ctx.T[c], x = i % n, y = (i / n) | 0;
    let n6 = 0, n5 = 0, n4 = 0, s = 0, adj = 0;
    for (let d = 0; d < 4; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      let cd = 0, k = 0;
      for (let o = -5; o <= 5; o++) {
        if (o === 0) continue;
        const xi = x + o * dx, yj = y + o * dy;
        let v;
        if (xi < 0 || yj < 0 || xi >= n || yj >= n) v = 2;
        else { const s0 = b[yj * n + xi]; v = s0 === 0 ? 0 : s0 === c ? 1 : 2; if (s0 && (o === 1 || o === -1)) adj++; }
        cd += v * POW[k++];
      }
      const l = T[cd];
      if (l === 7) return { s: 1e9, five: true, n6: 0, n5: 0, n4: 0 };
      if (l === 6) n6++; else if (l === 5) n5++; else if (l === 4) n4++;
      s += VAL[l];
    }
    if (n6) s += 1e6; else if (n5 >= 2) s += 5e5; else if (n5 && n4) s += 2e5; else if (n4 >= 2) s += 5e4;
    s += adj * 2;
    if (ctx.res[c] && (n6 || n5 + n4 >= 2 || (ctx.overF[c] && longRun(b, n, x, y, c)))) {
      if (OM.forbiddenRaw(b, n, x, y, c, ctx.rules, 0)) return FORB;
    }
    return { s, five: false, n6, n5, n4 };
  }
  function isFivePt(ctx, i, c) {
    const b = ctx.b, n = ctx.n, T = ctx.T[c], x = i % n, y = (i / n) | 0;
    for (let d = 0; d < 4; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      // 빠른 걸러내기: 바로 옆에 같은 돌이 없으면 이 방향 다섯 불가
      let cd = 0, k = 0;
      for (let o = -5; o <= 5; o++) {
        if (o === 0) continue;
        const xi = x + o * dx, yj = y + o * dy;
        let v;
        if (xi < 0 || yj < 0 || xi >= n || yj >= n) v = 2;
        else { const s0 = b[yj * n + xi]; v = s0 === 0 ? 0 : s0 === c ? 1 : 2; }
        cd += v * POW[k++];
      }
      if (T[cd] === 7) return true;
    }
    return false;
  }

  function gen(ctx, c) {
    const b = ctx.b, near = ctx.near, o = 3 - c, out = [], N = b.length;
    for (let i = 0; i < N; i++) {
      if (b[i] || !near[i]) continue;
      const A = evalPt(ctx, i, c), D = evalPt(ctx, i, o);
      const dv = D.forb ? 0 : D.s;
      out.push({ i, A, D, sc: A.forb ? -1 : A.s + dv * 0.85 });
    }
    out.sort((p, q) => q.sc - p.sc);
    return out;
  }

  const WIN = 1e8;
  // 둘 차례인 쪽 기준. 내가 가장 센 수를 두거나(그러면 상대가 가장 센 수로 받음),
  // 상대의 가장 센 자리를 막거나(그러면 상대는 두 번째로 센 수) 중 나은 쪽
  function staticEval(list) {
    let ma = 0, md = 0, md2 = 0, sa = 0, sd = 0;
    for (const m of list) {
      if (!m.A.forb) { if (m.A.s > ma) ma = m.A.s; sa += m.A.s; }
      if (!m.D.forb) {
        const v = m.D.s;
        if (v > md) { md2 = md; md = v; } else if (v > md2) md2 = v;
        sd += v;
      }
    }
    return Math.max(ma - md * 0.8, -md2 * 0.8) + (sa - sd) * 0.08;
  }

  function nega(ctx, c, depth, alpha, beta, ply, S) {
    if ((++S.nodes & 63) === 0 && Date.now() > S.deadline) S.abort = true;
    if (S.abort) return 0;
    const list = gen(ctx, c);
    if (!list.length) return 0;
    const oppFive = [];
    for (const m of list) { if (m.A.five) return WIN - ply; if (m.D.five) oppFive.push(m); }
    let moves;
    if (oppFive.length) {
      if (oppFive.length >= 2 || oppFive[0].A.forb) return -(WIN - ply - 1);
      if (ply > 24) return staticEval(list);
      moves = [oppFive[0]];
    } else {
      for (const m of list) if (!m.A.forb && (m.A.n6 || m.A.n5 >= 2)) return WIN - ply - 2;
      if (depth <= 0) return staticEval(list);
      moves = [];
      // 상대가 열린 4를 만들 수 있으면(열린 3·4-3): 막는 수 또는 내 4만
      let threat = false;
      for (const m of list) if (!m.D.forb && m.D.s >= 1e6) { threat = true; break; }
      const width = ply <= 1 ? S.width : Math.max(5, S.width - 2);
      if (threat) {
        for (const m of list) {
          if (m.A.forb) continue;
          if (m.D.s >= 1000 || m.A.n5) moves.push(m);
          if (moves.length >= width + 2) break;
        }
      }
      if (!moves.length) {
        let extra = 0;
        for (const m of list) {
          if (m.A.forb) continue;
          if (moves.length < width) moves.push(m);
          else if (m.A.n5 && extra < 3) { moves.push(m); extra++; }
        }
      }
      if (!moves.length) return 0;
    }
    let best = -Infinity;
    for (const m of moves) {
      ctx.place(m.i, c);
      const v = -nega(ctx, 3 - c, depth - 1, -beta, -alpha, ply + 1, S);
      ctx.unplace(m.i, c);
      if (S.abort) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function rootSearch(ctx, c, cands, maxDepth, width, deadline) {
    let order = cands.slice(), bestMove = order[0].i, bestVal = 0, reached = 0;
    for (let d = 2; d <= maxDepth; d += 2) {
      const S = { deadline, abort: false, width, nodes: 0 };
      let alpha = -Infinity, curBest = -1, curVal = -Infinity;
      const vals = new Map();
      for (const m of order) {
        ctx.place(m.i, c);
        const v = -nega(ctx, 3 - c, d - 1, -Infinity, -alpha, 1, S);
        ctx.unplace(m.i, c);
        if (S.abort) break;
        vals.set(m.i, v);
        if (v > curVal) { curVal = v; curBest = m.i; }
        if (v > alpha) alpha = v;
      }
      if (S.abort && curBest < 0) break;
      if (S.abort) { if (curVal > bestVal || curBest === bestMove) { bestMove = curBest; bestVal = curVal; } break; }
      bestMove = curBest; bestVal = curVal; reached = d;
      if (curVal >= WIN - 100 || curVal <= -WIN + 100) break;
      order = order.slice().sort((p, q) => (vals.get(q.i) ?? -Infinity) - (vals.get(p.i) ?? -Infinity));
    }
    return { move: bestMove, val: bestVal, depth: reached };
  }

  // 연속 4로 이기는 길 찾기 (c가 둘 차례)
  function blockPts(ctx, i, c) {
    const n = ctx.n, x = i % n, y = (i / n) | 0, ex = OM.exact(ctx.rules, c), out = [];
    for (const [dx, dy] of DIRS) {
      for (const o of OM.fivePoints(ctx.b, n, x, y, dx, dy, c, ex)) {
        const q = (y + o * dy) * n + x + o * dx;
        if (!out.includes(q)) out.push(q);
      }
    }
    return out;
  }
  function vcf(ctx, c, S, depth) {
    depth = depth || 0;
    if (++S.nodes > S.max || depth > S.maxDepth || Date.now() > S.deadline) return null;
    const key = ctx.key();
    if (S.fail.has(key)) return null;
    const b = ctx.b, near = ctx.near, o = 3 - c, N = b.length, fours = [];
    for (let i = 0; i < N; i++) {
      if (b[i] || !near[i]) continue;
      const A = evalPt(ctx, i, c);
      if (A.five) return [i];
      if (!A.forb && (A.n6 || A.n5)) fours.push({ i, s: A.s });
    }
    for (let i = 0; i < N; i++) if (!b[i] && near[i] && isFivePt(ctx, i, o)) { S.fail.add(key); return null; }
    fours.sort((p, q) => q.s - p.s);
    for (const f of fours) {
      ctx.place(f.i, c);
      const blocks = blockPts(ctx, f.i, c);
      let r = null;
      if (blocks.length >= 2) r = [f.i];
      else if (blocks.length === 1) {
        const q = blocks[0];
        if (ctx.res[o] && OM.forbiddenRaw(ctx.b, ctx.n, q % ctx.n, (q / ctx.n) | 0, o, ctx.rules, 0)) r = [f.i];
        else {
          ctx.place(q, o);
          const sub = vcf(ctx, c, S, depth + 1);
          ctx.unplace(q, o);
          if (sub) r = [f.i, q].concat(sub);
        }
      }
      ctx.unplace(f.i, c);
      if (r) return r;
    }
    S.fail.add(key);
    return null;
  }
  function findVCF(ctx, c, maxNodes, deadline) {
    return vcf(ctx, c, { nodes: 0, max: maxNodes, maxDepth: 14, fail: new Set(), deadline: deadline || Infinity });
  }

  // 한 방향 등급(놓인 돌 기준이 아니라 빈칸 q에 c를 놓을 때)
  function dirLevel(ctx, q, c, d) {
    const b = ctx.b, n = ctx.n, x = q % n, y = (q / n) | 0, dx = DIRS[d][0], dy = DIRS[d][1];
    let cd = 0, k = 0;
    for (let o = -5; o <= 5; o++) {
      if (o === 0) continue;
      const xi = x + o * dx, yj = y + o * dy;
      let v;
      if (xi < 0 || yj < 0 || xi >= n || yj >= n) v = 2;
      else { const s0 = b[yj * n + xi]; v = s0 === 0 ? 0 : s0 === c ? 1 : 2; }
      cd += v * POW[k++];
    }
    return ctx.T[c][cd];
  }
  // 3과 4를 이어 가며 이기는 길 (c가 둘 차례). 성공하면 첫 수
  function vct(ctx, c, S, depth) {
    if (++S.nodes > S.max || Date.now() > S.deadline) { S.out = true; return false; }
    if (depth > S.maxDepth) return false;
    const key = ctx.key() + depth * 0.5;
    if (S.fail.has(key)) return false;
    const b = ctx.b, near = ctx.near, o = 3 - c, N = b.length, n = ctx.n;
    const atk = [];
    for (let i = 0; i < N; i++) {
      if (b[i] || !near[i]) continue;
      const A = evalPt(ctx, i, c);
      if (A.five) { if (depth === 0) S.first = i; return true; }
      if (!A.forb && (A.n6 || A.n5 || A.n4)) atk.push({ i, A });
    }
    for (let i = 0; i < N; i++) if (!b[i] && near[i] && isFivePt(ctx, i, o)) { S.fail.add(key); return false; }
    atk.sort((p, q) => q.A.s - p.A.s);
    for (const m of atk.slice(0, 12)) {
      if (m.A.n6 || m.A.n5 >= 2 || (m.A.n5 && m.A.n4)) { if (depth === 0) S.first = m.i; return true; }
      ctx.place(m.i, c);
      let ok;
      if (m.A.n5) {
        // 4: 막을 자리 하나
        const q = blockPts(ctx, m.i, c)[0];
        if (q == null) ok = false;
        else if (ctx.res[o] && OM.forbiddenRaw(b, n, q % n, (q / n) | 0, o, ctx.rules, 0)) ok = true;
        else { ctx.place(q, o); ok = vct(ctx, c, S, depth + 1); ctx.unplace(q, o); }
      } else {
        // 열린 3: 막는 자리들 + 상대의 4(반격) 모두 견뎌야 함
        const def = new Set();
        const x = m.i % n, y = (m.i / n) | 0;
        for (let d = 0; d < 4; d++) {
          // m에서 이 방향이 열린 3인지
          ctx.unplace(m.i, c);
          const l = dirLevel(ctx, m.i, c, d);
          ctx.place(m.i, c);
          if (l !== 4) continue;
          for (let k = -5; k <= 5; k++) {
            const xi = x + k * DIRS[d][0], yj = y + k * DIRS[d][1];
            if (xi < 0 || yj < 0 || xi >= n || yj >= n) continue;
            const q = yj * n + xi;
            if (!b[q] && dirLevel(ctx, q, c, d) >= 5) def.add(q);
          }
        }
        for (let i = 0; i < N; i++) {
          if (b[i] || !near[i] || def.has(i)) continue;
          const D = evalPt(ctx, i, o);
          if (!D.forb && (D.n5 || D.n6)) def.add(i);
        }
        ok = def.size > 0;
        for (const q of def) {
          if (ctx.res[o] && OM.forbiddenRaw(b, n, q % n, (q / n) | 0, o, ctx.rules, 0)) continue;
          ctx.place(q, o);
          let r;
          // 상대가 4로 반격했으면 내가 막아야 함
          const five = blockPts(ctx, q, o);
          if (five.length >= 2) r = false;
          else if (five.length === 1) {
            const z = five[0];
            if (ctx.res[c] && OM.forbiddenRaw(b, n, z % n, (z / n) | 0, c, ctx.rules, 0)) r = false;
            else { ctx.place(z, c); r = vct(ctx, c, S, depth + 1); ctx.unplace(z, c); }
          } else r = vct(ctx, c, S, depth + 1);
          ctx.unplace(q, o);
          if (!r) { ok = false; break; }
        }
      }
      ctx.unplace(m.i, c);
      if (S.out) return false;
      if (ok) { if (depth === 0) S.first = m.i; return true; }
    }
    S.fail.add(key);
    return false;
  }
  function findVCT(ctx, c, maxNodes, deadline, maxDepth) {
    const S = { nodes: 0, max: maxNodes, maxDepth: maxDepth || 6, fail: new Set(), deadline, out: false, first: null };
    const ok = vct(ctx, c, S, 0);
    return ok ? S.first : null;
  }

  const LEVELS = { low: '초급', mid: '중급', high: '고급' };

  // opt: {board, n, rules, color, level, time(ms), rand}
  function think(opt) {
    const t0 = Date.now();
    const rand = opt.rand || Math.random;
    const rules = OM.makeRules(opt.rules);
    const n = rules.size, c = opt.color, o = 3 - c;
    const ctx = new Ctx(opt.board, n, rules);
    const level = opt.level || 'mid';
    const time = opt.time || (level === 'high' ? 1500 : 400);
    const done = (move, why) => ({ move, why, ms: Date.now() - t0 });
    const mid = ((n / 2) | 0) * n + ((n / 2) | 0);

    if (ctx.stones === 0) {
      if (level === 'low' && rand() < 0.5) {
        const dx = Math.floor(rand() * 3) - 1, dy = Math.floor(rand() * 3) - 1;
        return done(mid + dy * n + dx, '첫 수');
      }
      return done(mid, '첫 수');
    }
    const list = gen(ctx, c);
    const playable = list.filter(m => !m.A.forb);
    if (!playable.length) {
      for (let i = 0; i < n * n; i++) if (!ctx.b[i] && !OM.forbiddenRaw(ctx.b, n, i % n, (i / n) | 0, c, rules, 0)) return done(i, '둘 곳 찾기');
      return done(-1, '둘 곳 없음');
    }
    const win = playable.find(m => m.A.five);
    if (win) return done(win.i, '오목 완성');
    const oppFive = playable.filter(m => m.D.five);

    if (level === 'low') {
      if (oppFive.length && rand() < 0.9) return done(oppFive[0].i, '4 막기');
      let best = null, bv = -Infinity;
      for (const m of playable.slice(0, 10)) {
        const dv = m.D.forb ? 0 : m.D.s;
        const v = (Math.min(m.A.s, 3e5) + 0.45 * Math.min(dv, 3e5)) * (0.55 + rand() * 0.9);
        if (v > bv) { bv = v; best = m; }
      }
      return done(best.i, '느낌대로');
    }

    if (oppFive.length) return done(oppFive[0].i, '4 막기');
    const sure = playable.find(m => m.A.n6 || m.A.n5 >= 2);
    if (sure) return done(sure.i, sure.A.n6 ? '열린 4' : '4-4');

    if (level === 'mid') {
      const cands = playable.slice(0, 10);
      const r = rootSearch(ctx, c, cands, 2, 8, t0 + time);
      // 가끔은 비슷한 다른 수
      if (rand() < 0.2 && cands.length > 1 && cands[1].sc > cands[0].sc * 0.8 && Math.abs(r.val) < 1e5) return done(cands[1].i, '두 수 앞');
      return done(r.move, '두 수 앞');
    }

    // 고급
    const deadline = t0 + time;
    const mine = findVCF(ctx, c, 30000, t0 + time * 0.25);
    if (mine) return done(mine[0], '연속 4로 끝내기');
    const myT = findVCT(ctx, c, 20000, t0 + time * 0.4, 6);
    if (myT != null) return done(myT, '3·4로 몰아붙이기');
    let cands = playable.slice(0, 14);
    for (const m of playable) if (m.A.n5 && !cands.includes(m)) cands.push(m);
    const oppThreat = () => findVCF(ctx, o, 3000, t0 + time * 0.75) || findVCT(ctx, o, 1500, t0 + time * 0.75, 4) != null;
    const theirs = oppThreat();
    if (theirs) {
      const keep = [];
      for (const m of cands) {
        ctx.place(m.i, c);
        const still = oppThreat();
        ctx.unplace(m.i, c);
        if (!still) keep.push(m);
        if (Date.now() > t0 + time * 0.75) break;
      }
      if (keep.length) cands = keep;
    }
    const r = rootSearch(ctx, c, cands, 10, 9, deadline);
    return done(r.move, theirs ? '상대 공격 막기' : '깊이 ' + r.depth + '수 읽기');
  }

  const OMAI = { think, table, evalPt, gen, findVCF, findVCT, Ctx, LEVELS };
  root.OMAI = OMAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = OMAI;
})(typeof self !== 'undefined' ? self : this);
