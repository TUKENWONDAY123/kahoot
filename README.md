# 🎮 Kahoot Clone — Real-Time Quiz Game

<p align="center">
  <img src="https://img.shields.io/badge/Status-Live-brightgreen?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Players-Multiplayer-9b59b6?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Stack-Supabase-3ecf8e?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-MIT-orange?style=for-the-badge" />
</p>

---

## ✨ Features

### 🎯 Game Creation
- **Custom quiz builder** — Create games with unlimited questions
- **Image support** — Attach images to questions for visual quizzes
- **Configurable timers** — Set answer time per question (default 20s)
- **Save & load** — Store games locally or in Supabase cloud

### 👥 Multiplayer
- **Real-time sync** — Powered by Supabase Realtime
- **Unique 6-digit PIN** — Players join instantly with a simple code
- **Avatar system** — Random avatars via DiceBear API with custom selection
- **Kick players** — Host can remove disruptive players mid-game

### 🏆 Scoring System
- **Speed-based points** — Faster answers earn more points (500–1000)
- **Live leaderboard** — See rankings after each round
- **Skip penalties** — +50 points to all when host skips a question
- **Podium celebration** — Animated 1st/2nd/3rd place reveal with particle effects

### 🎨 Visual Effects
- **Confetti explosions** 🎊 — Celebration on podium phase
- **Button flash animations** — Colorful feedback on answer
- **Floating particles** — Background ambiance
- **Click burst effects** — Interactive ripple on every click
- **Screen shake** — Impact feedback on events
- **Score popups** — Animated point indicators

### 🔐 Admin Dashboard
- **Password protected** — Secure admin access
- **Manage games** — Edit, host, or delete saved games
- **Cloud sync** — Games persist across devices

---

## 🚀 Quick Start

### 1. Setup Configuration

```bash
cp config.example.js config.js
```

Edit `config.js` with your Supabase credentials:

```javascript
window.SB_URL = 'https://your-project.supabase.co';
window.SB_KEY = 'your-anon-key';
window.ADMIN_EMAIL = 'admin@example.com';
```

### 2. Create Supabase Tables

Run this SQL in your Supabase SQL Editor:

```sql
-- Saved Games Table
CREATE TABLE saved_games (
  id TEXT PRIMARY KEY,
  game_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE saved_games ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts/updates/deletes
CREATE POLICY "Allow all" ON saved_games FOR ALL USING (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE saved_games;

-- Storage Bucket for Images
INSERT INTO storage.buckets (id, name, public) VALUES ('kahoot-storage', 'kahoot-storage', true);

CREATE POLICY "Allow all" ON storage.objects FOR ALL USING (true);
```

### 3. Open the App

Simply open `index.html` in a browser — no build step needed!

---

## 🕹️ How to Play

### As a Host
1. Click **Create Game**
2. Add questions with answers
3. Optionally add images to questions
4. Click **Save & Host**
5. Share the 6-digit PIN with players
6. Click **Start Game** when ready

### As a Player
1. Go to the game URL
2. Enter the 6-digit PIN
3. Choose your avatar & enter your name
4. Wait for the host to start
5. Answer as fast as you can!

---

## 📁 Project Structure

```
kahoot-clone/
├── index.html          # Main HTML structure
├── style.css           # All styles & animations
├── app.js              # Application logic
├── config.example.js   # Configuration template
├── config.js           # Your local config (git-ignored)
└── README.md            # This file
```

---

## 🎨 Screenshots

| Lobby | Question | Podium |
|:---:|:---:|:---:|
| Players joining with avatars | Real-time answering | Animated celebration |

---

## 🛠️ Tech Stack

| Layer | Technology |
|------|------------|
| **Frontend** | Vanilla JS, HTML5, CSS3 |
| **Backend** | Supabase (Realtime, Auth, Storage) |
| **Images** | Supabase Storage + DiceBear API |
| **Hosting** | Any static host or local file |

---

## ⚡ Performance Notes

- **Offline mode** — Works locally with BroadcastChannel API (same device testing)
- **No build step** — Pure HTML/CSS/JS, open directly in browser
- **Responsive** — Works on desktop and mobile devices

---

<p align="center">
  <strong>Built with 💜 for fun quiz nights!</strong>
  <br />
  <sub>Star ⭐ this repo if you found it useful!</sub>
</p>