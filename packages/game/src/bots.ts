import { compareCardsForPlay, rankValue, sortCardsForPlay } from "./cards";
import { reduceGameAction } from "./reducer";
import { getLegalMoves } from "./rules";
import type { Card, CardMove, GameAction, GameState, Player, PlayerId } from "./types";

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

export const botTurnDelayMs = 2000;

export function isBotPlayer(player: Player | undefined): boolean {
  return player?.kind === "bot";
}

function randomIndex(length: number, random: () => number): number {
  return Math.min(Math.floor(random() * length), length - 1);
}

/**
 * Creates the deliberately limited information available to a bot decision.
 * Opponent hands are never included.
 */
export function createBotTurnView(state: GameState, actorId: PlayerId): BotTurnView {
  const isLeading = state.currentLeadingPlay === null;
  const hand = state.hands[actorId] ?? [];
  const requiredOpeningCard =
    isLeading && state.discardPile.length === 0 ? sortCardsForPlay(hand).at(0) : undefined;

  return {
    actorId,
    hand,
    currentTablePlay: state.currentLeadingPlay,
    isLeading,
    opponentCardCounts: state.turnOrder
      .filter((playerId) => playerId !== actorId && !(state.finishedPlayerIds ?? []).includes(playerId))
      .map((playerId) => state.hands[playerId]?.length ?? 0),
    ...(requiredOpeningCard === undefined ? {} : { requiredOpeningCard })
  };
}

/**
 * Chooses an EasyBot action from legal moves computed with the shared VC rules.
 */
export function chooseEasyBotAction(view: BotTurnView, options: EasyBotOptions = {}): GameAction {
  const random = options.random ?? Math.random;
  const passProbability = options.passProbability ?? 0.25;
  const moves = getLegalMoves({
    hand: view.hand,
    currentTablePlay: view.currentTablePlay,
    isLeading: view.isLeading,
    options: view.requiredOpeningCard === undefined ? {} : { requiredOpeningCard: view.requiredOpeningCard }
  });
  const plays = moves.filter((move) => move.type !== "pass");
  const winningPlays = plays.filter((move) => move.cards.length === view.hand.length);
  const availablePlays = winningPlays.length > 0 ? winningPlays : plays;

  if (!view.isLeading && winningPlays.length === 0 && moves.some((move) => move.type === "pass")) {
    if (random() < passProbability) {
      return { type: "skip", actorId: view.actorId };
    }
  }

  const play = availablePlays.length === 0 ? undefined : availablePlays[randomIndex(availablePlays.length, random)];

  if (play !== undefined) {
    return {
      type: "play-cards",
      actorId: view.actorId,
      cardIds: play.cards.map((card) => card.id)
    };
  }

  return { type: "skip", actorId: view.actorId };
}

function actionForPlay(actorId: PlayerId, play: CardMove): GameAction {
  return {
    type: "play-cards",
    actorId,
    cardIds: play.cards.map((card) => card.id)
  };
}

function compareMovesForCost(left: CardMove, right: CardMove): number {
  const highCardDifference = compareCardsForPlay(left.highCard, right.highCard);

  if (highCardDifference !== 0) {
    return highCardDifference;
  }

  return right.length - left.length;
}

function isVeryStrongMove(move: CardMove): boolean {
  return move.type === "bomb" || move.cards.some((card) => card.rank === "2");
}

function protectedComboCardIds(hand: readonly Card[]): ReadonlySet<Card["id"]> {
  const byRank = new Map<Card["rank"], readonly Card[]>();
  const protectedIds = new Set<Card["id"]>();

  for (const card of hand) {
    byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  }

  for (const cards of byRank.values()) {
    if (cards.length === 4) {
      cards.forEach((card) => protectedIds.add(card.id));
    }
  }

  const ranksWithPairs = [...byRank.entries()]
    .filter(([rank, cards]) => rank !== "2" && cards.length >= 2)
    .sort(([leftRank], [rightRank]) => rankValue(leftRank) - rankValue(rightRank));

  for (let start = 0; start < ranksWithPairs.length; start += 1) {
    for (let end = start + 3; end <= ranksWithPairs.length; end += 1) {
      const run = ranksWithPairs.slice(start, end);
      const isConsecutive = run.every(([rank], index) => {
        const previous = run[index - 1];
        return index === 0 || (previous !== undefined && rankValue(rank) === rankValue(previous[0]) + 1);
      });

      if (!isConsecutive) {
        break;
      }

      run.forEach(([, cards]) => cards.forEach((card) => protectedIds.add(card.id)));
    }
  }

  return protectedIds;
}

