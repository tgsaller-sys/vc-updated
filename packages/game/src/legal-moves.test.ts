import { describe, expect, it } from "vitest";
import { createDeck, createInitialGameState, getLegalMoves, getLegalMovesForPlayer, identifyCardMove } from ".";
import type { Card, CardId, CardMove, GameState, Move } from ".";

function card(id: CardId): Card {
  const found = createDeck().find((nextCard) => nextCard.id === id);

  if (found === undefined) {
    throw new Error(`Missing test card ${id}`);
  }

  return found;
}

function move(cards: readonly Card[]): CardMove {
  const identified = identifyCardMove(cards);

  if (identified === null) {
    throw new Error("Expected test cards to form a legal move.");
  }

  return identified;
}

function playIds(moves: readonly Move[]): readonly (readonly CardId[])[] {
  return moves
    .filter((nextMove): nextMove is CardMove => nextMove.type !== "pass")
    .map((nextMove) => nextMove.cards.map((nextCard) => nextCard.id));
}

describe("getLegalMoves", () => {
  it("returns higher singles in rank and suit order, followed by pass", () => {
    const moves = getLegalMoves({
      hand: [card("spades-5"), card("clubs-5"), card("hearts-5"), card("spades-2")],
      currentTablePlay: move([card("spades-5")]),
      isLeading: false
    });

    expect(playIds(moves)).toEqual([["clubs-5"], ["hearts-5"], ["spades-2"]]);
    expect(moves.at(-1)).toEqual({
      type: "pass",
      cards: [],
      primaryRank: null,
      highCard: null,
      length: 0
    });
  });

  it("returns only pairs that beat the table pair by rank or highest suit", () => {
    const moves = getLegalMoves({
      hand: [
        card("spades-5"),
        card("clubs-5"),
        card("hearts-5"),
        card("spades-6"),
        card("clubs-6"),
        card("diamonds-6")
      ],
      currentTablePlay: move([card("clubs-5"), card("diamonds-5")]),
      isLeading: false
    });

    expect(playIds(moves)).toEqual([
      ["spades-5", "hearts-5"],
      ["clubs-5", "hearts-5"],
      ["spades-6", "clubs-6"],
      ["spades-6", "diamonds-6"],
      ["clubs-6", "diamonds-6"]
    ]);
  });

  it("returns only triples that beat the table triple", () => {
    const moves = getLegalMoves({
      hand: [
        card("spades-7"),
        card("clubs-7"),
        card("diamonds-7"),
        card("spades-8"),
        card("clubs-8"),
        card("hearts-8")
      ],
      currentTablePlay: move([card("spades-7"), card("clubs-7"), card("hearts-7")]),
      isLeading: false
    });

    expect(playIds(moves)).toEqual([["spades-8", "clubs-8", "hearts-8"]]);
  });

  it("returns same-length straights that beat the table straight and never includes a 2", () => {
    const moves = getLegalMoves({
      hand: [
        card("spades-4"),
        card("clubs-5"),
        card("diamonds-6"),
        card("hearts-Q"),
        card("spades-K"),
        card("clubs-A"),
        card("diamonds-2")
      ],
      currentTablePlay: move([card("spades-3"), card("clubs-4"), card("diamonds-5")]),
      isLeading: false
    });

    expect(playIds(moves)).toEqual([
      ["spades-4", "clubs-5", "diamonds-6"],
      ["hearts-Q", "spades-K", "clubs-A"]
    ]);
    expect(playIds(moves).flat()).not.toContain("diamonds-2");
  });

  it("marks single-suit straights as locked", () => {
    expect(move([card("hearts-3"), card("hearts-4"), card("hearts-5")]).metadata?.straightSuitLock).toBe(true);
    expect(move([card("spades-3"), card("clubs-4"), card("diamonds-5")]).metadata?.straightSuitLock).toBeUndefined();
  });

  it("requires a single-suit straight to beat a locked straight", () => {
    const moves = getLegalMoves({
      hand: [card("spades-4"), card("clubs-4"), card("clubs-5"), card("diamonds-6"), card("clubs-6")],
      currentTablePlay: move([card("hearts-3"), card("hearts-4"), card("hearts-5")]),
      isLeading: false
    });

    expect(playIds(moves)).toEqual([["clubs-4", "clubs-5", "clubs-6"]]);
  });

  it("allows mixed-suit straights to beat an unlocked straight", () => {
    const moves = getLegalMoves({
      hand: [card("spades-4"), card("clubs-4"), card("clubs-5"), card("diamonds-6"), card("clubs-6")],
      currentTablePlay: move([card("spades-3"), card("clubs-4"), card("diamonds-5")]),
      isLeading: false
    });

    expect(playIds(moves)).toContainEqual(["clubs-4", "clubs-5", "clubs-6"]);
    expect(playIds(moves)).toContainEqual(["spades-4", "clubs-5", "diamonds-6"]);
  });

  it("returns quad and double-straight bombs or chops against a single 2", () => {
    const moves = getLegalMoves({
      hand: [
        card("spades-4"),
        card("clubs-4"),
        card("spades-5"),
        card("clubs-5"),
        card("spades-6"),
        card("clubs-6"),
        card("spades-8"),
        card("clubs-8"),
        card("diamonds-8"),
        card("hearts-8")
      ],
      currentTablePlay: move([card("hearts-2")]),
      isLeading: false
    });

    expect(playIds(moves)).toEqual([
      ["spades-8", "clubs-8", "diamonds-8", "hearts-8"],
      ["spades-4", "clubs-4", "spades-5", "clubs-5", "spades-6", "clubs-6"]
    ]);
    expect(moves.at(-1)?.type).toBe("pass");
  });

  it("includes pass only when the player is following and passing is enabled", () => {
    expect(
      getLegalMoves({
        hand: [card("clubs-4")],
        currentTablePlay: move([card("spades-5")]),
        isLeading: false
      })
    ).toEqual([
      {
        type: "pass",
        cards: [],
        primaryRank: null,
        highCard: null,
        length: 0
      }
    ]);

    expect(
      getLegalMoves({
        hand: [card("clubs-4")],
        currentTablePlay: move([card("spades-5")]),
        isLeading: false,
        options: { allowPass: false }
      })
    ).toEqual([]);
  });

  it("returns all valid leading plays while excluding double-straight bombs and pass", () => {
    const moves = getLegalMoves({
      hand: [
        card("spades-4"),
        card("clubs-4"),
        card("spades-5"),
        card("clubs-5"),
        card("spades-6"),
        card("clubs-6"),
        card("hearts-2")
      ],
      currentTablePlay: null,
      isLeading: true
    });

    expect(playIds(moves)).toContainEqual(["hearts-2"]);
    expect(playIds(moves)).toContainEqual(["spades-4", "spades-5", "spades-6"]);
    expect(playIds(moves)).not.toContainEqual([
      "spades-4",
      "clubs-4",
      "spades-5",
      "clubs-5",
      "spades-6",
      "clubs-6"
    ]);
    expect(moves.some((nextMove) => nextMove.type === "pass")).toBe(false);
  });

  it("limits an opening lead to plays that contain the required lowest card", () => {
    const moves = getLegalMoves({
      hand: [card("spades-3"), card("clubs-4"), card("diamonds-5"), card("hearts-6")],
      currentTablePlay: null,
      isLeading: true,
      options: { requiredOpeningCard: card("spades-3") }
    });

    expect(playIds(moves)).toEqual([
      ["spades-3"],
      ["spades-3", "clubs-4", "diamonds-5"],
      ["spades-3", "clubs-4", "diamonds-5", "hearts-6"]
    ]);
  });

  it("does not mutate its input and returns the same ordered moves each time", () => {
    const hand = [card("hearts-6"), card("spades-4"), card("clubs-5")];
    const currentTablePlay = move([card("spades-3"), card("clubs-4"), card("diamonds-5")]);
    const before = JSON.stringify({ hand, currentTablePlay });

    const first = getLegalMoves({ hand, currentTablePlay, isLeading: false });
    const second = getLegalMoves({ hand, currentTablePlay, isLeading: false });

    expect(first).toEqual(second);
    expect(JSON.stringify({ hand, currentTablePlay })).toBe(before);
  });
});

