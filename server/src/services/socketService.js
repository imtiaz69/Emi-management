const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const User = require("../models/User");

let io;

function developmentOrigins() {
  if (process.env.NODE_ENV === "production") return [];
  return ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5175", "http://127.0.0.1:5175"];
}

function allowedOrigins() {
  return [
    ...(process.env.CLIENT_URL || "").split(",").map((value) => value.trim()).filter(Boolean),
    ...developmentOrigins()
  ];
}

function socketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  const header = socket.handshake.headers.authorization || "";
  return authToken || (header.startsWith("Bearer ") ? header.slice(7) : "");
}

function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins(),
      credentials: true,
      methods: ["GET", "POST"]
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socketToken(socket);
      if (!token) return next(new Error("Authentication required"));

      const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
      const user = await User.findById(payload.sub).select("_id role status name");
      if (!user || user.status === "suspended") return next(new Error("Account unavailable"));

      socket.data.user = {
        id: user._id.toString(),
        role: user.role,
        name: user.name
      };
      return next();
    } catch {
      return next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    socket.join(`role:${role}`);
    socket.emit("socket:ready", { connected: true, userId: id });
  });

  return io;
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return false;
  io.to(`user:${userId.toString()}`).emit(event, payload);
  return true;
}

function emitToRole(role, event, payload) {
  if (!io || !role) return false;
  io.to(`role:${role}`).emit(event, payload);
  return true;
}

function getSocketServer() {
  return io;
}

module.exports = { initializeSocket, emitToUser, emitToRole, getSocketServer };
