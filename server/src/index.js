/* 오목 온라인 서버 (Cloudflare Workers + Durable Objects)
 * - Room: 방 하나 = 두 사람. 규칙 엔진(OM)으로 수를 확인하고 판 상태를 둘에게 보낸다.
 *         수마다 제한 시간(끌 수 있음), 지나면 시간패. 끊긴 채 90초가 지나도 패.
 *         무르기는 상대가 들어줘야 됨. '한 판 더'는 둘 다 누르면 색을 바꿔 시작.
 * - Lobby: 빠른 참가용 공개 방 목록 (하나뿐)
 */
import { DurableObject } from 'cloudflare:workers';
import OM from '../../src/engine.js';

const EMPTY_ROOM_MS = 30 * 60 * 1000;  // 아무도 없으면 30분 뒤 방 정리
const OPEN_ROOM_TTL = 10 * 60 * 1000;  // 빠른 참가에서 오래된 방은 제외
const GONE_MS = 90 * 1000;             // 대국 중 끊긴 채 이만큼 지나면 패
const TURN_SECS = [0, 15, 30, 60, 120];
const SAYS = 8;                        // 화면에 정해 둔 말 개수

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
});
function rand32() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
const randomCode = () => String(100000 + (rand32() % 900000));
const lobbyStub = (env) => env.LOBBY.get(env.LOBBY.idFromName('main'));
const roomStub = (env, code) => env.ROOM.get(env.ROOM.idFromName(code));

