# Art and sound guide

Everything in the game is drawn as a placeholder until a real file shows up at the path below. Save the PNG with that exact name, reload the TV page, and it's used. Nothing else needs to change.

The full list, with frame counts and speeds, lives in Client/js/assets.js. If a strip has a different number of frames than listed, change the number there.

## Rules for every sprite

- PNG with a transparent background.
- Each animation is one horizontal strip: frames side by side, all the same size.
- Characters face RIGHT. The game mirrors them for left.
- The world is 1024 x 576 pixels with 32 x 32 tiles. A 32 x 32 sprite fills one tile.
- The bottom of the frame is where the feet go. Leave little or no empty space under the feet.
- Bigger art (for example 64 x 64 from PixelLab) works: set w and h to 64 in assets.js and leave size at 32 (or raise it a little if the character should look bigger than its hit box).

## Sprites

| File | Frames | What it shows |
|---|---|---|
| assets/sprites/p1_idle.png | 2 | Player 1 standing, gentle breathing |
| assets/sprites/p1_walk.png | 4 | Player 1 walking |
| assets/sprites/p1_jump.png | 1 | Player 1 going up |
| assets/sprites/p1_fall.png | 1 | Player 1 coming down |
| assets/sprites/p1_blow.png | 2 | Player 1 blowing a bubble |
| assets/sprites/p1_hurt.png | 4 | Player 1 getting hit (the game also spins it) |
| assets/sprites/p2_*.png | same | Player 2, optional |
| assets/sprites/enemy_walk.png | 4 | Lint bunny walking |
| assets/sprites/enemy_angry.png | 4 | Lint bunny angry (after escaping, or HURRY UP) |
| assets/sprites/enemy_trapped.png | 2 | Lint bunny struggling inside a bubble (drawn under the bubble) |
| assets/sprites/enemy_flung.png | 4 | Lint bunny flying after its bubble pops (the game also spins it) |
| assets/sprites/bubble.png | 1 | An empty bubble, 32 x 32, mostly see-through |
| assets/sprites/bubble_pop.png | 3 | A bubble bursting |
| assets/sprites/treat.png | 1 | The prize a popped enemy turns into (placeholder is a clean sock) |

Players 3 and 4: if p3_*.png and p4_*.png don't exist (they aren't in the list yet), the game reuses player 1's art with a color shift. The same happens for player 2 until p2_*.png exists. To give them their own art, copy the p2 lines in assets.js and change p2 to p3 or p4.

## Level art

| File | Size | Notes |
|---|---|---|
| assets/tiles/wall.png | 32 x 32 | Solid wall, ceiling and floor. Should tile seamlessly. Also used to fill the edges on screens that aren't 16:9. |
| assets/tiles/platform.png | 32 x 32 | Platforms you can jump up through. Should tile seamlessly side to side. |
| assets/backgrounds/level1.png | 1024 x 576 | Behind everything. Keep it darker and calmer than the characters so they stand out. |

## Sound (optional)

The game makes beeps on its own. To replace one, put an .mp3 in assets/sounds with one of these names: jump, blow, trap, pop, splat, treat, hurt, clear, hurry, join, start.

## PixelLab and Meshy tips

- PixelLab: make the player first, then use its animation tools to make the walk, jump and blow strips from the same character so they match. Ask for a side view facing right, 32 x 32 or 64 x 64, transparent background.
- Meshy gives you 3D models. To use one here, render it from the side at a fixed camera, export frames, and lay them out in a strip. PixelLab is the quicker path for this game.
- Keep everything original: your own characters and names. Don't prompt for "Bubble Bobble style", "Bub" or anything that copies the original's dragons.

## Ideas that fit the theme (all original)

- Players: soap-bubble creatures, a laundry detergent pod, a dryer sheet, a fluffy towel.
- Enemies: lint bunnies, grass stains, mud blobs, stinky socks, ketchup splats.
- Treats: clean folded shirts, matched sock pairs, quarters for the machines.
- Level 1 "Wash Cycle": a row of front-loading washers along the back wall, folding tables, a change machine.
- The Liberty Laundry logo or colors could go on the lobby screen or the background. Send them over and I'll work them in.
