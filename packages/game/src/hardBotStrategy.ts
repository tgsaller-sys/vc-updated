import { compareCardsForPlay, createDeck, rankValue } from "./cards";
import { getLegalMoves } from "./rules";
import { actionForPlay, cardMovesForView } from "./botStrategyCore";
import { compareMovesByCost, compareMovesForBlocking, protectedBombCardIds, spendsStrongCards } from "./botMoveScoring";
import type { BotTurnView } from "./botStrategyCore";
import type { Card, CardMove, GameAction } from "./types";

interface HandQuality {
  readonly estimatedTurns: number;
  readonly flexibility: number;
  readonly isolatedLowCards: number;
  readonly trappedHighCards: number;
}

interface ScoreContext {
  readonly handQualityCache: Map<string, HandQuality>;
  readonly protectedIds: ReadonlySet<Card["id"]>;
  readonly pressure: number;
  readonly unseenCards: readonly Card[];
}

function cardIdSet(cards: readonly Card[]): ReadonlySet<Card["id"]> {
  return new Set(cards.map((card) => card.id));
}

function removeMoveCards(hand: readonly Card[], move: CardMove): readonly Card[] {
  const playedIds = cardIdSet(move.cards);
  return hand.filter((card) => !playedIds.has(card.id));
}

function publicUnseenCards(view: BotTurnView): readonly Card[] {
  const knownIds = new Set([...view.hand, ...(view.playedCards ?? []), ...(view.currentTablePlay?.cards ?? [])].map((card) => card.id));
  return createDeck().filter((card) => !knownIds.has(card.id));
}

function leadingCardMoves(hand: readonly Card[]): readonly CardMove[] {
  return getLegalMoves({ hand, currentTablePlay: null, isLeading: true }).filter(
    (move): move is CardMove => move.type !== "pass"
  );
}

function greedyTurnEstimate(hand: readonly Card[]): number {
  let remaining = [...hand];
  let turns = 0;

  while (remaining.length > 0 && turns < 52) {
    const nextMove = [...leadingCardMoves(remaining)].sort((left, right) => right.length - left.length || compareMovesByCost(left, right))[0];

    if (nextMove === undefined) {
      return turns + remaining.length;
    }

    remaining = [...removeMoveCards(remaining, nextMove)];
    turns += 1;
  }

  return turns;
}

function recursiveTurnEstimate(hand: readonly Card[], memo = new Map<string, number>()): number {
  if (hand.length === 0) {
    return 0;
  }

  if (hand.length > 6) {
    return greedyTurnEstimate(hand);
  }

  const key = hand.map((card) => card.id).sort().join("|");
  const cached = memo.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const moves = leadingCardMoves(hand);
  const estimate =
    moves.length === 0
      ? hand.length
      : Math.min(...moves.map((move) => 1 + recursiveTurnEstimate(removeMoveCards(hand, move), memo)));

  memo.set(key, estimate);
  return estimate;
}

function cardsInAnyCombination(hand: readonly Card[]): ReadonlySet<Card["id"]> {
  const comboIds = new Set<Card["id"]>();

  for (const move of leadingCardMoves(hand)) {
    if (move.length > 1) {
      move.cards.forEach((card) => comboIds.add(card.id));
    }
  }

  return comboIds;
}

function evaluateHand(hand: readonly Card[]): HandQuality {
  const moves = leadingCardMoves(hand);
  const comboIds = cardsInAnyCombination(hand);
  const isolatedLowCards = hand.filter((card) => rankValue(card.rank) <= rankValue("7") && !comboIds.has(card.id)).length;
  const trappedHighCards = hand.filter((card) => (card.rank === "A" || card.rank === "2") && !comboIds.has(card.id)).length;
  const combinationCount = moves.filter((move) => move.length > 1).length;
  const straightCount = moves.filter((move) => move.type === "straight").length;

  return {
    estimatedTurns: recursiveTurnEstimate(hand),
    flexibility: moves.length + combinationCount * 2 + straightCount,
    isolatedLowCards,
    trappedHighCards
  };
}

