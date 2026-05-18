import {
  assertValidTransition,
  createInitialGameState,
  reduceGameAction,
  type GameAction,
  type GameState,
  type Player
} from "@vc/game";

export function createDemoGame(localPlayerId: string, lobbyCode: string): GameState {
  const now = new Date().toISOString();
  const localPlayer: Player = {
    id: localPlayerId,
    name: "You",
    connected: true,
    joinedAt: now
  };
  const guestPlayer: Player = {
    id: "local-guest",
    name: "Local Guest",
    connected: true,
    joinedAt: now
  };

  const game = createInitialGameState(lobbyCode);
  return [localPlayer, guestPlayer].reduce(
    (state, player) => assertValidTransition(reduceGameAction(state, { type: "join", player })),
    game
  );
}

export function dispatchLocalAction(state: GameState, action: GameAction): GameState {
  return assertValidTransition(reduceGameAction(state, action));
}
