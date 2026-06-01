import {
  assertValidTransition,
  createInitialGameState,
  reduceGameAction,
  type GameAction,
  type GameState,
  type Player
} from "@vc/game";

export function createPlayer(playerId: string, name: string): Player {
  const now = new Date().toISOString();

  return {
    id: playerId,
    name,
    connected: true,
    joinedAt: now,
    kind: "human"
  };
}

export function createBotPlayer(playerId: string, name: string): Player {
  return {
    ...createPlayer(playerId, name),
    kind: "bot"
  };
}

export function createLobbyGame(localPlayerId: string, playerName: string, gameId: string): GameState {
  const game = createInitialGameState(gameId);
  return assertValidTransition(
    reduceGameAction(game, { type: "join", player: createPlayer(localPlayerId, playerName) })
  );
}

export function createDemoGame(localPlayerId: string, playerName: string, lobbyCode: string): GameState {
  const localPlayer = createPlayer(localPlayerId, playerName);
  const guestPlayer = createBotPlayer("local-bot", "Local Bot");

  const game = createInitialGameState(lobbyCode);
  return [localPlayer, guestPlayer].reduce(
    (state, player) => assertValidTransition(reduceGameAction(state, { type: "join", player })),
    game
  );
}

export function dispatchLocalAction(state: GameState, action: GameAction): GameState {
  return assertValidTransition(reduceGameAction(state, action));
}
