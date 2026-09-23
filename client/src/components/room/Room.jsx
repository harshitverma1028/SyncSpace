import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Copy, File, LogOut, Mic, MicOff, MonitorUp, MoreVertical, PenLine, PhoneOff, Users, Video, VideoOff, Wifi, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { decryptFile } from "../../utils/fileCrypto";
import VideoTile from "./VideoTile";
import Control from "./Control";
import Chat from "../panels/Chat";
import FilesPanel from "../panels/FilesPanel";
import Whiteboard from "../whiteboard/Whiteboard";

export default function Room({ auth, onLogout }) {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [activePanel, setActivePanel] = useState("chat");
  const [messages, setMessages] = useState([]);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [toast, setToast] = useState("");

  const socketRef = useRef(null);
  const pcs = useRef(new Map());
  const localStreamRef = useRef(null);
  const pendingIce = useRef(new Map());

  useEffect(() => {
    if (!auth?.token) {
      // Preserve room ID. Login will return to this exact URL.
      navigate("/login", {
        state: { returnTo: `/room/${roomId}` }
      });
      return;
    }

    const socket = io("/", {
      auth: { token: auth.token }
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
      socket.emit("room:join", { roomId });
    });

    socket.on("connect_error", (error) => {
      console.error("Socket error:", error.message);
      setToast(error.message || "Socket connection failed.");
      setJoined(false);
    });

    socket.on("room:users", (users = []) => {
      console.log("Existing users:", users);
      setJoined(true);

      users.forEach((user) => createOfferTo(user));
    });

    socket.on("room:user-joined", (user) => {
      console.log("User joined:", user);

      setJoined(true);

      setPeers((prev) => {
        if (prev.some((p) => p.socketId === user.socketId)) return prev;
        return [...prev, user];
      });

      // The existing participant creates the offer.
      createOfferTo(user);
    });

    socket.on("room:user-left", ({ socketId }) => {
      removePeer(socketId);
    });

    socket.on("chat:message", (message) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on("file:share", async (file) => {
      try {
        const blob = await decryptFile(file);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setToast(`${file.senderName || "Someone"} shared ${file.name}`);
      } catch {
        setToast("Could not decrypt the shared file.");
      }
    });

    socket.on("webrtc:offer", async ({ from, offer, name }) => {
      try {
        setPeers((prev) => {
          if (prev.some((p) => p.socketId === from)) {
            return prev.map((p) =>
              p.socketId === from ? { ...p, name } : p
            );
          }
          return [...prev, { socketId: from, name }];
        });

        const pc = getPC(from);

        await pc.setRemoteDescription(
          new RTCSessionDescription(offer)
        );

        await flushPendingIce(from, pc);

        if (localStreamRef.current) {
          addLocalTracks(pc, localStreamRef.current);
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          to: from,
          answer
        });
      } catch (error) {
        console.error("Offer handling failed:", error);
      }
    });

    socket.on("webrtc:answer", async ({ from, answer }) => {
      try {
        const pc = pcs.current.get(from);
        if (!pc) return;

        await pc.setRemoteDescription(
          new RTCSessionDescription(answer)
        );

        await flushPendingIce(from, pc);
      } catch (error) {
        console.error("Answer handling failed:", error);
      }
    });

    socket.on("webrtc:ice-candidate", async ({ from, candidate }) => {
      try {
        const pc = pcs.current.get(from);
        if (!pc || !candidate) return;

        if (pc.remoteDescription) {
          await pc.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        } else {
          const list = pendingIce.current.get(from) || [];
          list.push(candidate);
          pendingIce.current.set(from, list);
        }
      } catch (error) {
        console.error("ICE error:", error);
      }
    });

    return () => {
      socket.disconnect();

      pcs.current.forEach((pc) => {
        try { pc.close(); } catch {}
      });

      pcs.current.clear();
      pendingIce.current.clear();

      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStream?.getTracks().forEach((t) => t.stop());
    };
  }, [auth?.token, roomId]);

  function addLocalTracks(pc, stream) {
    const current = new Set(
      pc.getSenders().map((s) => s.track?.id).filter(Boolean)
    );

    stream.getTracks().forEach((track) => {
      if (!current.has(track.id)) {
        pc.addTrack(track, stream);
      }
    });
  }

  function getPC(id) {
    if (pcs.current.has(id)) return pcs.current.get(id);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" }
      ]
    });

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;

      socketRef.current?.emit("webrtc:ice-candidate", {
        to: id,
        candidate: e.candidate
      });
    };

    pc.ontrack = (e) => {
      const stream = e.streams?.[0];
      if (!stream) return;

      setPeers((prev) =>
        prev.map((p) =>
          p.socketId === id ? { ...p, stream } : p
        )
      );
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        removePeer(id);
      }
    };

    pcs.current.set(id, pc);

    if (localStreamRef.current) {
      addLocalTracks(pc, localStreamRef.current);
    }

    return pc;
  }

  async function flushPendingIce(id, pc) {
    const list = pendingIce.current.get(id) || [];

    for (const candidate of list) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }

    pendingIce.current.delete(id);
  }

  async function createOfferTo(user) {
    if (!user?.socketId) return;

    setPeers((prev) => {
      if (prev.some((p) => p.socketId === user.socketId)) {
        return prev.map((p) =>
          p.socketId === user.socketId ? { ...p, ...user } : p
        );
      }
      return [...prev, user];
    });

    try {
      const pc = getPC(user.socketId);

      if (localStreamRef.current) {
        addLocalTracks(pc, localStreamRef.current);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current?.emit("webrtc:offer", {
        to: user.socketId,
        offer
      });
    } catch (error) {
      console.error("Offer creation failed:", error);
    }
  }

  function removePeer(id) {
    pcs.current.get(id)?.close();
    pcs.current.delete(id);
    pendingIce.current.delete(id);

    setPeers((prev) => prev.filter((p) => p.socketId !== id));
  }

  async function startMedia() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      // Add tracks and renegotiate with all connected peers.
      for (const [peerId, pc] of pcs.current) {
        addLocalTracks(pc, stream);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socketRef.current?.emit("webrtc:offer", {
          to: peerId,
          offer
        });
      }

      setMuted(false);
      setCameraOff(false);
      setToast("Camera and microphone connected.");
    } catch (error) {
      console.error(error);
      setToast("Camera/microphone permission was denied or unavailable.");
    }
  }

  async function toggleScreen() {
    if (screenStream) {
      await stopScreen();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });

      setScreenStream(stream);

      const track = stream.getVideoTracks()[0];

      for (const pc of pcs.current.values()) {
        const sender = pc.getSenders().find(
          (s) => s.track?.kind === "video"
        );

        if (sender) {
          await sender.replaceTrack(track);
        }
      }

      track.onended = () => stopScreen();
    } catch {
      setToast("Screen sharing was cancelled.");
    }
  }

  async function stopScreen() {
    const camera = localStreamRef.current?.getVideoTracks()[0];

    for (const pc of pcs.current.values()) {
      const sender = pc.getSenders().find(
        (s) => s.track?.kind === "video"
      );

      if (sender && camera) {
        await sender.replaceTrack(camera);
      }
    }

    screenStream?.getTracks().forEach((t) => t.stop());
    setScreenStream(null);
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach(
      (t) => (t.enabled = !next)
    );
    setMuted(next);
  }

  function toggleCamera() {
    const next = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach(
      (t) => (t.enabled = !next)
    );
    setCameraOff(next);
  }

  function sendChat(text) {
    if (!text.trim()) return;
    socketRef.current?.emit("chat:message", { text: text.trim() });
  }

  function leave() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());

    pcs.current.forEach((pc) => {
      try { pc.close(); } catch {}
    });

    socketRef.current?.disconnect();
    navigate("/");
  }

  async function copyRoomLink() {
    await navigator.clipboard?.writeText(window.location.href);
    setToast("Room link copied. Share this exact link.");
  }

  return (
    <div className="room-app">
      <header className="room-header">
        <Link to="/" className="brand">
          <span className="brand-mark"><Wifi size={17} /></span>
          <span>Sync<span>Space</span></span>
        </Link>

        <div className="room-meta">
          <span className="live-dot" />
          <b>Room</b>
          <code>{roomId}</code>
          <button className="icon-btn" onClick={copyRoomLink} title="Copy room link">
            <Copy size={15} />
          </button>
        </div>

        <div className="room-user">
          <span className="avatar">
            {auth?.user?.name?.slice(0, 2).toUpperCase()}
          </span>
          <span>{auth?.user?.name}</span>
          <button className="icon-btn" onClick={onLogout}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="room-body">
        <main className="call-area">
          <div className="call-top">
            <div>
              <span className="status-chip">
                <span className="pulse-dot" />
                {joined ? "Connected" : "Connecting"}
              </span>

              <span className="participant-count">
                <Users size={14} />
                {peers.length + 1} participants
              </span>
            </div>

            <button className="icon-btn">
              <MoreVertical size={18} />
            </button>
          </div>

          <div className={`video-grid count-${Math.min(peers.length + 1, 4)}`}>
            <VideoTile
              stream={screenStream || localStream}
              name={`${auth?.user?.name || "You"} (You)`}
              local
              muted={cameraOff}
              initials={auth?.user?.name?.slice(0, 2).toUpperCase()}
            />

            {peers.map((peer) => (
              <VideoTile
                key={peer.socketId}
                stream={peer.stream}
                name={peer.name}
                initials={peer.name?.slice(0, 2).toUpperCase()}
              />
            ))}

            {!localStream && (
              <div className="start-media-card">
                <div className="big-icon"><Video /></div>
                <h3>Ready to join?</h3>
                <p>Enable your camera and microphone to enter the call.</p>
                <button className="btn btn-primary" onClick={startMedia}>
                  <Video size={16} /> Join with camera
                </button>
              </div>
            )}
          </div>

          <div className="controls">
            <Control
              onClick={toggleMute}
              active={!muted}
              danger={muted}
              label={muted ? "Unmute" : "Mute"}
              icon={muted ? <MicOff /> : <Mic />}
            />

            <Control
              onClick={toggleCamera}
              active={!cameraOff}
              danger={cameraOff}
              label={cameraOff ? "Start video" : "Stop video"}
              icon={cameraOff ? <VideoOff /> : <Video />}
            />

            <Control
              onClick={toggleScreen}
              active={!!screenStream}
              label={screenStream ? "Stop share" : "Share screen"}
              icon={<MonitorUp />}
            />

            <Control
              onClick={() => setWhiteboardOpen(true)}
              label="Whiteboard"
              icon={<PenLine />}
            />

            <Control
              onClick={() => setActivePanel(activePanel === "chat" ? "files" : "chat")}
              label="Files & chat"
              icon={<File />}
            />

            <button className="leave-btn" onClick={leave}>
              <PhoneOff size={18} />
              <span>Leave</span>
            </button>
          </div>
        </main>

        <aside className="side-panel">
          <div className="panel-tabs">
            <button
              className={activePanel === "chat" ? "active" : ""}
              onClick={() => setActivePanel("chat")}
            >
              Chat
            </button>

            <button
              className={activePanel === "files" ? "active" : ""}
              onClick={() => setActivePanel("files")}
            >
              Files
            </button>
          </div>

          {activePanel === "chat" ? (
            <Chat messages={messages} onSend={sendChat} me={auth?.user?.id} />
          ) : (
            <FilesPanel socket={socketRef.current} onToast={setToast} />
          )}
        </aside>
      </div>

      {whiteboardOpen && (
        <Whiteboard
          socket={socketRef.current}
          onClose={() => setWhiteboardOpen(false)}
        />
      )}

      {toast && (
        <div className="toast">
          {toast}
          <button onClick={() => setToast("")}><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

