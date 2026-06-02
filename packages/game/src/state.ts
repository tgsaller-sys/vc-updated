import type { GameState, Player, PlayerId } from "./types";

export function createInitialGameState(id: string): GameState {
  return {
    id,
    phase: "lobby",
    players: [],
    hands: {},
    deck: [],
    discardPile: [],
    currentTurn: null,
    currentLeadingPlay: null,
    skippedPlayers: [],
    winnerId: null,
    finishedPlayerIds: [],
    lastEvent: null,
    turnOrder: [],
    version: 0
  };
}

export function upsertPlayer(players: readonly Player[], nextPlayer: Player): readonly Player[] {
  const existingIndex = players.findIndex((player) => player.id === nextPlayer.id);

  if (existingIndex === -1) {
    return [...players, nextPlayer];
  }

  return players.map((player) => (player.id === nextPlayer.id ? { ...player, ...nextPlayer } : player));
}

export function setPlayerConnection(
  players: readonly Player[],
  playerId: PlayerId,
  connected: boolean
): readonly Player[] {
  return players.map((player) => (player.id === playerId ? { ...player, connected } : player));
}

export function removePlayer(players: readonly Player[], playerId: PlayerId): readonly Player[] {
  return players.filter((player) => player.id !== playerId);
}
