import { randomInt, randomUUID } from 'node:crypto';
import type { Card, Phase, PrivateState, PublicState, RevealedCard } from '../src/types.ts';

const COLORS = ['#5ba7ff', '#4edcaa', '#b38aff', '#ffae65'];
type Member = { id: string; name: string; color: string; token: string; socketId?: string; claimed: boolean; ready: boolean; cards: RevealedCard[] };
export type ActionResult = { ok: true; token?: string } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });

export class Game {
  readonly id = randomUUID();
  readonly hostToken = randomUUID();
  readonly inviteToken = randomUUID();
  hostSocketId?: string;
  phase: Phase = 'lobby';
  round = 0;
  theme: string;
  players: Member[];
  order: string[] = [];
  correctOrder: string[] = [];
  correctPositions = 0;
  pool: number[] = [];
  revealTimer?: ReturnType<typeof setTimeout>;

  constructor(names: string[], theme: string, hostSocketId: string) {
    this.theme = theme.trim();
    this.hostSocketId = hostSocketId;
    this.players = names.map((name, i) => ({ id: randomUUID(), name: name.trim(), color: COLORS[i], token: randomUUID(), claimed: false, ready: false, cards: [] }));
  }

  static validate(names: unknown, theme: unknown): string | null {
    if (!Array.isArray(names) || names.length !== 4 || names.some(n => typeof n !== 'string' || !n.trim() || n.trim().length > 24)) return 'Informe quatro nomes de até 24 caracteres.';
    if (new Set(names.map(n => n.trim().toLocaleLowerCase('pt-BR'))).size !== 4) return 'Os quatro nomes precisam ser diferentes.';
    if (typeof theme !== 'string' || !theme.trim() || theme.trim().length > 160) return 'Informe um tema de até 160 caracteres.';
    return null;
  }

  attachHost(token: string, socketId: string): ActionResult {
    if (token !== this.hostToken) return fail('Sessão de host inválida.');
    this.hostSocketId = socketId;
    return { ok: true };
  }

  attachPlayer(playerId: string, token: string | undefined, socketId: string): ActionResult {
    const p = this.players.find(x => x.id === playerId);
    if (!p) return fail('Jogador não encontrado.');
    if (p.claimed && token !== p.token) return fail('Este nome já foi escolhido em outro dispositivo.');
    if (token && token !== p.token) return fail('Sessão de jogador inválida.');
    p.claimed = true;
    p.socketId = socketId;
    return { ok: true, token: p.token };
  }

  detach(socketId: string) {
    if (this.hostSocketId === socketId) this.hostSocketId = undefined;
    const p = this.players.find(x => x.socketId === socketId);
    if (p) p.socketId = undefined;
  }

  playerByToken(token: string) { return this.players.find(x => x.token === token); }
  isHost(socketId: string) { return this.hostSocketId === socketId; }
  isPlayer(socketId: string, token: string) { return this.playerByToken(token)?.socketId === socketId; }

  setReady(token: string, ready: boolean): ActionResult {
    const p = this.playerByToken(token);
    if (!p || this.phase !== 'lobby') return fail('Não é possível alterar a prontidão agora.');
    p.ready = ready;
    return { ok: true };
  }

  setTheme(theme: unknown): ActionResult {
    if (this.phase !== 'lobby') return fail('O tema só pode ser alterado no lobby.');
    if (typeof theme !== 'string' || !theme.trim() || theme.trim().length > 160) return fail('Informe um tema de até 160 caracteres.');
    this.theme = theme.trim();
    return { ok: true };
  }

  startRound(first = false): ActionResult {
    if (first && (this.phase !== 'lobby' || !this.players.every(p => p.ready && p.socketId))) return fail('Aguarde os quatro jogadores conectados e prontos.');
    if (!first && this.phase !== 'result') return fail('A rodada atual ainda não terminou.');
    this.round++;
    this.phase = 'draw';
    this.pool = [];
    while (this.pool.length < 8) {
      const n = randomInt(0, 101);
      if (!this.pool.includes(n)) this.pool.push(n);
    }
    this.players.forEach(p => { p.cards = []; });
    this.order = this.players.flatMap(p => [1, 2].map(i => `${p.id}:${i}`));
    this.correctOrder = [];
    this.correctPositions = 0;
    return { ok: true };
  }

  draw(token: string): ActionResult {
    const p = this.playerByToken(token);
    if (!p || this.phase !== 'draw') return fail('O sorteio não está disponível agora.');
    if (p.cards.length) return fail('Você já sorteou suas cartas nesta rodada.');
    const start = this.players.indexOf(p) * 2;
    p.cards = [1, 2].map((index, i) => ({ id: `${p.id}:${index}`, playerId: p.id, index, value: this.pool[start + i] }));
    if (this.players.every(x => x.cards.length === 2)) this.phase = 'discussion';
    return { ok: true };
  }

  reorder(order: unknown): ActionResult {
    if (this.phase !== 'discussion') return fail('A ordem só pode ser alterada durante a discussão.');
    if (!Array.isArray(order) || order.length !== 8 || order.some(x => typeof x !== 'string') || new Set(order).size !== 8 || !this.order.every(id => order.includes(id))) return fail('A sequência precisa conter as oito cartas.');
    this.order = [...order];
    return { ok: true };
  }

  confirm(): ActionResult {
    if (this.phase !== 'discussion' || !this.players.every(p => p.cards.length === 2)) return fail('Aguarde as oito cartas antes de confirmar.');
    const byId = new Map(this.players.flatMap(p => p.cards).map(c => [c.id, c]));
    this.correctOrder = [...byId.values()].sort((a, b) => a.value - b.value).map(c => c.id);
    this.correctPositions = this.order.filter((id, i) => id === this.correctOrder[i]).length;
    this.phase = 'reveal';
    return { ok: true };
  }

  finishReveal() { if (this.phase === 'reveal') this.phase = 'result'; }

  backToLobby(): ActionResult {
    if (this.phase !== 'result') return fail('Aguarde o resultado da rodada.');
    this.phase = 'lobby';
    this.players.forEach(p => { p.ready = false; p.cards = []; });
    this.order = [];
    this.correctOrder = [];
    this.pool = [];
    return { ok: true };
  }

  privateState(token: string): PrivateState | undefined {
    const p = this.playerByToken(token);
    return p ? { playerId: p.id, round: this.round, cards: p.cards.map(({ id, index, value }) => ({ id, index, value })) } : undefined;
  }

  publicState(): PublicState {
    const cards: Card[] = this.players.flatMap(p => [1, 2].map(index => ({ id: `${p.id}:${index}`, playerId: p.id, index })));
    const visible = this.phase === 'reveal' || this.phase === 'result';
    return {
      gameId: this.id, phase: this.phase, theme: this.theme, round: this.round,
      players: this.players.map(({ id, name, color, socketId, ready, cards }) => ({ id, name, color, connected: !!socketId, ready, drawn: cards.length === 2 })),
      cards: this.phase === 'lobby' ? [] : cards,
      order: [...this.order], hostConnected: !!this.hostSocketId,
      ...(visible ? {
        revealed: this.players.flatMap(p => p.cards),
        correctOrder: [...this.correctOrder], correctPositions: this.correctPositions,
        won: this.correctPositions === 8
      } : {})
    };
  }
}
