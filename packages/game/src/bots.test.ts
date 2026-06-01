import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
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
  it("advances consecutive bot turns in a two-human and two-bot game through normal reducer actions", () => {
    const afterHuman = assertValidTransition(
      reduceGameAction(fourSeatGame(), {
        type: "play-cards",
        actorId: "human-a",
        cardIds: ["spades-3"]
      })
    );

    const afterBots = runBotTurns(afterHuman);

    expect(afterBots.currentTurn).toBe("human-b");
    expect(afterBots.discardPile.map((play) => play.playerId)).toEqual(["human-a", "bot-a", "bot-b"]);
    expect(afterBots.discardPile.map((play) => play.cards.map((nextCard) => nextCard.id))).toEqual([
      ["spades-3"],
      ["clubs-4"],
      ["diamonds-5"]
    ]);
    expect(afterBots.hands["bot-a"]?.map((nextCard) => nextCard.id)).toEqual(["clubs-8"]);
    expect(afterBots.hands["bot-b"]?.map((nextCard) => nextCard.id)).toEqual(["diamonds-8"]);
    expect(afterBots.version).toBe(afterHuman.version + 2);
  });

  it("gives bot decisions only their own hand and public table play", () => {
    const state = fourSeatGame();
    const view = createBotTurnView({ ...state, currentTurn: "bot-a" }, "bot-a");

    expect(view.hand).toEqual(state.hands["bot-a"]);
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
});
