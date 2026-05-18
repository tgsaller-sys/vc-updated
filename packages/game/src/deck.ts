import { createDeck } from "./cards";
import { seededRandom } from "./random";
import type { Card, PlayerId } from "./types";

export function shuffleDeck(deck: readonly Card[], seed: number): readonly Card[] {
  const random = seededRandom(seed);
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const swap = shuffled[swapIndex];

    if (current === undefined || swap === undefined) {
      continue;
    }

    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

export function dealEqually(
  players: readonly PlayerId[],
  deck: readonly Card[]
): {
  readonly hands: Readonly<Record<PlayerId, readonly Card[]>>;
  readonly remainder: readonly Card[];
} {
  const handSize = Math.floor(deck.length / players.length);
  const hands = Object.fromEntries(players.map((playerId) => [playerId, [] as Card[]]));

  players.forEach((playerId, playerIndex) => {
    hands[playerId] = deck.slice(playerIndex * handSize, (playerIndex + 1) * handSize);
  });

  return {
    hands,
    remainder: deck.slice(handSize * players.length)
  };
}

export function createShuffledDeck(seed: number): readonly Card[] {
  return shuffleDeck(createDeck(), seed);
}
