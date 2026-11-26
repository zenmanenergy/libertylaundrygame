# Liberty Laundry

A Liberty Laundry bubble-trapping platformer for the big screen. The TV runs the game, and 1 to 4 players join with their phones as controllers.

- Run it: node Server/server.js, then open http://<this computer's address>:8091 on the TV. No npm install needed.
- Test without phones: open the TV page with ?keys=1 (A/D/W/S and the arrow keys).
- Deploying (games.socrates.guru/libertylaundry): docs/DEPLOY.md
- Adding art from PixelLab: docs/ASSETS.md
- Rules and how it works: docs/DesignSpec.md

## Layout

- Client/ - TV page (index.html), phone controller (pad.html), game code in js/, art in assets/
- Server/ - server.js: serves Client and relays phone input to the TV
- docs/ - design spec, art guide, deploy guide
- test/ - play.js runs a TV and two phones in headless Chrome
- deploy.sh - run on the server to update
