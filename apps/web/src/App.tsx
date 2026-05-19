import { AnimatePresence, motion } from "framer-motion";
import { Play, RotateCcw, Send, SkipForward, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardView } from "@vc/ui";
import {
  isBombPlay,
  reduceGameAction,
  sortCardsForPlay,
  type GameAction,
  type GameState,
  type Player
} from "@vc/game";
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

function applyAction(state: GameState, action: GameAction): GameState {
  const result = reduceGameAction(state, action);

  if (!result.validation.ok) {
    throw new Error(result.validation.reason);
  }

  return result.state;
}

interface OpponentHandProps {
  readonly cardCount: number;
  readonly isSkipped: boolean;
  readonly isTurn: boolean;
  readonly player: Player;
}

function OpponentHand({ cardCount, isSkipped, isTurn, player }: OpponentHandProps) {
  const visibleCards = Array.from({ length: Math.min(cardCount, 12) }, (_value, index) => index);

  return (
    <motion.article layout className={`opponent-hand ${isTurn ? "is-turn" : ""} ${isSkipped ? "is-skipped" : ""}`}>
      <div className="opponent-meta">
        <span>{player.name}</span>
        <strong>{cardCount}</strong>
      </div>
      <div className="opponent-card-row" aria-label={`${player.name} has ${cardCount} cards`}>
        <AnimatePresence initial={false}>
          {visibleCards.map((index) => (
            <motion.div
              layout
              key={`${player.id}-${index}`}
              className="opponent-card-back"
              initial={{ opacity: 0, x: -12, rotate: -8 }}
              animate={{ opacity: 1, x: 0, rotate: (index - visibleCards.length / 2) * 2.5 }}
              exit={{ opacity: 0, y: -12, scale: 0.82 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            />
          ))}
        </AnimatePresence>
      </div>
      {isSkipped ? <span className="opponent-state">Skipped</span> : null}
    </motion.article>
  );
}

export function App() {
  const localPlayerId = useUiStore((state) => state.localPlayerId);
  const playerName = useUiStore((state) => state.playerName);
  const setPlayerName = useUiStore((state) => state.setPlayerName);
  const maxCardsPerPlayer = useUiStore((state) => state.maxCardsPerPlayer);
  const setMaxCardsPerPlayer = useUiStore((state) => state.setMaxCardsPerPlayer);
  const lobbyCode = useUiStore((state) => state.lobbyCode);
  const setLobbyCode = useUiStore((state) => state.setLobbyCode);
  const selectedCardIds = useUiStore((state) => state.selectedCardIds);
  const toggleCard = useUiStore((state) => state.toggleCard);
  const clearSelection = useUiStore((state) => state.clearSelection);
  const error = useUiStore((state) => state.error);
  const setError = useUiStore((state) => state.setError);
  const [authStatus, setAuthStatus] = useState<"checking" | "anonymous" | "local">("checking");
  const [syncMode, setSyncMode] = useState<"local" | "remote">("local");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [passNotice, setPassNotice] = useState<string | null>(null);
  const lastPassNoticeKey = useRef<string | null>(null);
  const preferredPlayerName = playerName.trim() || `Player ${localPlayerId.slice(0, 4)}`;
  const [game, setGame] = useState(() => createDemoGame(localPlayerId, preferredPlayerName, createLobbyCode()));
  const localPlayer = game.players.find((player) => player.id === localPlayerId) ?? game.players[0];
  const activePlayerId = localPlayer?.id ?? "";
  const activeHand = game.hands[activePlayerId] ?? [];
  const sortedActiveHand = useMemo(() => sortCardsForPlay(activeHand), [activeHand]);
  const opponents = useMemo(
    () => game.players.filter((player) => player.id !== localPlayerId),
    [game.players, localPlayerId]
  );
  const isActiveTurn = game.currentTurn === activePlayerId;
  const isRemoteLobby = syncMode === "remote";
  const currentTurnName =
    game.currentTurn === null
      ? "Waiting"
      : (game.players.find((player) => player.id === game.currentTurn)?.name ?? "Unknown player");
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
  const connectionLabel =
    !supabaseConfig.hasUrl || !supabaseConfig.hasAnonKey
      ? "Setup needed"
      : authStatus === "checking"
        ? "Connecting"
        : syncMode === "remote"
          ? "Online"
          : "Local";
  const turnLabel =
    game.phase === "lobby"
      ? "Waiting to start"
      : game.phase === "finished"
        ? "Game finished"
        : isActiveTurn
          ? "Your turn"
          : `${currentTurnName}'s turn`;
  const selectedCards = useMemo(
    () => sortedActiveHand.filter((card) => selectedCardIds.includes(card.id)),
    [selectedCardIds, sortedActiveHand]
  );
  const showBombCallout =
    game.currentLeadingPlay !== null && isBombPlay(game.currentLeadingPlay.cards) && game.currentLeadingPlay.cards.length > 1;
  const visibleDiscardPlay = game.currentLeadingPlay ?? game.discardPile.at(-1) ?? null;
  const winnerName =
    game.winnerId === null
      ? null
      : (game.players.find((player) => player.id === game.winnerId)?.name ?? game.winnerId);

  useEffect(() => {
    if (game.lastEvent?.type !== "skip") {
      return undefined;
    }

    const noticeKey = `${game.id}-${game.version}-${game.lastEvent.playerId}`;

    if (lastPassNoticeKey.current === noticeKey) {
      return undefined;
    }

    lastPassNoticeKey.current = noticeKey;
    const passingPlayerName =
      game.players.find((player) => player.id === game.lastEvent?.playerId)?.name ?? "A player";
    setPassNotice(`${passingPlayerName} passes.`);

    const timeoutId = window.setTimeout(() => {
      setPassNotice(null);
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [game.id, game.lastEvent, game.players, game.version]);

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
      try {
        await signInAnonymously();

        if (cancelled) {
          return;
        }

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
    void dispatch({ type: "start", actorId: activePlayerId, seed: Date.now(), maxCardsPerPlayer });
  }

  function savePlayerName() {
    void dispatch({ type: "join", player: createPlayer(localPlayerId, preferredPlayerName) });
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
    setGame(createDemoGame(localPlayerId, preferredPlayerName, createLobbyCode()));
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
        setGame(createDemoGame(localPlayerId, preferredPlayerName, nextCode));
        setActionStatus(null);
        return;
      }

      const nextGame = createLobbyGame(localPlayerId, preferredPlayerName, window.crypto.randomUUID());
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
        setGame(createDemoGame(localPlayerId, preferredPlayerName, nextCode));
        setActionStatus(null);
        return;
      }

      const remoteGame = await getRemoteGameByLobbyCode(nextCode);
      const joinedGame = await dispatchValidatedRemoteAction(remoteGame, {
        type: "join",
        player: createPlayer(localPlayerId, preferredPlayerName)
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
            <span>{connectionLabel}</span>
            <span>{isRemoteLobby ? `Lobby ${lobbyCode}` : "Demo table"}</span>
            <span>
              {game.players.length} player{game.players.length === 1 ? "" : "s"}
            </span>
            <span>{turnLabel}</span>
            <span>{game.phase}</span>
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
            <input
              className="player-name-input"
              value={playerName}
              maxLength={24}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Your name"
              aria-label="Your name"
            />
            <button type="button" onClick={savePlayerName}>
              Save Name
            </button>
            <button type="button" onClick={() => void createLobby()}>
              Create Lobby
            </button>
            <input
              className="lobby-code-input"
              value={lobbyCode}
              maxLength={8}
              onChange={(event) => setLobbyCode(event.target.value)}
              placeholder="CODE"
              aria-label="Lobby code"
            />
            <button type="button" onClick={() => void joinLobby()}>
              Join
            </button>
            <label className="max-cards-control">
              <span>Max cards</span>
              <input
                type="number"
                min={1}
                max={52}
                step={1}
                value={maxCardsPerPlayer}
                onChange={(event) => setMaxCardsPerPlayer(event.currentTarget.valueAsNumber)}
                aria-label="Maximum cards per player"
              />
            </label>
          </section>
        ) : null}

        <section className="center-table" aria-label="Table">
          <AnimatePresence mode="popLayout">
            {winnerName !== null ? (
              <motion.div
                key="winner"
                className="winner-callout"
                initial={{ opacity: 0, scale: 0.72, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 360, damping: 24 }}
              >
                {winnerName} wins!
              </motion.div>
            ) : showBombCallout ? (
              <motion.div
                key="bomb"
                className="bomb-callout"
                initial={{ opacity: 0, scale: 0.76, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                BOMB!
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {passNotice !== null ? (
              <motion.div
                key={passNotice}
                className="pass-callout"
                initial={{ opacity: 0, y: 12, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              >
                {passNotice}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="table-focus">
            <div className="opponents-panel" aria-label="Other players">
              <AnimatePresence initial={false}>
                {opponents.map((player) => (
                  <OpponentHand
                    key={player.id}
                    player={player}
                    cardCount={game.hands[player.id]?.length ?? 0}
                    isTurn={game.currentTurn === player.id}
                    isSkipped={game.skippedPlayers.includes(player.id)}
                  />
                ))}
              </AnimatePresence>
            </div>

            <div className="discard-zone" aria-label="Discard pile">
              <AnimatePresence mode="popLayout">
                {visibleDiscardPlay === null ? (
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
                  visibleDiscardPlay.cards.map((card) => (
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
            {syncMode === "local" ? (
              <button type="button" onClick={resetDemo} aria-label="Reset demo">
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            ) : null}
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
