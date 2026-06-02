import { compareCardsForPlay, findCardsById, highestCardForPlay, rankValue, sortCardsForPlay } from "./cards";
import type {
  Card,
  CardId,
  CardMove,
  CardMoveType,
  GameState,
  GetLegalMovesInput,
  Move,
  PassMove,
  PlayerId,
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

function getMultipleType(length: number): CardMoveType | null {
  switch (length) {
    case 1:
      return "single";
    case 2:
      return "pair";
    case 3:
      return "triple";
    case 4:
      return "bomb";
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

function doubleStraightHighCard(cards: readonly Card[]): Card | null {
  if (cards.length < 6 || cards.length % 2 !== 0 || cards.some((card) => card.rank === "2")) {
    return null;
  }

  const byRank = new Map<Card["rank"], readonly Card[]>();

  for (const card of cards) {
    byRank.set(
      card.rank,
      [...(byRank.get(card.rank) ?? []), card].sort(compareCardsForPlay)
    );
  }

  if ([...byRank.values()].some((rankCards) => rankCards.length !== 2)) {
    return null;
  }

  const rankValues = [...byRank.keys()].map(rankValue).sort((left, right) => left - right);

  for (let index = 1; index < rankValues.length; index += 1) {
    const previous = rankValues[index - 1];
    const current = rankValues[index];

    if (previous === undefined || current === undefined || current !== previous + 1) {
      return null;
    }
  }

  return highestCardForPlay(cards);
}

export function identifyCardMove(cards: readonly Card[]): CardMove | null {
  if (cards.length === 0) {
    return null;
  }

  const multipleType = getMultipleType(cards.length);

  if (multipleType !== null && sameRank(cards)) {
    const highCard = highestCardForPlay(cards);

    if (highCard === null) {
      return null;
    }

    return {
      type: multipleType,
      cards: sortCardsForPlay(cards),
      length: cards.length,
      primaryRank: highCard.rank,
      highCard,
      ...(multipleType === "bomb" ? { metadata: { bombKind: "quad" as const } } : {})
    };
  }

  const highStraightRank = straightHighRank(cards);

  if (highStraightRank !== null) {
    const highCard = highestCardForPlay(cards);

    if (highCard === null) {
      return null;
    }

    return {
      type: "straight",
      cards: sortCardsForPlay(cards),
      length: cards.length,
      primaryRank: highStraightRank,
      highCard
    };
  }

  const highDoubleStraightCard = doubleStraightHighCard(cards);

  if (highDoubleStraightCard !== null) {
    return {
      type: "bomb",
      cards: sortCardsForPlay(cards),
      length: cards.length,
      primaryRank: highDoubleStraightCard.rank,
      highCard: highDoubleStraightCard,
      metadata: { bombKind: "double-straight" }
    };
  }

  return null;
}

export function isBombMove(move: CardMove): boolean {
  return move.type === "bomb";
}

export function isBombPlay(cards: readonly Card[]): boolean {
  const move = identifyCardMove(cards);
  return move !== null && isBombMove(move);
}

function isSingleTwo(move: CardMove): boolean {
  return move.type === "single" && move.highCard.rank === "2";
}

function validateVcCards(
  cards: readonly Card[],
  currentTablePlay: CardMove | null,
  isLeading: boolean,
  requiredOpeningCard?: Card
): ValidationResult {
  const nextMove = identifyCardMove(cards);

  if (nextMove === null) {
    return {
      ok: false,
      reason: "Play singles, same-rank doubles/triples/quads, or straights of 3 or more cards."
    };
  }

  if (requiredOpeningCard !== undefined && !cards.some((card) => card.id === requiredOpeningCard.id)) {
    return {
      ok: false,
      reason: `The first play must include the ${requiredOpeningCard.rank} of ${requiredOpeningCard.suit}.`
    };
  }

  if (isLeading) {
    if (nextMove.metadata?.bombKind === "double-straight") {
      return { ok: false, reason: "A double-straight bomb can only be played on a single 2." };
    }

    return { ok: true };
  }

  if (currentTablePlay === null) {
    return { ok: false, reason: "There is no current leading play." };
  }

  if (isSingleTwo(currentTablePlay) && isBombMove(nextMove)) {
    return { ok: true };
  }

  if (
    nextMove.metadata?.bombKind === "double-straight" &&
    currentTablePlay.metadata?.bombKind !== "double-straight"
  ) {
    return { ok: false, reason: "A double-straight bomb can only be played on a single 2." };
  }

  if (
    nextMove.type !== currentTablePlay.type ||
    nextMove.length !== currentTablePlay.length ||
    nextMove.metadata?.bombKind !== currentTablePlay.metadata?.bombKind
  ) {
    return { ok: false, reason: "Play the same format as the current leading play or skip." };
  }

  if (compareCardsForPlay(nextMove.highCard, currentTablePlay.highCard) <= 0) {
    return { ok: false, reason: "Play higher cards than the current leading play or skip." };
  }

  return { ok: true };
}

function combinations<T>(items: readonly T[], length: number): readonly (readonly T[])[] {
  if (length === 0) {
    return [[]];
  }

  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), length - 1).map((rest) => [item, ...rest])
  );
}

