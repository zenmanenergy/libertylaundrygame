# Liberty Laundry design spec

Liberty Laundry is an original single-screen platformer, branded for the Liberty Laundry laundromat, for 1 to 4 players on one big screen, with phones as controllers. The gameplay idea of trapping enemies in bubbles comes from classic arcade games. Game mechanics can't be copyrighted, but art, music, characters, names and level layouts can, so everything here is new: the name, the characters, the level, the code and the art (placeholders for now).

## How it plays

- Each player is a little laundry-soap creature (Suds, Rinse, Spin, Fluff).
- BUBBLE blows a bubble forward. A bubble that hits a lint bunny on its way out traps it.
- Bubbles float up and drift along the ceiling.
- Touch a bubble to pop it. Popping a trapped lint bunny flings it, and it lands as a treat worth points.
- Bubbles touching each other pop together. Popping several trapped lint bunnies at once is a combo: 1000, 3000, 7000 and so on, and the treats are worth more.
- Land on top of a bubble and you stand on it, but your weight pops it after about half a second. Keep jumping (hold JUMP) and it holds you up, so you can ride it as it rises. A bubble squashed against the ceiling with you on it pops. Touching a bubble from the side or below pops it, except your own bubble in its first 0.6 seconds, so you can blow one against a wall, jump past it and land on top.
- Pull the stick down and press JUMP to drop through the platform you're standing on. Hold both to keep dropping level after level. The floor can't be dropped through.
- Every jump is full height, however briefly JUMP is pressed (phone lag makes hold time unreliable). Holding JUMP keeps jumping: you jump again the moment you land.
- A bubble that hits another player traps them. They can't move, the bubble rises quickly and pops when it reaches the ceiling, dropping them out at the top. It's a way to get someone up high without jumping. Anyone else who touches the bubble on the way up pops it early. A freshly trapped player can't be popped for half a second, and players are safe from enemies for a second after popping out.
- A trapped lint bunny escapes after 7 seconds (the bubble flashes red for the last 2) and comes out angry and faster.
- Platforms can be jumped through from below. Fall through the gap in the floor and you drop in from the gap in the ceiling.
- After 60 seconds, "HURRY UP!" makes every lint bunny angry.
- Touching a free lint bunny costs a life. Everyone starts with 3.
- Clear every lint bunny and the level ends: "SPARKLING CLEAN!", leftover bubbles pop, and the players stop and float in place.
- Then the level slides down off the bottom of the screen while the next level slides down from the top to replace it (about 2.6 seconds). The players float to their start spots on the new level during the slide, since where they were could be inside a wall on the new level.
- There are 10 levels. After level 10 the layouts start over from level 1, but the level number keeps counting up.
- Players who join during the clear or the slide drop in when the new level starts.
- If everyone is out of lives, it's game over and back to the lobby. A player who runs out while others are still playing can press JUMP to come back with fresh lives and a score of 0.

## Screens

- TV: the lobby shows a QR code, the join address, the room code and the 4 player slots. JUMP on any phone (or Enter on the TV) starts the game. During play the room code stays at the top so others can join mid-game.
- Phone: slide stick on the left (it appears where your thumb lands), BUBBLE and JUMP on the right, and your name, color, lives and score in the middle. Holding BUBBLE keeps blowing bubbles. Android vibrates on hits and combos.
- The game world is 1024 x 576 (16:9), scaled to fill the TV. On other screen shapes the edges are filled with wall tiles.

## Level format

All 10 levels are text maps in Client/js/levels.js, 32 columns by 18 rows each, with a name and a hurryAfter time in seconds:

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

test/play.js runs the TV and two phones in headless Chrome and checks joining, moving, trapping, popping, the level clear and slide to level 2, reconnecting and game over.

## Next steps (not built)

- More levels and a level order
- Real art and sounds (see ASSETS.md)
- More enemy types

## Performance

- The level art (background, tiles and the wall fill at the screen edges) is drawn on its own canvas (#bg) under the game canvas, and only redrawn when the level or screen size changes, or while a level slides in.
- Drawing is capped at about 1920 x 1080 pixels and the browser scales it up to fill bigger or high-DPI screens. Add ?res=full to the TV address to draw at the screen's full resolution.
- The game draws at most 60 frames a second, even on 120 or 144 Hz monitors.
- The QR code and recolored player sprites are drawn once and reused.
