# Afterglow Circuit

A 3D night race on a wet harbour circuit at blue hour, in a single HTML file.

Race three laps against three AI rivals, or run solo hot laps against your own record. The road and the bay reflect the city lights, the tail lights bloom, and the engine sound is synthesised in the browser.

## Career

Twelve circuits, each with its own layout and a 1–5 star difficulty, laid out on a timeline in the **Career** panel. Finish on the podium to unlock the next one.

Every race has four goals (podium, win, no off-track penalties, a target lap time). Each goal pays coins the first time you meet it and a smaller amount on repeats. Leaving the tarmac doesn't slow you down; it adds 2 seconds to your time.

Rivals get stronger as you progress: better drivers and upgraded cars (up to stage 4 of 5 on the final circuit). From level 7 on they race dirty and will now and then lean on you to push you into the mud.

## Workshop

Spend coins on five stages each of **engine**, **brakes**, **steering & tyres** and **transmission**. The free setup sliders tune final drive, downforce, steering ratio and brake bias.

## Install it as an app

The game is a Progressive Web App, so it runs from GitHub Pages and installs like a normal program. It gets its own window, its own icon, works offline, and picks up every push by itself.

1. In this repo on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save**. (Pages on a private repo needs a paid GitHub plan; otherwise make the repo public.)
2. After a minute the game is live at `https://<your-user>.github.io/cargame/`.
3. Open that link in Chrome or Edge and click the **install** icon at the right of the address bar (or menu → *Install Afterglow Circuit*). On a phone: *Add to Home screen*.

From then on, launch it from the Start menu or desktop. No cloning needed; new pushes show up the next time you open it.

You can still open `index.html` straight from disk, but it then uses the built-in copy of the levels instead of `levels.json`.

## Make your own levels

Open **`editor.html`** (in the installed app: right-click the icon → *Level editor*).

- Click empty space to add a point, drag points to shape the track, right-click to delete one.
- The panel checks every rule the game needs: corner radius (at least 30 m), gap between parts of the track (at least 72 m), length, and staying inside the buildable area. Problem spots turn red on the map.
- **Test drive** opens the game straight onto the track you're editing.
- Reorder, rename, rate (1–5 stars), duplicate or delete levels in the list. The first level is the first career race.
- **Publish to the game** commits `levels.json` to this repo using a GitHub fine-grained token with *Contents: read and write* on this repo only. The installed game loads the new levels on its next launch.

## Play

Needs a current Chrome, Edge, Firefox or Safari, and an internet connection the first time to load three.js and the fonts.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake, then reverse |
| A / D, ← / → | Steer |
| Space | Handbrake (drift) |
| C | Change camera |
| R | Put the car back on the track |
| M | Sound on/off |
| Esc / P | Pause |

On phones and tablets, touch pads appear during the race. Gamepads work too.

## Graphics settings

"Auto" lowers the render resolution by itself if the frame rate drops. High, Medium and Low are in the main menu and the pause menu.
