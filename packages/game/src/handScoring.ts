import { compareCardsForPlay, createDeck, rankValue, sortCardsForPlay } from "./cards";
import { getLegalMoves } from "./rules";
import type { Card, CardMove, PlayerId, VcRuleOptions } from "./types";

export interface ScoreHandContext {
  readonly playerCardCounts?: readonly number[];
  readonly turnOrder?: readonly PlayerId[];
  readonly likelyToLeadNext?: boolean;
}

export interface ScoreHandInput {
  readonly hand: readonly Card[];
  readonly publicCards?: readonly Card[];
  readonly ruleOptions?: VcRuleOptions;
  readonly context?: ScoreHandContext;
}

export interface HandScore {
  readonly totalScore: number;
  readonly estimatedTurnsToGoOut: number;
  readonly singlesCount: number;
  readonly pairCount: number;
  readonly tripleCount: number;
  readonly straightCount: number;
  readonly bombCount: number;
  readonly highCardStrength: number;
  readonly lowCardPenalty: number;
  readonly flexibilityScore: number;
  readonly trappedCardPenalty: number;
  readonly notes: readonly string[];
}

function cardIdSet(cards: readonly Card[]): ReadonlySet<Card["id"]> {
  return new Set(cards.map((card) => card.id));
}

function removeMoveCards(hand: readonly Card[], move: CardMove): readonly Card[] {
  const playedIds = cardIdSet(move.cards);
  return hand.filter((card) => !playedIds.has(card.id));
}

function leadingCardMoves(hand: readonly Card[], ruleOptions: VcRuleOptions): readonly CardMove[] {
  return getLegalMoves({ hand, currentTablePlay: null, isLeading: true, options: ruleOptions }).filter(
    (move): move is CardMove => move.type !== "pass"
  );
}

function handKey(hand: readonly Card[]): string {
  return hand.map((card) => card.id).sort().join("|");
}

function greedyTurnEstimate(hand: readonly Card[], ruleOptions: VcRuleOptions): number {
  let remaining = [...hand];
  let turns = 0;

  while (remaining.length > 0 && turns < 52) {
    const nextMove = [...leadingCardMoves(remaining, ruleOptions)].sort(
      (left, right) => right.length - left.length || compareCardsForPlay(left.highCard, right.highCard)
    )[0];

    if (nextMove === undefined) {
      return turns + remaining.length;
    }

    remaining = [...removeMoveCards(remaining, nextMove)];
    turns += 1;
  }

  return turns;
}

function recursiveTurnEstimate(
  hand: readonly Card[],
  ruleOptions: VcRuleOptions,
  memo = new Map<string, number>()
): number {
  if (hand.length === 0) {
    return 0;
  }

  if (hand.length > 7) {
    return greedyTurnEstimate(hand, ruleOptions);
  }

  const key = handKey(hand);
  const cached = memo.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const moves = leadingCardMoves(hand, ruleOptions);
  const estimate =
    moves.length === 0
      ? hand.length
      : Math.min(...moves.map((move) => 1 + recursiveTurnEstimate(removeMoveCards(hand, move), ruleOptions, memo)));

  memo.set(key, estimate);
  return estimate;
}

function cardsInCombination(moves: readonly CardMove[]): ReadonlySet<Card["id"]> {
  const comboIds = new Set<Card["id"]>();

  for (const move of moves) {
    if (move.length > 1) {
      move.cards.forEach((card) => comboIds.add(card.id));
    }
  }

  return comboIds;
}

function unseenPublicOnly(hand: readonly Card[], publicCards: readonly Card[]): readonly Card[] {
  const knownIds = cardIdSet([...hand, ...publicCards]);
  return createDeck().filter((card) => !knownIds.has(card.id));
}

function highCardValue(card: Card): number {
  const base = rankValue(card.rank);
  const twoBonus = card.rank === "2" ? 5 : 0;
  return base + twoBonus;
}

