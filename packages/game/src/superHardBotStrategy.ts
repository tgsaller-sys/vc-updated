import { compareCardsForPlay, createDeck, rankValue } from "./cards";
import { compareMovesByCost, compareMovesForBlocking, protectedBombCardIds, spendsStrongCards } from "./botMoveScoring";
import { actionForPlay, cardMovesForView } from "./botStrategyCore";
import { scoreHand } from "./handScoring";
import { getLegalMoves } from "./rules";
import type { BotTurnView } from "./botStrategyCore";
import type { Card, CardMove, GameAction } from "./types";

export interface SuperHardBotOptions {
  readonly debug?: (message: string) => void;
  readonly candidateLimit?: number;
}

interface ScoredMove {
  readonly move: CardMove;
  readonly score: number;
  readonly reasons: readonly string[];
}

function cardIdSet(cards: readonly Card[]): ReadonlySet<Card["id"]> {
  return new Set(cards.map((card) => card.id));
}

function removeMoveCards(hand: readonly Card[], move: CardMove): readonly Card[] {
  const playedIds = cardIdSet(move.cards);
  return hand.filter((card) => !playedIds.has(card.id));
}

function publicCardsForMove(view: BotTurnView, move?: CardMove): readonly Card[] {
  return [
    ...(view.playedCards ?? []),
    ...(view.currentTablePlay?.cards ?? []),
    ...(move?.cards ?? [])
  ];
}

function publicUnseenCards(view: BotTurnView, move?: CardMove): readonly Card[] {
  const knownIds = cardIdSet([...view.hand, ...publicCardsForMove(view, move)]);
  return createDeck().filter((card) => !knownIds.has(card.id));
}

function leadingMovesForHand(hand: readonly Card[], view: BotTurnView): readonly CardMove[] {
  return getLegalMoves({
    hand,
    currentTablePlay: null,
    isLeading: true,
    options: view.requiredOpeningCard === undefined ? {} : { requiredOpeningCard: view.requiredOpeningCard }
  }).filter((move): move is CardMove => move.type !== "pass");
}

function opponentDanger(view: BotTurnView, unseenCards: readonly Card[]): number {
  const closestOpponent = Math.min(...view.opponentCardCounts, 99);
  const closeOpponentPressure = closestOpponent <= 1 ? 95 : closestOpponent <= 2 ? 70 : closestOpponent <= 3 ? 38 : 0;
  const unseenTwos = unseenCards.filter((card) => card.rank === "2").length;
  const unseenRanks = new Map<Card["rank"], number>();

  for (const card of unseenCards) {
    unseenRanks.set(card.rank, (unseenRanks.get(card.rank) ?? 0) + 1);
  }

  const possibleQuadRanks = [...unseenRanks.values()].filter((count) => count >= 4).length;
  const possibleBombPressure = Math.min(30, possibleQuadRanks * 5 + unseenTwos * 2);

  return closeOpponentPressure + unseenTwos * 3 + possibleBombPressure;
}

function beatRisk(move: CardMove, unseenCards: readonly Card[]): number {
  if (unseenCards.length === 0) {
    return 0;
  }

  if (move.type === "single") {
    return unseenCards.filter((card) => compareCardsForPlay(card, move.highCard) > 0).length / unseenCards.length;
  }

  const byRank = new Map<Card["rank"], readonly Card[]>();

  for (const card of unseenCards) {
    byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  }

  if (move.type === "pair" || move.type === "triple" || move.type === "bomb") {
    const possibleRanks = [...byRank.values()].filter(
      (cards) =>
        cards.length >= move.length &&
        compareCardsForPlay(cards[cards.length - 1] ?? cards[0] ?? move.highCard, move.highCard) > 0
    ).length;
    return possibleRanks / Math.max(1, byRank.size);
  }

  const ranksAbove = [...byRank.keys()].filter((rank) => rank !== "2" && rankValue(rank) > rankValue(move.primaryRank)).length;
  const suitLockMultiplier = move.metadata?.straightSuitLock === true ? 0.45 : 1;
  return (ranksAbove / Math.max(1, byRank.size)) * suitLockMultiplier;
}

function moveControlScore(move: CardMove, unseenCards: readonly Card[]): number {
  const risk = beatRisk(move, unseenCards);
  const formatControl = move.type === "single" ? -8 : move.type === "pair" ? 8 : move.type === "triple" ? 12 : move.type === "straight" ? 10 : 22;
  return formatControl + (1 - Math.min(1, risk)) * 35;
}

function bestLookaheadScore(remainingHand: readonly Card[], view: BotTurnView, publicCards: readonly Card[]): number {
  if (remainingHand.length === 0) {
    return 300;
  }

  const nextMoves = [...leadingMovesForHand(remainingHand, {
    actorId: view.actorId,
    hand: remainingHand,
    currentTablePlay: null,
    isLeading: true,
    opponentCardCounts: view.opponentCardCounts,
    ...(view.playedCards === undefined ? {} : { playedCards: view.playedCards }),
    ...(view.turnOrder === undefined ? {} : { turnOrder: view.turnOrder })
  })]
    .sort((left, right) => right.length - left.length || compareMovesByCost(left, right))
    .slice(0, 8);

  if (nextMoves.length === 0) {
    return -60;
  }

  return Math.max(
    ...nextMoves.map((nextMove) => {
      const nextRemaining = removeMoveCards(remainingHand, nextMove);
      const nextScore = scoreHand({
        hand: nextRemaining,
        publicCards: [...publicCards, ...nextMove.cards],
        context: {
          playerCardCounts: view.opponentCardCounts,
          ...(view.turnOrder === undefined ? {} : { turnOrder: view.turnOrder }),
          likelyToLeadNext: true
        }
      });

      return nextMove.cards.length * 18 + nextScore.totalScore * 0.25 - nextScore.estimatedTurnsToGoOut * 20;
    })
  );
}

