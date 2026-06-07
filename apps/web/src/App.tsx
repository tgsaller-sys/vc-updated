import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, MessageSquare, Play, RotateCcw, Send, SkipForward, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { CardView } from "@vc/ui";
import {
  getLegalMovesForPlayer,
  isBombPlay,
  maxPlayers,
  nextBotAction,
  reduceGameAction,
  sortCardsForPlay,
  validatePlay,
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
import {
  listChatMessages,
  sendChatMessage,
  subscribeToChatMessages,
  type ChatMessage
} from "./supabase/chatRepository";
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

  return "Knuckle-rap";
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
  readonly seat: "top" | "left" | "right";
}

function OpponentHand({ cardCount, isSkipped, isTurn, player, seat }: OpponentHandProps) {
  const visibleCards = Array.from({ length: Math.min(cardCount, 12) }, (_value, index) => index);

  return (
    <motion.article
      layout
      className={`opponent-hand opponent-seat-${seat} ${isTurn ? "is-turn" : ""} ${isSkipped ? "is-skipped" : ""}`}
    >
      <div className="opponent-meta">
        <div>
          <span>{player.name}</span>
          <small>{cardCount} cards</small>
        </div>
        <strong>{player.kind === "bot" ? "BOT" : "HUMAN"}</strong>
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
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<readonly ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const lastPassNoticeKey = useRef<string | null>(null);
  const lastChatSentAt = useRef(0);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
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
  const lobbySeats = useMemo(
    () => Array.from({ length: maxPlayers }, (_value, index) => game.players[index]),
    [game.players]
  );
  const currentTurnName =
    game.currentTurn === null
      ? "Waiting"
      : (game.players.find((player) => player.id === game.currentTurn)?.name ?? "Unknown player");
  const tableStatusLabel =
    !supabaseConfig.hasUrl || !supabaseConfig.hasAnonKey
      ? "Setup needed"
      : authStatus === "checking"
        ? "Connecting"
        : syncMode === "remote"
          ? `Lobby ${lobbyCode}`
          : "Local demo";
  const turnLabel =
    game.phase === "lobby"
      ? "Waiting to start"
      : game.phase === "finished"
        ? "Game finished"
        : isActiveTurn
          ? "Your turn"
          : `${currentTurnName}'s turn`;
  const playerCountLabel = `${game.players.length} player${game.players.length === 1 ? "" : "s"}`;
  const headerStatus = `${tableStatusLabel} • ${playerCountLabel} • ${turnLabel}`;
  const selectedCards = useMemo(
    () => sortedActiveHand.filter((card) => selectedCardIds.includes(card.id)),
    [selectedCardIds, sortedActiveHand]
  );
  const canPlaySelectedCards =
    canUseHumanControls &&
    selectedCards.length > 0 &&
    validatePlay(
      game,
      activePlayerId,
      selectedCards.map((card) => card.id)
    ).ok;
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
    if (!isRulesOpen) {
      return undefined;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsRulesOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isRulesOpen]);

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
    chatMessagesEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [chatMessages.length]);

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
    if (syncMode !== "remote") {
      setChatMessages([]);
      setChatError(null);
      return undefined;
    }

    let cancelled = false;

    function addMessage(nextMessage: ChatMessage) {
      setChatMessages((currentMessages) => {
        if (currentMessages.some((message) => message.id === nextMessage.id)) {
          return currentMessages;
        }

        return [...currentMessages, nextMessage].sort(
          (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)
        );
      });
    }

    async function loadMessages() {
      try {
        const nextMessages = await listChatMessages(game.id);

        if (cancelled) {
          return;
        }

        setChatMessages(nextMessages);
        setChatError(null);
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setChatError(caught instanceof Error ? caught.message : "Could not load chat.");
      }
    }

    const unsubscribe = subscribeToChatMessages(game.id, addMessage);
    void loadMessages();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [game.id, syncMode]);

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

  function restartGame() {
    try {
      void dispatch({
        type: "restart",
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

  function handleChatDraftChange(nextDraft: string) {
    setChatDraft(nextDraft.slice(0, 200));
    setChatError(null);
  }

  async function sendCurrentChatMessage() {
    const nextMessage = chatDraft.trim();

    if (nextMessage.length === 0) {
      return;
    }

    if (nextMessage.length > 200) {
      setChatError("Messages must be 200 characters or less.");
      return;
    }

    const now = Date.now();

    if (now - lastChatSentAt.current < 1000) {
      setChatError("Please wait a moment before sending another message.");
      return;
    }

    try {
      lastChatSentAt.current = now;
      await sendChatMessage(game.id, activePlayerId, localPlayer?.name ?? preferredPlayerName, nextMessage);
      setChatDraft("");
      setChatError(null);
    } catch (caught) {
      lastChatSentAt.current = 0;
      setChatError(caught instanceof Error ? caught.message : "Could not send message.");
    }
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
          <div className="brand-block">
            <p className="eyebrow">Lobby {game.id}</p>
            <h1>VC</h1>
            <p className="game-subtitle">Vietnamese Cards</p>
          </div>
          <div className="status-cluster" aria-label="Game status">
            <button className="button-ghost rules-button" type="button" onClick={() => setIsRulesOpen(true)}>
              <BookOpen size={16} aria-hidden="true" />
              Rules
            </button>
            <p className="header-status">{headerStatus}</p>
          </div>
        </header>

        <section className="players-strip" aria-label="Players">
          {game.players.map((player) => (
            <motion.article
              layout
              key={player.id}
              className={`pill player-pill ${game.currentTurn === player.id ? "is-turn" : ""}`}
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
          <section className="lobby-layout" aria-label="Lobby setup">
            <div className="panel lobby-panel setup-panel">
              <div className="panel-heading">
                <h2>Setup</h2>
              </div>
              <section className="lobby-controls" aria-label="Lobby controls">
                <div className="lobby-control-row name-control-row">
                  <input
                    className="player-name-input"
                    value={playerName}
                    maxLength={24}
                    onChange={(event) => setPlayerName(event.target.value)}
                    placeholder="Your name"
                    aria-label="Your name"
                  />
                  <button className="button-secondary button-small" type="button" onClick={savePlayerName}>
                    Save Name
                  </button>
                </div>
                <div className="lobby-control-row">
                  <button className="button-primary" type="button" onClick={() => void createLobby()}>
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
                  <button className="button-secondary" type="button" onClick={() => void joinLobby()}>
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
              <div className="lobby-start-actions">
                <button className="button-primary lobby-start-button" type="button" onClick={startGame}>
                  <Play size={18} aria-hidden="true" />
                  Start Game
                </button>
                {syncMode === "local" ? (
                  <button className="button-ghost icon-button" type="button" onClick={resetDemo} aria-label="Reset demo">
                    <RotateCcw size={18} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {error !== null ? <p className="error-text">{error}</p> : null}
            </div>

            <div className="panel lobby-panel table-preview-panel">
              <div className="panel-heading">
                <h2>Seats</h2>
              </div>
              <div className="felt-preview">
                <div className="felt-center" aria-hidden="true">
                  <span>Table</span>
                </div>
                <section className="lobby-seats" aria-label="Lobby seats">
                  {lobbySeats.map((player, index) => {
                    const seatType = player?.kind === "bot" ? (player.botStrategy ?? "easy") : "human";
                    const isJoinedHuman = player !== undefined && player.kind !== "bot";
                    const seatClassName = [
                      "lobby-seat",
                      `seat-${index + 1}`,
                      player === undefined ? "is-empty" : "is-occupied",
                      player?.kind === "bot" ? "is-bot" : ""
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <label className={seatClassName} key={player?.id ?? `open-seat-${index}`}>
                        <span className="seat-label-row">
                          <span>Seat {index + 1}</span>
                          {player?.kind === "bot" ? <span className="bot-badge">BOT</span> : null}
                        </span>
                        <span className="seat-name">
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
              </div>
            </div>
          </section>
        ) : null}

        {game.phase !== "lobby" ? (
          <section className="center-table game-table" aria-label="Table">
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
                className={`turn-callout ${isActiveTurn ? "is-your-turn" : ""}`}
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
          <div className={`table-focus seat-layout opponents-${opponents.length}`}>
            <div className="opponents-panel" aria-label="Other players">
              <AnimatePresence initial={false}>
                {opponents.map((player, index) => {
                  const seat = index === 0 ? "top" : index === 1 ? "left" : "right";

                  return (
                    <OpponentHand
                      key={player.id}
                      player={player}
                      seat={seat}
                      cardCount={game.hands[player.id]?.length ?? 0}
                      isTurn={game.currentTurn === player.id}
                      isSkipped={game.skippedPlayers.includes(player.id)}
                    />
                  );
                })}
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
                    Center pile
                  </motion.div>
                ) : (
                  visibleDiscardPlay.cards.map((card, index) => (
                    <motion.div
                      layout
                      key={card.id}
                      className="center-play-card"
                      initial={{ opacity: 0, y: 70, scale: 0.9, rotate: -14 }}
                      animate={{ opacity: 1, y: 0, scale: 1, rotate: (index - visibleDiscardPlay.cards.length / 2) * 5 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ type: "spring", stiffness: 430, damping: 28 }}
                    >
                      <CardView card={card} disabled />
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
          </section>
        ) : null}

        {game.phase !== "lobby" ? (
          <section className="panel chat-panel" aria-label="Lobby chat">
            <div className="chat-heading">
              <h2>
                <MessageSquare size={16} aria-hidden="true" />
                Chat
              </h2>
              <span>{syncMode === "remote" ? "Lobby" : "Online only"}</span>
            </div>

            <div className="chat-messages" aria-live="polite">
              {syncMode !== "remote" ? (
                <p className="chat-empty">Create or join an online lobby to chat.</p>
              ) : chatMessages.length === 0 ? (
                <p className="chat-empty">No messages yet.</p>
              ) : (
                chatMessages.map((chatMessage) => (
                  <article
                    className={`chat-message ${chatMessage.player_id === activePlayerId ? "is-own-message" : ""}`}
                    key={chatMessage.id}
                  >
                    <div>
                      <strong>{chatMessage.player_name}</strong>
                      <time dateTime={chatMessage.created_at}>
                        {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
                          new Date(chatMessage.created_at)
                        )}
                      </time>
                    </div>
                    <p>{chatMessage.message}</p>
                  </article>
                ))
              )}
              <div ref={chatMessagesEndRef} />
            </div>

            <form
              className="chat-form"
              onSubmit={(event) => {
                event.preventDefault();
                void sendCurrentChatMessage();
              }}
            >
              <input
                value={chatDraft}
                maxLength={200}
                onChange={(event) => handleChatDraftChange(event.currentTarget.value)}
                placeholder="Message"
                disabled={syncMode !== "remote"}
                aria-label="Chat message"
              />
              <button className="button-primary icon-button" type="submit" disabled={syncMode !== "remote" || chatDraft.trim().length === 0}>
                <Send size={17} aria-hidden="true" />
              </button>
            </form>
            {chatError !== null ? <p className="chat-error">{chatError}</p> : null}
          </section>
        ) : null}

        {game.phase !== "lobby" ? (
          <section className="hand-panel player-hand-tray" aria-label="Your hand">
            <div className="hand-actions">
              <button className="button-primary play-action" type="button" disabled={!canPlaySelectedCards} onClick={playSelectedCards}>
                <Send size={18} aria-hidden="true" />
                Play {selectedCards.length}
              </button>
              <button type="button" disabled={!canUseHumanControls || game.currentLeadingPlay === null} onClick={skipTurn}>
                <SkipForward size={18} aria-hidden="true" />
                {skipLabel}
              </button>
              <button className="button-secondary new-game-action" type="button" onClick={restartGame}>
                <RotateCcw size={18} aria-hidden="true" />
                New Game
              </button>
            </div>

            {canUseHumanControls && !hasLegalCardPlay ? (
              <p className="no-legal-play-text">
                No legal play available.{game.currentLeadingPlay === null ? "" : " Pass to continue."}
              </p>
            ) : null}

            <motion.div layout className="hand">
              {sortedActiveHand.map((card, index) => {
                const selected = selectedCardIds.includes(card.id);

                return (
                  <span
                    key={card.id}
                    className={`hand-card-shell ${selected ? "is-selected" : ""}`}
                    style={{ "--fan-offset": index - (sortedActiveHand.length - 1) / 2 } as CSSProperties}
                  >
                    <CardView
                      card={card}
                      selected={selected}
                      disabled={game.phase !== "playing" || !canUseHumanControls}
                      onClick={(nextCard) => toggleCard(nextCard.id)}
                    />
                  </span>
                );
              })}
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
        ) : null}

        <footer className="version-footer">
          <span title={`Build HEAD ${buildHead}`} aria-label={`Build HEAD ${buildHead}`}>
            Version
          </span>
        </footer>

        {isRulesOpen ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsRulesOpen(false)}>
            <section
              className="panel rules-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="rules-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="rules-header">
                <div>
                  <p className="eyebrow">Current table rules</p>
                  <h2 id="rules-title">VC Rules</h2>
                </div>
                <button className="button-ghost icon-button" type="button" onClick={() => setIsRulesOpen(false)} aria-label="Close rules">
                  <X size={18} aria-hidden="true" />
                </button>
              </div>

              <div className="rules-content">
                <section>
                  <h3>Turn Order</h3>
                  <ul>
                    <li>The player with the 3 of spades starts. If it is not in the deal, the lowest card starts.</li>
                    <li>The opening play must include that starting card.</li>
                    <li>When everyone else passes, the last player who played cards leads the next hand.</li>
                  </ul>
                </section>

                <section>
                  <h3>Legal Plays</h3>
                  <ul>
                    <li>Singles, pairs, triples, straights of 3 or more, and bombs are playable.</li>
                    <li>Pairs and triples must use matching ranks.</li>
                    <li>2s may never be included in straights.</li>
                    <li>Bombs are four of a kind or a straight of pairs.</li>
                  </ul>
                </section>

                <section>
                  <h3>Beating Plays</h3>
                  <ul>
                    <li>After a play is set, the next play must match its format or pass.</li>
                    <li>The highest card in the new play must beat the highest card in the previous play.</li>
                    <li>Rank order starts at 3, then rises through ace, with 2 highest.</li>
                    <li>Suit order is spades, clubs, diamonds, hearts.</li>
                  </ul>
                </section>

                <section>
                  <h3>Passing And Locks</h3>
                  <ul>
                    <li>If you pass during a hand, you cannot play again until that hand resets.</li>
                    <li>A straight all in one suit creates a lock: the next straight must also be all one suit.</li>
                    <li>A single 2 can be beaten by a bomb.</li>
                    <li>Players continue after someone goes out until the finishing order is set.</li>
                  </ul>
                </section>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