function likelyOpponentPressure(context: ScoreHandContext): number {
  const closestOpponent = Math.min(...(context.playerCardCounts ?? []), 99);

  if (closestOpponent <= 1) {
    return 3;
  }

  if (closestOpponent <= 3) {
    return 2;
  }

  return 1;
}

/**
 * Scores a hand from public information only. It is deterministic and never mutates inputs.
 */
export function scoreHand({
  hand,
  publicCards = [],
  ruleOptions = {},
  context = {}
}: ScoreHandInput): HandScore {
  const sortedHand = sortCardsForPlay(hand);
  const moves = leadingCardMoves(sortedHand, ruleOptions);
  const comboIds = cardsInCombination(moves);
  const unseenCards = unseenPublicOnly(sortedHand, publicCards);
  const unseenHigherCards = (card: Card) => unseenCards.filter((unseen) => compareCardsForPlay(unseen, card) > 0).length;
  const pressure = likelyOpponentPressure(context);
  const notes: string[] = [];

  const singlesCount = moves.filter((move) => move.type === "single").length;
  const pairCount = moves.filter((move) => move.type === "pair").length;
  const tripleCount = moves.filter((move) => move.type === "triple").length;
  const straightCount = moves.filter((move) => move.type === "straight").length;
  const bombCount = moves.filter((move) => move.type === "bomb").length;
  const estimatedTurnsToGoOut = recursiveTurnEstimate(sortedHand, ruleOptions);
  const highCardStrength = sortedHand.reduce((total, card) => total + highCardValue(card), 0);
  const isolatedLowCards = sortedHand.filter((card) => rankValue(card.rank) <= rankValue("7") && !comboIds.has(card.id));
  const lowCardPenalty = isolatedLowCards.reduce((total, card) => total + (8 - rankValue(card.rank)) * 4, 0);
  const flexibleCombinationCount = pairCount + tripleCount * 2 + straightCount * 2 + bombCount * 3;
  const flexibilityScore = moves.length * 3 + flexibleCombinationCount * 7;
  const trappedHighCards = sortedHand.filter(
    (card) => (card.rank === "A" || card.rank === "2") && !comboIds.has(card.id) && unseenHigherCards(card) > 0
  );
  const trappedCardPenalty = trappedHighCards.length * (pressure >= 2 ? 14 : 9);
  const bombScore = bombCount * (context.likelyToLeadNext === true ? 24 : 18);
  const twoScore = sortedHand.filter((card) => card.rank === "2").length * (context.likelyToLeadNext === true ? 9 : 14);
  const turnScore = Math.max(0, 8 - estimatedTurnsToGoOut) * 45;
  const leadBonus = context.likelyToLeadNext === true ? straightCount * 8 + pairCount * 4 : 0;
  const strongCardWastePenalty =
    context.likelyToLeadNext === true && sortedHand.length > 5 ? sortedHand.filter((card) => card.rank === "2").length * 5 : 0;

  if (estimatedTurnsToGoOut <= 2) {
    notes.push("near-winning hand");
  }

  if (isolatedLowCards.length > 0) {
    notes.push(`isolated low cards: ${isolatedLowCards.map((card) => card.id).join(", ")}`);
  }

  if (bombCount > 0) {
    notes.push(`${bombCount} bomb option${bombCount === 1 ? "" : "s"}`);
  }

  if (trappedHighCards.length > 0) {
    notes.push(`trapped high cards: ${trappedHighCards.map((card) => card.id).join(", ")}`);
  }

  if (context.likelyToLeadNext === true) {
    notes.push("likely to lead next");
  }

  const totalScore =
    turnScore +
    flexibilityScore +
    highCardStrength +
    bombScore +
    twoScore +
    leadBonus -
    lowCardPenalty -
    trappedCardPenalty -
    strongCardWastePenalty;

  return {
    totalScore,
    estimatedTurnsToGoOut,
    singlesCount,
    pairCount,
    tripleCount,
    straightCount,
    bombCount,
    highCardStrength,
    lowCardPenalty,
    flexibilityScore,
    trappedCardPenalty,
    notes
  };
}
