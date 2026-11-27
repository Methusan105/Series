# Show artwork

Drop a poster for a show here and list it in `index.json`; the home page's
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
