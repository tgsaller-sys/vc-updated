import { getLegalMoves } from "./rules";
import { compareMovesByCost, compareMovesForBlocking, protectedBombCardIds, spendsStrongCards } from "./botMoveScoring";
import type { Card, CardMove, GameAction, Move, PlayerId } from "./types";

export interface BotTurnView {
  readonly actorId: PlayerId;
  readonly hand: readonly Card[];
  readonly currentTablePlay: CardMove | null;
  readonly isLeading: boolean;
  readonly opponentCardCounts: readonly number[];
  readonly requiredOpeningCard?: Card;
}

export interface EasyBotOptions {
  readonly random?: () => number;
  readonly passProbability?: number;
}

function randomIndex(length: number, random: () => number): number {
  return Math.min(Math.floor(random() * length), length - 1);
}

function movesForView(view: BotTurnView): readonly Move[] {
  return getLegalMoves({
    hand: view.hand,
    currentTablePlay: view.currentTablePlay,
    isLeading: view.isLeading,
    options: view.requiredOpeningCard === undefined ? {} : { requiredOpeningCard: view.requiredOpeningCard }
  });
}

function cardMovesForView(view: BotTurnView): readonly CardMove[] {
  return movesForView(view).filter((move): move is CardMove => move.type !== "pass");
}

function actionForPlay(actorId: PlayerId, play: CardMove): GameAction {
  return {
    type: "play-cards",
    actorId,
    cardIds: play.cards.map((card) => card.id)
  };
}

/**
 * Chooses a random legal play, with occasional passes when answering a play.
 */
export function chooseEasyBotAction(view: BotTurnView, options: EasyBotOptions = {}): GameAction {
  const random = options.random ?? Math.random;
  const passProbability = options.passProbability ?? 0.25;
  const moves = movesForView(view);
  const plays = moves.filter((move): move is CardMove => move.type !== "pass");
  const winningPlays = plays.filter((move) => move.cards.length === view.hand.length);
  const availablePlays = winningPlays.length > 0 ? winningPlays : plays;

  if (!view.isLeading && winningPlays.length === 0 && moves.some((move) => move.type === "pass") && random() < passProbability) {
    return { type: "skip", actorId: view.actorId };
  }

  const play = availablePlays.length === 0 ? undefined : availablePlays[randomIndex(availablePlays.length, random)];

  return play === undefined ? { type: "skip", actorId: view.actorId } : actionForPlay(view.actorId, play);
}

/**
 * Chooses a conservative legal play using public opponent hand sizes.
 */
export function chooseMediumBotAction(view: BotTurnView): GameAction {
  const plays = cardMovesForView(view);
  const protectedIds = protectedBombCardIds(view.hand);
  const opponentHasOneCard = view.opponentCardCounts.some((count) => count === 1);
  const opponentCloseToGoingOut = view.opponentCardCounts.some((count) => count >= 1 && count <= 3);
  const botCanGoOutSoon = view.hand.length <= 3;
  const winningPlays = plays.filter((move) => move.cards.length === view.hand.length).sort(compareMovesByCost);

  if (winningPlays[0] !== undefined) {
    return actionForPlay(view.actorId, winningPlays[0]);
  }

  if (!view.isLeading) {
    const ordinaryPlays = plays.filter((move) => !spendsStrongCards(move, protectedIds));
    const availablePlays = opponentHasOneCard || ordinaryPlays.length === 0 ? plays : ordinaryPlays;
    const selectedPlay = [...availablePlays].sort(opponentHasOneCard ? compareMovesForBlocking : compareMovesByCost)[0];

    if (
      selectedPlay === undefined ||
      (spendsStrongCards(selectedPlay, protectedIds) && !opponentCloseToGoingOut && !botCanGoOutSoon)
    ) {
      return { type: "skip", actorId: view.actorId };
    }

    return actionForPlay(view.actorId, selectedPlay);
  }

  const preservedPlays = plays.filter((move) => !spendsStrongCards(move, protectedIds));
  const availablePlays = preservedPlays.length > 0 ? preservedPlays : plays;
  const combinations = availablePlays.filter((move) => move.length > 1);
  const preferredPlays = combinations.length > 0 ? combinations : availablePlays;
  const selectedPlay = [...preferredPlays].sort(opponentHasOneCard ? compareMovesForBlocking : compareMovesByCost)[0];

  return selectedPlay === undefined ? { type: "skip", actorId: view.actorId } : actionForPlay(view.actorId, selectedPlay);
}

export function chooseBotAction(view: BotTurnView, options: EasyBotOptions = {}): GameAction {
  return chooseEasyBotAction(view, options);
}
