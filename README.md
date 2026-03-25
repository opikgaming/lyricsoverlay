# LyricsOverlay

Overlay lyrics on your screen from YouTube, Spotify, and YouTube Music.
While your browser plays music, this app displays
the lyrics as a transparent topmost overlay.

---

## 1. Compile the C# app

Double-click **compile.bat** (requires .NET Framework 4 installed).

It will produce **LyricsOverlay.exe** in the same folder.

If csc.exe is not found, install .NET Framework 4:
https://dotnet.microsoft.com/en-us/download/dotnet-framework/net40

---

## 2. Install ViolentMonkey

Install the ViolentMonkey extension for your browser:
- Chrome / Edge: https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegedbjkdiaebcehnmgki
- Firefox: https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/

---

## 3. Install the userscripts

Open ViolentMonkey dashboard → click the + button → "Install from file" (or just drag the .js file in).

| Script file                          | Works on                        |
|--------------------------------------|---------------------------------|
| userscripts/youtube.user.js          | https://www.youtube.com/watch*  |
| userscripts/spotify.user.js          | https://open.spotify.com/*      |
| userscripts/ytmusic.user.js          | https://music.youtube.com/*     |

All three can be installed at the same time — they only activate on their
respective domains.

---

## 4. Usage

1. Run **LyricsOverlay.exe**
2. The config window shows the server status (green = running on port 7331)
3. Open your browser and play music on a supported platform
4. Lyrics appear as an overlay — position/style it via the Display tab
5. Use "Drag Mode" to reposition the overlay, then "Lock" it when done

---

## HTTP API (for custom scripts)

The app listens on http://localhost:7331

    POST /subtitle
    Content-Type: application/json
    { "main": "Current lyric line", "upcoming": "Next line" }

    POST /clear         → clears the overlay
    GET  /ping          → responds "pong" (health check)

---

## Troubleshooting

**Overlay not showing lyrics:**
- Make sure LyricsOverlay.exe is running (green dot in the window)
- Check that the userscript is enabled in ViolentMonkey for the current site
- Some videos/tracks have no captions/lyrics — nothing to display in that case

**YouTube — no lyrics showing:**
- The script uses auto-generated captions; videos with no captions/subtitles
  will have no lyrics. Check: Settings gear → Subtitles → are any available?
- On SPA navigation (clicking a new video), wait ~2 seconds for the script to
  fetch the caption track

**Spotify — lyrics not syncing:**
- Spotify Web needs to load the lyrics panel at least once per track for the
  intercept to fire. Open the lyrics panel (mic icon in the player bar) on
  the first few tracks to trigger the API fetch.
- Not all tracks have synced lyrics; some only have unsynced static lyrics.

**Port conflict:**
- Change the port in the app's Server tab → Restart Server
- Change PORT = 7331 at the top of each userscript to match

**"Waiting for data from browser..." stuck:**
- The app is running but hasn't received any data yet
- Make sure a userscript is active (ViolentMonkey icon shows a badge count)

---

## Architecture

```
Browser (YouTube / Spotify / YTM)
  └── ViolentMonkey userscript
        ├── Intercepts fetch/XHR for lyrics API
        ├── Polls video.currentTime for sync
        └── POST JSON → http://localhost:7331/subtitle

LyricsOverlay.exe
  ├── HttpListener (port 7331)
  ├── Parses {"main","upcoming"} JSON
  └── Updates transparent overlay (SubtitleLabel)
        ├── Main lyric line (colored, optional stroke)
        └── Upcoming lyric line (smaller, dimmed)
```

---

## Changing the port

1. In the app: Server tab → change port number → "Restart Server"
2. In each userscript: edit the line `var PORT = 7331;` at the top
