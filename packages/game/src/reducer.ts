import { createShuffledDeck, dealForVc, dealForVcWithMaxCards } from "./deck";
import { sortCardsForPlay } from "./cards";
import { allOtherPlayersSkipped, nextEligiblePlayerId } from "./turns";
import { setPlayerConnection, upsertPlayer } from "./state";
import { validatePlay, validateSkip } from "./rules";
import type { Card, GameAction, GameState, RuleValidator, ValidationResult } from "./types";

const maxSeed = 4294967295;

export interface TransitionResult {
  readonly state: GameState;
  readonly validation: ValidationResult;
}

export interface ReducerOptions {
  readonly playValidators?: readonly RuleValidator[];
}

function bumpVersion(state: GameState): GameState {
  return { ...state, version: state.version + 1 };
}

function removeCardsFromHand(hand: readonly Card[], playedCards: readonly Card[]): readonly Card[] {
  const playedIds = new Set(playedCards.map((card) => card.id));
  return hand.filter((card) => !playedIds.has(card.id));
}

function findPlayerWithCard(hands: Readonly<Record<string, readonly Card[]>>, cardId: string): string | null {
  for (const [playerId, hand] of Object.entries(hands)) {
    if (hand.some((card) => card.id === cardId)) {
      return playerId;
    }
  }

  return null;
}

function findOpeningCard(hands: Readonly<Record<string, readonly Card[]>>): Card | null {
  const cards = Object.values(hands).flat();
  return cards.find((card) => card.id === "spades-3") ?? sortCardsForPlay(cards).at(0) ?? null;
}

function findOpeningPlayer(hands: Readonly<Record<string, readonly Card[]>>): string | null {
  const openingCard = findOpeningCard(hands);

  if (openingCard === null) {
    return null;
  }

  return findPlayerWithCard(hands, openingCard.id);
}

function validateMaxCardsPerPlayer(maxCardsPerPlayer: number | undefined): ValidationResult {
  if (maxCardsPerPlayer === undefined) {
    return { ok: true };
  }

  if (!Number.isInteger(maxCardsPerPlayer) || maxCardsPerPlayer < 1 || maxCardsPerPlayer > 52) {
    return { ok: false, reason: "Max cards per player must be a whole number from 1 to 52." };
  }

  return { ok: true };
}

function validateSeed(seed: number): ValidationResult {
  if (!Number.isInteger(seed) || seed < 0 || seed > maxSeed) {
    return { ok: false, reason: `Seed must be a whole number from 0 to ${maxSeed}.` };
  }

  return { ok: true };
}

/**
 * Applies one player action to immutable game state after validating it.
 * This is the authoritative transition function used by UI and server sync code.
 */
