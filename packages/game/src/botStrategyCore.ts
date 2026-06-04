import { getLegalMoves } from "./rules";
import type { Card, CardMove, GameAction, Move, PlayerId } from "./types";

export interface BotTurnView {
  readonly actorId: PlayerId;
  readonly hand: readonly Card[];
  readonly currentTablePlay: CardMove | null;
  readonly currentTablePlayerId?: PlayerId;
  readonly isLeading: boolean;
  readonly opponentCardCounts: readonly number[];
  readonly playedCards?: readonly Card[];
  readonly turnOrder?: readonly PlayerId[];
  readonly requiredOpeningCard?: Card;
}

export interface EasyBotOptions {
  readonly random?: () => number;
  readonly passProbability?: number;
}

export function movesForView(view: BotTurnView): readonly Move[] {
  return getLegalMoves({
    hand: view.hand,
    currentTablePlay: view.currentTablePlay,
    isLeading: view.isLeading,
    options: view.requiredOpeningCard === undefined ? {} : { requiredOpeningCard: view.requiredOpeningCard }
  });
}

export function cardMovesForView(view: BotTurnView): readonly CardMove[] {
  return movesForView(view).filter((move): move is CardMove => move.type !== "pass");
}

export function actionForPlay(actorId: PlayerId, play: CardMove): GameAction {
  return {
    type: "play-cards",
    actorId,
    cardIds: play.cards.map((card) => card.id)
  };
}
