import { create } from "zustand";
import { botTurnDelayMs as defaultBotTurnDelayMs } from "@vc/game";
import type { CardId, PlayerId } from "@vc/game";

const defaultMaxCardsPerPlayer = 13;
const minMaxCardsPerPlayer = 1;
const maxMaxCardsPerPlayer = 52;
const minBotTurnDelayMs = 0;
const maxBotTurnDelayMs = 30000;

interface UiState {
  readonly localPlayerId: PlayerId;
  readonly playerName: string;
  readonly maxCardsPerPlayer: number;
  readonly botTurnDelayMs: number;
  readonly gameSeed: string;
  readonly selectedCardIds: readonly CardId[];
  readonly lobbyCode: string;
  readonly error: string | null;
  readonly setPlayerName: (playerName: string) => void;
  readonly setMaxCardsPerPlayer: (maxCardsPerPlayer: number) => void;
  readonly setBotTurnDelaySeconds: (botTurnDelaySeconds: number) => void;
  readonly setGameSeed: (gameSeed: string) => void;
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
  return Number.isInteger(storedValue) && storedValue >= minMaxCardsPerPlayer && storedValue <= maxMaxCardsPerPlayer
    ? storedValue
    : defaultMaxCardsPerPlayer;
}

function createInitialBotTurnDelayMs(): number {
  const storedValue = Number(window.localStorage.getItem("vc.botTurnDelayMs"));
  return Number.isInteger(storedValue) && storedValue >= minBotTurnDelayMs && storedValue <= maxBotTurnDelayMs
    ? storedValue
    : defaultBotTurnDelayMs;
}

function normalizeMaxCardsPerPlayer(maxCardsPerPlayer: number): number {
  if (!Number.isFinite(maxCardsPerPlayer)) {
    return defaultMaxCardsPerPlayer;
  }

  return Math.min(maxMaxCardsPerPlayer, Math.max(minMaxCardsPerPlayer, Math.floor(maxCardsPerPlayer)));
}

function normalizeBotTurnDelaySeconds(botTurnDelaySeconds: number): number {
  if (!Number.isFinite(botTurnDelaySeconds)) {
    return defaultBotTurnDelayMs;
  }

  const botTurnDelayMs = Math.round(botTurnDelaySeconds * 1000);
  return Math.min(maxBotTurnDelayMs, Math.max(minBotTurnDelayMs, botTurnDelayMs));
}

export const useUiStore = create<UiState>((set) => ({
  localPlayerId: createLocalPlayerId(),
  playerName: createInitialPlayerName(),
  maxCardsPerPlayer: createInitialMaxCardsPerPlayer(),
  botTurnDelayMs: createInitialBotTurnDelayMs(),
  gameSeed: "",
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
  setBotTurnDelaySeconds: (botTurnDelaySeconds) => {
    const nextBotTurnDelayMs = normalizeBotTurnDelaySeconds(botTurnDelaySeconds);
    window.localStorage.setItem("vc.botTurnDelayMs", String(nextBotTurnDelayMs));
    set({ botTurnDelayMs: nextBotTurnDelayMs });
  },
  setGameSeed: (gameSeed) => set({ gameSeed }),
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
