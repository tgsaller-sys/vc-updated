import { describe, expect, it } from "vitest";
import { assertValidTransition, createInitialGameState, nextBotAction, reduceGameAction } from ".";
import type { BotStrategy, GameAction, GameState, Player, PlayerId } from ".";

const simulationCount = 1000;
const superHardSimulationCount = 100;
const maximumActionsPerGame = 1000;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createBotPlayers(strategies: readonly BotStrategy[] = ["easy", "medium", "easy", "medium"]): readonly Player[] {
  return Array.from({ length: 4 }, (_value, index) => {
    const botNumber = index + 1;
    const botStrategy = strategies[index] ?? "medium";

    return {
      id: `bot-${botNumber}`,
      name: `${
        botStrategy === "easy"
          ? "Easy"
          : botStrategy === "medium"
            ? "Medium"
            : botStrategy === "hard"
              ? "Hard"
              : "Super Hard"
      } Bot ${botNumber}`,
      connected: true,
      joinedAt: `2026-01-01T00:0${index}:00.000Z`,
      kind: "bot",
      botStrategy
    };
  });
}

function summarizeAction(action: GameAction): string {
  switch (action.type) {
    case "play-cards":
      return `${action.actorId} plays ${action.cardIds.join(",")}`;
    case "skip":
      return `${action.actorId} skips`;
    case "join":
      return `${action.player.id} joins`;
    case "remove-player":
      return `${action.playerId} leaves`;
    case "set-connection":
      return `${action.playerId} connection=${action.connected}`;
    case "start":
      return `${action.actorId} starts seed=${action.seed}`;
    case "restart":
      return `${action.actorId} restarts seed=${action.seed}`;
  }
}

function summarizeState(state: GameState): string {
  const handCounts = state.turnOrder.map((playerId) => `${playerId}:${state.hands[playerId]?.length ?? 0}`).join(" ");
  const finishedPlayers = (state.finishedPlayerIds ?? []).join(",");
  const tablePlay =
    state.currentLeadingPlay === null
      ? "open"
      : `${state.currentLeadingPlay.playerId}:${state.currentLeadingPlay.type}:${state.currentLeadingPlay.cards
          .map((card) => card.id)
          .join(",")}`;

  return `phase=${state.phase} turn=${state.currentTurn ?? "none"} hands=[${handCounts}] finished=[${finishedPlayers}] table=${tablePlay}`;
}

function simulationFailure(seed: number, message: string, state: GameState, transcript: readonly string[]): Error {
  return new Error(
    [`Simulation seed ${seed} failed: ${message}`, summarizeState(state), "Transcript:", ...transcript].join("\n")
  );
}

function finishOrder(state: GameState): readonly PlayerId[] {
  const finishedPlayers = state.finishedPlayerIds ?? [];
  return [...finishedPlayers, ...state.turnOrder.filter((playerId) => !finishedPlayers.includes(playerId))];
}

function simulateGame(seed: number, players = createBotPlayers()): GameState {
  const random = createSeededRandom(seed ^ 0x9e3779b9);
  const lobby = players.reduce(
    (state, player) => assertValidTransition(reduceGameAction(state, { type: "join", player })),
    createInitialGameState(`bot-simulation-${seed}`)
  );
  let state = assertValidTransition(
    reduceGameAction(lobby, { type: "start", actorId: players[0]?.id ?? "bot-1", seed })
  );
  const transcript: string[] = [`START ${summarizeState(state)}`];

  for (let actionNumber = 1; actionNumber <= maximumActionsPerGame; actionNumber += 1) {
    if (state.phase === "finished") {
      return state;
    }

    const action = nextBotAction(state, { random });

    if (action === null) {
      throw simulationFailure(seed, "No bot action was available before the game finished.", state, transcript);
    }

    const transition = reduceGameAction(state, action);
    transcript.push(`${actionNumber}. ${summarizeAction(action)} => ${summarizeState(transition.state)}`);

    if (!transition.validation.ok) {
      throw simulationFailure(
        seed,
        `Illegal action: ${transition.validation.reason}`,
        state,
        transcript
      );
    }

    state = transition.state;
  }

  throw simulationFailure(seed, `Exceeded ${maximumActionsPerGame} actions.`, state, transcript);
}

