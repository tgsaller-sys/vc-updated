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
    joinedAt: now
  };
}

export function createLobbyGame(localPlayerId: string, lobbyCode: string): GameState {
  const game = createInitialGameState(lobbyCode);
  return assertValidTransition(
    reduceGameAction(game, { type: "join", player: createPlayer(localPlayerId, "You") })
  );
}

export function createDemoGame(localPlayerId: string, lobbyCode: string): GameState {
  const localPlayer = createPlayer(localPlayerId, "You");
  const guestPlayer = createPlayer("local-guest", "Local Guest");

  const game = createInitialGameState(lobbyCode);
  return [localPlayer, guestPlayer].reduce(
    (state, player) => assertValidTransition(reduceGameAction(state, { type: "join", player })),
    game
  );
}

export function dispatchLocalAction(state: GameState, action: GameAction): GameState {
  return assertValidTransition(reduceGameAction(state, action));
}
