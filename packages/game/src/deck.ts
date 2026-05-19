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

function extraRecipientIds(players: readonly PlayerId[], firstExtraIndex: number, extraCount: number): readonly PlayerId[] {
  return Array.from({ length: extraCount }, (_value, offset) => {
    const player = players[(firstExtraIndex + offset) % players.length];

    if (player === undefined) {
      throw new Error("Cannot deal extra cards without players.");
    }

    return player;
  });
}

function dealWithExtraStart(
  players: readonly PlayerId[],
  deck: readonly Card[],
  firstExtraIndex: number
): Readonly<Record<PlayerId, readonly Card[]>> {
  const handSize = Math.floor(deck.length / players.length);
  const extraCount = deck.length % players.length;
  const extraRecipients = new Set(extraRecipientIds(players, firstExtraIndex, extraCount));
  const hands = Object.fromEntries(players.map((playerId) => [playerId, [] as Card[]]));
  let deckIndex = 0;

  players.forEach((playerId) => {
    const nextHandSize = handSize + (extraRecipients.has(playerId) ? 1 : 0);
    hands[playerId] = deck.slice(deckIndex, deckIndex + nextHandSize);
    deckIndex += nextHandSize;
  });

  return hands;
}

function findPlayerWithCard(hands: Readonly<Record<PlayerId, readonly Card[]>>, cardId: string): PlayerId | null {
  for (const [playerId, hand] of Object.entries(hands)) {
    if (hand.some((card) => card.id === cardId)) {
      return playerId;
    }
  }

  return null;
}

/**
 * Deals every card for VC. When cards cannot divide evenly, extra cards begin
 * with the player who receives the 3 of spades and continue in turn order.
 */
export function dealForVc(players: readonly PlayerId[], deck: readonly Card[]): Readonly<Record<PlayerId, readonly Card[]>> {
  if (players.length === 0) {
    throw new Error("Cannot deal cards without players.");
  }

  const extraCount = deck.length % players.length;

  if (extraCount === 0) {
    return dealWithExtraStart(players, deck, 0);
  }

  for (let firstExtraIndex = 0; firstExtraIndex < players.length; firstExtraIndex += 1) {
    const hands = dealWithExtraStart(players, deck, firstExtraIndex);
    const holderId = findPlayerWithCard(hands, "spades-3");

    if (holderId === players[firstExtraIndex]) {
      return hands;
    }
  }

  throw new Error("Could not assign extra cards to the player holding the 3 of spades.");
}

export function createShuffledDeck(seed: number): readonly Card[] {
  return shuffleDeck(createDeck(), seed);
}
