/* 로컬 서버(wrangler dev --var FAST_TEST:1)에 봇 둘을 붙여 온라인 흐름을 확인
 *   cd server && npx wrangler dev --var FAST_TEST:1  (다른 창)
 *   node test/online.test.mjs
 */
import { createRequire } from 'module';
import assert from 'assert';
const require = createRequire(import.meta.url);
const OM = require('../../src/engine.js');
const OMAI = require('../../src/ai.js');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const WSB = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newPid = () => crypto.randomUUID().replace(/-/g, '');
let passed = 0;
const ok = (name) => { passed++; console.log('✓', name); };

class Bot {
  constructor(name, code, pid) { Object.assign(this, { name, code, pid: pid || newPid() }); this.errors = []; this.last = null; this.waiters = []; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WSB}/ws/${this.code}?pid=${this.pid}&name=${encodeURIComponent(this.name)}`);
      this.ws = ws; this.closed = false;
      ws.onopen = () => resolve(this);
      ws.onerror = () => reject(new Error('ws error ' + this.name));
      ws.onclose = () => { this.closed = true; };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        const m = JSON.parse(e.data);
        if (m.t === 'error') { this.errors.push(m); return; }
        this.last = m;
        this.waiters = this.waiters.filter((w) => { if (w.f(m)) { w.res(m); return false; } return true; });
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(f, ms = 8000, label = '') {
    if (this.last && f(this.last)) return Promise.resolve(this.last);
    return new Promise((res, rej) => {
      const w = { f, res };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error('시간 초과: ' + this.name + ' ' + label + ' ' + JSON.stringify(this.last && this.last.room && { st: this.last.room.status, res: this.last.room.result }))); }, ms);
    });
  }
  get room() { return this.last && this.last.room; }
  get myColor() { return this.room.colors[this.last.seat]; }
  close() { try { this.ws.close(); } catch (e) {} }
}
const post = async (path, body) => (await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json();
function gameOf(room) { const g = OM.newGame(room.game.rules); for (const i of room.game.moves) OM.play(g, i); return g; }

async function pair(settings) {
  const { code } = await post('/api/rooms', {});
  const a = await new Bot('가나', code).connect();
  await a.wait((m) => m.room.seats[0].kind === 'human');
  const b = await new Bot('가나', code).connect();
  await a.wait((m) => m.room.seats[1].online);
  if (settings) { a.send({ t: 'settings', settings }); await a.wait((m) => Object.entries(settings).every(([k, v]) => m.room.settings[k] === v)); }
  return { code, a, b };
}
async function startGame(a, b) {
  const r0 = a.room.round;
  a.send({ t: 'start' });
  await a.wait((m) => m.room.status === 'playing' && m.room.round > r0);
  await b.wait((m) => m.room.status === 'playing' && m.room.round > r0);
}
// 둘이 번갈아 두며 끝까지
async function playOut(a, b, level = 'low', maxMoves = 400) {
  for (let k = 0; k < maxMoves; k++) {
    const room = a.room;
    if (room.status !== 'playing') return room;
    const g = gameOf(room);
    const who = room.colors[0] === g.turn ? a : b;
    const mv = OMAI.think({ board: g.board, n: g.n, rules: g.rules, color: g.turn, level, time: 50 }).move;
    const n = g.moves.length;
    who.send({ t: 'move', i: mv, n });
    await a.wait((m) => m.room.status !== 'playing' || m.room.game.moves.length > n, 8000, 'move');
  }
  return a.room;
}

try {
  // 1. 방 만들기·같은 이름 구분·설정·한 판 끝까지
  {
    const { a, b } = await pair({ preset: 'free', size: 15, turnSec: 0, color: 'black' });
    assert.notStrictEqual(a.room.seats[0].name, a.room.seats[1].name, '같은 이름이 그대로');
    ok('두 사람 입장, 이름 겹침 구분: ' + a.room.seats.map((s) => s.name).join(', '));
    await startGame(a, b);
    assert.strictEqual(a.room.colors[a.last.seat], 1, '방장이 흑이 아님');
    // 차례 아닐 때·지난 차례
    b.send({ t: 'move', i: 112, n: 0 }); await sleep(200);
    assert.ok(b.errors.some((e) => /상대 차례/.test(e.message)), '상대 차례 거절 안 됨');
    a.send({ t: 'move', i: 112, n: 5 }); await sleep(200);
    assert.ok(a.errors.some((e) => /지나간/.test(e.message)), '지난 차례 거절 안 됨');
    ok('차례·수 번호 확인');
    const end = await playOut(a, b, 'mid');
    assert.strictEqual(end.status, 'ended');
    assert.ok(['five', 'draw'].includes(end.result.reason));
    assert.strictEqual(end.score[0] + end.score[1] + end.score[2], 1);
    ok(`한 판 끝: ${end.result.reason}, ${end.game.moves.length}수, 점수 ${end.score}`);
    // 한 판 더 → 색 바뀜
    const before = end.colors.slice();
    a.send({ t: 'again' }); await b.wait((m) => m.room.ready[0]);
    b.send({ t: 'again' });
    await a.wait((m) => m.room.status === 'playing' && m.room.round === 2);
    assert.deepStrictEqual(a.room.colors, [before[1], before[0]], '색이 안 바뀜');
    ok('한 판 더: 둘 다 누르면 색 바꿔 시작');
    // 말하기
    a.send({ t: 'say', k: 2 }); await b.wait((m) => m.room.say && m.room.say.k === 2);
    ok('정해 둔 말 보내기');
    // 무르기 요청 → 거절 → 수락
    const g0 = gameOf(a.room);
    const black = a.room.colors[0] === 1 ? a : b, white = black === a ? b : a;
    black.send({ t: 'move', i: 112, n: 0 }); await a.wait((m) => m.room.game.moves.length === 1);
    white.send({ t: 'move', i: 113, n: 1 }); await a.wait((m) => m.room.game.moves.length === 2);
    black.send({ t: 'move', i: 128, n: 2 }); await a.wait((m) => m.room.game.moves.length === 3);
    white.send({ t: 'undo' }); await black.wait((m) => m.room.undoReq === (white === a ? 0 : 1));
    black.send({ t: 'undoAns', ok: false }); await white.wait((m) => m.room.undoReq === -1 && m.room.say && m.room.say.text === 'undoNo');
    assert.strictEqual(a.room.game.moves.length, 3);
    white.send({ t: 'undo' }); await black.wait((m) => m.room.undoReq >= 0);
    black.send({ t: 'undoAns', ok: true }); await white.wait((m) => m.room.game.moves.length === 1);
    assert.strictEqual(gameOf(a.room).turn, 2, '무르기 뒤 백 차례가 아님');
    ok('무르기: 상대가 거절하면 그대로, 들어주면 내 마지막 수와 그 뒤 수를 되돌림');
    // 기권
    white.send({ t: 'resign' });
    await a.wait((m) => m.room.status === 'ended');
    assert.strictEqual(a.room.result.reason, 'resign');
    assert.strictEqual(a.room.result.winner, black === a ? 0 : 1);
    ok('기권');
    // 방장이 설정 바꾸러 대기실로
    b.send({ t: 'toWaiting' }); await sleep(150); assert.strictEqual(a.room.status, 'ended', '방장 아닌데 대기실로 감');
    a.send({ t: 'toWaiting' }); await b.wait((m) => m.room.status === 'waiting');
    ok('대기실로 돌아가기는 방장만');
    // 셋째 사람
    const c = await new Bot('다라', a.code).connect(); await sleep(200);
    assert.ok(c.errors.some((e) => e.code === 'full'), '셋째가 들어감');
    ok('셋째 사람은 꽉 찼다고 거절');
    a.close(); b.close(); c.close();
  }
  // 2. 렌주 금수 거절 + 시간패
  {
    const { a, b } = await pair({ preset: 'renju', turnSec: 30, color: 'black' });
    await startGame(a, b);
    // 흑 3-3 만들기: 흑 (7,7),(7,8)... 직접 놓기
    const n = 15, P = (x, y) => y * n + x;
    const seq = [P(5, 3), P(0, 0), P(5, 2), P(0, 1), P(6, 4), P(0, 2), P(7, 4), P(0, 4)];
    for (let k = 0; k < seq.length; k++) {
      (k % 2 ? b : a).send({ t: 'move', i: seq[k], n: k });
      await a.wait((m) => m.room.game.moves.length === k + 1, 4000, 'seq ' + k);
    }
    a.send({ t: 'move', i: P(5, 4), n: seq.length }); await sleep(250);
    assert.ok(a.errors.some((e) => /3-3/.test(e.message)), '3-3 금수 거절 안 됨: ' + JSON.stringify(a.errors));
    ok('렌주 흑 3-3 금수 거절');
    // 30초 × 0.05 = 1.5초 지나면 흑 시간패
    await a.wait((m) => m.room.status === 'ended', 6000, '시간패');
    assert.strictEqual(a.room.result.reason, 'time');
    assert.strictEqual(a.room.result.winner, 1);
    ok('제한 시간 지나면 시간패');
    a.close(); b.close();
  }
  // 3. 끊김: 돌아오면 이어서, 계속 안 오면 패 / 나가기
  {
    const { a, b } = await pair({ turnSec: 0, color: 'black' });
    await startGame(a, b);
    a.send({ t: 'move', i: 112, n: 0 }); await b.wait((m) => m.room.game.moves.length === 1);
    const pidB = b.pid; b.close();
    await a.wait((m) => !m.room.seats[1].online);
    await sleep(1500);
    const b2 = await new Bot('가나', a.code, pidB).connect();
    await b2.wait((m) => m.room.status === 'playing' && m.room.seats[1].online);
    assert.strictEqual(b2.last.seat, 1); assert.strictEqual(b2.room.game.moves.length, 1);
    ok('끊겼다 같은 열쇠로 돌아오면 같은 자리에서 이어서');
    b2.close();
    await a.wait((m) => m.room.status === 'ended', 9000, '끊김패');
    assert.strictEqual(a.room.result.reason, 'gone');
    ok('끊긴 채 90초(시험은 4.5초) 지나면 패');
    a.close();
  }
  {
    const { a, b } = await pair({ turnSec: 0 });
    await startGame(a, b);
    b.send({ t: 'leave' });
    await a.wait((m) => m.room.status === 'ended');
    assert.strictEqual(a.room.result.reason, 'leave'); assert.strictEqual(a.room.result.winner, 0);
    assert.strictEqual(a.room.seats[1].kind, 'empty');
    ok('대국 중 나가면 상대 승, 자리 비움');
    const c = await new Bot('새손님', a.code).connect();
    await a.wait((m) => m.room.status === 'waiting' && m.room.seats[1].kind === 'human');
    ok('빈자리에 새 사람이 들어오면 대기실로');
    a.close(); c.close();
  }
  // 4. 빠른 참가
  {
    const q1 = await post('/api/quick');
    const a = await new Bot('빠름1', q1.code).connect();
    await a.wait((m) => m.room.seats[0].kind === 'human');
    const q2 = await post('/api/quick');
    assert.strictEqual(q1.code, q2.code, '빠른 참가가 같은 방으로 안 감');
    const b = await new Bot('빠름2', q2.code).connect();
    await a.wait((m) => m.room.seats[1].online);
    const q3 = await post('/api/quick');
    assert.notStrictEqual(q3.code, q1.code, '꽉 찬 방으로 보냄');
    ok('빠른 참가: 기다리는 방으로, 꽉 차면 새 방');
    const st = await (await fetch(BASE + '/api/stats')).json();
    assert.ok(typeof st.waitingRooms === 'number');
    a.close(); b.close();
  }
  console.log(`\n온라인 시험 ${passed}개 통과`);
  process.exit(0);
} catch (e) {
  console.error('✗', e.message);
  process.exit(1);
}
