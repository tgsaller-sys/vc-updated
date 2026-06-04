import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  botTurnDelayMs,
  chooseEasyBotAction,
  chooseHardBotAction,
  chooseMediumBotAction,
  createBotTurnView,
  createDeck,
  createInitialGameState,
  nextBotAction,
  reduceGameAction,
  runBotTurns
} from ".";
import type { Card, CardId, GameState, Player } from ".";

const players: readonly Player[] = [
  { id: "human-a", name: "Ada", connected: true, joinedAt: "2026-01-01T00:00:00.000Z", kind: "human" },
  { id: "bot-a", name: "Bot A", connected: true, joinedAt: "2026-01-01T00:01:00.000Z", kind: "bot" },
  { id: "bot-b", name: "Bot B", connected: true, joinedAt: "2026-01-01T00:02:00.000Z", kind: "bot" },
  { id: "human-b", name: "Ben", connected: true, joinedAt: "2026-01-01T00:03:00.000Z", kind: "human" }
];

function card(id: CardId): Card {
  const found = createDeck().find((nextCard) => nextCard.id === id);

  if (found === undefined) {
    throw new Error(`Missing test card ${id}`);
  }

  return found;
}

function fourSeatGame(): GameState {
  return {
    ...createInitialGameState("bots-test"),
    phase: "playing",
    players,
    hands: {
      "human-a": [card("spades-3"), card("clubs-9")],
      "bot-a": [card("clubs-4"), card("clubs-8")],
      "bot-b": [card("diamonds-5"), card("diamonds-8")],
      "human-b": [card("hearts-6"), card("hearts-8")]
    },
    currentTurn: "human-a",
    turnOrder: players.map((player) => player.id)
  };
}