function spendsProtectedCards(move: CardMove, protectedIds: ReadonlySet<Card["id"]>): boolean {
  return isVeryStrongMove(move) || move.cards.some((card) => protectedIds.has(card.id));
}

/**
 * Chooses a conservative MediumBot action using legal moves and public hand sizes.
 */
export function chooseMediumBotAction(view: BotTurnView): GameAction {
  const moves = getLegalMoves({
    hand: view.hand,
    currentTablePlay: view.currentTablePlay,
    isLeading: view.isLeading,
    options: view.requiredOpeningCard === undefined ? {} : { requiredOpeningCard: view.requiredOpeningCard }
  });
  const plays = moves.filter((move): move is CardMove => move.type !== "pass");
  const protectedIds = protectedComboCardIds(view.hand);
  const winningPlays = plays.filter((move) => move.cards.length === view.hand.length).sort(compareMovesForCost);

  if (winningPlays[0] !== undefined) {
    return actionForPlay(view.actorId, winningPlays[0]);
  }

  if (!view.isLeading) {
    const ordinaryPlays = plays.filter((move) => !spendsProtectedCards(move, protectedIds));
    const availablePlays = ordinaryPlays.length > 0 ? ordinaryPlays : plays;
    const cheapestPlay = [...availablePlays].sort(compareMovesForCost)[0];
    const opponentCloseToGoingOut = view.opponentCardCounts.some((count) => count <= 2);

    if (cheapestPlay === undefined || (spendsProtectedCards(cheapestPlay, protectedIds) && !opponentCloseToGoingOut)) {
      return { type: "skip", actorId: view.actorId };
    }

    return actionForPlay(view.actorId, cheapestPlay);
  }

  const preservedPlays = plays.filter((move) => !spendsProtectedCards(move, protectedIds));
  const availablePlays = preservedPlays.length > 0 ? preservedPlays : plays;
  const combinations = availablePlays.filter((move) => move.length > 1);
  const preferredPlays = combinations.length > 0 ? combinations : availablePlays;
  const cheapestPlay = [...preferredPlays].sort(compareMovesForCost)[0];

  if (cheapestPlay === undefined) {
    return { type: "skip", actorId: view.actorId };
  }

  return actionForPlay(view.actorId, cheapestPlay);
}

export function chooseBotAction(view: BotTurnView, options: EasyBotOptions = {}): GameAction {
  return chooseEasyBotAction(view, options);
}

export function nextBotAction(state: GameState, options: EasyBotOptions = {}): GameAction | null {
  if (state.phase !== "playing" || state.currentTurn === null) {
    return null;
  }

  const player = state.players.find((nextPlayer) => nextPlayer.id === state.currentTurn);

  if (!isBotPlayer(player)) {
    return null;
  }

  if (state.skippedPlayers.includes(state.currentTurn)) {
    return { type: "skip", actorId: state.currentTurn };
  }

  const view = createBotTurnView(state, state.currentTurn);
  return player?.botStrategy === "medium" ? chooseMediumBotAction(view) : chooseBotAction(view, options);
}

/**
 * Advances local games through consecutive bot seats via the authoritative reducer.
 */
export function runBotTurns(state: GameState, options: EasyBotOptions = {}): GameState {
  let nextState = state;

  for (let turn = 0; turn < 1000; turn += 1) {
    const action = nextBotAction(nextState, options);

    if (action === null) {
      return nextState;
    }

    const transition = reduceGameAction(nextState, action);

    if (!transition.validation.ok) {
      throw new Error(transition.validation.reason);
    }

    nextState = transition.state;
  }

  throw new Error("Bot turns exceeded the safety limit.");
}
