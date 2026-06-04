import { AnimatePresence, motion } from "framer-motion";
import { Play, RotateCcw, Send, SkipForward, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardView } from "@vc/ui";
import {
  getLegalMovesForPlayer,
  isBombPlay,
  maxPlayers,
  nextBotAction,
  reduceGameAction,
  sortCardsForPlay,
  type GameAction,
  type GameState,
  type Player,
  type BotStrategy
} from "@vc/game";
import { createBotPlayer, createDemoGame, createLobbyGame, createPlayer } from "./lib/localGame";
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

const maxSeed = 4294967295;
type LobbySeatType = "human" | BotStrategy;

function ordinalLabel(index: number): string {
  const labels = ["First", "Second", "Third", "Fourth"];
  return labels[index] ?? `${index + 1}th`;
}

function botSeatName(strategy: BotStrategy, botNumber: number): string {
  const label = strategy === "easy" ? "Easy" : strategy === "medium" ? "Medium" : "Hard";
  return `${label} Bot ${botNumber}`;
}

function applyAction(state: GameState, action: GameAction): GameState {
  const result = reduceGameAction(state, action);

  if (!result.validation.ok) {
    throw new Error(result.validation.reason);
  }

  return result.state;
}

function pickSkipLabel(): string {
  const roll = Math.random();

  if (roll < 0.7) {
    return "Pass";
  }

  if (roll < 0.8) {
    return "Pass-o";
  }

  if (roll < 0.9) {
    return "Skip";
  }

  return "Knucle-rap";
}

function createRandomSeed(): number {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);
  return values[0] ?? 0;
}

