import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  createDeck,
  createInitialGameState,
  dealEqually,
  reduceGameAction,
  shuffleDeck,
  sortCardsForPlay,
  validatePlay
} from ".";
import type { Card, CardId, GameState, Player } from ".";

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

function playerHoldingCard(state: GameState, cardId: CardId): string {
  const player = Object.entries(state.hands).find((entry) => entry[1].some((nextCard) => nextCard.id === cardId));

  if (player === undefined) {
    throw new Error(`No player holds ${cardId}`);
  }

  return player[0];
}

function card(id: CardId): Card {
  const found = createDeck().find((nextCard) => nextCard.id === id);

  if (found === undefined) {
    throw new Error(`Missing test card ${id}`);
  }

  return found;
}

function playingStateWithHands(hands: Readonly<Record<string, readonly Card[]>>): GameState {
  return {
    ...createInitialGameState("rules-test"),
    phase: "playing",
    players,
    hands,
    currentTurn: "player-a",
    turnOrder: players.map((player) => player.id)
  };
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

describe("card sorting", () => {
  it("sorts by VC rank order then suit order", () => {
    const cards = [
      { id: "hearts-2", suit: "hearts", rank: "2" },
      { id: "clubs-3", suit: "clubs", rank: "3" },
      { id: "spades-A", suit: "spades", rank: "A" },
      { id: "spades-3", suit: "spades", rank: "3" },
      { id: "diamonds-A", suit: "diamonds", rank: "A" },
      { id: "hearts-3", suit: "hearts", rank: "3" }
    ] as const;

    expect(sortCardsForPlay(cards).map((card) => card.id)).toEqual([
      "spades-3",
      "clubs-3",
      "hearts-3",
      "spades-A",
      "diamonds-A",
      "hearts-2"
    ]);
  });
});

describe("valid play detection", () => {
  it("accepts one or more cards owned by the current player", () => {
    const state = startedGame();
    const actorId = state.currentTurn ?? "";
    const firstCard = state.hands[actorId]?.[0];

    expect(firstCard).toBeDefined();

    const result = reduceGameAction(state, {
      type: "play-cards",
      actorId,
      cardIds: [firstCard?.id].filter((id): id is CardId => id !== undefined)
    });

    expect(result.validation.ok).toBe(true);
    expect(result.state.discardPile).toHaveLength(1);
    expect(result.state.currentLeadingPlay?.playerId).toBe(actorId);
  });
});

describe("VC play rules", () => {
  it("allows same-rank doubles, triples, and quads", () => {
    const state = playingStateWithHands({
      "player-a": [card("spades-3"), card("spades-6"), card("clubs-6"), card("diamonds-6"), card("hearts-6")],
      "player-b": [],
      "player-c": []
    });

    const afterOpening = assertValidTransition(
      reduceGameAction(state, { type: "play-cards", actorId: "player-a", cardIds: ["spades-3"] })
    );
    const nextState = { ...afterOpening, currentTurn: "player-a", currentLeadingPlay: null };

    expect(validatePlay(nextState, "player-a", ["spades-6", "clubs-6"]).ok).toBe(true);
    expect(validatePlay(nextState, "player-a", ["spades-6", "clubs-6", "diamonds-6"]).ok).toBe(true);
    expect(validatePlay(nextState, "player-a", ["spades-6", "clubs-6", "diamonds-6", "hearts-6"]).ok).toBe(true);
  });

  it("allows straights of three or more consecutive ranks", () => {
    const state = playingStateWithHands({
      "player-a": [card("spades-3"), card("clubs-4"), card("diamonds-5"), card("hearts-6")],
      "player-b": [],
      "player-c": []
    });

    expect(validatePlay(state, "player-a", ["spades-3", "clubs-4", "diamonds-5"]).ok).toBe(true);
    expect(validatePlay(state, "player-a", ["spades-3", "clubs-4", "diamonds-5", "hearts-6"]).ok).toBe(true);
  });

  it("rejects straights that include a 2", () => {
    const state = playingStateWithHands({
      "player-a": [card("spades-K"), card("clubs-A"), card("diamonds-2"), card("spades-3")],
      "player-b": [],
      "player-c": []
    });
    const stateAfterOpening = {
      ...state,
      discardPile: [{ playerId: "player-b", cards: [card("spades-3")] }]
    };

    expect(validatePlay(stateAfterOpening, "player-a", ["spades-K", "clubs-A", "diamonds-2"]).ok).toBe(false);
  });

  it("rejects mixed-rank sets and broken straights", () => {
    const state = playingStateWithHands({
      "player-a": [card("spades-3"), card("spades-6"), card("clubs-6"), card("diamonds-7"), card("hearts-9")],
      "player-b": [],
      "player-c": []
    });
    const stateAfterOpening = {
      ...state,
      discardPile: [{ playerId: "player-b", cards: [card("spades-3")] }]
    };

    expect(validatePlay(stateAfterOpening, "player-a", ["spades-6", "diamonds-7"]).ok).toBe(false);
    expect(validatePlay(stateAfterOpening, "player-a", ["spades-6", "diamonds-7", "hearts-9"]).ok).toBe(false);
  });

  it("requires the first play to include the 3 of spades", () => {
    const state = playingStateWithHands({
      "player-a": [card("spades-3"), card("clubs-4"), card("diamonds-5"), card("hearts-6")],
      "player-b": [],
      "player-c": []
    });

    expect(validatePlay(state, "player-a", ["clubs-4"]).ok).toBe(false);
    expect(validatePlay(state, "player-a", ["spades-3"]).ok).toBe(true);
    expect(validatePlay(state, "player-a", ["spades-3", "clubs-4", "diamonds-5"]).ok).toBe(true);
  });

  it("requires the same format as the leading play", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [card("spades-7"), card("clubs-7"), card("diamonds-7"), card("spades-8")],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("spades-6"), card("clubs-6"), card("diamonds-6")]
      }
    };

    expect(validatePlay(state, "player-a", ["spades-7", "clubs-7", "diamonds-7"]).ok).toBe(true);
    expect(validatePlay(state, "player-a", ["spades-8"]).ok).toBe(false);
    expect(validatePlay(state, "player-a", ["spades-7", "clubs-7"]).ok).toBe(false);
  });

  it("requires played cards to beat the leading play by rank", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [card("spades-5"), card("clubs-5"), card("diamonds-7"), card("hearts-7")],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("spades-6"), card("clubs-6")]
      }
    };

    expect(validatePlay(state, "player-a", ["spades-5", "clubs-5"]).ok).toBe(false);
    expect(validatePlay(state, "player-a", ["diamonds-7", "hearts-7"]).ok).toBe(true);
  });

  it("uses the highest card suit to break ties in same-rank sets", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [card("spades-5"), card("hearts-5"), card("clubs-5"), card("diamonds-5")],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("clubs-5"), card("diamonds-5")]
      }
    };

    expect(validatePlay(state, "player-a", ["spades-5", "hearts-5"]).ok).toBe(true);
    expect(validatePlay(state, "player-a", ["spades-5", "clubs-5"]).ok).toBe(false);
  });

  it("requires straights to match length and beat the high rank", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [
          card("spades-4"),
          card("clubs-5"),
          card("diamonds-6"),
          card("hearts-7"),
          card("spades-8")
        ],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("spades-3"), card("clubs-4"), card("diamonds-5")]
      }
    };

    expect(validatePlay(state, "player-a", ["spades-4", "clubs-5", "diamonds-6"]).ok).toBe(true);
    expect(validatePlay(state, "player-a", ["spades-4", "clubs-5", "diamonds-6", "hearts-7"]).ok).toBe(false);
  });

  it("uses the highest card suit to break ties in straights", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [card("spades-4"), card("spades-5"), card("clubs-6")],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("hearts-4"), card("hearts-5"), card("spades-6")]
      }
    };

    expect(validatePlay(state, "player-a", ["spades-4", "spades-5", "clubs-6"]).ok).toBe(true);
  });

  it("allows a quad bomb to be played on a single 2", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [card("spades-4"), card("clubs-4"), card("diamonds-4"), card("hearts-4")],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("spades-2")]
      }
    };

    expect(validatePlay(state, "player-a", ["spades-4", "clubs-4", "diamonds-4", "hearts-4"]).ok).toBe(true);
  });

  it("allows a double-straight bomb to be played on a single 2", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [
          card("spades-4"),
          card("clubs-4"),
          card("spades-5"),
          card("clubs-5"),
          card("spades-6"),
          card("clubs-6")
        ],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("hearts-2")]
      }
    };

    expect(
      validatePlay(state, "player-a", ["spades-4", "clubs-4", "spades-5", "clubs-5", "spades-6", "clubs-6"]).ok
    ).toBe(true);
  });

  it("rejects double-straight bombs when the leading play is not a single 2", () => {
    const state: GameState = {
      ...playingStateWithHands({
        "player-a": [
          card("spades-4"),
          card("clubs-4"),
          card("spades-5"),
          card("clubs-5"),
          card("spades-6"),
          card("clubs-6")
        ],
        "player-b": [],
        "player-c": []
      }),
      currentLeadingPlay: {
        playerId: "player-b",
        cards: [card("hearts-A")]
      }
    };

    expect(
      validatePlay(state, "player-a", ["spades-4", "clubs-4", "spades-5", "clubs-5", "spades-6", "clubs-6"]).ok
    ).toBe(false);
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
  it("starts with the player holding the 3 of spades", () => {
    const state = startedGame();

    expect(state.currentTurn).toBe(playerHoldingCard(state, "spades-3"));
  });

  it("advances to the next deterministic player after a play", () => {
    const state = startedGame();
    const actorId = state.currentTurn ?? "";
    const card = state.hands[actorId]?.find((nextCard) => nextCard.id === "spades-3");

    expect(card).toBeDefined();

    const result = reduceGameAction(state, {
      type: "play-cards",
      actorId,
      cardIds: card === undefined ? [] : [card.id]
    });
    const actorIndex = state.turnOrder.indexOf(actorId);
    const expectedNextTurn = state.turnOrder[(actorIndex + 1) % state.turnOrder.length];

    expect(result.state.currentTurn).toBe(expectedNextTurn);
  });
});

describe("skip/reset logic", () => {
  it("returns turn to the last player who played when everyone else skips", () => {
    const started = startedGame();
    const initialState: GameState = {
      ...started,
      currentTurn: "player-a",
      hands: {
        ...started.hands,
        "player-a": [card("spades-3"), ...(started.hands["player-a"] ?? [])]
      }
    };
    const firstCard = initialState.hands["player-a"]?.find((nextCard) => nextCard.id === "spades-3");

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
    const state = playingStateWithHands({
      "player-a": [card("spades-3")],
      "player-b": [card("clubs-4")],
      "player-c": [card("diamonds-5")]
    });
    const actorId = "player-a";
    const handIds = (state.hands[actorId] ?? []).map((nextCard) => nextCard.id);

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