function beatRisk(move: CardMove, unseenCards: readonly Card[]): number {
  if (unseenCards.length === 0) {
    return 0;
  }

  if (move.type === "single") {
    const beatingCards = unseenCards.filter((card) => compareCardsForPlay(card, move.highCard) > 0).length;
    return Math.min(1, beatingCards / unseenCards.length);
  }

  const byRank = new Map<Card["rank"], readonly Card[]>();

  for (const card of unseenCards) {
    byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  }

  if (move.type === "pair" || move.type === "triple" || move.type === "bomb") {
    const needed = move.length;
    const possibleRanks = [...byRank.values()].filter(
      (cards) => cards.length >= needed && compareCardsForPlay(cards[cards.length - 1] ?? cards[0] ?? move.highCard, move.highCard) > 0
    ).length;
    return Math.min(1, possibleRanks / Math.max(1, byRank.size));
  }

  const ranksAbove = [...byRank.keys()].filter((rank) => rank !== "2" && rankValue(rank) > rankValue(move.primaryRank)).length;
  const suitLockMultiplier = move.metadata?.straightSuitLock === true ? 0.45 : 1;

  return Math.min(1, (ranksAbove / Math.max(1, byRank.size)) * suitLockMultiplier);
}

function publicPressure(view: BotTurnView): number {
  const closestOpponent = Math.min(...view.opponentCardCounts, 99);

  if (closestOpponent <= 1) {
    return 3;
  }

  if (closestOpponent <= 3) {
    return 2;
  }

  return 1;
}

function handKey(hand: readonly Card[]): string {
  return hand.map((card) => card.id).sort().join("|");
}

function scoreMove(move: CardMove, view: BotTurnView, context: ScoreContext): number {
  const remainingHand = removeMoveCards(view.hand, move);
  const remainingHandKey = handKey(remainingHand);
  const cachedQuality = context.handQualityCache.get(remainingHandKey);
  const handQuality = cachedQuality ?? evaluateHand(remainingHand);

  if (cachedQuality === undefined) {
    context.handQualityCache.set(remainingHandKey, handQuality);
  }

  const moveRisk = beatRisk(move, context.unseenCards);
  const strongCardCost = spendsStrongCards(move, context.protectedIds) ? 1 : 0;
  const removesDifficultLowCards = move.cards.filter((card) => rankValue(card.rank) <= rankValue("7")).length;
  const moveTypeBonus = move.type === "straight" ? 18 : move.length > 1 ? 12 : 0;

  if (remainingHand.length === 0) {
    return 100000;
  }

  return (
    move.cards.length * 28 +
    moveTypeBonus +
    removesDifficultLowCards * 4 -
    handQuality.estimatedTurns * 42 +
    handQuality.flexibility * 5 -
    handQuality.isolatedLowCards * 14 -
    handQuality.trappedHighCards * 8 -
    moveRisk * (context.pressure >= 3 ? 8 : 34) -
    strongCardCost * (context.pressure >= 2 || view.hand.length <= 3 ? 3 : 34) +
    (context.pressure >= 3 ? compareCardsForPlay(move.highCard, view.hand[0] ?? move.highCard) * 0.05 : 0)
  );
}

function scorePass(view: BotTurnView): number {
  const pressure = publicPressure(view);
  return pressure >= 2 ? -300 : -180;
}

/**
 * Scores every legal move from public information only and chooses the best line.
 */
export function chooseHardBotAction(view: BotTurnView): GameAction {
  const plays = cardMovesForView(view);

  if (plays.length === 0) {
    return { type: "skip", actorId: view.actorId };
  }

  const winningPlay = [...plays].filter((move) => move.cards.length === view.hand.length).sort(compareMovesByCost)[0];

  if (winningPlay !== undefined) {
    return actionForPlay(view.actorId, winningPlay);
  }

  const context: ScoreContext = {
    handQualityCache: new Map<string, HandQuality>(),
    protectedIds: protectedBombCardIds(view.hand),
    pressure: publicPressure(view),
    unseenCards: publicUnseenCards(view)
  };
  const scoredPlays = plays.map((move) => ({ move, score: scoreMove(move, view, context) }));
  const bestPlay = scoredPlays.sort((left, right) => {
    const scoreDifference = right.score - left.score;
    return scoreDifference === 0
      ? context.pressure >= 3
        ? compareMovesForBlocking(left.move, right.move)
        : compareMovesByCost(left.move, right.move)
      : scoreDifference;
  })[0];

  if (!view.isLeading && scorePass(view) > (bestPlay?.score ?? Number.NEGATIVE_INFINITY)) {
    return { type: "skip", actorId: view.actorId };
  }

  return bestPlay === undefined ? { type: "skip", actorId: view.actorId } : actionForPlay(view.actorId, bestPlay.move);
}
