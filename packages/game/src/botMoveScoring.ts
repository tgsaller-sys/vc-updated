import { compareCardsForPlay } from "./cards";
import { getBombMoves } from "./rules";
import type { Card, CardMove } from "./types";

export function compareMovesByCost(left: CardMove, right: CardMove): number {
  const highCardDifference = compareCardsForPlay(left.highCard, right.highCard);

  if (highCardDifference !== 0) {
    return highCardDifference;
  }

  return right.length - left.length;
}

export function compareMovesForBlocking(left: CardMove, right: CardMove): number {
  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return compareCardsForPlay(right.highCard, left.highCard);
}

export function protectedBombCardIds(hand: readonly Card[]): ReadonlySet<Card["id"]> {
  return new Set(getBombMoves(hand).flatMap((move) => move.cards.map((card) => card.id)));
}

export function spendsStrongCards(move: CardMove, protectedIds: ReadonlySet<Card["id"]>): boolean {
  return move.type === "bomb" || move.cards.some((card) => card.rank === "2" || protectedIds.has(card.id));
}
