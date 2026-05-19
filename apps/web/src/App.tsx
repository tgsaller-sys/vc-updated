import { AnimatePresence, motion } from "framer-motion";
import { Play, RotateCcw, Send, SkipForward, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CardView } from "@vc/ui";
import { isBombPlay, reduceGameAction, sortCardsForPlay, type GameAction, type GameState } from "@vc/game";
import { createDemoGame, createLobbyGame, createPlayer } from "./lib/localGame";
import { createLobbyCode } from "./lib/lobbyCode";
import {
  createRemoteGame,
  dispatchValidatedRemoteAction,
  getRemoteGameByLobbyCode,
  signInAnonymously,
  subscribeToGame
} from "./supabase/gameRepository";
import { supabaseConfig } from "./supabase/client";
import { useUiStore } from "./store/uiStore";
import { buildHead } from "./buildInfo";

const buildLabel = "discard-sort-ui";

function applyAction(state: GameState, action: GameAction): GameState {
  const result = reduceGameAction(state, action);

  if (!result.validation.ok) {
    throw new Error(result.validation.reason);
  }

  return result.state;
}

export function App() {
  const localPlayerId = useUiStore((state) => state.localPlayerId);
  const lobbyCode = useUiStore((state) => state.lobbyCode);
  const setLobbyCode = useUiStore((state) => state.setLobbyCode);
  const selectedCardIds = useUiStore((state) => state.selectedCardIds);
  const toggleCard = useUiStore((state) => state.toggleCard);
  const clearSelection = useUiStore((state) => state.clearSelection);
  const error = useUiStore((state) => state.error);
  const setError = useUiStore((state) => state.setError);
  const [authStatus, setAuthStatus] = useState<"checking" | "anonymous" | "local">("checking");
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<"local" | "remote">("local");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [game, setGame] = useState(() => createDemoGame(localPlayerId, createLobbyCode()));
  const localPlayer = game.players.find((player) => player.id === localPlayerId) ?? game.players[0];
  const activePlayerId = localPlayer?.id ?? "";
  const activeHand = game.hands[activePlayerId] ?? [];
  const sortedActiveHand = useMemo(() => sortCardsForPlay(activeHand), [activeHand]);
  const isActiveTurn = game.currentTurn === activePlayerId;
  const isRemoteLobby = syncMode === "remote";
  const lobbyStatus =
    !supabaseConfig.hasUrl || !supabaseConfig.hasAnonKey
      ? "Supabase env vars missing in this deployment"
      : authStatus === "local"
        ? "Supabase sign-in failed; using local demo mode"
        : isRemoteLobby && game.phase === "lobby"
          ? `In lobby ${lobbyCode} with ${game.players.length} player${game.players.length === 1 ? "" : "s"}`
          : syncMode === "local"
            ? "Local demo"
            : `Connected to lobby ${lobbyCode}`;
  const hasSupabaseConfig = supabaseConfig.hasUrl && supabaseConfig.hasAnonKey;
  const selectedCards = useMemo(
    () => sortedActiveHand.filter((card) => selectedCardIds.includes(card.id)),
    [selectedCardIds, sortedActiveHand]
  );
  const showBombCallout =
    game.currentLeadingPlay !== null && isBombPlay(game.currentLeadingPlay.cards) && game.currentLeadingPlay.cards.length > 1;

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
      try {
        const userId = await signInAnonymously();

        if (cancelled) {
          return;
        }

        setAuthUserId(userId);
        setAuthStatus("anonymous");
        setError(null);
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setAuthStatus("local");
        setError(caught instanceof Error ? caught.message : "Anonymous sign-in failed.");
      }
    }

    void authenticate();

    return () => {
      cancelled = true;
    };
  }, [setError]);

  useEffect(() => {
    if (syncMode !== "remote") {
      return undefined;
    }

    return subscribeToGame(game.id, (nextState) => {
      setGame(nextState);
      setError(null);
    });
  }, [game.id, setError, syncMode]);

  async function dispatch(action: GameAction) {
    try {
      setActionStatus("Sending action...");
      if (syncMode === "remote") {
        const nextState = await dispatchValidatedRemoteAction(game, action);
        setGame(nextState);
      } else {
        setGame((state) => applyAction(state, action));
      }

      clearSelection();
      setActionStatus(null);
      setError(null);
    } catch (caught) {
      setActionStatus(null);
      setError(caught instanceof Error ? caught.message : "Action failed.");
    }
  }

  function startGame() {
    void dispatch({ type: "start", actorId: activePlayerId, seed: Date.now() });
  }

  function playSelectedCards() {
    void dispatch({ type: "play-cards", actorId: activePlayerId, cardIds: selectedCards.map((card) => card.id) });
  }

  function skipTurn() {
    void dispatch({ type: "skip", actorId: activePlayerId });
  }

  function resetDemo() {
    clearSelection();
    setError(null);
    setSyncMode("local");
    setGame(createDemoGame(localPlayerId, createLobbyCode()));
  }

  async function createLobby() {
    const nextCode = createLobbyCode();

    try {
      clearSelection();
      setError(null);
      setActionStatus("Creating lobby...");
      setLobbyCode(nextCode);

      if (authStatus !== "anonymous") {
        setSyncMode("local");
        setGame(createDemoGame(localPlayerId, nextCode));
        setActionStatus(null);
        return;
      }

      const nextGame = createLobbyGame(localPlayerId, window.crypto.randomUUID());
      const remoteGame = await createRemoteGame(nextCode, nextGame);
      setSyncMode("remote");
      setGame(remoteGame);
      setActionStatus(null);
    } catch (caught) {
      setActionStatus(null);
      setError(caught instanceof Error ? caught.message : "Could not create lobby.");
    }
  }

  async function joinLobby() {
    const nextCode = lobbyCode.trim();

    if (nextCode.length === 0) {
      setError("Enter a lobby code first.");
      return;
    }

    try {
      clearSelection();
      setError(null);
      setActionStatus("Joining lobby...");
      setLobbyCode(nextCode);

      if (authStatus !== "anonymous") {
        setSyncMode("local");
        setGame(createDemoGame(localPlayerId, nextCode));
        setActionStatus(null);
        return;
      }

      const remoteGame = await getRemoteGameByLobbyCode(nextCode);
      const joinedGame = await dispatchValidatedRemoteAction(remoteGame, {
        type: "join",
        player: createPlayer(localPlayerId, `Player ${localPlayerId.slice(0, 4)}`)
      });
      setSyncMode("remote");
      setGame(joinedGame);
      setActionStatus(null);
    } catch (caught) {
      setActionStatus(null);
      setError(caught instanceof Error ? caught.message : "Could not join lobby.");
    }
  }

  return (
    <main className="app-shell">
      <section className="tabletop" aria-label="VC game table">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Lobby {game.id}</p>
            <p className="build-head">HEAD {buildHead}</p>
            <h1>VC</h1>
            <p className="lobby-status">{lobbyStatus}</p>
          </div>
          <div className="status-cluster" aria-label="Game status">
            <span>{hasSupabaseConfig ? "Supabase env OK" : "Supabase env missing"}</span>
            <span>{buildLabel}</span>
            <span>{authStatus === "anonymous" ? "Anonymous" : authStatus === "checking" ? "Signing in" : "Local"}</span>
            <span>{syncMode}</span>
            <span>You {localPlayerId.slice(0, 4)}</span>
            {authUserId !== null ? <span>Auth {authUserId.slice(0, 4)}</span> : null}
            <span>{game.phase}</span>
            <span>Turn {game.currentTurn ?? "waiting"}</span>
          </div>
        </header>

        <section className="players-strip" aria-label="Players">
          {game.players.map((player) => (
            <motion.article
              layout
              key={player.id}
              className={`player-pill ${game.currentTurn === player.id ? "is-turn" : ""}`}
            >
              <Users size={16} aria-hidden="true" />
              <span>{player.id === localPlayerId ? `${player.name} (you)` : player.name}</span>
              <strong>{game.hands[player.id]?.length ?? 0}</strong>
            </motion.article>
          ))}
        </section>

        {actionStatus !== null ? <p className="notice-text">{actionStatus}</p> : null}

        {game.phase === "lobby" ? (
          <section className="lobby-controls" aria-label="Lobby controls">
            <button type="button" onClick={() => void createLobby()}>
              Create Lobby
            </button>
            <input
              value={lobbyCode}
              maxLength={8}
              onChange={(event) => setLobbyCode(event.target.value)}
              placeholder="CODE"
              aria-label="Lobby code"
            />
            <button type="button" onClick={() => void joinLobby()}>
              Join
            </button>
          </section>
        ) : null}

        <section className="center-table" aria-label="Discard pile">
          <AnimatePresence>
            {showBombCallout ? (
              <motion.div
                className="bomb-callout"
                initial={{ opacity: 0, scale: 0.76, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                BOMB!
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="discard-zone">
            <AnimatePresence mode="popLayout">
              {game.currentLeadingPlay === null ? (
                <motion.div
                  layout
                  key="empty-discard"
                  className="discard-placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  Discard pile
                </motion.div>
              ) : (
                game.currentLeadingPlay.cards.map((card) => (
                  <motion.div
                    layout
                    key={card.id}
                    initial={{ opacity: 0, y: 60, rotate: -8 }}
                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                  >
                    <CardView card={card} disabled />
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </section>

        <section className="hand-panel" aria-label="Your hand">
          <div className="hand-actions">
            {game.phase === "lobby" ? (
              <button type="button" onClick={startGame}>
                <Play size={18} aria-hidden="true" />
                Start
              </button>
            ) : (
              <>
                <button type="button" disabled={!isActiveTurn || selectedCards.length === 0} onClick={playSelectedCards}>
                  <Send size={18} aria-hidden="true" />
                  Play {selectedCards.length}
                </button>
                <button type="button" disabled={!isActiveTurn || game.currentLeadingPlay === null} onClick={skipTurn}>
                  <SkipForward size={18} aria-hidden="true" />
                  Skip
                </button>
              </>
            )}
            <button type="button" onClick={resetDemo} aria-label="Reset demo">
              <RotateCcw size={18} aria-hidden="true" />
            </button>
          </div>

          <motion.div layout className="hand">
            {sortedActiveHand.map((card) => (
              <CardView
                key={card.id}
                card={card}
                selected={selectedCardIds.includes(card.id)}
                disabled={game.phase !== "playing" || !isActiveTurn}
                onClick={(nextCard) => toggleCard(nextCard.id)}
              />
            ))}
          </motion.div>
          {error !== null ? <p className="error-text">{error}</p> : null}
          {game.winnerId !== null ? <p className="winner-text">Winner: {game.winnerId}</p> : null}
        </section>
      </section>
    </main>
  );
}
