// Execute com o servidor local iniciado: npx tsx server/socket.integration.ts
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import type { PrivateState, PublicState } from '../src/types.ts';

const url = process.env.TEST_URL ?? 'http://localhost:3000';
const connect = (invite?: string) => new Promise<Socket>((resolve, reject) => {
  const socket = io(url, { reconnection: false, timeout: 3000, auth: { invite } });
  socket.once('connect', () => resolve(socket));
  socket.once('connect_error', reject);
});
const send = (socket: Socket, event: string, payload?: unknown) => new Promise<{ ok: boolean; token?: string; error?: string }>(resolve => socket.emit(event, payload, resolve));
const once = <T>(socket: Socket, event: string) => new Promise<T>(resolve => socket.once(event, resolve));
const untilState = (socket: Socket, phase: string) => new Promise<PublicState>(resolve => {
  const handler = (state: PublicState) => { if (state?.phase === phase) { socket.off('state', handler); resolve(state); } };
  socket.on('state', handler);
});
const sockets: Socket[] = [];
try {
  const host = await connect(); sockets.push(host);
  const invitePromise = once<string>(host, 'host:invite');
  const created = await send(host, 'host:create', { names: ['João', 'Pedro', 'Lucas', 'Gabriel'], theme: 'Quão perigoso?', hostCode: process.env.TEST_HOST_CODE });
  assert.equal(created.ok, true);
  const invite = await invitePromise;
  const lobby = await once<PublicState>(host, 'state');
  assert.equal(lobby.players.length, 4);
  const phones: Socket[] = [];
  if (process.env.TEST_HOST_CODE) {
    const outsider = await connect(); sockets.push(outsider);
    assert.equal((await send(outsider, 'player:join', { playerId: lobby.players[0].id })).ok, false);
  }
  const privateStates = new Map<string, PrivateState>();
  const tokens = new Map<string, string>();
  for (const p of lobby.players) {
    const phone = await connect(invite); sockets.push(phone); phones.push(phone);
    const joined = await send(phone, 'player:join', { playerId: p.id });
    assert.equal(joined.ok, true);
    tokens.set(p.id, joined.token!);
    phone.on('private', (state: PrivateState) => privateStates.set(p.id, state));
    assert.equal((await send(phone, 'player:ready', true)).ok, true);
  }
  assert.equal((await send(host, 'host:start')).ok, true);
  const discussion = untilState(host, 'discussion');
  for (const phone of phones) assert.equal((await send(phone, 'player:draw')).ok, true);
  const publicState = await discussion;
  await new Promise(resolve => setTimeout(resolve, 50));
  const allPrivate = [...privateStates.values()];
  assert.equal(allPrivate.length, 4);
  const values = allPrivate.flatMap(p => p.cards.map(c => c.value));
  assert.equal(new Set(values).size, 8);
  assert.equal(publicState.phase, 'discussion');
  assert.equal(JSON.stringify(publicState).includes('"value"'), false);
  const firstPhone = phones[0];
  firstPhone.disconnect();
  const rejoined = await connect(invite); sockets.push(rejoined);
  const recovered = once<PrivateState>(rejoined, 'private');
  assert.equal((await send(rejoined, 'player:join', { playerId: lobby.players[0].id, token: tokens.get(lobby.players[0].id) })).ok, true);
  assert.deepEqual((await recovered).cards, allPrivate[0].cards);
  const correct = allPrivate.flatMap(p => p.cards).sort((a, b) => a.value - b.value).map(c => c.id);
  assert.equal((await send(host, 'host:reorder', correct)).ok, true);
  const revealing = untilState(host, 'reveal');
  assert.equal((await send(host, 'host:confirm')).ok, true);
  const revealed = await revealing;
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.won, true);
  console.log('Integração Socket.IO: host, quatro jogadores, sorteio privado, ordem e revelação OK.');
} finally {
  sockets.forEach(socket => socket.disconnect());
}
