import { reduceGameAction, type GameAction, type GameState } from "@vc/game";
import { supabase } from "./client";

function actorIdForAction(action: GameAction): string {
  switch (action.type) {
    case "join":
      return action.player.id;
    case "set-connection":
      return action.playerId;
    case "start":
    case "play-cards":
    case "skip":
      return action.actorId;
  }
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

export async function dispatchValidatedRemoteAction(
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