function parseSeed(seedText: string): number | null {
  const trimmedSeed = seedText.trim();

  if (trimmedSeed.length === 0) {
    return null;
  }

  const seed = Number(trimmedSeed);

  if (!Number.isInteger(seed) || seed < 0 || seed > maxSeed) {
    throw new Error(`Seed must be a whole number from 0 to ${maxSeed}.`);
  }

  return seed;
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
  const botTurnDelayMs = useUiStore((state) => state.botTurnDelayMs);
  const setBotTurnDelaySeconds = useUiStore((state) => state.setBotTurnDelaySeconds);
  const gameSeed = useUiStore((state) => state.gameSeed);
  const setGameSeed = useUiStore((state) => state.setGameSeed);
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
  const [skipLabel, setSkipLabel] = useState(() => pickSkipLabel());
  const lastPassNoticeKey = useRef<string | null>(null);
  const preferredPlayerName = playerName.trim() || `Player ${localPlayerId.slice(0, 4)}`;
  const [game, setGame] = useState(() => createDemoGame(localPlayerId, preferredPlayerName, createLobbyCode()));
  const localPlayer = game.players.find((player) => player.id === localPlayerId) ?? game.players[0];
  const activePlayerId = localPlayer?.id ?? "";
  const activeHand = game.hands[activePlayerId] ?? [];
  const botTurnDelaySeconds = botTurnDelayMs / 1000;
  const sortedActiveHand = useMemo(() => sortCardsForPlay(activeHand), [activeHand]);
  const opponents = useMemo(
    () => game.players.filter((player) => player.id !== localPlayerId),
    [game.players, localPlayerId]
  );
  const isActiveTurn = game.currentTurn === activePlayerId;
  const isBotTurn = game.players.find((player) => player.id === game.currentTurn)?.kind === "bot";
  const canUseHumanControls = isActiveTurn && !isBotTurn;
  const isRemoteLobby = syncMode === "remote";
  const lobbySeats = useMemo(
    () => Array.from({ length: maxPlayers }, (_value, index) => game.players[index]),
    [game.players]
  );
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
  const hasLegalCardPlay = useMemo(
    () =>
      !canUseHumanControls ||
      getLegalMovesForPlayer(game, activePlayerId).some((move) => move.type !== "pass"),
    [activePlayerId, canUseHumanControls, game]
  );
  const showBombCallout =
    game.currentLeadingPlay !== null && isBombPlay(game.currentLeadingPlay.cards) && game.currentLeadingPlay.cards.length > 1;
  const visibleDiscardPlay = game.currentLeadingPlay ?? game.discardPile.at(-1) ?? null;
  const winnerName =
    game.winnerId === null
      ? null
      : (game.players.find((player) => player.id === game.winnerId)?.name ?? game.winnerId);
  const placementRows = useMemo(() => {
    const finishedPlayerIds = game.finishedPlayerIds ?? [];
    const remainingPlayerIds =
      game.phase === "finished"
        ? game.turnOrder.filter((playerId) => !finishedPlayerIds.includes(playerId))
        : [];
    const rankedPlayerIds = [...finishedPlayerIds, ...remainingPlayerIds];

    return rankedPlayerIds.map((playerId, index) => ({
      label: `${ordinalLabel(index)} ${game.phase === "finished" ? "place" : "out"}`,
      name: game.players.find((player) => player.id === playerId)?.name ?? playerId,
      playerId
    }));
  }, [game.finishedPlayerIds, game.phase, game.players, game.turnOrder]);
  const turnCalloutText =
    game.phase === "playing" && game.currentTurn !== null
      ? isActiveTurn
        ? "Your turn!"
        : `${currentTurnName}'s turn`
      : null;

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
  }, [game.id, game.lastEvent, game.players, game.version]);

  useEffect(() => {
    if (passNotice === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPassNotice(null);
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [passNotice]);

  useEffect(() => {
    setSkipLabel(pickSkipLabel());
  }, [game.currentTurn, game.currentLeadingPlay]);

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

  useEffect(() => {
    if (syncMode !== "local") {
      return undefined;
    }

    const botAction = nextBotAction(game);

    if (botAction === null) {
      return undefined;
    }

    const botName = game.players.find((player) => player.id === game.currentTurn)?.name ?? "Bot";
    setActionStatus(`${botName} is thinking...`);
    const timeoutId = window.setTimeout(() => {
      void dispatch(botAction);
    }, botTurnDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [botTurnDelayMs, game, syncMode]);

  async function dispatch(action: GameAction) {
    try {
      setActionStatus("Sending action...");
      if (syncMode === "remote") {
        const nextState = await dispatchValidatedRemoteAction(game, action, { botTurnDelayMs });
        setGame(nextState);
      } else {
        setGame(applyAction(game, action));
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
    try {
      void dispatch({
        type: "start",
        actorId: activePlayerId,
        seed: parseSeed(gameSeed) ?? createRandomSeed(),
        maxCardsPerPlayer
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid seed.");
    }
  }

  function savePlayerName() {
    void dispatch({ type: "join", player: createPlayer(localPlayerId, preferredPlayerName) });
  }

  function addBot(botStrategy: BotStrategy) {
    const botNumber = game.players.filter((player) => player.kind === "bot").length + 1;
    void dispatch({
      type: "join",
      player: createBotPlayer(`bot-${window.crypto.randomUUID()}`, botSeatName(botStrategy, botNumber), botStrategy)
    });
  }

  function fallbackBotName(botStrategy: BotStrategy, player: Player): string {
    const botNumber = game.players.filter((nextPlayer) => nextPlayer.kind === "bot").indexOf(player) + 1;
    return botSeatName(botStrategy, botNumber);
  }

  function updateLobbySeat(player: Player | undefined, seatType: LobbySeatType) {
    if (player?.kind !== "bot") {
      if (player === undefined && seatType !== "human") {
        addBot(seatType);
      }

      return;
    }

    if (seatType === "human") {
      void dispatch({ type: "remove-player", playerId: player.id });
      return;
    }

    const nextBotName = player.name.trim() || fallbackBotName(seatType, player);
    void dispatch({
      type: "join",
      player: createBotPlayer(player.id, nextBotName, seatType)
    });
  }

  function renameBot(player: Player, nextName: string) {
    if (player.kind !== "bot") {
      return;
    }

    const botStrategy = player.botStrategy ?? "easy";
    const nextBotName = nextName.trim() || fallbackBotName(botStrategy, player);
    void dispatch({
      type: "join",
      player: createBotPlayer(player.id, nextBotName, botStrategy)
    });
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
      const existingPlayer = remoteGame.players.find((player) => player.id === localPlayerId);

      if (remoteGame.phase !== "lobby" && existingPlayer === undefined) {
        throw new Error("This game has already started. Rejoin from the same browser that created your seat.");
      }

      const joinedGame = await dispatchValidatedRemoteAction(
        remoteGame,
        existingPlayer === undefined
          ? {
              type: "join",
              player: createPlayer(localPlayerId, preferredPlayerName)
            }
          : {
              type: "set-connection",
              playerId: localPlayerId,
              connected: true
            }
      );
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
              <span>
                {player.id === localPlayerId ? `${player.name} (you)` : `${player.name}${player.kind === "bot" ? " (bot)" : ""}`}
              </span>
              <strong>{game.hands[player.id]?.length ?? 0}</strong>
            </motion.article>
          ))}
        </section>

        {actionStatus !== null ? <p className="notice-text">{actionStatus}</p> : null}

        {game.phase === "lobby" ? (
          <section className="lobby-controls" aria-label="Lobby controls">
            <div className="lobby-control-row">
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
            </div>
            <div className="lobby-control-row">
              <button type="button" onClick={() => void createLobby()}>
                Create Lobby
              </button>
              <input
                className="lobby-code-input"
                value={lobbyCode}
                maxLength={8}
                onChange={(event) => setLobbyCode(event.target.value)}
                placeholder="Lobby code"
                aria-label="Lobby code"
              />
              <button type="button" onClick={() => void joinLobby()}>
                Join
              </button>
            </div>
            <div className="lobby-control-row">
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
            </div>
            <div className="lobby-control-row">
              <label className="seed-control">
                <span>Seed</span>
                <input
                  type="number"
                  min={0}
                  max={maxSeed}
                  step={1}
                  value={gameSeed}
                  onChange={(event) => setGameSeed(event.currentTarget.value)}
                  placeholder="Random"
                  aria-label="Random seed"
                />
              </label>
            </div>
            <div className="lobby-control-row">
              <label className="bot-delay-control">
                <span>Bot delay</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={botTurnDelaySeconds}
                  onChange={(event) => setBotTurnDelaySeconds(event.currentTarget.valueAsNumber)}
                  aria-label="Bot delay in seconds"
                />
                <span>s</span>
              </label>
            </div>
          </section>
        ) : null}

        {game.phase === "lobby" ? (
          <section className="lobby-seats" aria-label="Lobby seats">
            {lobbySeats.map((player, index) => {
              const seatType = player?.kind === "bot" ? (player.botStrategy ?? "easy") : "human";
              const isJoinedHuman = player !== undefined && player.kind !== "bot";

              return (
                <label className="lobby-seat" key={player?.id ?? `open-seat-${index}`}>
                  <span>
                    Seat {index + 1}
                    <strong>{player?.name ?? "Open human seat"}</strong>
                  </span>
                  {player?.kind === "bot" ? (
                    <input
                      className="bot-name-input"
                      defaultValue={player.name}
                      maxLength={24}
                      onBlur={(event) => renameBot(player, event.currentTarget.value)}
                      aria-label={`Seat ${index + 1} bot name`}
                    />
                  ) : null}
                  <select
                    value={seatType}
                    disabled={isJoinedHuman}
                    onChange={(event) => updateLobbySeat(player, event.currentTarget.value as LobbySeatType)}
                    aria-label={`Seat ${index + 1} player type`}
                  >
                    <option value="human">Human</option>
                    <option value="easy">Easy Bot</option>
                    <option value="medium">Medium Bot</option>
                    <option value="hard">Hard Bot</option>
                  </select>
                </label>
              );
            })}
          </section>
        ) : null}

        <section className="center-table" aria-label="Table">
          <AnimatePresence mode="popLayout">
            {winnerName !== null && game.phase === "finished" ? (
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
            ) : turnCalloutText !== null ? (
              <motion.div
                key={`turn-${game.currentTurn ?? "waiting"}`}
                className="turn-callout"
                initial={{ opacity: 0, scale: 0.76, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                {turnCalloutText}
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
                <button type="button" disabled={!canUseHumanControls || selectedCards.length === 0} onClick={playSelectedCards}>
                  <Send size={18} aria-hidden="true" />
                  Play {selectedCards.length}
                </button>
                <button type="button" disabled={!canUseHumanControls || game.currentLeadingPlay === null} onClick={skipTurn}>
                  <SkipForward size={18} aria-hidden="true" />
                  {skipLabel}
                </button>
              </>
            )}
            {syncMode === "local" ? (
              <button type="button" onClick={resetDemo} aria-label="Reset demo">
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {canUseHumanControls && !hasLegalCardPlay ? (
            <p className="no-legal-play-text">
              No legal play available.{game.currentLeadingPlay === null ? "" : " Pass to continue."}
            </p>
          ) : null}

          <motion.div layout className="hand">
            {sortedActiveHand.map((card) => (
              <CardView
                key={card.id}
                card={card}
                selected={selectedCardIds.includes(card.id)}
                disabled={game.phase !== "playing" || !canUseHumanControls}
                onClick={(nextCard) => toggleCard(nextCard.id)}
              />
            ))}
          </motion.div>
          {error !== null ? <p className="error-text">{error}</p> : null}
          {placementRows.length > 0 ? (
            <ol className="placement-list" aria-label="Player placement order">
              {placementRows.map((row) => (
                <li key={row.playerId}>
                  <span>{row.label}</span>
                  <strong>{row.name}</strong>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      </section>
    </main>
  );
}
