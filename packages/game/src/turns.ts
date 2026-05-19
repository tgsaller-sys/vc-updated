import type { PlayerId } from "./types";

export function nextPlayerId(turnOrder: readonly PlayerId[], currentPlayerId: PlayerId): PlayerId {
  const currentIndex = turnOrder.indexOf(currentPlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % turnOrder.length;
  const next = turnOrder[nextIndex];

  if (next === undefined) {
    throw new Error("Cannot advance turn without players.");
  }

  return next;
}

export function nextEligiblePlayerId(
  turnOrder: readonly PlayerId[],
  currentPlayerId: PlayerId,
  skippedPlayers: readonly PlayerId[]
): PlayerId {
  if (turnOrder.length === 0) {
    throw new Error("Cannot advance turn without players.");
  }

  let next = nextPlayerId(turnOrder, currentPlayerId);

  for (const playerId of turnOrder) {
    void playerId;

    if (!skippedPlayers.includes(next)) {
      return next;
    }

    next = nextPlayerId(turnOrder, next);
  }

  return currentPlayerId;
}

export function allOtherPlayersSkipped(
  turnOrder: readonly PlayerId[],
  lastPlayerToPlay: PlayerId,
  skippedPlayers: readonly PlayerId[]
): boolean {
  return turnOrder
    .filter((playerId) => playerId !== lastPlayerToPlay)
    .every((playerId) => skippedPlayers.includes(playerId));
}
