# Liberty Laundry design spec

Liberty Laundry is an original single-screen platformer, branded for the Liberty Laundry laundromat, for 1 to 4 players on one big screen, with phones as controllers. The gameplay idea of trapping enemies in bubbles comes from classic arcade games. Game mechanics can't be copyrighted, but art, music, characters, names and level layouts can, so everything here is new: the name, the characters, the level, the code and the art (placeholders for now).

## How it plays

- Each player is a little laundry-soap creature (Suds, Rinse, Spin, Fluff).
- BUBBLE blows a bubble forward. A bubble that hits a lint bunny on its way out traps it.
- Bubbles float up and drift along the ceiling.
- Touch a bubble to pop it. Popping a trapped lint bunny flings it, and it lands as a treat worth points.
- Bubbles touching each other pop together. Popping several trapped lint bunnies at once is a combo: 1000, 3000, 7000 and so on, and the treats are worth more.
- Land on a bubble while holding JUMP to bounce off it instead of popping it. This is how you reach high places.
- A trapped lint bunny escapes after 7 seconds (the bubble flashes red for the last 2) and comes out angry and faster.
- Platforms can be jumped through from below. Fall through the gap in the floor and you drop in from the gap in the ceiling.
- After 60 seconds, "HURRY UP!" makes every lint bunny angry.
- Touching a free lint bunny costs a life. Everyone starts with 3.
- Clear every lint bunny and the round ends: "SPARKLING CLEAN!", then the next round starts on the same level.
- If everyone is out of lives, it's game over and back to the lobby. A player who runs out while others are still playing can press JUMP to come back with fresh lives and a score of 0.

## Screens

- TV: the lobby shows a QR code, the join address, the room code and the 4 player slots. JUMP on any phone (or Enter on the TV) starts the game. During play the room code stays at the top so others can join mid-game.
- Phone: slide stick on the left (it appears where your thumb lands), BUBBLE and JUMP on the right, and your name, color, lives and score in the middle. Holding BUBBLE keeps blowing bubbles. Android vibrates on hits and combos.
- The game world is 1024 x 576 (16:9), scaled to fill the TV. On other screen shapes the edges are filled with wall tiles.

## Level format

Levels are text maps in Client/js/levelN.js, 32 columns by 18 rows:

- # wall, = platform you can jump through, . empty
- 1 to 4 player start points, e lint bunny start points

## Network

One Node process (Server/server.js, no npm packages) serves the Client folder and relays WebSocket messages. The TV runs the whole game. Phones only send buttons.

- TV connects to /ws?role=host and gets {t:'room', code}. It saves the code for the browser tab, so a reload keeps the same code.
- Phone connects to /ws?role=pad&room=CODE&id=ID. The id lives in the phone's localStorage, so a phone that reloads or loses signal gets its player back. A player whose phone is gone for 30 seconds is removed.
- Phone to TV: {t:'i', l, r, j, f}, sent on every change and repeated every 200 ms.
- TV to phone: {t:'you', name, color, status, lives, score} and {t:'buzz', ms}.

## Testing on one computer

Open the TV page with ?keys=1 to add two keyboard players: A/D/W/S for one, the arrow keys for the other (Up jumps, Down blows a bubble). Phones still work at the same time.

test/play.js runs the TV and two phones in headless Chrome and checks joining, moving, trapping, popping, the round clear, reconnecting and game over.

## Next steps (not built)

- More levels and a level order
- Real art and sounds (see ASSETS.md)
- More enemy types
