import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  createDeck,
  createInitialGameState,
  dealEqually,
  reduceGameAction,
  shuffleDeck
} from ".";
import type { CardId, GameState, Player } from ".";

const players: readonly Player[] = [
  { id: "player-a", name: "Ada", connected: true, joinedAt: "2026-01-01T00:00:00.000Z" },
  { id: "player-b", name: "Ben", connected: true, joinedAt: "2026-01-01T00:01:00.000Z" },
  { id: "player-c", name: "Cyd", connected: true, joinedAt: "2026-01-01T00:02:00.000Z" }
];

function lobbyWithPlayers(count = 3): GameState {
  return players.slice(0, count).reduce((state, player) => {
    return assertValidTransition(reduceGameAction(state, { type: "join", player }));
  }, createInitialGameState("test-game"));
}

function startedGame(count = 3): GameState {
  return assertValidTransition(
    reduceGameAction(lobbyWithPlayers(count), { type: "start", actorId: "player-a", seed: 42 })
  );
}

describe("deck generation", () => {
  it("creates one standard 52-card deck with suits and ranks", () => {
    const deck = createDeck();

    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => card.id))).toHaveLength(52);
    expect(deck).toContainEqual({ id: "spades-A", suit: "spades", rank: "A" });
    expect(deck).toContainEqual({ id: "diamonds-10", suit: "diamonds", rank: "10" });
  });
});

describe("shuffling", () => {
  it("is deterministic for the same seed", () => {
    const deck = createDeck();

    expect(shuffleDeck(deck, 7)).toEqual(shuffleDeck(deck, 7));
    expect(shuffleDeck(deck, 7)).not.toEqual(deck);
  });
});

describe("dealing", () => {
  it("deals equally and leaves the remainder in the deck", () => {
    const result = dealEqually(["a", "b", "c"], createDeck());

    expect(result.hands.a).toHaveLength(17);
    expect(result.hands.b).toHaveLength(17);
    expect(result.hands.c).toHaveLength(17);
    expect(result.remainder).toHaveLength(1);
  });
});

describe("valid play detection", () => {
  it("accepts one or more cards owned by the current player", () => {
    const state = startedGame();
    const actorId = state.currentTurn ?? "";
    const firstCard = state.hands[actorId]?.[0];
    const secondCard = state.hands[actorId]?.[1];

    expect(firstCard).toBeDefined();
    expect(secondCard).toBeDefined();

    const result = reduceGameAction(state, {
      type: "play-cards",
      actorId,
      cardIds: [firstCard?.id, secondCard?.id].filter((id): id is CardId => id !== undefined)
    });

    expect(result.validation.ok).toBe(true);
    expect(result.state.discardPile).toHaveLength(1);
    expect(result.state.currentLeadingPlay?.playerId).toBe(actorId);
  });
});

describe("invalid play rejection", () => {
  it("rejects plays from the wrong player", () => {
    const state = startedGame();
    const card = state.hands["player-b"]?.[0];

    expect(card).toBeDefined();

    const result = reduceGameAction(state, {
      type: "play-cards",
      actorId: "player-b",
      cardIds: card === undefined ? [] : [card.id]
    });

    expect(result.validation.ok).toBe(false);
    expect(result.state).toBe(state);
  });

  it("rejects cards not owned by the current player", () => {
    const state = startedGame();
    const actorId = state.currentTurn ?? "";
    const otherCard = state.hands["player-b"]?.[0];

    expect(otherCard).toBeDefined();

    const result = reduceGameAction(state, {
      type: "play-cards",
      actorId,
      cardIds: otherCard === undefined ? [] : [otherCard.id]
    });

    expect(result.validation.ok).toBe(false);
  });

  it("uses injected validators for future rule limits", () => {
    const state = startedGame();
    const actorId = state.currentTurn ?? "";
    const card = state.hands[actorId]?.[0];

    expect(card).toBeDefined();

    const result = reduceGameAction(
      state,
      {
        type: "play-cards",
        actorId,
        cardIds: card === undefined ? [] : [card.id]
      },
      {
        playValidators: [() => ({ ok: false, reason: "Future sequential rule rejected this play." })]
      }
    );

    expect(result.validation).toEqual({
      ok: false,
      reason: "Future sequential rule rejected this play."
    });
  });
});

describe("turn advancement", () => {
  it("advances to the next deterministic player after a play", () => {
    const state = startedGame();
    const card = state.hands["player-a"]?.[0];

    expect(card).toBeDefined();

    const result = reduceGameAction(state, {
      type: "play-cards",
      actorId: "player-a",
      cardIds: card === undefined ? [] : [card.id]
    });

    expect(result.state.currentTurn).toBe("player-b");
  });
});

describe("skip/reset logic", () => {
  it("returns turn to the last player who played when everyone else skips", () => {
    const initialState = startedGame();
    const firstCard = initialState.hands["player-a"]?.[0];

    expect(firstCard).toBeDefined();

    const afterPlay = assertValidTransition(
      reduceGameAction(initialState, {
        type: "play-cards",
        actorId: "player-a",
        cardIds: firstCard === undefined ? [] : [firstCard.id]
      })
    );
    const afterFirstSkip = assertValidTransition(
      reduceGameAction(afterPlay, { type: "skip", actorId: "player-b" })
    );
    const afterSecondSkip = assertValidTransition(
      reduceGameAction(afterFirstSkip, { type: "skip", actorId: "player-c" })
    );

    expect(afterSecondSkip.currentTurn).toBe("player-a");
    expect(afterSecondSkip.currentLeadingPlay).toBeNull();
    expect(afterSecondSkip.skippedPlayers).toEqual([]);
  });
});

describe("win condition", () => {
  it("finishes when a player empties their hand", () => {
    const state = startedGame(2);
    const actorId = state.currentTurn ?? "";
    const handIds = (state.hands[actorId] ?? []).map((card) => card.id);

    const result = reduceGameAction(state, {
      type: "play-cards",
      actorId,
      cardIds: handIds
    });

    expect(result.validation.ok).toBe(true);
    expect(result.state.phase).toBe("finished");
    expect(result.state.winnerId).toBe(actorId);
  });
});
