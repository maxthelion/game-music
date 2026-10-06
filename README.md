# game-music

Generative ambient music for games, made in the browser with Web Audio and no sound files.

This first version is the single-page study: open `index.html`, press Start and move the sliders. It plays slow pad
chords joined by small voice-leading moves, a beating drone, bells on loops that never line up, a double-kick
heartbeat and an occasional arpeggio. The same seed always gives the same music.

A library that a game can import and steer (energy, valence and tension axes, named moods, a per-district prompt) is
being built on top of this.

To deploy as a static site, serve the repository root; there is no build step yet.
