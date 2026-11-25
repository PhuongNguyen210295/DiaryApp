# Diary

A private, offline-first diary styled as a starship captain's log, you install on your phone's home screen. It's a Progressive Web App (PWA): no app store, no account, no server. Your entries stay on your device.

## Features

- Write entries with a title, date/time, mood and photos
- `#tags` written anywhere in an entry are picked up automatically; tap a tag to filter
- Search across all entries, filter by mood
- Entry count, monthly count and writing streak
- **Star map:** each month is a route through space. Days you wrote are planets in your mood's colour, missed days are faint stars, a glowing lane marks your streaks, the nebula colour changes with the season, and your level badge hovers over today. Tap a stop to read that day, or write for a day you missed
- **Levels and badges:** earn XP every time you write, level up through titles from *Blank Page* to *Legendary Author*, unlock 14 badges, and earn a milestone badge every 10 levels (Orbit Reached, Moonwalker, Star Sailor…)
- Optional passcode lock that re-locks when you leave the app
- Light, dark or automatic theme
- Works fully offline once loaded
- Export and import JSON backups (on phones, Export opens the share sheet, so you can save to Files, Google Drive or email it to yourself)

## Put it on your phone

1. **Host it.** This repo has a GitHub Actions workflow that publishes to GitHub Pages:
   - In the repo on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
   - Merge into `main` (or run the *Deploy to GitHub Pages* workflow by hand from the **Actions** tab).
   - The site will be at `[https://<your-username>.github.io/<repo-name>/](https://phuongnguyen210295.github.io/DiaryApp/#/)`.
2. **Install it.**
   - **iPhone:** open the link in **Safari** → Share → **Add to Home Screen**.
   - **Android:** open the link in **Chrome** → ⋮ menu → **Install app**.

The app then opens full-screen from its icon, like a native app.

## Your data

- Entries are stored in the browser's IndexedDB on the device you install it on. They don't sync between devices.
- Deleting the app from your home screen, or clearing Safari/Chrome website data, can erase them. **Export a backup regularly.**
- The passcode is a privacy screen: it's stored only as a salted PBKDF2 hash, but the entries themselves aren't encrypted. Someone with the unlocked device and developer tools could still read them.

## Run locally

Any static file server works, for example:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Releasing updates

The service worker loads files from the network first (so every file comes from the same release) and falls back to its saved copy only when offline. When you add a new file, add it to `ASSETS` in `sw.js` and to the copy step in `.github/workflows/pages.yml`, and bump `CACHE` in `sw.js` (e.g. `diary-v5`).

## Fonts

Chakra Petch and Be Vietnam Pro (SIL Open Font License) are self-hosted in `fonts/` so they work offline and cover Vietnamese.
