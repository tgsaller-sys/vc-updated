export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export type CardId = `${Suit}-${Rank}`;

export interface Card {
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
}

export type PlayerId = string;

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly connected: boolean;
  readonly joinedAt: string;
}

export interface PlayedSet {
  readonly playerId: PlayerId;
  readonly cards: readonly Card[];
}

export type GamePhase = "lobby" | "playing" | "finished";

export interface GameState {
  readonly id: string;
  readonly phase: GamePhase;
  readonly players: readonly Player[];
  readonly hands: Readonly<Record<PlayerId, readonly Card[]>>;
  readonly deck: readonly Card[];
  readonly discardPile: readonly PlayedSet[];
  readonly currentTurn: PlayerId | null;
  readonly currentLeadingPlay: PlayedSet | null;
  readonly skippedPlayers: readonly PlayerId[];
  readonly winnerId: PlayerId | null;
  readonly turnOrder: readonly PlayerId[];
  readonly version: number;
}

export type GameAction =
  | {
      readonly type: "join";
      readonly player: Player;
    }
  | {
      readonly type: "set-connection";
      readonly playerId: PlayerId;
      readonly connected: boolean;
    }
  | {
      readonly type: "start";
      readonly actorId: PlayerId;
      readonly seed: number;
    }
  | {
      readonly type: "play-cards";
      readonly actorId: PlayerId;
      readonly cardIds: readonly CardId[];
    }
  | {
      readonly type: "skip";
      readonly actorId: PlayerId;
    };

export type ValidationResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type PlayValidationResult =
  | {
      readonly ok: true;
      readonly cards: readonly Card[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type RuleValidator = (state: GameState, actorId: PlayerId, cards: readonly Card[]) => ValidationResult;
