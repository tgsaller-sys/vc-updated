import type { GameAction, GameState } from "@vc/game";

export interface Database {
  readonly public: {
    readonly Tables: {
      readonly games: {
        readonly Row: {
          readonly id: string;
          readonly lobby_code: string;
          readonly state: GameState;
          readonly version: number;
          readonly created_at: string;
          readonly updated_at: string;
        };
        readonly Insert: {
          readonly id: string;
          readonly lobby_code: string;
          readonly state: GameState;
          readonly version?: number;
        };
        readonly Update: {
          readonly state?: GameState;
          readonly version?: number;
          readonly updated_at?: string;
        };
        readonly Relationships: [];
      };
      readonly game_actions: {
        readonly Row: {
          readonly id: string;
          readonly game_id: string;
          readonly actor_id: string;
          readonly action: GameAction;
          readonly created_at: string;
        };
        readonly Insert: {
          readonly game_id: string;
          readonly actor_id: string;
          readonly action: GameAction;
        };
        readonly Update: never;
        readonly Relationships: [];
      };
    };
    readonly Views: Record<string, never>;
    readonly Functions: Record<string, never>;
    readonly Enums: Record<string, never>;
    readonly CompositeTypes: Record<string, never>;
  };
}