function choicesFromGroups<T>(groups: readonly (readonly T[])[]): readonly (readonly T[])[] {
  return groups.reduce<readonly (readonly T[])[]>(
    (choices, group) => choices.flatMap((choice) => group.map((item) => [...choice, item])),
    [[]]
  );
}

function consecutiveRankGroups<T>(
  ranksWithCards: readonly {
    readonly value: number;
    readonly choices: readonly T[];
  }[],
  minimumLength: number
): readonly (readonly T[])[] {
  const groups: (readonly T[])[] = [];

  for (let start = 0; start < ranksWithCards.length; start += 1) {
    for (let end = start + minimumLength; end <= ranksWithCards.length; end += 1) {
      const run = ranksWithCards.slice(start, end);
      const isConsecutive = run.every((rank, index) => {
        const previous = run[index - 1];
        return index === 0 || (previous !== undefined && rank.value === previous.value + 1);
      });

      if (!isConsecutive) {
        break;
      }

      groups.push(...choicesFromGroups(run.map((rank) => rank.choices)));
    }
  }

  return groups;
}

function compareCardLists(left: readonly Card[], right: readonly Card[]): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftCard = left[index];
    const rightCard = right[index];

    if (leftCard === undefined || rightCard === undefined) {
      return 0;
    }

    const difference = compareCardsForPlay(leftCard, rightCard);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function candidatePlays(hand: readonly Card[]): readonly (readonly Card[])[] {
  const sortedHand = sortCardsForPlay(hand);
  const byRank = new Map<Card["rank"], readonly Card[]>();

  for (const card of sortedHand) {
    byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  }

  const plays: (readonly Card[])[] = sortedHand.map((card) => [card]);

  for (const rankCards of byRank.values()) {
    for (const length of [2, 3, 4]) {
      plays.push(...combinations(rankCards, length));
    }
  }

  const ranksWithoutTwos = [...byRank.entries()]
    .filter(([rank]) => rank !== "2")
    .map(([rank, cards]) => ({ value: rankValue(rank), choices: cards }))
    .sort((left, right) => left.value - right.value);
  plays.push(...consecutiveRankGroups(ranksWithoutTwos, 3));

  const ranksWithPairs = ranksWithoutTwos
    .map(({ value, choices }) => ({ value, choices: combinations(choices, 2) }))
    .filter(({ choices }) => choices.length > 0);
  plays.push(...consecutiveRankGroups(ranksWithPairs, 3).map((pairs) => pairs.flat()));

  const uniquePlays = new Map<string, readonly Card[]>();

  for (const play of plays) {
    const sortedPlay = sortCardsForPlay(play);
    uniquePlays.set(sortedPlay.map((card) => card.id).join("|"), sortedPlay);
  }

  return [...uniquePlays.values()].sort(compareCardLists);
}

/**
 * Returns every bomb available in a hand so strategies can reason about them
 * without duplicating the rules for quads and double straights.
 */
export function getBombMoves(hand: readonly Card[]): readonly CardMove[] {
  return candidatePlays(hand)
    .map((cards) => identifyCardMove(cards))
    .filter((move): move is CardMove => move !== null && isBombMove(move));
}

/**
 * Returns every legal VC play for a hand in deterministic card order.
 * The function is pure so clients can safely use it for hints or action menus.
 */
export function getLegalMoves({
  hand,
  currentTablePlay,
  isLeading,
  options = {}
}: GetLegalMovesInput): readonly Move[] {
  const legalPlays: readonly Move[] = candidatePlays(hand)
    .filter((cards) => validateVcCards(cards, currentTablePlay, isLeading, options.requiredOpeningCard).ok)
    .map((cards) => identifyCardMove(cards))
    .filter((move): move is CardMove => move !== null);

  if (options.allowPass !== false && !isLeading && currentTablePlay !== null) {
    const pass: PassMove = {
      type: "pass",
      cards: [],
      primaryRank: null,
      highCard: null,
      length: 0
    };
    return [...legalPlays, pass];
  }

  return legalPlays;
}

function openingCardForState(state: GameState): Card | null {
  const cards = Object.values(state.hands).flat();
  return cards.find((card) => card.id === "spades-3") ?? sortCardsForPlay(cards).at(0) ?? null;
}

export const validateVcPlay: RuleValidator = (state, _actorId, cards) => {
  let requiredOpeningCard: Card | undefined;
  if (state.discardPile.length === 0 && state.currentLeadingPlay === null) {
    requiredOpeningCard = openingCardForState(state) ?? undefined;
  }

  return validateVcCards(
    cards,
    state.currentLeadingPlay === null ? null : identifyCardMove(state.currentLeadingPlay.cards),
    state.currentLeadingPlay === null,
    requiredOpeningCard
  );
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

  if (state.skippedPlayers.includes(actorId)) {
    return { ok: false, reason: "This player skipped and cannot play again until the hand resets." };
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

  const move = identifyCardMove(cards);

  if (move === null) {
    return { ok: false, reason: "The selected cards do not form a recognized VC move." };
  }

  return { ok: true, cards, move };
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