describe("computer players", () => {
  it("waits two seconds before automated turns in browser dispatchers", () => {
    expect(botTurnDelayMs).toBe(2000);
  });

  it("returns a local two-seat demo turn from its bot seat to the human", () => {
    const localPlayers: readonly Player[] = [
      { id: "human-a", name: "Ada", connected: true, joinedAt: "2026-01-01T00:00:00.000Z", kind: "human" },
      { id: "local-bot", name: "Local Bot", connected: true, joinedAt: "2026-01-01T00:01:00.000Z", kind: "bot" }
    ];
    const state: GameState = {
      ...createInitialGameState("local-demo-test"),
      phase: "playing",
      players: localPlayers,
      hands: {
        "human-a": [card("clubs-9")],
        "local-bot": [card("spades-3"), card("clubs-4")]
      },
      currentTurn: "local-bot",
      turnOrder: localPlayers.map((player) => player.id)
    };

    const afterBot = runBotTurns(state, { random: () => 0.99 });

    expect(afterBot.currentTurn).toBe("human-a");
    expect(afterBot.discardPile.at(0)?.playerId).toBe("local-bot");
    expect(afterBot.discardPile.at(0)?.cards.some((nextCard) => nextCard.id === "spades-3")).toBe(true);
  });

  it("automatically plays the opening turn when a bot is dealt the 3 of spades", () => {
    const lobby = players.reduce(
      (state, player) => assertValidTransition(reduceGameAction(state, { type: "join", player })),
      createInitialGameState("bot-opening-test")
    );
    const started = Array.from({ length: 1000 }, (_value, seed) =>
      assertValidTransition(
        reduceGameAction(lobby, { type: "start", actorId: "human-a", seed, maxCardsPerPlayer: 13 })
      )
    ).find((state) => state.currentTurn?.startsWith("bot-") === true);

    expect(started).toBeDefined();

    if (started === undefined) {
      throw new Error("Expected to find a deal with a bot opening turn.");
    }

    const openingBotId = started.currentTurn;
    const afterBot = runBotTurns(started, { random: () => 0.99 });

    expect(openingBotId).not.toBeNull();
    expect(started.hands[openingBotId ?? ""]?.some((nextCard) => nextCard.id === "spades-3")).toBe(true);
    expect(afterBot.discardPile.at(0)?.playerId).toBe(openingBotId);
    expect(afterBot.discardPile.at(0)?.cards.some((nextCard) => nextCard.id === "spades-3")).toBe(true);
    expect(afterBot.currentTurn?.startsWith("human-")).toBe(true);
  });

  it("advances consecutive bot turns in a two-human and two-bot game through normal reducer actions", () => {
    const afterHuman = assertValidTransition(
      reduceGameAction(fourSeatGame(), {
        type: "play-cards",
        actorId: "human-a",
        cardIds: ["spades-3"]
      })
    );

    const afterBots = runBotTurns(afterHuman, { random: () => 0.99 });

    expect(afterBots.currentTurn).toBe("human-b");
    expect(afterBots.discardPile.map((play) => play.playerId)).toEqual(["human-a", "bot-a", "bot-b"]);
    expect(afterBots.discardPile.map((play) => play.cards.map((nextCard) => nextCard.id))).toEqual([
      ["spades-3"],
      ["clubs-8"],
      ["diamonds-8"]
    ]);
    expect(afterBots.hands["bot-a"]?.map((nextCard) => nextCard.id)).toEqual(["clubs-4"]);
    expect(afterBots.hands["bot-b"]?.map((nextCard) => nextCard.id)).toEqual(["diamonds-5"]);
    expect(afterBots.version).toBe(afterHuman.version + 2);
  });

  it("gives bot decisions only their own hand and public table play", () => {
    const state = fourSeatGame();
    const view = createBotTurnView({ ...state, currentTurn: "bot-a" }, "bot-a");

    expect(view.hand).toEqual(state.hands["bot-a"]);
    expect(view.opponentCardCounts).toEqual([2, 2, 2]);
    expect(view.playedCards).toEqual([]);
    expect(view.turnOrder).toEqual(["human-a", "bot-a", "bot-b", "human-b"]);
    expect(view).not.toHaveProperty("hands");
    expect(view).not.toHaveProperty("deck");
    expect(view).not.toHaveProperty("players");
  });

  it("uses the same legal move generator to pass when a bot cannot beat the table", () => {
    const afterLead = assertValidTransition(
      reduceGameAction(
        {
          ...fourSeatGame(),
          currentTurn: "human-a",
          hands: {
            ...fourSeatGame().hands,
            "human-a": [card("hearts-A"), card("clubs-9")],
            "bot-a": [card("clubs-4"), card("clubs-8")]
          },
          discardPile: [
            {
              playerId: "human-b",
              type: "single",
              cards: [card("spades-3")],
              primaryRank: "3",
              highCard: card("spades-3"),
              length: 1
            }
          ]
        },
        { type: "play-cards", actorId: "human-a", cardIds: ["hearts-A"] }
      )
    );

    const action = nextBotAction(afterLead);

    expect(action).toEqual({ type: "skip", actorId: "bot-a" });

    if (action === null) {
      throw new Error("Expected a bot action.");
    }

    const afterBot = assertValidTransition(reduceGameAction(afterLead, action));

    expect(afterBot.lastEvent).toEqual({ type: "skip", playerId: "bot-a" });
    expect(afterBot.skippedPlayers).toEqual(["bot-a"]);
    expect(afterBot.currentTurn).toBe("bot-b");
  });

  it("passes again if the existing wrapped-turn edge case routes play back to an already-passed bot", () => {
    const state: GameState = {
      ...fourSeatGame(),
      currentTurn: "bot-a",
      currentLeadingPlay: {
        playerId: "human-a",
        type: "single",
        cards: [card("spades-3")],
        primaryRank: "3",
        highCard: card("spades-3"),
        length: 1
      },
      skippedPlayers: ["bot-a"]
    };

    expect(nextBotAction(state)).toEqual({ type: "skip", actorId: "bot-a" });
  });

  it("chooses randomly among legal non-pass responses with injected randomness", () => {
    const action = chooseEasyBotAction(
      {
        actorId: "bot-a",
        hand: [card("clubs-4"), card("diamonds-5"), card("hearts-6")],
        currentTablePlay: {
          type: "single",
          cards: [card("spades-3")],
          primaryRank: "3",
          highCard: card("spades-3"),
          length: 1
        },
        isLeading: false,
        opponentCardCounts: [3]
      },
      { random: () => 0.99, passProbability: 0 }
    );

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["hearts-6"] });
  });

  it("sometimes passes while responding even when a legal play exists", () => {
    const action = chooseEasyBotAction(
      {
        actorId: "bot-a",
        hand: [card("clubs-4"), card("clubs-8")],
        currentTablePlay: {
          type: "single",
          cards: [card("spades-3")],
          primaryRank: "3",
          highCard: card("spades-3"),
          length: 1
        },
        isLeading: false,
        opponentCardCounts: [3]
      },
      { random: () => 0, passProbability: 0.25 }
    );

    expect(action).toEqual({ type: "skip", actorId: "bot-a" });
  });

  it("never passes when a legal move wins the game", () => {
    const action = chooseEasyBotAction(
      {
        actorId: "bot-a",
        hand: [card("clubs-4")],
        currentTablePlay: {
          type: "single",
          cards: [card("spades-3")],
          primaryRank: "3",
          highCard: card("spades-3"),
          length: 1
        },
        isLeading: false,
        opponentCardCounts: [3]
      },
      { random: () => 0, passProbability: 1 }
    );

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["clubs-4"] });
  });

  it("never passes while leading and still returns a legal play", () => {
    const action = chooseEasyBotAction(
      {
        actorId: "bot-a",
        hand: [card("clubs-4"), card("diamonds-5")],
        currentTablePlay: null,
        isLeading: true,
        opponentCardCounts: [3]
      },
      { random: () => 0, passProbability: 1 }
    );

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["clubs-4"] });
  });

  it("has MediumBot answer with the cheapest legal move that beats the table", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("clubs-4"), card("diamonds-5"), card("hearts-6")],
      currentTablePlay: {
        type: "single",
        cards: [card("spades-3")],
        primaryRank: "3",
        highCard: card("spades-3"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [3]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["clubs-4"] });
  });

  it("has MediumBot pass rather than spend a 2 when no opponent is close to going out", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("clubs-4"), card("diamonds-5"), card("hearts-6"), card("spades-2")],
      currentTablePlay: {
        type: "single",
        cards: [card("hearts-A")],
        primaryRank: "A",
        highCard: card("hearts-A"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [4, 5]
    });

    expect(action).toEqual({ type: "skip", actorId: "bot-a" });
  });

  it("has MediumBot spend a 2 when an opponent is close to going out", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("clubs-4"), card("spades-2")],
      currentTablePlay: {
        type: "single",
        cards: [card("hearts-A")],
        primaryRank: "A",
        highCard: card("hearts-A"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [3, 5]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["spades-2"] });
  });

  it("has MediumBot spend a 2 when it can go out soon", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("clubs-4"), card("spades-2")],
      currentTablePlay: {
        type: "single",
        cards: [card("hearts-A")],
        primaryRank: "A",
        highCard: card("hearts-A"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [4, 5]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["spades-2"] });
  });

  it("has MediumBot block a one-card opponent with its strongest legal response", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("clubs-4"), card("diamonds-5"), card("hearts-K")],
      currentTablePlay: {
        type: "single",
        cards: [card("spades-3")],
        primaryRank: "3",
        highCard: card("spades-3"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [1, 5]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["hearts-K"] });
  });

  it("has MediumBot preserve a double-straight chop when no opponent is close to going out", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [
        card("spades-4"),
        card("clubs-4"),
        card("spades-5"),
        card("clubs-5"),
        card("spades-6"),
        card("clubs-6"),
        card("diamonds-9")
      ],
      currentTablePlay: {
        type: "single",
        cards: [card("spades-2")],
        primaryRank: "2",
        highCard: card("spades-2"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [4]
    });

    expect(action).toEqual({ type: "skip", actorId: "bot-a" });
  });

  it("has MediumBot spend a double-straight chop to stop a one-card opponent", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [
        card("spades-4"),
        card("clubs-4"),
        card("spades-5"),
        card("clubs-5"),
        card("spades-6"),
        card("clubs-6"),
        card("diamonds-9")
      ],
      currentTablePlay: {
        type: "single",
        cards: [card("spades-2")],
        primaryRank: "2",
        highCard: card("spades-2"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [1, 5]
    });

    expect(action).toEqual({
      type: "play-cards",
      actorId: "bot-a",
      cardIds: ["spades-4", "clubs-4", "spades-5", "clubs-5", "spades-6", "clubs-6"]
    });
  });

  it("has MediumBot lead a low combination to reduce its hand size", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("spades-4"), card("clubs-4"), card("diamonds-5")],
      currentTablePlay: null,
      isLeading: true,
      opponentCardCounts: [3]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["spades-4", "clubs-4"] });
  });

  it("has MediumBot preserve 2s and bombs while leading when a low ordinary play is available", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("clubs-4"), card("spades-8"), card("clubs-8"), card("diamonds-8"), card("hearts-8"), card("spades-2")],
      currentTablePlay: null,
      isLeading: true,
      opponentCardCounts: [4]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["clubs-4"] });
  });

  it("has MediumBot take a winning move before conserving strong cards", () => {
    const action = chooseMediumBotAction({
      actorId: "bot-a",
      hand: [card("spades-2")],
      currentTablePlay: {
        type: "single",
        cards: [card("hearts-A")],
        primaryRank: "A",
        highCard: card("hearts-A"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [5]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["spades-2"] });
  });

  it("routes medium bot seats through the MediumBot strategy", () => {
    const state: GameState = {
      ...fourSeatGame(),
      players: players.map((player) => (player.id === "bot-a" ? { ...player, botStrategy: "medium" } : player)),
      currentTurn: "bot-a",
      currentLeadingPlay: {
        playerId: "human-a",
        type: "single",
        cards: [card("spades-3")],
        primaryRank: "3",
        highCard: card("spades-3"),
        length: 1
      }
    };

    expect(nextBotAction(state, { random: () => 0.99 })).toEqual({
      type: "play-cards",
      actorId: "bot-a",
      cardIds: ["clubs-4"]
    });
  });

  it("has HardBot preserve bombs early when ordinary plays are available", () => {
    const action = chooseHardBotAction({
      actorId: "bot-a",
      hand: [card("clubs-4"), card("spades-8"), card("clubs-8"), card("diamonds-8"), card("hearts-8")],
      currentTablePlay: null,
      isLeading: true,
      opponentCardCounts: [8, 8, 8],
      playedCards: [],
      turnOrder: ["bot-a", "bot-b", "bot-c", "bot-d"]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["clubs-4"] });
  });

  it("has HardBot use a bomb to stop a player with one card", () => {
    const action = chooseHardBotAction({
      actorId: "bot-a",
      hand: [
        card("spades-4"),
        card("clubs-4"),
        card("spades-5"),
        card("clubs-5"),
        card("spades-6"),
        card("clubs-6"),
        card("diamonds-9")
      ],
      currentTablePlay: {
        type: "single",
        cards: [card("spades-2")],
        primaryRank: "2",
        highCard: card("spades-2"),
        length: 1
      },
      isLeading: false,
      opponentCardCounts: [1, 7],
      playedCards: [card("hearts-3"), card("diamonds-3")],
      turnOrder: ["bot-a", "bot-b", "bot-c"]
    });

    expect(action).toEqual({
      type: "play-cards",
      actorId: "bot-a",
      cardIds: ["spades-4", "clubs-4", "spades-5", "clubs-5", "spades-6", "clubs-6"]
    });
  });

  it("has HardBot lead with a straight instead of a single when it improves the hand", () => {
    const action = chooseHardBotAction({
      actorId: "bot-a",
      hand: [card("spades-4"), card("clubs-5"), card("diamonds-6"), card("hearts-9")],
      currentTablePlay: null,
      isLeading: true,
      opponentCardCounts: [6, 6],
      playedCards: [],
      turnOrder: ["bot-a", "bot-b", "bot-c"]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["spades-4", "clubs-5", "diamonds-6"] });
  });

  it("has HardBot choose a move that leaves a shorter endgame line", () => {
    const action = chooseHardBotAction({
      actorId: "bot-a",
      hand: [card("spades-4"), card("clubs-4"), card("hearts-4"), card("diamonds-5"), card("hearts-5")],
      currentTablePlay: {
        type: "pair",
        cards: [card("spades-3"), card("clubs-3")],
        primaryRank: "3",
        highCard: card("clubs-3"),
        length: 2
      },
      isLeading: false,
      opponentCardCounts: [5, 5],
      playedCards: [],
      turnOrder: ["bot-a", "bot-b", "bot-c"]
    });

    expect(action).toEqual({ type: "play-cards", actorId: "bot-a", cardIds: ["diamonds-5", "hearts-5"] });
  });

  it("does not let HardBot read hidden opponent cards", () => {
    const baseState: GameState = {
      ...fourSeatGame(),
      players: players.map((player) => (player.id === "bot-a" ? { ...player, botStrategy: "hard" } : player)),
      currentTurn: "bot-a",
      currentLeadingPlay: {
        playerId: "human-a",
        type: "single",
        cards: [card("spades-3")],
        primaryRank: "3",
        highCard: card("spades-3"),
        length: 1
      },
      discardPile: [
        {
          playerId: "human-a",
          type: "single",
          cards: [card("spades-3")],
          primaryRank: "3",
          highCard: card("spades-3"),
          length: 1
        }
      ],
      hands: {
        ...fourSeatGame().hands,
        "bot-a": [card("clubs-4"), card("diamonds-5"), card("hearts-K")],
        "bot-b": [card("clubs-A"), card("diamonds-A")],
        "human-b": [card("clubs-7"), card("diamonds-7")]
      }
    };
    const changedHiddenCards: GameState = {
      ...baseState,
      hands: {
        ...baseState.hands,
        "bot-b": [card("clubs-2"), card("diamonds-2")],
        "human-b": [card("clubs-8"), card("diamonds-8")]
      }
    };

    expect(createBotTurnView(baseState, "bot-a")).toEqual(createBotTurnView(changedHiddenCards, "bot-a"));
    expect(nextBotAction(baseState)).toEqual(nextBotAction(changedHiddenCards));
  });
});
