import { create } from "zustand";
import type { CardId, PlayerId } from "@vc/game";

interface UiState {
  readonly localPlayerId: PlayerId;
  readonly playerName: string;
  readonly maxCardsPerPlayer: number;
  readonly selectedCardIds: readonly CardId[];
  readonly lobbyCode: string;
  readonly error: string | null;
  readonly setPlayerName: (playerName: string) => void;
  readonly setMaxCardsPerPlayer: (maxCardsPerPlayer: number) => void;
  readonly setLobbyCode: (lobbyCode: string) => void;
  readonly toggleCard: (cardId: CardId) => void;
  readonly clearSelection: () => void;
  readonly setError: (error: string | null) => void;
}

function createLocalPlayerId(): PlayerId {
  const existing = window.localStorage.getItem("vc.localPlayerId") ?? window.sessionStorage.getItem("vc.localPlayerId");

  if (existing !== null) {
    window.localStorage.setItem("vc.localPlayerId", existing);
    return existing;
  }

  const next = window.crypto.randomUUID();
  window.localStorage.setItem("vc.localPlayerId", next);
  return next;
}

function createInitialPlayerName(): string {
  return window.localStorage.getItem("vc.playerName") ?? "";
}

function createInitialMaxCardsPerPlayer(): number {
  const storedValue = Number(window.localStorage.getItem("vc.maxCardsPerPlayer"));
  return Number.isInteger(storedValue) && storedValue >= 1 && storedValue <= 52 ? storedValue : 52;
}

function normalizeMaxCardsPerPlayer(maxCardsPerPlayer: number): number {
  if (!Number.isFinite(maxCardsPerPlayer)) {
    return 52;
  }

  return Math.min(52, Math.max(1, Math.floor(maxCardsPerPlayer)));
}

export const useUiStore = create<UiState>((set) => ({
  localPlayerId: createLocalPlayerId(),
  playerName: createInitialPlayerName(),
  maxCardsPerPlayer: createInitialMaxCardsPerPlayer(),
  selectedCardIds: [],
  lobbyCode: "",
  error: null,
  setPlayerName: (playerName) => {
    window.localStorage.setItem("vc.playerName", playerName);
    set({ playerName });
  },
  setMaxCardsPerPlayer: (maxCardsPerPlayer) => {
    const nextMaxCardsPerPlayer = normalizeMaxCardsPerPlayer(maxCardsPerPlayer);
    window.localStorage.setItem("vc.maxCardsPerPlayer", String(nextMaxCardsPerPlayer));
    set({ maxCardsPerPlayer: nextMaxCardsPerPlayer });
  },
  setLobbyCode: (lobbyCode) => set({ lobbyCode: lobbyCode.toUpperCase() }),
  toggleCard: (cardId) =>
    set((state) => ({
      selectedCardIds: state.selectedCardIds.includes(cardId)
        ? state.selectedCardIds.filter((id) => id !== cardId)
        : [...state.selectedCardIds, cardId]
    })),
  clearSelection: () => set({ selectedCardIds: [] }),
  setError: (error) => set({ error })
}));
