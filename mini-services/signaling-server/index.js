"use strict";

// index.ts
var peersByRoom = /* @__PURE__ */ new Map();
function getRoom(code) {
  if (!peersByRoom.has(code)) peersByRoom.set(code, /* @__PURE__ */ new Map());
  return peersByRoom.get(code);
}
function listRoomPeers(code, excludeId) {
  return Array.from(getRoom(code).entries()).filter(([id]) => id !== excludeId).map(([id, ws]) => {
    const d = ws.data;
    return { id, role: d.role, name: d.name, joinedAt: d.joinedAt };
  });
}
function broadcastPresence(code) {
  const peers = listRoomPeers(code);
  const text = JSON.stringify({ type: "presence", peers });
  getRoom(code).forEach((ws) => {
    try {
      if (ws.readyState === 1) ws.send(text);
    } catch {
    }
  });
}
function relayToRoom(code, message, excludeId) {
  getRoom(code).forEach((ws, id) => {
    if (id === excludeId) return;
    try {
      if (ws.readyState === 1) ws.send(message);
    } catch {
    }
  });
}
function joinRoom(ws, roomCode, role, name) {
  const code = roomCode.toUpperCase().trim();
  const d = ws.data;
  if (d.roomCode && d.roomCode !== code) {
    getRoom(d.roomCode).delete(d.peerId);
    relayToRoom(d.roomCode, JSON.stringify({ type: "peer-left", id: d.peerId, name: d.name }));
    broadcastPresence(d.roomCode);
  }
  d.roomCode = code;
  d.role = role;
  d.name = name;
  getRoom(code).set(d.peerId, ws);
  console.log(`[ws] ${name} (${role}) joined room ${code}`);
  const peers = listRoomPeers(code, d.peerId);
  ws.send(JSON.stringify({ type: "joined-room", peers }));
  relayToRoom(code, JSON.stringify({
    type: "peer-joined",
    id: d.peerId,
    role,
    name,
    joinedAt: d.joinedAt
  }), d.peerId);
  if (role === "customer") {
    relayToRoom(code, JSON.stringify({ type: "stream-ready", from: d.peerId }), d.peerId);
  }
  broadcastPresence(code);
}
var server = Bun.serve({
  port: 3003,
  hostname: "0.0.0.0",
  fetch(req, srv) {
    console.log(`[http] ${req.method} ${req.url} headers:`, Object.fromEntries(req.headers.entries()));
    try {
      const code = (req.headers.get("x-marqueeit-code") || "").toUpperCase().trim();
      const name = req.headers.get("x-marqueeit-name") || "";
      const role = req.headers.get("x-marqueeit-role") || "customer";
      const data = {
        role,
        name,
        roomCode: code,
        peerId: `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        joinedAt: Date.now()
      };
      const ok = srv.upgrade(req, { data });
      console.log(`[http] upgrade result: ${ok}`);
      if (ok) return;
      return new Response("hi");
    } catch (err) {
      console.error("[http] error:", err);
      return new Response("error", { status: 500 });
    }
  },
  websocket: {
    open(ws) {
      console.log("[ws] open");
      try {
        const d = ws.data;
        if (d.roomCode) {
          joinRoom(ws, d.roomCode, d.role, d.name || "Customer");
        }
      } catch (err) {
        console.error("[ws] open error:", err);
      }
    },
    message(ws, msg) {
      try {
        const d = ws.data;
        if (typeof msg === "string") {
          const m = JSON.parse(msg);
          if (m.type === "join-room" && m.roomCode) {
            joinRoom(ws, m.roomCode, m.role || "customer", m.name || "Peer");
            return;
          }
          if (m.type === "chat" && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({
              type: "chat-message",
              id: Math.random().toString(36).slice(2),
              sender: m.sender || d.name,
              content: m.content,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }), d.peerId);
            return;
          }
          if (m.type === "input-event" && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({
              type: "input-event",
              payload: m.payload || m
            }), d.peerId);
            return;
          }
          if (m.type === "annotation" && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: "annotation", ...m }), d.peerId);
            return;
          }
          if (m.type === "clear-annotations" && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: "clear-annotations" }), d.peerId);
            return;
          }
          if (m.type === "end-session" && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: "session-ended" }), d.peerId);
            return;
          }
          if (m.type === "stream-ready" && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: "stream-ready", from: d.peerId }), d.peerId);
            return;
          }
        } else {
          if (d.roomCode) {
            const u8 = new Uint8Array(msg);
            relayToRoom(d.roomCode, u8, d.peerId);
          }
        }
      } catch (err) {
        console.error("[ws] message error:", err);
      }
    },
    close(ws) {
      try {
        const d = ws.data;
        if (d.roomCode) {
          getRoom(d.roomCode).delete(d.peerId);
          relayToRoom(d.roomCode, JSON.stringify({ type: "peer-left", id: d.peerId, name: d.name }));
          broadcastPresence(d.roomCode);
          console.log(`[ws] ${d.name} left room ${d.roomCode}`);
        }
      } catch (err) {
        console.error("[ws] close error:", err);
      }
    },
    error(ws, error) {
      console.error("[ws] socket error:", error);
    }
  }
});
console.log(`Signaling server on port 3003`);
process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
