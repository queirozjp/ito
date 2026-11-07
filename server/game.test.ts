import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from './game.ts';

const makeGame = () => new Game(['João', 'Pedro', 'Lucas', 'Gabriel'], 'Quão perigoso é este animal?', 'host');

function startedGame() {
  const game = makeGame();
  game.players.forEach((p, i) => {
    assert.equal(game.attachPlayer(p.id, undefined, `socket-${i}`).ok, true);
    assert.equal(game.setReady(p.token, true).ok, true);
  });
  assert.equal(game.startRound(true).ok, true);
  return game;
}

test('quatro jogadores recebem duas cartas únicas, sem vazamento no estado público', () => {
  const game = startedGame();
  assert.equal(game.publicState().phase, 'draw');
  for (const p of game.players) {
    assert.equal(game.draw(p.token).ok, true);
    assert.equal(game.draw(p.token).ok, false);
    assert.equal(game.privateState(p.token)?.cards.length, 2);
  }
  assert.equal(game.publicState().phase, 'discussion');
  const values = game.players.flatMap(p => p.cards.map(c => c.value));
  assert.equal(values.length, 8);
  assert.equal(new Set(values).size, 8);
  assert.ok(values.every(n => Number.isInteger(n) && n >= 0 && n <= 100));
  const publicJson = JSON.stringify(game.publicState());
  assert.equal(publicJson.includes('"value"'), false);
  assert.deepEqual(game.privateState(game.players[0].token)?.cards.map(c => c.id), game.players[0].cards.map(c => c.id));
});

test('a sessão original retorna após desconexão e impede outro dispositivo', () => {
  const game = makeGame();
  const p = game.players[0];
  assert.equal(game.attachPlayer(p.id, undefined, 'phone-1').ok, true);
  game.detach('phone-1');
  assert.equal(game.attachPlayer(p.id, undefined, 'phone-2').ok, false);
  assert.equal(game.attachPlayer(p.id, p.token, 'phone-1-reloaded').ok, true);
});

test('o servidor valida a ordem e calcula o resultado', () => {
  const game = startedGame();
  game.players.forEach(p => game.draw(p.token));
  assert.equal(game.reorder(game.order.slice(0, 7)).ok, false);
  const sorted = game.players.flatMap(p => p.cards).sort((a, b) => a.value - b.value).map(c => c.id);
  assert.equal(game.reorder(sorted).ok, true);
  assert.equal(game.confirm().ok, true);
  assert.equal(game.publicState().won, true);
  assert.equal(game.publicState().correctPositions, 8);
  assert.equal(game.reorder(sorted.reverse()).ok, false);
  game.finishReveal();
  assert.equal(game.publicState().phase, 'result');
  assert.equal(game.startRound().ok, true);
  assert.equal(game.publicState().phase, 'draw');
  assert.ok(game.players.every(p => p.cards.length === 0));
  assert.equal(game.publicState().revealed, undefined);
});

test('derrota identifica cartas em posições erradas', () => {
  const game = startedGame();
  game.players.forEach(p => game.draw(p.token));
  const sorted = game.players.flatMap(p => p.cards).sort((a, b) => a.value - b.value).map(c => c.id);
  const swapped = [...sorted];
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  game.reorder(swapped);
  game.confirm();
  assert.equal(game.publicState().won, false);
  assert.equal(game.publicState().correctPositions, 6);
  assert.deepEqual(game.publicState().correctOrder, sorted);
});
