# VC Deployment Notes

## Supabase

1. Create a Supabase project.
2. In Authentication > Providers, enable anonymous sign-ins.
3. In SQL Editor, run `supabase/schema.sql`.
4. Copy the project URL and anon public key from Project Settings > API.
5. Add these environment variables to local `.env.local` and to Vercel:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The current repository keeps rules in TypeScript. Supabase stores the authoritative serialized `GameState`, records submitted actions, and broadcasts `games` row updates through Realtime.

## Vercel

1. Import this Git repository into Vercel.
2. Set the framework preset to Vite.
3. Set the root directory to `apps/web`.
4. Set the install command to `pnpm install`.
5. Set the build command to `pnpm --filter @vc/web build`.
6. Set the output directory to `apps/web/dist` if Vercel asks from the repo root, or `dist` if the project root is `apps/web`.
7. Add the Supabase environment variables above.

## Next Multiplayer Step

For fully authoritative multiplayer, route actions through a Supabase Edge Function or PostgREST RPC that:

1. Reads the current `games.state` and `version`.
2. Imports or bundles `@vc/game`.
3. Calls `reduceGameAction`.
4. Writes the validated next state with a version match.
5. Returns the validated state to the client.

That preserves the intended flow: UI dispatches actions, TypeScript validates transitions, Supabase persists state, and Realtime broadcasts updates.
