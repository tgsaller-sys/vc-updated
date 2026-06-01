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

export type CardMoveType = "single" | "pair" | "triple" | "straight" | "bomb";

export type BombKind = "quad" | "double-straight";

export interface MoveMetadata {
  readonly bombKind?: BombKind;
}

export interface CardMove {
  readonly type: CardMoveType;
  readonly cards: readonly Card[];
  readonly primaryRank: Rank;
  readonly highCard: Card;
  readonly length: number;
  readonly metadata?: MoveMetadata;
}

export interface PassMove {
  readonly type: "pass";
  readonly cards: readonly [];
  readonly primaryRank: null;
  readonly highCard: null;
  readonly length: 0;
}

export type Move = CardMove | PassMove;

export interface PlayedMove extends CardMove {
  readonly playerId: PlayerId;
}

export interface VcRuleOptions {
  readonly requiredOpeningCard?: Card;
  readonly allowPass?: boolean;
}

export interface GetLegalMovesInput {
  readonly hand: readonly Card[];
  readonly currentTablePlay: CardMove | null;
  readonly isLeading: boolean;
  readonly options?: VcRuleOptions;
}

export type GamePhase = "lobby" | "playing" | "finished";

export type GameEvent =
  | {
      readonly type: "skip";
      readonly playerId: PlayerId;
    }
  | {
      readonly type: "play";
      readonly playerId: PlayerId;
    };

export interface GameState {
  readonly id: string;
  readonly phase: GamePhase;
  readonly players: readonly Player[];
  readonly hands: Readonly<Record<PlayerId, readonly Card[]>>;
  readonly deck: readonly Card[];
  readonly discardPile: readonly PlayedMove[];
  readonly currentTurn: PlayerId | null;
  readonly currentLeadingPlay: PlayedMove | null;
  readonly skippedPlayers: readonly PlayerId[];
  readonly winnerId: PlayerId | null;
  readonly lastEvent: GameEvent | null;
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
      readonly maxCardsPerPlayer?: number;
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
      readonly move: CardMove;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type RuleValidator = (state: GameState, actorId: PlayerId, cards: readonly Card[]) => ValidationResult;