describe("getLegalMovesForPlayer", () => {
  it("returns only pass when the active player cannot beat the table", () => {
    const state: GameState = {
      ...createInitialGameState("no-legal-play"),
      phase: "playing",
      hands: {
        "player-a": [card("clubs-4")],
        "player-b": [card("hearts-5")]
      },
      currentTurn: "player-a",
      currentLeadingPlay: {
        playerId: "player-b",
        ...move([card("hearts-5")])
      },
      turnOrder: ["player-a", "player-b"]
    };

    expect(getLegalMovesForPlayer(state, "player-a")).toEqual([
      {
        type: "pass",
        cards: [],
        primaryRank: null,
        highCard: null,
        length: 0
      }
    ]);
  });

  it("applies the required opening card and ignores players who cannot act", () => {
    const state: GameState = {
      ...createInitialGameState("opening-legal-play"),
      phase: "playing",
      hands: {
        "player-a": [card("spades-3"), card("clubs-4")],
        "player-b": [card("diamonds-5")]
      },
      currentTurn: "player-a",
      turnOrder: ["player-a", "player-b"]
    };

    expect(playIds(getLegalMovesForPlayer(state, "player-a"))).toEqual([["spades-3"]]);
    expect(getLegalMovesForPlayer(state, "player-b")).toEqual([]);
    expect(getLegalMovesForPlayer({ ...state, skippedPlayers: ["player-a"] }, "player-a")).toEqual([]);
  });
});
