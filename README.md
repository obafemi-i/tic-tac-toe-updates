# Real-time tic-tac-toe 🤗😘

A small Express + Socket.io app. One person creates a room and gets a
4-character code; the other joins with that code. Moves sync instantly
over a WebSocket connection.

## Run it locally

```
npm install
npm start
```

Then open http://localhost:3000.

## Deploy for free (so a remote friend can play)

### Render.com
1. Push this folder to a GitHub repo (or use Render's "Upload" option).
2. **New > Web Service**, connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Deploy — Render gives you a public URL. Send it to your friend.

### Railway.app
1. `npm install -g @railway/cli` (or use their web UI)
2. `railway init` in this folder, then `railway up`

Free tiers on both may spin the service down when idle — the first
request after a while can take a few seconds to wake it up. That's
normal, not a bug.

## New in this version

- **Themes**: pick a character pair before creating a room — Hugs &
  Kisses, Cats & Dogs, Day & Night, Fire & Water, Pizza & Burgers, or
  Garden Grower. The joiner automatically sees whatever theme the
  creator picked.
- **Move animations**: pieces pop in when placed; the winning line
  gets a gentle pulse.
- **Win confetti**: a short themed burst plays when the game ends.
- **Contextual commentary**: occasional flavor text — taking the
  center on the first move, blocking an immediate threat, and a
  theme-flavored line on win/draw. Kept deliberately rare so it
  doesn't get noisy.
- **Friendlier losing screen**: instead of "you lost," the losing
  side sees "So close — rematch?"

All of this is cosmetic — the underlying rules, win detection, and
sync logic are unchanged.

## What changed to fix the "waiting for opponent" bug

Originally the creator's screen only updated when the server pushed a
`state` event after the joiner connected. On a free host, brief
connection hiccups (cold starts, idle proxy timeouts) can occasionally
drop that push — and since nothing else corrected it, the creator's
screen could get stuck.

Two changes fix this:
- **Periodic sync**: while in a room, the client quietly re-asks the
  server for the current state every 2 seconds (`get_state`), so even
  a missed push self-corrects within a couple seconds.
- **Reconnect handling**: the room code + your symbol are kept in
  `sessionStorage` for the current tab. If the socket disconnects and
  reconnects (network blip, host restart), the client automatically
  rejoins the same room instead of being dropped back to the home
  screen, and the server re-associates the new connection with your
  seat (X or O).

## How it works

- `server.js` holds all game state in memory per room (board, turns,
  whose socket is X/O, win detection) — the source of truth. Clients
  just render what the server sends.
- `public/script.js` connects via Socket.io, sends `create_room` /
  `join_room` / `rejoin_room` / `play` / `request_rematch` /
  `get_state` events, and re-renders on every `state` push or sync
  response.
- Marks are 🤗 (first player, "X" internally) and 😘 (second player,
  "O" internally) — purely cosmetic, the game logic is unchanged.
- A room is only deleted once both seats are empty *and* the leave was
  explicit (not just a temporary disconnect), so a brief drop doesn't
  wipe an in-progress game.

Note: state is in-memory, so restarting the server clears any rooms in
progress.
