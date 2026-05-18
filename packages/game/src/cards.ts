import type { Card, CardId, Rank, Suit } from "./types";

export const suits: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
export const ranks: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const playSuitOrder: readonly Suit[] = ["spades", "clubs", "diamonds", "hearts"];
export const playRankOrder: readonly Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];

export function createDeck(): readonly Card[] {
  return suits.flatMap((suit) =>
    ranks.map((rank) => {
      const id: CardId = `${suit}-${rank}`;
      return { id, suit, rank };
    })
  );
}

export function findCardsById(cards: readonly Card[], ids: readonly CardId[]): readonly Card[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return ids.map((id) => byId.get(id)).filter((card): card is Card => card !== undefined);
}

export function compareCardsForPlay(left: Card, right: Card): number {
  const rankDifference = playRankOrder.indexOf(left.rank) - playRankOrder.indexOf(right.rank);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  return playSuitOrder.indexOf(left.suit) - playSuitOrder.indexOf(right.suit);
}

export function sortCardsForPlay(cards: readonly Card[]): readonly Card[] {
  return [...cards].sort(compareCardsForPlay);
}

export function rankValue(rank: Rank): number {
  return playRankOrder.indexOf(rank);
}
