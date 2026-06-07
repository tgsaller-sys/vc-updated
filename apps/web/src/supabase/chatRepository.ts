import { supabase } from "./client";
import type { Database } from "./database.types";

export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];

export async function listChatMessages(lobbyId: string): Promise<readonly ChatMessage[]> {
  const client = supabase;

  if (client === null) {
    return [];
  }

  const { data, error } = await client
    .from("chat_messages")
    .select("id,lobby_id,player_id,player_name,message,created_at")
    .eq("lobby_id", lobbyId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error !== null) {
    throw error;
  }

  return data;
}

export async function sendChatMessage(
  lobbyId: string,
  playerId: string,
  playerName: string,
  message: string
): Promise<void> {
  const client = supabase;

  if (client === null) {
    throw new Error("Supabase is not configured.");
  }

  const { error } = await client.from("chat_messages").insert({
    lobby_id: lobbyId,
    player_id: playerId,
    player_name: playerName,
    message
  });

  if (error !== null) {
    throw error;
  }
}

export function subscribeToChatMessages(lobbyId: string, onMessage: (message: ChatMessage) => void): () => void {
  const client = supabase;

  if (client === null) {
    return () => undefined;
  }

  const channel = client
    .channel(`chat:${lobbyId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `lobby_id=eq.${lobbyId}` },
      (payload) => {
        onMessage(payload.new as ChatMessage);
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
