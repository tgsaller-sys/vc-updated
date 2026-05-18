const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createLobbyCode(length = 6): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