export function reduceGameAction(
  state: GameState,
  action: GameAction,
  options: ReducerOptions = {}
): TransitionResult {
  switch (action.type) {
    case "join": {
      if (state.phase !== "lobby") {
        return { state, validation: { ok: false, reason: "Players can only join during the lobby." } };
      }

      return {
        state: bumpVersion({
          ...state,
          players: upsertPlayer(state.players, action.player)
        }),
        validation: { ok: true }
      };
    }

    case "set-connection": {
      return {
        state: bumpVersion({
          ...state,
          players: setPlayerConnection(state.players, action.playerId, action.connected)
        }),
        validation: { ok: true }
      };
    }

    case "start": {
      if (state.phase !== "lobby") {
        return { state, validation: { ok: false, reason: "Game has already started." } };
      }

      if (state.players.length < 2) {
        return { state, validation: { ok: false, reason: "At least two players are required." } };
      }

      if (!state.players.some((player) => player.id === action.actorId)) {
        return { state, validation: { ok: false, reason: "Only a joined player can start the game." } };
      }

      const seedValidation = validateSeed(action.seed);

      if (!seedValidation.ok) {
        return { state, validation: seedValidation };
      }

      const maxCardsValidation = validateMaxCardsPerPlayer(action.maxCardsPerPlayer);

      if (!maxCardsValidation.ok) {
        return { state, validation: maxCardsValidation };
      }

      const turnOrder = state.players.map((player) => player.id);
      const deck = createShuffledDeck(action.seed);
      const hands =
        action.maxCardsPerPlayer === undefined
          ? dealForVc(turnOrder, deck)
          : dealForVcWithMaxCards(turnOrder, deck, action.maxCardsPerPlayer);
      const startingPlayerId = findOpeningPlayer(hands);

      return {
        state: bumpVersion({
          ...state,
          phase: "playing",
          hands,
          deck: [],
          currentTurn: startingPlayerId,
          currentLeadingPlay: null,
          skippedPlayers: [],
          finishedPlayerIds: [],
          lastEvent: null,
          turnOrder
        }),
        validation: { ok: true }
      };
    }

    case "play-cards": {
      const validation = validatePlay(state, action.actorId, action.cardIds, options.playValidators);

      if (!validation.ok || validation.cards === undefined) {
        return { state, validation };
      }

      const nextHands = {
        ...state.hands,
        [action.actorId]: removeCardsFromHand(state.hands[action.actorId] ?? [], validation.cards)
      };
      const playerWentOut = nextHands[action.actorId]?.length === 0;
      const finishedPlayerIds = playerWentOut
        ? [...new Set([...(state.finishedPlayerIds ?? []), action.actorId])]
        : (state.finishedPlayerIds ?? []);
      const remainingPlayerIds = state.turnOrder.filter((playerId) => !finishedPlayerIds.includes(playerId));
      const gameFinished = remainingPlayerIds.length <= 1;
      const nextState: GameState = {
        ...state,
        hands: nextHands,
        discardPile: [...state.discardPile, { playerId: action.actorId, ...validation.move }],
        currentLeadingPlay: { playerId: action.actorId, ...validation.move },
        lastEvent: { type: "play", playerId: action.actorId },
        skippedPlayers: state.skippedPlayers,
        currentTurn: gameFinished
          ? null
          : nextEligiblePlayerId(state.turnOrder, action.actorId, [...state.skippedPlayers, ...finishedPlayerIds]),
        phase: gameFinished ? "finished" : state.phase,
        winnerId: playerWentOut ? (state.winnerId ?? action.actorId) : state.winnerId,
        finishedPlayerIds
      };

      return { state: bumpVersion(nextState), validation: { ok: true } };
    }

    case "skip": {
      const validation = validateSkip(state, action.actorId);

      if (!validation.ok) {
        return { state, validation };
      }

      const currentLeadingPlayer = state.currentLeadingPlay?.playerId;
      const skippedPlayers = [...new Set([...state.skippedPlayers, action.actorId])];
      const finishedPlayerIds = state.finishedPlayerIds ?? [];

      if (
        currentLeadingPlayer !== undefined &&
        allOtherPlayersSkipped(state.turnOrder, currentLeadingPlayer, skippedPlayers, finishedPlayerIds)
      ) {
        const nextLeader = finishedPlayerIds.includes(currentLeadingPlayer)
          ? nextEligiblePlayerId(state.turnOrder, currentLeadingPlayer, finishedPlayerIds)
          : currentLeadingPlayer;

        return {
          state: bumpVersion({
            ...state,
            currentTurn: nextLeader,
            currentLeadingPlay: null,
            lastEvent: { type: "skip", playerId: action.actorId },
            skippedPlayers: []
          }),
          validation: { ok: true }
        };
      }

      return {
        state: bumpVersion({
          ...state,
          skippedPlayers,
          lastEvent: { type: "skip", playerId: action.actorId },
          currentTurn: nextEligiblePlayerId(state.turnOrder, action.actorId, finishedPlayerIds)
        }),
        validation: { ok: true }
      };
    }
  }
}

export function assertValidTransition(result: TransitionResult): GameState {
  if (!result.validation.ok) {
    throw new Error(result.validation.reason);
  }

  return result.state;
}
