import { sortCardsForPlay } from "./cards";
import { reduceGameAction } from "./reducer";
import { getLegalMoves } from "./rules";
import type { Card, CardMove, GameAction, GameState, Player, PlayerId } from "./types";

export interface BotTurnView {
  readonly actorId: PlayerId;
  readonly hand: readonly Card[];
  readonly currentTablePlay: CardMove | null;
  readonly isLeading: boolean;
  readonly requiredOpeningCard?: Card;
}

export interface EasyBotOptions {
  readonly random?: () => number;
  readonly passProbability?: number;
}

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

  return chooseBotAction(createBotTurnView(state, state.currentTurn), options);
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
