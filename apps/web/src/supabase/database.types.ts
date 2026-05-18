import type { GameAction, GameState } from "@vc/game";

export type Json = string | number | boolean | null | { readonly [key: string]: Json | undefined } | readonly Json[];

export interface Database {
  public: {
    Tables: {
      games: {
        Row: {
          readonly id: string;
          readonly lobby_code: string;
          readonly state: GameState;
          readonly version: number;
          readonly created_at: string;
          readonly updated_at: string;
        };
        Insert: {
          readonly id?: string;
          readonly lobby_code: string;
          readonly state: GameState;
          readonly version?: number;
        };
        Update: {
          readonly state?: GameState;
          readonly version?: number;
          readonly updated_at?: string;
        };
        readonly Relationships: [];
      };
      game_actions: {
        Row: {
          readonly id: string;
          readonly game_id: string;
          readonly actor_id: string;
          readonly action: GameAction;
          readonly created_at: string;
        };
        Insert: {
          readonly game_id: string;
          readonly actor_id: string;
          readonly action: GameAction;
        };
        Update: never;
        readonly Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
