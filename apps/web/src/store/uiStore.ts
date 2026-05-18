import { create } from "zustand";
import type { CardId, PlayerId } from "@vc/game";

interface UiState {
  readonly localPlayerId: PlayerId;
  readonly selectedCardIds: readonly CardId[];
  readonly lobbyCode: string;
  readonly error: string | null;
  readonly setLobbyCode: (lobbyCode: string) => void;
  readonly toggleCard: (cardId: CardId) => void;
  readonly clearSelection: () => void;
  readonly setError: (error: string | null) => void;
}

function createLocalPlayerId(): PlayerId {
  const existing = window.sessionStorage.getItem("vc.localPlayerId");

  if (existing !== null) {
    return existing;
  }

  const next = window.crypto.randomUUID();
  window.sessionStorage.setItem("vc.localPlayerId", next);
  return next;
}

export const useUiStore = create<UiState>((set) => ({
  localPlayerId: createLocalPlayerId(),
  selectedCardIds: [],
  lobbyCode: "",
  error: null,
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
