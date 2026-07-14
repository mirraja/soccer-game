# Penalty Shootout — Online Multiplayer

Play a mobile-friendly penalty shootout in real time with family anywhere. Hosted on GitHub Pages + Firebase Realtime Database.

## Play (after setup)

1. One player taps **Create new game** and shares the 6-digit room code (use **Share** on mobile).
2. The other opens the same URL and taps **Join game** with that code.
3. Take turns shooting and saving — Home shoots first.

## How to play

- The **shooter** taps a goal zone to aim their shot.
- The **keeper** taps a zone to dive at the same time.
- **Goal** if the zones don't match; **save** if they do.
- Each player gets 5 shots (10 rounds). Most goals wins.
- Tied after 10 rounds? Sudden death until someone leads.

## Firebase setup (one time, ~5 min)

1. Go to [Firebase Console](https://console.firebase.google.com) → **Create a project**
2. **Build → Realtime Database → Create Database** → choose a region → start in **test mode**
3. **Project settings** (gear) → **Your apps** → **Web** (`</>`) → register app
4. Copy the `firebaseConfig` object
5. Paste it into `docs/firebase-config.js` (replace the placeholder values)
6. Commit and push:

```bash
cd c:\Users\rmir\practice\soccer-game
git add docs/firebase-config.js
git commit -m "Add Firebase config"
git push
```

You can reuse the same Firebase project as tic-tac-toe — both games use `rooms/{code}` paths.

### Database rules

In Realtime Database → **Rules**, use the rules in `firebase-database-rules.json`:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

## GitHub Pages

**Settings → Pages** → Branch: `main`, Folder: `/docs` → Save

## Local test

```bash
python -m http.server 8080 --directory docs
```

Open http://localhost:8080

### Mobile testing tips

- **Same Wi-Fi:** On your phone, open `http://<your-computer-ip>:8080` (find IP with `ipconfig` on Windows).
- **Two tabs:** Use two browser tabs on desktop to simulate Home vs Away.
- **Touch:** All controls use large tap targets (48px+ buttons, 72px goal zones) — no keyboard needed.
- **Share:** Tap **Share** in-game to send the room code via your phone's share sheet.
- **Landscape:** The layout compacts automatically on phones held sideways.

Do not open `index.html` via `file://` — Firebase works best over HTTP.

## Project structure

```
soccer-game/
├── docs/
│   ├── index.html
│   ├── style.css
│   ├── game.js
│   ├── firebase-config.js
│   └── firebase-config.example.js
├── firebase-database-rules.json
└── README.md
```
