# Afterglow Circuit

A 3D racing game in the browser with two ways to play: a career on twelve wet harbour circuits, and **Aethelgard Bay**, an open world built from a painted map. Time of day and weather run in cycles, the roads and the bay reflect the lights, and the engine sound is synthesised in the browser.

## Open world: Aethelgard Bay

Press **Open world** on the title screen (or use the *Open world* shortcut of the installed app). The whole map is drivable, about 4 × 2 km with 20 km of road:

- **Aethelgard City** with a street grid, downtown towers, the harbour with container stacks and cranes, and Sunset Pier.
- The **I-5 ring road** round the bay, the **A1 Coastal Way**, the airport, the Grand Stadium.
- **Sierra Peaks** with the Switchbacks up to the Snowy Summit, and **Bear Lake Reservoir** below.
- The **Evergreen National Forest** and the Redwood Trail, Rural Oakhaven, Whispering Woods.
- The **Sunscorched Badlands**: mesas, the salt flats, Coyote Canyon and the Rust Valley Speedway.
- **The Marshlands** and the dunes of **Dune Crest**.

What to do there:

- **Events.** Seven timed runs, each starting at an orange light beacon: Switchback Pass, Coastal Way Sprint, Redwood Trail Rally, Salt Flats Dash, Rust Valley Speedway, Marshland Run and the Grand Tour of the ring road. Drive into the beacon and press **E** (or tap *Start event*), then follow the gates. Bronze, silver and gold medals pay coins.
- **Collectibles.** 25 golden coins hidden round the map, 25 coins each.
- **Stunt ramps.** Five ramps; the first jump off each one pays a bonus.
- **Map.** **Tab** (or the *Map* button) opens the full map with every event and collectible. Click anywhere to set a waypoint; a green light column and the minimap lead you there.

Coins and upgrades are shared with the career. Rivals cruise the ring road as traffic. **R** puts you back on the nearest road; drive into deep water and you are pulled out automatically.

## Career

Twelve circuits, each with its own layout and a 1–5 star difficulty, laid out on a timeline in the **Career** panel. Finish on the podium to unlock the next one.

Every race has four goals (podium, win, no off-track penalties, a target lap time). Each goal pays coins the first time you meet it and a smaller amount on repeats. Leaving the tarmac doesn't slow you down; it adds 2 seconds to your time.

Rivals get stronger as you progress: better drivers and upgraded cars (up to stage 4 of 5 on the final circuit). From level 7 on they race dirty and will now and then lean on you to push you into the mud.

Pick **Harbour**, **City** (skyscrapers along the track) or **Forest** (dense pines up to the barriers) scenery on the title screen.

## Time and weather

**Time**: *Cycle* runs a full day (sunrise, noon, sunset, night) every few minutes, or pin dawn, day, dusk or night.

**Weather**: *Cycle* drifts between clear, cloudy, overcast, rain, thunderstorms and fog. Clouds build before the rain, the road soaks up and then slowly dries, puddles and reflections come and go, storms bring lightning and thunder, and fog closes in on the horizon. Or pin *Clear*, *Rain*, *Storm* or *Fog*. **T** cycles through them while driving.

## Music

On the title screen or in the pause menu, **Add songs** or **Add folder** plays any MP3, MP4, M4A, OGG, WAV or FLAC you pick. They're kept in your browser for next time. **Car radio** runs the music through an old factory car stereo (mono, thin, a bit crunchy, with a little FM hiss); **Clean** plays it straight. Keys: **N** next song, **B** radio/clean.

To ship songs with the game for everyone, put them in `music/` and list them in `music/playlist.json` (see `music/README.md`).

## Workshop

Spend coins on five stages each of **engine**, **brakes**, **steering & tyres** and **transmission**. The free setup sliders tune final drive, downforce, steering ratio and brake bias.

## Install it as an app

The game is a Progressive Web App, so it runs from GitHub Pages and installs like a normal program. It gets its own window, its own icon, works offline, and picks up every push by itself.

1. In this repo on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save**. (Pages on a private repo needs a paid GitHub plan; otherwise make the repo public.)
2. After a minute the game is live at `https://<your-user>.github.io/cargame/`.
3. Open that link in Chrome or Edge and click the **install** icon at the right of the address bar (or menu → *Install Afterglow Circuit*). On a phone: *Add to Home screen*.

From then on, launch it from the Start menu or desktop. Right-click the icon for the *Open world*, *Circuits* and *Level editor* shortcuts.

The game is split into modules, which browsers refuse to load from `file://`. To run it from a local copy, serve the folder instead, for example `npx http-server` in the repo and open the address it prints.

## Make your own levels

Open **`editor.html`** (in the installed app: right-click the icon → *Level editor*).

- Click empty space to add a point, drag points to shape the track, right-click to delete one.
- The panel checks every rule the game needs: corner radius (at least 30 m), gap between parts of the track (at least 72 m), length, and staying inside the buildable area. Problem spots turn red on the map.
- **Test drive** opens the game straight onto the track you're editing.
- Reorder, rename, rate (1–5 stars), duplicate or delete levels in the list. The first level is the first career race.
- **Publish to the game** commits `levels.json` to this repo using a GitHub fine-grained token with *Contents: read and write* on this repo only. The installed game loads the new levels on its next launch.

## Play

Needs a current Chrome, Edge, Firefox or Safari with WebGL 2, and an internet connection the first time to load three.js and the fonts.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake, then reverse |
| A / D, ← / → | Steer |
| Space | Handbrake (drift) |
| C | Change camera |
| R | Back on the track / road |
| E | Start an event (open world) |
| Tab | World map (open world) |
| T | Change the weather |
| M | Sound on/off |
| Esc / P | Pause |

On phones and tablets, touch pads appear while you drive. Gamepads work too (Y starts an event).

## Graphics settings

"Auto" lowers the render resolution by itself if the frame rate drops. High, Medium and Low are in the main menu and the pause menu. Low turns off the planar reflections and sun shadows; the amount of trees in the open world follows the setting chosen when it loads.

## Code layout

| Folder | What's in it |
| --- | --- |
| `js/core` | Settings, saved state and small helpers |
| `js/gfx` | Renderer and post-processing, sky, time of day and weather, particles |
| `js/world` | Circuits, the open world and its map data, roads, scenery props |
| `js/car` | Car models and driving physics |
| `js/game` | Race rules, open-world events, AI, camera, input, effects |
| `js/audio` | Engine and weather sounds, music player |
| `js/ui` | HUD, menus, world map |