function scoreMove(
  move: CardMove,
  view: BotTurnView,
  protectedIds: ReadonlySet<Card["id"]>,
  includeLookahead: boolean
): ScoredMove {
  const remainingHand = removeMoveCards(view.hand, move);
  const publicCards = publicCardsForMove(view, move);
  const unseenCards = publicUnseenCards(view, move);
  const handScore = scoreHand({
    hand: remainingHand,
    publicCards,
    context: {
      playerCardCounts: view.opponentCardCounts,
      ...(view.turnOrder === undefined ? {} : { turnOrder: view.turnOrder }),
      likelyToLeadNext: view.isLeading
    }
  });
  const danger = opponentDanger(view, unseenCards);
  const opponentHasOneOrTwo = view.opponentCardCounts.some((count) => count >= 1 && count <= 2);
  const goesOutNow = remainingHand.length === 0;
  const nearWin = handScore.estimatedTurnsToGoOut <= 1 || remainingHand.length <= 2;
  const controlScore = moveControlScore(move, unseenCards);
  const blockingScore = opponentHasOneOrTwo
    ? move.type === "single"
      ? compareCardsForPlay(move.highCard, view.hand[0] ?? move.highCard) * 0.1 + controlScore
      : move.length * 28 + controlScore
    : 0;
  const strongCardWastePenalty =
    spendsStrongCards(move, protectedIds) && !goesOutNow && !nearWin && !opponentHasOneOrTwo ? 36 : 0;
  const awkwardLowPenalty = handScore.lowCardPenalty * 1.2;
  const lookaheadScore = includeLookahead ? bestLookaheadScore(remainingHand, view, publicCards) : 0;
  const reasons: string[] = [
    `after hand score=${handScore.totalScore.toFixed(1)}`,
    `turns=${handScore.estimatedTurnsToGoOut}`,
    `flex=${handScore.flexibilityScore}`,
    `danger=${danger.toFixed(1)}`,
    `control=${controlScore.toFixed(1)}`,
    includeLookahead ? `lookahead=${lookaheadScore.toFixed(1)}` : "lookahead=deferred"
  ];

  if (goesOutNow) {
    reasons.push("wins immediately");
  } else if (nearWin) {
    reasons.push("near-winning line");
  }

  if (opponentHasOneOrTwo) {
    reasons.push("blocking close opponent");
  }

  if (strongCardWastePenalty > 0) {
    reasons.push("penalized strong-card waste");
  }

  const score =
    (goesOutNow ? 200000 : 0) +
    (nearWin ? 9000 : 0) +
    handScore.totalScore +
    (8 - handScore.estimatedTurnsToGoOut) * 70 +
    move.cards.length * 22 +
    controlScore +
    blockingScore +
    lookaheadScore * 0.55 -
    danger * (opponentHasOneOrTwo ? 0.15 : 0.35) -
    awkwardLowPenalty -
    handScore.trappedCardPenalty -
    strongCardWastePenalty;

  return { move, score, reasons };
}

function shouldPass(bestMove: ScoredMove | undefined, view: BotTurnView): boolean {
  if (bestMove === undefined || view.isLeading) {
    return false;
  }

  const closestOpponent = Math.min(...view.opponentCardCounts, 99);
  const passScore = closestOpponent <= 2 ? -220 : -45;
  return passScore > bestMove.score;
}

/**
 * Scores legal moves with public information only and limited self-lookahead.
 */
export function chooseSuperHardBotAction(view: BotTurnView, options: SuperHardBotOptions = {}): GameAction {
  const plays = cardMovesForView(view);

  if (plays.length === 0) {
    options.debug?.("SuperHardBot skips: no legal card moves.");
    return { type: "skip", actorId: view.actorId };
  }

  const winningPlay = [...plays].filter((move) => move.cards.length === view.hand.length).sort(compareMovesByCost)[0];

  if (winningPlay !== undefined) {
    options.debug?.(`SuperHardBot plays ${winningPlay.cards.map((card) => card.id).join(",")} because it goes out now.`);
    return actionForPlay(view.actorId, winningPlay);
  }

  const protectedIds = protectedBombCardIds(view.hand);
  const candidateLimit = options.candidateLimit ?? 8;
  const roughCandidates = [...plays]
    .map((move) => scoreMove(move, view, protectedIds, false))
    .sort((left, right) => right.score - left.score || compareMovesForBlocking(left.move, right.move))
    .slice(0, candidateLimit);
  const scoredCandidates = roughCandidates
    .map((candidate) => scoreMove(candidate.move, view, protectedIds, true))
    .sort((left, right) => right.score - left.score || compareMovesForBlocking(left.move, right.move));
  const bestMove = scoredCandidates[0];

  if (shouldPass(bestMove, view)) {
    options.debug?.("SuperHardBot skips: best legal move does not beat pass value.");
    return { type: "skip", actorId: view.actorId };
  }

  if (bestMove === undefined) {
    options.debug?.("SuperHardBot skips: no candidate survived scoring.");
    return { type: "skip", actorId: view.actorId };
  }

  options.debug?.(
    `SuperHardBot plays ${bestMove.move.cards.map((card) => card.id).join(",")} score=${bestMove.score.toFixed(
      1
    )}; ${bestMove.reasons.join("; ")}`
  );
  return actionForPlay(view.actorId, bestMove.move);
}
