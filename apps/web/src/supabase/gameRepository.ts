import {
  botTurnDelayMs,
  maximumAutomaticBotTurns,
  nextBotAction,
  reduceGameAction,
  type GameAction,
  type GameState
} from "@vc/game";
import { supabase } from "./client";

function actorIdForAction(action: GameAction): string {
  switch (action.type) {
    case "join":
      return action.player.id;
    case "set-connection":
    case "remove-player":
      return action.playerId;
    case "start":
    case "restart":
    case "play-cards":
    case "skip":
      return action.actorId;
  }
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

interface DispatchRemoteActionOptions {
  readonly botTurnDelayMs?: number;
}

export async function signInAnonymously(): Promise<string> {
  if (supabase === null) {
    throw new Error("Supabase is not configured.");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError !== null) {
    throw sessionError;
  }

  if (sessionData.session?.user.id !== undefined) {
    return sessionData.session.user.id;
  }

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error !== null) {
    throw error;
  }

  const userId = data.user?.id;

  if (userId === undefined) {
    throw new Error("Anonymous sign-in did not return a user.");
  }

  return userId;
}

export async function createRemoteGame(lobbyCode: string, state: GameState): Promise<GameState> {
  const client = supabase;

  if (client === null) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await client
    .from("games")
    .insert({ id: state.id, lobby_code: lobbyCode, state, version: state.version })
    .select("state")
    .single();

  if (error !== null) {
    throw error;
  }

  return data.state;
}

export async function getRemoteGameByLobbyCode(lobbyCode: string): Promise<GameState> {
  const client = supabase;

  if (client === null) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await client
    .from("games")
    .select("state")
    .eq("lobby_code", lobbyCode)
    .single();

  if (error !== null) {
    throw error;
  }

  return data.state;
}

async function persistValidatedRemoteAction(
  state: GameState,
  action: GameAction
): Promise<GameState> {
  const client = supabase;

  if (client === null) {
    throw new Error("Supabase is not configured.");
  }

  const transition = reduceGameAction(state, action);

  if (!transition.validation.ok) {
    throw new Error(transition.validation.reason);
  }

  const { data, error } = await client
    .from("games")
    .update({
      state: transition.state,
      version: transition.state.version,
      updated_at: new Date().toISOString()
    })
    .eq("id", state.id)
    .eq("version", state.version)
    .select("state")
    .single();

  if (error !== null) {
    throw error;
  }

  const { error: actionError } = await client.from("game_actions").insert({
    game_id: state.id,
    actor_id: actorIdForAction(action),
    action
  });

  if (actionError !== null) {
    throw actionError;
  }

  return data.state;
}

export async function dispatchValidatedRemoteAction(
  state: GameState,
  action: GameAction,
  options: DispatchRemoteActionOptions = {}
): Promise<GameState> {
  let nextState = await persistValidatedRemoteAction(state, action);
  const nextBotTurnDelayMs = options.botTurnDelayMs ?? botTurnDelayMs;

  for (let turn = 0; turn < maximumAutomaticBotTurns; turn += 1) {
    const botAction = nextBotAction(nextState);

    if (botAction === null) {
      return nextState;
    }

    await wait(nextBotTurnDelayMs);
    nextState = await persistValidatedRemoteAction(nextState, botAction);
  }

  throw new Error("Bot turns exceeded the safety limit.");
}

export function subscribeToGame(gameId: string, onState: (state: GameState) => void): () => void {
  const client = supabase;

  if (client === null) {
    return () => undefined;
  }

  const channel = client
    .channel(`game:${gameId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
      (payload) => {
        const next = payload.new as { readonly state?: GameState };

        if (next.state !== undefined) {
          onState(next.state);
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
