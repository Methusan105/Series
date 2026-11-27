# Show artwork

Thirty posters are already here, pulled from the [TVMaze](https://www.tvmaze.com)
API (their public API needs no key; images stay the property of their rights
holders and are used here to illustrate the shows). Most came from TVMaze's 16:9
"background" art; Gachiakuta, Knuckles and Solo Leveling had only portrait
posters, so those are centre-cropped to 16:9. All are 640×360 JPEGs, about 50KB
each.

To replace one, drop a file here and list it in `index.json`; the home page's
Continue watching cards pick it up. Files are looked up as `<slug>.<ext>`.

Any of `.jpg`, `.png` or `.webp` works. 16:9 crops best (the card is a 16:9
tile), roughly 640x360 is plenty.

`index.json` maps a slug to its extension so the page never asks for a file
that isn't there:

```json
{ "dexter": "png", "the-boys": "jpg" }
```

Shows without an entry show their initials on a colour derived from the name.

## Expected file names

- `akame-ga-kill.jpg` — Akame Ga Kill
- `arcane.jpg` — Arcane
- `attack-on-titan.jpg` — Attack On Titan
- `black-clover.jpg` — Black Clover
- `bluelock.jpg` — Bluelock
- `cyberpunk-edgerunners.jpg` — Cyberpunk Edgerunners
- `demon-slayer.jpg` — Demon Slayer
- `dexter.jpg` — Dexter
- `flash.jpg` — Flash
- `gachiakuta.jpg` — Gachiakuta
- `haikyuu.jpg` — Haikyuu
- `jujutsu-kaisen.jpg` — Jujutsu Kaisen
- `knuckles.jpg` — Knuckles
- `lucifer.jpg` — Lucifer
- `mandalorian.jpg` — Mandalorian
- `my-hero-academia.jpg` — My Hero Academia
- `peaky-blinders.jpg` — Peaky Blinders
- `prison-break.jpg` — Prison Break
- `smallville.jpg` — Smallville
- `snowfall.jpg` — Snowfall
- `solo-leveling.jpg` — Solo Leveling
- `squid-game.jpg` — Squid Game
- `stranger-things.jpg` — Stranger Things
- `supernatural.jpg` — Supernatural
- `teen-wolf.jpg` — Teen Wolf
- `the-big-bang-theory.jpg` — The Big Bang Theory
- `the-boys.jpg` — The Boys
- `the-umbrella-academy.jpg` — The Umbrella Academy
- `you.jpg` — You
- `young-sheldon.jpg` — Young Sheldon
