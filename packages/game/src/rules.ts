import { compareCardsForPlay, findCardsById, highestCardForPlay, rankValue, sortCardsForPlay } from "./cards";
import type {
  Card,
  CardId,
  GameState,
  PlayedSet,
  PlayerId,
  PlayShape,
  PlayValidationResult,
  RuleValidator,
  ValidationResult
} from "./types";

export const allowAnyOwnedCards: RuleValidator = (_state, _actorId, cards) => {
  if (cards.length === 0) {
    return { ok: false, reason: "Play at least one card." };
  }

  return { ok: true };
};

function sameRank(cards: readonly Card[]): boolean {
  const firstRank = cards[0]?.rank;
  return firstRank !== undefined && cards.every((card) => card.rank === firstRank);
}

function getMultipleKind(length: number): PlayShape["kind"] | null {
  switch (length) {
    case 1:
      return "single";
    case 2:
      return "double";
    case 3:
      return "triple";
    case 4:
      return "quad";
    default:
      return null;
  }
}

function straightHighRank(cards: readonly Card[]): Card["rank"] | null {
  if (cards.length < 3) {
    return null;
  }

  if (cards.some((card) => card.rank === "2")) {
    return null;
  }

  const sorted = sortCardsForPlay(cards);
  const values = sorted.map((card) => rankValue(card.rank));

  if (new Set(values).size !== values.length) {
    return null;
  }

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];

    if (previous === undefined || current === undefined || current !== previous + 1) {
      return null;
    }
  }

  return sorted[sorted.length - 1]?.rank ?? null;
}

export function identifyPlayShape(cards: readonly Card[]): PlayShape | null {
  if (cards.length === 0) {
    return null;
  }

  const multipleKind = getMultipleKind(cards.length);

  if (multipleKind !== null && sameRank(cards)) {
    const highCard = highestCardForPlay(cards);

    if (highCard === null) {
      return null;
    }

    return {
      kind: multipleKind,
      length: cards.length,
      highRank: highCard.rank,
      highCard
    };
  }

  const highStraightRank = straightHighRank(cards);

  if (highStraightRank !== null) {
    const highCard = highestCardForPlay(cards);

    if (highCard === null) {
      return null;
    }

    return {
      kind: "straight",
      length: cards.length,
      highRank: highStraightRank,
      highCard
    };
  }

  return null;
}

function playShapeForPlayedSet(playedSet: PlayedSet): PlayShape | null {
  return identifyPlayShape(playedSet.cards);
}

export const validateVcPlay: RuleValidator = (state, _actorId, cards) => {
  const nextShape = identifyPlayShape(cards);

  if (nextShape === null) {
    return {
      ok: false,
      reason: "Play singles, same-rank doubles/triples/quads, or straights of 3 or more cards."
    };
  }

  if (
    state.discardPile.length === 0 &&
    state.currentLeadingPlay === null &&
    !cards.some((card) => card.id === "spades-3")
  ) {
    return { ok: false, reason: "The first play must include the 3 of spades." };
  }

  if (state.currentLeadingPlay === null) {
    return { ok: true };
  }

  const leadingShape = playShapeForPlayedSet(state.currentLeadingPlay);

  if (leadingShape === null) {
    return { ok: false, reason: "The current leading play has an invalid shape." };
  }

  if (nextShape.kind !== leadingShape.kind || nextShape.length !== leadingShape.length) {
    return { ok: false, reason: "Play the same format as the current leading play or skip." };
  }

  if (compareCardsForPlay(nextShape.highCard, leadingShape.highCard) <= 0) {
    return { ok: false, reason: "Play higher cards than the current leading play or skip." };
  }

  return { ok: true };
};

export function validatePlay(
  state: GameState,
  actorId: PlayerId,
  cardIds: readonly CardId[],
  validators: readonly RuleValidator[] = [validateVcPlay]
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
