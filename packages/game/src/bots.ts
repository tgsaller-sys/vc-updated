import { sortCardsForPlay } from "./cards";
import { reduceGameAction } from "./reducer";
import { chooseEasyBotAction, chooseMediumBotAction } from "./botStrategies";
import type { BotTurnView, EasyBotOptions } from "./botStrategies";
import type { GameAction, GameState, Player, PlayerId } from "./types";

export { chooseBotAction, chooseEasyBotAction, chooseMediumBotAction } from "./botStrategies";
export type { BotTurnView, EasyBotOptions } from "./botStrategies";

export const botTurnDelayMs = 2000;
export const maximumAutomaticBotTurns = 1000;

export function isBotPlayer(player: Player | undefined): player is Player & { readonly kind: "bot" } {
  return player?.kind === "bot";
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
  return player.botStrategy === "medium" ? chooseMediumBotAction(view) : chooseEasyBotAction(view, options);
}

/**
 * Advances local games through consecutive bot seats via the authoritative reducer.
 */
export function runBotTurns(state: GameState, options: EasyBotOptions = {}): GameState {
  let nextState = state;

  for (let turn = 0; turn < maximumAutomaticBotTurns; turn += 1) {
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
