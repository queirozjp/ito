import express from 'express';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { Game, type ActionResult } from './game.ts';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT deve ser um número entre 1 e 65535.');
const publicMode = process.env.APP_MODE === 'public';
const hostCode = process.env.HOST_CODE ?? '';
if (publicMode && hostCode.length < 12) throw Error('No modo público, defina HOST_CODE com pelo menos 12 caracteres.');
const validHostCode = (candidate: unknown) => {
  if (!publicMode) return true;
  if (typeof candidate !== 'string') return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(hostCode);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
let game: Game | undefined;
const addressList = () => Object.values(networkInterfaces()).flatMap(group => group ?? [])
  .filter(item => item.family === 'IPv4' && !item.internal).map(item => `http://${item.address}:${port}`);
app.get('/api/network', (_req, res) => res.json({ addresses: publicMode ? [] : addressList(), port, publicMode }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

function canSeeState(socket: Socket) {
  return !publicMode || !game || game.isHost(socket.id) ||
    socket.handshake.auth?.invite === game.inviteToken ||
    game.isPlayer(socket.id, socket.data.token);
}

function broadcast() {
  for (const socket of io.sockets.sockets.values()) if (canSeeState(socket)) socket.emit('state', game?.publicState() ?? null);
  if (game) for (const p of game.players) if (p.socketId) io.to(p.socketId).emit('private', game.privateState(p.token));
}

type Reply = (result: ActionResult) => void;
const reply = (cb: unknown, result: ActionResult) => { if (typeof cb === 'function') (cb as Reply)(result); };
const fail = (message: string): ActionResult => ({ ok: false, error: message });

io.on('connection', (socket: Socket) => {
  if (canSeeState(socket)) socket.emit('state', game?.publicState() ?? null);
  socket.on('host:create', (payload: { names?: unknown; theme?: unknown; hostCode?: unknown }, cb) => {
    if (!validHostCode(payload?.hostCode)) return reply(cb, fail('Código de host incorreto.'));
    const error = Game.validate(payload?.names, payload?.theme);
    if (error) return reply(cb, fail(error));
    if (game && !game.isHost(socket.id)) return reply(cb, fail('Já existe uma partida. Use a sessão de host ou reinicie o servidor.'));
    if (game?.revealTimer) clearTimeout(game.revealTimer);
    game = new Game(payload.names as string[], payload.theme as string, socket.id);
    socket.data.role = 'host';
    socket.data.token = game.hostToken;
    socket.emit('host:invite', game.inviteToken);
    reply(cb, { ok: true, token: game.hostToken });
    broadcast();
  });
  socket.on('host:join', (token: string, cb) => {
    if (!game) return reply(cb, fail('Nenhuma partida ativa.'));
    const previous = game.hostSocketId;
    const result = game.attachHost(token, socket.id);
    if (result.ok) {
      if (previous && previous !== socket.id) io.to(previous).emit('session:replaced');
      socket.data.role = 'host'; socket.data.token = token;
      socket.emit('host:invite', game.inviteToken);
      broadcast();
    }
    reply(cb, result);
  });
  socket.on('player:join', (payload: { playerId?: string; token?: string }, cb) => {
    if (!game) return reply(cb, fail('Aguarde o host criar uma partida.'));
    if (publicMode && socket.handshake.auth?.invite !== game.inviteToken) return reply(cb, fail('Convite inválido. Abra o link ou QR Code do host.'));
    const old = game.players.find(p => p.id === payload?.playerId)?.socketId;
    const result = game.attachPlayer(payload?.playerId ?? '', payload?.token, socket.id);
    if (result.ok) {
      if (old && old !== socket.id) io.to(old).emit('session:replaced');
      socket.data.role = 'player'; socket.data.token = result.token;
      reply(cb, result);
      broadcast();
    } else reply(cb, result);
  });
  const hostAction = (event: string, fn: (payload?: any) => ActionResult) => socket.on(event, (payload: unknown, cb: unknown) => {
    if (!game || !game.isHost(socket.id)) return reply(cb, fail('Apenas o host pode fazer isso.'));
    const result = fn(payload);
    reply(cb, result);
    if (result.ok) broadcast();
  });
  hostAction('host:theme', payload => game!.setTheme(payload));
  hostAction('host:start', () => game!.startRound(true));
  hostAction('host:reorder', payload => game!.reorder(payload));
  hostAction('host:confirm', () => {
    const result = game!.confirm();
    if (result.ok) {
      const current = game!;
      current.revealTimer = setTimeout(() => { if (game === current) { current.finishReveal(); broadcast(); } }, 6200);
    }
    return result;
  });
  hostAction('host:again', () => game!.startRound());
  hostAction('host:lobby', () => game!.backToLobby());
  hostAction('host:end', () => {
    if (game?.revealTimer) clearTimeout(game.revealTimer);
    game = undefined;
    socket.data.role = undefined;
    socket.data.token = undefined;
    return { ok: true };
  });
  socket.on('player:ready', (ready: boolean, cb) => {
    if (!game || !game.isPlayer(socket.id, socket.data.token)) return reply(cb, fail('Entre como jogador primeiro.'));
    const result = game.setReady(socket.data.token, ready);
    reply(cb, result);
    if (result.ok) broadcast();
  });
  socket.on('player:draw', (_payload, cb) => {
    if (!game || !game.isPlayer(socket.id, socket.data.token)) return reply(cb, fail('Entre como jogador primeiro.'));
    const result = game.draw(socket.data.token);
    reply(cb, result);
    if (result.ok) broadcast();
  });
  socket.on('disconnect', () => { if (game) { game.detach(socket.id); broadcast(); } });
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--production') || process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Ordem Secreta: http://localhost:${port}/host`);
  for (const address of addressList()) console.log(`Rede local: ${address}/jogar`);
});
