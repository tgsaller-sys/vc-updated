import type { Card, CardId, Rank, Suit } from "./types";

export const suits: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
export const ranks: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

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
