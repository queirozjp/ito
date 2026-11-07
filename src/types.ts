export type Phase = 'lobby' | 'draw' | 'discussion' | 'reveal' | 'result';
export type Player = { id: string; name: string; color: string; connected: boolean; ready: boolean; drawn: boolean };
export type Card = { id: string; playerId: string; index: number };
export type RevealedCard = Card & { value: number };
export type PublicState = {
  gameId: string; phase: Phase; theme: string; round: number; players: Player[];
  cards: Card[]; order: string[]; revealed?: RevealedCard[];
  correctOrder?: string[]; correctPositions?: number; won?: boolean;
  hostConnected: boolean;
};
export type PrivateState = { playerId: string; round: number; cards: { id: string; index: number; value: number }[] };
