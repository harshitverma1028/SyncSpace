# SyncSpace — Real-Time Collaboration App

A student-friendly full-stack real-time collaboration application with:

- JWT authentication
- Separate login sessions per browser tab
- Room creation and room joining
- Room URL preserved through login
- Multi-user Socket.IO room presence
- WebRTC video/audio
- Screen sharing
- Real-time chat
- Encrypted file sharing (AES-256-GCM, demo limit 5 MB)
- Collaborative whiteboard
- Responsive UI

## Requirements

- Node.js 18+
- npm
- Modern browser with camera/microphone support

## Project structure

```text
RealTimeCollab-New/
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── server/
│   ├── src/
│   │   └── server.js
│   ├── .env.example
│   └── package.json
└── README.md
```

## Run backend

```bash
cd server
npm install
copy .env.example .env
npm run dev
```

On macOS/Linux:

```bash
cp .env.example .env
npm run dev
```

Backend runs on `http://localhost:3000`.

## Run frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Testing two users

1. Open the frontend.
2. Register User A.
3. Create a room.
4. Copy the room URL.
5. Open a new browser tab.
6. Open the copied room URL.
7. If login is requested, login/register as User B.
8. The original room URL is preserved after login.
9. Both users should remain in the same room.

Important: opening a new room from the landing page creates a new room. To join an existing meeting, use its copied room URL.

## Authentication note

This demo uses a per-tab storage key backed by localStorage. The tab ID itself is stored in sessionStorage. This allows:

- refresh without logging out
- different accounts in different tabs
- no shared `syncspace-auth` key between tabs

For production, replace this with secure HttpOnly cookie-based sessions.

## WebRTC note

The demo uses public STUN servers. For reliable production connectivity across restrictive NAT/firewalls, add a TURN server.

## File sharing note

Files are encrypted in the browser before being sent through Socket.IO. This is a demo architecture; for production use WebRTC DataChannels or object storage with proper access controls for larger files.