describe("four-bot game simulations", () => {
  it(`completes ${simulationCount} full games without illegal moves or infinite loops`, () => {
    for (let seed = 0; seed < simulationCount; seed += 1) {
      const finalState = simulateGame(seed);
      const order = finishOrder(finalState);

      expect(finalState.phase, `seed ${seed}`).toBe("finished");
      expect(finalState.currentTurn, `seed ${seed}`).toBeNull();
      expect(finalState.winnerId, `seed ${seed}`).toBe(order[0]);
      expect(order, `seed ${seed}`).toHaveLength(4);
      expect(new Set(order).size, `seed ${seed}`).toBe(4);
      expect(order.every((playerId) => finalState.turnOrder.includes(playerId)), `seed ${seed}`).toBe(true);
      expect((finalState.finishedPlayerIds ?? []).every((playerId) => finalState.hands[playerId]?.length === 0), `seed ${seed}`).toBe(true);
    }
  });

  it(`compares HardBot against MediumBot over ${simulationCount} full games`, () => {
    const wins = new Map<PlayerId, number>();
    const players = createBotPlayers(["hard", "medium", "medium", "medium"]);

    for (let seed = 0; seed < simulationCount; seed += 1) {
      const finalState = simulateGame(seed + 10000, players);
      const winnerId = finalState.winnerId;

      if (winnerId === null) {
        throw new Error(`Simulation seed ${seed + 10000} finished without a winner.`);
      }

      wins.set(winnerId, (wins.get(winnerId) ?? 0) + 1);
      expect(finishOrder(finalState), `seed ${seed + 10000}`).toHaveLength(4);
    }

    const hardWins = wins.get("bot-1") ?? 0;
    const mediumWins = simulationCount - hardWins;
    console.info(
      `HardBot comparison: hard=${hardWins}/${simulationCount} (${(hardWins / simulationCount).toFixed(
        3
      )}), medium=${mediumWins}/${simulationCount}`
    );

    expect(hardWins).toBeGreaterThan(0);
  }, 120000);

  it(`compares SuperHardBot against MediumBot over ${superHardSimulationCount} full games`, () => {
    const wins = new Map<PlayerId, number>();
    const players = createBotPlayers(["super-hard", "medium", "medium", "medium"]);

    for (let seed = 0; seed < superHardSimulationCount; seed += 1) {
      const finalState = simulateGame(seed + 20000, players);
      const winnerId = finalState.winnerId;

      if (winnerId === null) {
        throw new Error(`Simulation seed ${seed + 20000} finished without a winner.`);
      }

      wins.set(winnerId, (wins.get(winnerId) ?? 0) + 1);
      expect(finishOrder(finalState), `seed ${seed + 20000}`).toHaveLength(4);
    }

    const superHardWins = wins.get("bot-1") ?? 0;
    const mediumWins = superHardSimulationCount - superHardWins;
    console.info(
      `SuperHardBot vs MediumBot: superHard=${superHardWins}/${superHardSimulationCount} (${(
        superHardWins / superHardSimulationCount
      ).toFixed(3)}), medium=${mediumWins}/${superHardSimulationCount}`
    );

    expect(superHardWins).toBeGreaterThan(0);
  }, 120000);

  it(`compares SuperHardBot against HardBot over ${superHardSimulationCount} full games`, () => {
    const wins = new Map<PlayerId, number>();
    const players = createBotPlayers(["super-hard", "hard", "hard", "hard"]);

    for (let seed = 0; seed < superHardSimulationCount; seed += 1) {
      const finalState = simulateGame(seed + 30000, players);
      const winnerId = finalState.winnerId;

      if (winnerId === null) {
        throw new Error(`Simulation seed ${seed + 30000} finished without a winner.`);
      }

      wins.set(winnerId, (wins.get(winnerId) ?? 0) + 1);
      expect(finishOrder(finalState), `seed ${seed + 30000}`).toHaveLength(4);
    }

    const superHardWins = wins.get("bot-1") ?? 0;
    const hardWins = superHardSimulationCount - superHardWins;
    console.info(
      `SuperHardBot vs HardBot: superHard=${superHardWins}/${superHardSimulationCount} (${(
        superHardWins / superHardSimulationCount
      ).toFixed(3)}), hard=${hardWins}/${superHardSimulationCount}`
    );

    expect(superHardWins).toBeGreaterThan(0);
  }, 120000);
});
