import { findCardsById } from "./cards";
import type { CardId, GameState, PlayerId, PlayValidationResult, RuleValidator, ValidationResult } from "./types";

export const allowAnyOwnedCards: RuleValidator = (_state, _actorId, cards) => {
  if (cards.length === 0) {
    return { ok: false, reason: "Play at least one card." };
  }

  return { ok: true };
};

export function validatePlay(
  state: GameState,
  actorId: PlayerId,
  cardIds: readonly CardId[],
  validators: readonly RuleValidator[] = [allowAnyOwnedCards]
): PlayValidationResult {
  if (state.phase !== "playing") {
    return { ok: false, reason: "The game is not in progress." };
  }

  if (state.currentTurn !== actorId) {
    return { ok: false, reason: "It is not this player's turn." };
  }

  if (new Set(cardIds).size !== cardIds.length) {
    return { ok: false, reason: "A card cannot be played twice." };
  }

  const hand = state.hands[actorId] ?? [];
  const cards = findCardsById(hand, cardIds);

  if (cards.length !== cardIds.length) {
    return { ok: false, reason: "One or more cards are not in this player's hand." };
  }

  for (const validator of validators) {
    const result = validator(state, actorId, cards);

    if (!result.ok) {
      return result;
    }
  }

  return { ok: true, cards };
}

export function validateSkip(state: GameState, actorId: PlayerId): ValidationResult {
  if (state.phase !== "playing") {
    return { ok: false, reason: "The game is not in progress." };
  }

  if (state.currentTurn !== actorId) {
    return { ok: false, reason: "It is not this player's turn." };
  }

  if (state.currentLeadingPlay === null) {
    return { ok: false, reason: "The leading player cannot skip before any cards are played." };
  }

  return { ok: true };
}