function cleanName(s) {
  s = String(s || '').replace(/[\u0000-\u001f\u007f<>&"']/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 8).join('') || '손님';
}
const emptySeat = () => ({ kind: 'empty', pid: null, name: '', offAt: 0 });
export const DEFAULT_SETTINGS = { preset: 'renju', size: 15, d3: 'black', d4: 'black', overB: 'forbid', overW: 'win', turnSec: 30, color: 'random', public: false };
export function cleanSettings(cur, s) {
  const out = { ...cur };
  if (!s || typeof s !== 'object') return out;
  const r = OM.makeRules({ ...out, ...s, size: s.size != null ? s.size : out.size });
  Object.assign(out, { preset: r.preset, size: r.size, d3: r.d3, d4: r.d4, overB: r.overB, overW: r.overW });
  if (TURN_SECS.includes(s.turnSec)) out.turnSec = s.turnSec;
  if (['random', 'black', 'white'].includes(s.color)) out.color = s.color;
  if (typeof s.public === 'boolean') out.public = s.public;
  return out;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.speed = env && env.FAST_TEST === '1' ? 0.05 : (env && +env.SPEED > 0 ? +env.SPEED : 1); // 로컬 테스트에서만 시간을 줄임
    ctx.blockConcurrencyWhile(async () => { this.room = (await ctx.storage.get('room')) || null; });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async init(code, isPublic) {
    if (this.room) return false;
    this.room = {
      v: 1, code, created: Date.now(), hostPid: null,
      settings: { ...DEFAULT_SETTINGS, public: !!isPublic },
      seats: [emptySeat(), emptySeat()],
      status: 'waiting', game: null, colors: [1, 2], round: 0, score: [0, 0, 0],
      result: null, undoReq: -1, ready: [false, false], turnAt: 0, say: null,
      deadline: 0, pending: null,
    };
    await this.arm({ kind: 'cleanup', at: Date.now() + EMPTY_ROOM_MS });
    await this.save();
    return true;
  }
  async save() { if (this.room) await this.ctx.storage.put('room', this.room); }
  async arm(p) {
    if (!this.room) return;
    this.room.pending = p || null;
    if (p) await this.ctx.storage.setAlarm(p.at);
    else await this.ctx.storage.deleteAlarm();
  }

  sockets() { return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1); }
  pidOf(ws) { try { return (ws.deserializeAttachment() || {}).pid || null; } catch (e) { return null; } }
  connectedPids(except) {
    const set = new Set();
    for (const ws of this.sockets()) if (ws !== except) { const p = this.pidOf(ws); if (p) set.add(p); }
    return set;
  }
  seatOf(pid) { return pid && this.room ? this.room.seats.findIndex((s) => s.pid === pid) : -1; }
  other(i) { return 1 - i; }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const pid = (url.searchParams.get('pid') || '').toLowerCase();
    const name = cleanName(url.searchParams.get('name'));
    server.serializeAttachment({ pid });
    const fail = (code, message) => {
      try { server.send(JSON.stringify({ t: 'error', fatal: true, code, message })); server.close(4000, code); } catch (e) { /* 이미 닫힘 */ }
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!/^[a-f0-9]{16,64}$/.test(pid)) return fail('bad_player', '접속 정보가 올바르지 않아요. 새로고침해 주세요');
    if (!this.room) return fail('no_room', '없는 방이에요. 방 번호를 확인해 주세요');
    const res = this.join(pid, name);
    if (!res.ok) return fail(res.code, res.message);
    await this.afterChange({ lobby: true });
    return new Response(null, { status: 101, webSocket: client });
  }

  join(pid, name) {
    const r = this.room;
    let i = this.seatOf(pid);
    if (i >= 0) { // 다시 들어옴
      const s = r.seats[i];
      s.offAt = 0;
      if (r.status === 'waiting') s.name = this.uniqueName(name, i);
      if (!r.hostPid || this.seatOf(r.hostPid) < 0) r.hostPid = pid;
      return { ok: true, seat: i };
    }
    if (r.status === 'playing') return { ok: false, code: 'in_game', message: '두 사람이 대국 중인 방이에요' };
    i = r.seats.findIndex((s) => s.kind === 'empty');
    if (i < 0) return { ok: false, code: 'full', message: '방이 꽉 찼어요' };
    r.seats[i] = { ...emptySeat(), kind: 'human', pid, name: this.uniqueName(name, i) };
    if (r.status === 'ended') { r.status = 'waiting'; r.game = null; r.result = null; r.score = [0, 0, 0]; }
    if (!r.hostPid || this.seatOf(r.hostPid) < 0) r.hostPid = pid;
    return { ok: true, seat: i };
  }
  uniqueName(name, idx) {
    const o = this.room.seats[this.other(idx)];
    if (o.kind === 'empty' || o.name !== name) return name;
    return Array.from(name).slice(0, 7).join('') + '2';
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 2000) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    const r = this.room;
    if (!r || !msg || typeof msg.t !== 'string') return;
    const pid = this.pidOf(ws);
    const seat = this.seatOf(pid);
    if (seat < 0) return;
    const err = (message) => { try { ws.send(JSON.stringify({ t: 'error', message })); } catch (e) { /* 무시 */ } };
    try {
      switch (msg.t) {
        case 'move': {
          if (r.status !== 'playing' || !r.game) return err('지금은 둘 수 없어요');
          const g = r.game;
          if (g.turn !== r.colors[seat]) return err('상대 차례예요');
          if ((msg.n | 0) !== g.moves.length) { err('이미 지나간 차례예요'); return this.afterChange(); }
          const res = OM.play(g, msg.i | 0);
          if (!res.ok) { err(res.forbidden ? res.why + ' 금수 자리예요' : res.why); return this.afterChange(); }
          r.undoReq = -1;
          r.turnAt = Date.now();
          if (g.winner) return this.finish(g.winner === 3 ? -1 : r.colors.indexOf(g.winner), g.winner === 3 ? 'draw' : 'five');
          return this.afterChange();
        }
        case 'undo': {
          if (r.status !== 'playing' || r.undoReq >= 0) return;
          if (!r.game.moves.some((i) => r.game.board[i] === r.colors[seat])) return err('물릴 수가 없어요');
          r.undoReq = seat;
          return this.afterChange();
        }
        case 'undoAns': {
          if (r.status !== 'playing' || r.undoReq < 0 || r.undoReq === seat) return;
          const asker = r.undoReq;
          r.undoReq = -1;
          if (msg.ok) {
            const g = r.game, c = r.colors[asker];
            // 요청한 사람의 마지막 수와 그 뒤의 수를 모두 되돌림
            while (g.moves.length) {
              const last = g.moves[g.moves.length - 1];
              const col = g.board[last];
              OM.undo(g);
              if (col === c) break;
            }
            r.turnAt = Date.now();
            r.say = { seat, k: -1, text: 'undoOk', at: Date.now() };
          } else r.say = { seat, k: -1, text: 'undoNo', at: Date.now() };
          return this.afterChange();
        }
        case 'resign':
          if (r.status !== 'playing') return;
          return this.finish(this.other(seat), 'resign');
        case 'say': {
          const k = msg.k | 0;
          if (k < 0 || k >= SAYS) return;
          const now = Date.now();
          if (r.say && r.say.seat === seat && now - r.say.at < 1500) return; // 너무 잦은 말 막기
          r.say = { seat, k, at: now };
          return this.afterChange();
        }
        case 'again': {
          if (r.status !== 'ended') return;
          if (r.seats.some((s) => s.kind !== 'human')) return err('상대가 나갔어요');
          r.ready[seat] = true;
          if (r.ready[0] && r.ready[1]) return this.newRound(false);
          return this.afterChange();
        }
        case 'start':
          if (r.hostPid !== pid) return err('방장만 시작할 수 있어요');
          if (r.status !== 'waiting') return;
          if (r.seats.some((s) => s.kind !== 'human')) return err('상대가 들어와야 시작할 수 있어요');
          if (!r.seats.every((s) => this.connectedPids().has(s.pid))) return err('상대 연결이 끊겨 있어요');
          return this.newRound(true);
        case 'settings': {
          if (r.hostPid !== pid || r.status !== 'waiting') return;
          r.settings = cleanSettings(r.settings, msg.settings);
          return this.afterChange({ lobby: true });
        }
        case 'toWaiting':
          if (r.hostPid !== pid || r.status !== 'ended') return;
          r.status = 'waiting'; r.game = null; r.result = null; r.ready = [false, false];
          return this.afterChange({ lobby: true });
        case 'leave':
          return this.leave(pid);
        case 'hello':
          return this.afterChange();
      }
    } catch (e) {
      console.error('message', e);
      err('서버에서 처리하지 못했어요');
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) { /* 이미 닫힘 */ }
    await this.dropped(ws);
  }
  async webSocketError(ws) { await this.dropped(ws); }

  async dropped(ws) {
    const r = this.room;
    if (!r) return;
    const pid = this.pidOf(ws);
    const i = this.seatOf(pid);
    if (i < 0) return;
    const online = this.connectedPids(ws);
    if (!online.has(pid)) {
      if (r.status === 'waiting') r.seats[i] = emptySeat();
      else r.seats[i].offAt = Date.now(); // 대국 중·끝난 뒤에는 자리를 남겨 두고 기다림
      if (r.hostPid === pid) { const o = r.seats[this.other(i)]; if (o.kind === 'human' && online.has(o.pid)) r.hostPid = o.pid; }
    }
    await this.afterChange({ lobby: true, except: ws });
  }

  async leave(pid) {
    const r = this.room;
    const i = this.seatOf(pid);
    if (i >= 0) {
      if (r.status === 'playing') await this.finish(this.other(i), 'leave', true);
      r.seats[i] = emptySeat();
      r.ready = [false, false];
      if (r.hostPid === pid) { const o = r.seats[this.other(i)]; r.hostPid = o.kind === 'human' ? o.pid : null; }
      if (r.status === 'ended' && r.result) r.result.left = true;
    }
    for (const w of this.ctx.getWebSockets()) if (this.pidOf(w) === pid) { try { w.close(1000, 'left'); } catch (e) { /* 무시 */ } }
    await this.afterChange({ lobby: true });
  }

  async newRound(first) {
    const r = this.room;
    if (first) {
      const host = Math.max(0, this.seatOf(r.hostPid));
      const hostColor = r.settings.color === 'black' ? 1 : r.settings.color === 'white' ? 2 : (rand32() % 2 ? 1 : 2);
      r.colors = [0, 0];
      r.colors[host] = hostColor; r.colors[this.other(host)] = 3 - hostColor;
      r.score = [0, 0, 0];
    } else r.colors = [r.colors[1], r.colors[0]];
    r.game = OM.newGame(r.settings);
    r.status = 'playing'; r.result = null; r.undoReq = -1; r.ready = [false, false];
    r.round += 1; r.turnAt = Date.now(); r.say = null;
    await this.afterChange({ lobby: true });
  }

  // winner: 자리 번호(-1이면 무승부)
  async finish(winner, reason, quiet) {
    const r = this.room;
    r.status = 'ended';
    r.result = { winner, reason, round: r.round };
    r.undoReq = -1; r.ready = [false, false];
    if (winner >= 0) r.score[winner]++; else r.score[2]++;
    if (!quiet) await this.afterChange({ lobby: true });
  }

  /* ── 다음에 할 일 예약 ── */
  async schedule(online) {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    r.deadline = 0;
    const anyone = r.seats.some((s) => s.kind === 'human' && online.has(s.pid));
    if (!anyone) return this.arm({ kind: 'cleanup', at: now + EMPTY_ROOM_MS });
    if (r.status !== 'playing' || !r.game) return this.arm(null);
    const g = r.game, step = r.round + ':' + g.moves.length;
    let best = null;
    if (r.settings.turnSec > 0) {
      const at = r.turnAt + r.settings.turnSec * 1000 * this.speed;
      r.deadline = at;
      best = { kind: 'timeout', seat: r.colors.indexOf(g.turn), step, at };
    }
    r.seats.forEach((s, i) => {
      if (online.has(s.pid)) { s.offAt = 0; return; }
      if (!s.offAt) s.offAt = now;
      const at = s.offAt + GONE_MS * this.speed;
      if (!best || at < best.at) best = { kind: 'gone', seat: i, step, at };
    });
    return this.arm(best);
  }

  async alarm() {
    const r = this.room;
    if (!r || !r.pending) return;
    const p = r.pending;
    try {
      if (p.kind === 'cleanup') {
        if (this.connectedPids().size) { await this.afterChange(); return; }
        await this.removeFromLobby();
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.room = null;
        return;
      }
      const g = r.game;
      if (!g || r.status !== 'playing' || r.round + ':' + g.moves.length !== p.step) { r.pending = null; await this.afterChange(); return; }
      if (Date.now() < p.at - 50) { await this.afterChange(); return; }
      if (p.kind === 'timeout') return this.finish(this.other(p.seat), 'time');
      if (p.kind === 'gone') {
        if (this.connectedPids().has(r.seats[p.seat].pid)) { await this.afterChange(); return; }
        return this.finish(this.other(p.seat), 'gone');
      }
    } catch (e) {
      console.error('alarm', e);
      r.pending = null;
      await this.afterChange();
    }
  }

  async afterChange(opt = {}) {
    const online = this.connectedPids(opt.except);
    await this.schedule(online);
    await this.save();
    this.broadcast(online);
    if (opt.lobby) await this.notifyLobby(online);
  }

  broadcast(online) {
    const r = this.room;
    if (!r) return;
    const seats = r.seats.map((s) => ({ kind: s.kind, name: s.name, online: s.kind === 'human' && online.has(s.pid), offAt: s.offAt || 0 }));
    const g = r.game;
    const room = {
      code: r.code, status: r.status, settings: r.settings, seats, host: this.seatOf(r.hostPid),
      colors: r.colors, round: r.round, score: r.score, result: r.result, undoReq: r.undoReq, ready: r.ready,
      deadline: r.deadline || 0, goneMs: GONE_MS * this.speed, say: r.say,
      game: g ? { rules: g.rules, moves: g.moves, winner: g.winner, line: g.line } : null,
    };
    for (const ws of this.sockets()) {
      const seat = this.seatOf(this.pidOf(ws));
      try { ws.send(JSON.stringify({ t: 'state', now: Date.now(), seat, room })); } catch (e) { /* 끊긴 소켓 */ }
    }
  }

  async notifyLobby(online) {
    const r = this.room;
    if (!r) return;
    online = online || this.connectedPids();
    const humans = r.seats.filter((s) => s.kind === 'human' && online.has(s.pid)).length;
    try { await lobbyStub(this.env).update({ code: r.code, public: r.settings.public, status: r.status, humans, max: 2 }); }
    catch (e) { console.error('lobby', e); }
  }
  async removeFromLobby() { try { await lobbyStub(this.env).remove(this.room.code); } catch (e) { /* 무시 */ } }
}

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = {};
    ctx.blockConcurrencyWhile(async () => { this.rooms = (await ctx.storage.get('rooms')) || {}; });
  }
  async save() { await this.ctx.storage.put('rooms', this.rooms); }
  prune() {
    const now = Date.now();
    for (const [c, r] of Object.entries(this.rooms)) if (now - r.updated > 2 * 60 * 60 * 1000) delete this.rooms[c];
  }
  async update(info) {
    if (!info || !info.code) return;
    const cur = this.rooms[info.code];
    if (!info.public) { if (cur) { delete this.rooms[info.code]; await this.save(); } return; }
    this.rooms[info.code] = { ...cur, ...info, created: cur ? cur.created : Date.now(), updated: Date.now() };
    this.prune();
    await this.save();
  }
  async remove(code) { if (this.rooms[code]) { delete this.rooms[code]; await this.save(); } }
  open() {
    const now = Date.now();
    return Object.values(this.rooms).filter((r) => r.public && r.status === 'waiting' && r.humans < r.max && now - r.updated < OPEN_ROOM_TTL);
  }
  // 한 사람이 기다리는 공개 방 → 막 만든 빈 공개 방 → 새로 만들기
  async quick() {
    const open = this.open().sort((a, b) => b.humans - a.humans || a.created - b.created);
    if (open.length) { open[0].updated = Date.now(); open[0].humans++; await this.save(); return { code: open[0].code }; }
    for (let k = 0; k < 6; k++) {
      const code = randomCode();
      if (await roomStub(this.env, code).init(code, true)) {
        const now = Date.now();
        this.rooms[code] = { code, public: true, status: 'waiting', humans: 0, max: 2, created: now, updated: now };
        await this.save();
        return { code };
      }
    }
    throw new Error('방을 만들지 못했어요');
  }
  async stats() {
    const now = Date.now();
    const open = this.open();
    const playing = Object.values(this.rooms).filter((r) => r.public && r.status === 'playing' && now - r.updated < 60 * 60 * 1000).length;
    return { waitingRooms: open.filter((r) => r.humans > 0).length, waitingPlayers: open.reduce((n, r) => n + r.humans, 0), playingRooms: playing };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/api/quick' && request.method === 'POST') return json(await lobbyStub(env).quick());
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) { /* 빈 본문 */ }
        const isPublic = !!(body && body.public);
        for (let k = 0; k < 6; k++) {
          const code = randomCode();
          if (await roomStub(env, code).init(code, isPublic)) {
            if (isPublic) await lobbyStub(env).update({ code, public: true, status: 'waiting', humans: 0, max: 2 });
            return json({ code });
          }
        }
        return json({ error: '방을 만들지 못했어요' }, 500);
      }
      if (url.pathname === '/api/stats') return json(await lobbyStub(env).stats());
      const m = url.pathname.match(/^\/ws\/(\d{6})$/);
      if (m) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426, headers: CORS });
        return roomStub(env, m[1]).fetch(request);
      }
      if (url.pathname === '/') return new Response('오목 서버가 돌고 있어요', { headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: '서버 오류가 났어요' }, 500);
    }
  },
};
