import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import crypto from "crypto";
import mongoose from "mongoose";
import { User } from "./models/User.js";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing in server/.env");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: CLIENT_URL,
  credentials: true
}));
app.use(express.json({ limit: "8mb" }));

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 8 * 1024 * 1024
});

function publicUser(user) {
  return {
    id: user._id?.toString() || user.id,
    name: user.name,
    email: user.email
  };
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "syncspace-server" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ message: "Name, email and password are required." });
    if (password.length < 6) return res.status(400).json({ message: "Password must contain at least 6 characters." });
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ message: "An account with this email already exists." });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash });
    res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "An account with this email already exists." });
    console.error(error); res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(401).json({ message: "Invalid email or password." });
    const valid = await bcrypt.compare(String(password || ""), user.passwordHash);
    if (!valid) return res.status(401).json({ message: "Invalid email or password." });
    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    console.error(error); res.status(500).json({ message: "Login failed." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const auth = authFromRequest(req);
    if (!auth) return res.status(401).json({ message: "Unauthorized" });
    const user = await User.findById(auth.id).select("name email");
    if (!user) return res.status(401).json({ message: "User no longer exists." });
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error(error); res.status(401).json({ message: "Unauthorized" });
  }
});

function socketAuth(socket, next) {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;

    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
}

io.use(socketAuth);

const rooms = new Map();
const socketSessions = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId);
}

function leaveRoom(socket, reason = "disconnect") {
  const session = socketSessions.get(socket.id);
  if (!session) return;

  const { roomId } = session;
  const room = rooms.get(roomId);

  if (room) {
    room.delete(socket.id);

    socket.to(roomId).emit("room:user-left", {
      socketId: socket.id,
      reason
    });

    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }

  socketSessions.delete(socket.id);
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id, socket.user.name);

  socket.on("room:join", ({ roomId }) => {
    const cleanRoomId = String(roomId || "").trim();

    if (!cleanRoomId) {
      socket.emit("room:error", {
        message: "Room ID is required."
      });
      return;
    }

    // If this socket was already in another room, leave it first.
    leaveRoom(socket, "room-switch");

    const room = getRoom(cleanRoomId);

    // Existing users are sent only to the joining user.
    const existingUsers = [...room.values()].map((participant) => ({
      socketId: participant.socketId,
      userId: participant.userId,
      name: participant.name
    }));

    socket.join(cleanRoomId);

    // Register the new participant.
    const participant = {
      socketId: socket.id,
      userId: socket.user.id,
      name: socket.user.name
    };

    room.set(socket.id, participant);

    socketSessions.set(socket.id, {
      roomId: cleanRoomId,
      user: socket.user
    });

    // Tell current user about everyone already in the room.
    socket.emit("room:users", existingUsers);

    // Tell everyone else about the new user.
    socket.to(cleanRoomId).emit("room:user-joined", participant);

    console.log(
      `Room ${cleanRoomId}: ${room.size} participant(s)`
    );
  });

  socket.on("chat:message", ({ text }) => {
    const session = socketSessions.get(socket.id);
    if (!session || !text?.trim()) return;

    const message = {
      id: crypto.randomUUID(),
      senderId: socket.user.id,
      senderName: socket.user.name,
      text: text.trim().slice(0, 4000),
      createdAt: new Date().toISOString()
    };

    io.to(session.roomId).emit("chat:message", message);
  });

  socket.on("file:share", (file) => {
    const session = socketSessions.get(socket.id);
    if (!session || !file) return;

    socket.to(session.roomId).emit("file:share", {
      ...file,
      senderId: socket.user.id,
      senderName: socket.user.name
    });
  });

  socket.on("whiteboard:stroke", (stroke) => {
    const session = socketSessions.get(socket.id);
    if (!session) return;

    socket.to(session.roomId).emit(
      "whiteboard:stroke",
      stroke
    );
  });

  socket.on("whiteboard:clear", () => {
    const session = socketSessions.get(socket.id);
    if (!session) return;

    socket.to(session.roomId).emit("whiteboard:clear");
  });

  // WebRTC signaling.
  socket.on("webrtc:offer", ({ to, offer }) => {
    if (!to || !offer) return;

    io.to(to).emit("webrtc:offer", {
      from: socket.id,
      offer,
      name: socket.user.name
    });
  });

  socket.on("webrtc:answer", ({ to, answer }) => {
    if (!to || !answer) return;

    io.to(to).emit("webrtc:answer", {
      from: socket.id,
      answer
    });
  });

  socket.on("webrtc:ice-candidate", ({ to, candidate }) => {
    if (!to || !candidate) return;

    io.to(to).emit("webrtc:ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    leaveRoom(socket);
  });
});

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB connected");
    server.listen(PORT, () => console.log(`SyncSpace server running on http://localhost:${PORT}`));
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

start();
