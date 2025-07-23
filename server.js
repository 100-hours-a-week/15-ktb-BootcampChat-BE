require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");
const { router: roomsRouter, initializeSocket } = require("./routes/api/rooms");
const routes = require("./routes");
const { redisHost, redisPort, mongo_URI_AUTH,mongo_URI_FILE,mongo_URI_MSG,mongo_URI_ROOM } = require("./config/keys");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;

// trust proxy 설정 추가
app.set("trust proxy", 1);

// CORS 설정
const corsOptions = {
  origin: [
    "https://bootcampchat-fe.run.goorm.site",
    "https://bootcampchat-hgxbv.dev-k8s.arkain.io",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "https://localhost:3000",
    "https://localhost:3001",
    "https://localhost:3002",
    "http://0.0.0.0:3000",
    "https://0.0.0.0:3000",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-auth-token",
    "x-session-id",
    "Cache-Control",
    "Pragma",
  ],
  exposedHeaders: ["x-auth-token", "x-session-id"],
};

// 기본 미들웨어
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OPTIONS 요청에 대한 처리
app.options("*", cors(corsOptions));

// 정적 파일 제공
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 요청 로깅 (개발 모드에서만)
if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
    );
    next();
  });
}

// 기본 상태 체크
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// API 라우트 마운트
app.use("/api", routes);

// Socket.IO 설정
const io = socketIO(server, { cors: corsOptions });

// // Socket.IO 객체 전달
// initializeSocket(io);

// Redis Adapter 설정
async function setupSocketIOWithRedis() {
  const pubClient = createClient({ url: `redis://${redisHost}:${redisPort}` });
  const subClient = pubClient.duplicate();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log("✅ Redis Pub/Sub 어댑터 연결 완료");

    // Socket.IO 채팅 서버 로드
    require("./sockets/chat")(io);
    initializeSocket(io);
  } catch (err) {
    console.error("❌ Redis 어댑터 연결 실패:", err);
    process.exit(1);
  }
}

setupSocketIOWithRedis();

// 404 에러 핸들러
app.use((req, res) => {
  console.log("404 Error:", req.originalUrl);
  res.status(404).json({
    success: false,
    message: "요청하신 리소스를 찾을 수 없습니다.",
    path: req.originalUrl,
  });
});

// 글로벌 에러 핸들러
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "서버 에러가 발생했습니다.",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});


const authDB = mongoose.createConnection(mongo_URI_AUTH, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const roomDB = mongoose.createConnection(mongo_URI_ROOM, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const msgDB = mongoose.createConnection(mongo_URI_MSG, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const fileDB = mongoose.createConnection(mongo_URI_FILE, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// 서버 시작
async function startServer() {
  try {
    // 여러 DB 연결
    const authDB = await mongoose.createConnection(mongo_URI_AUTH);
    const roomDB = await mongoose.createConnection(mongo_URI_ROOM);
    const msgDB = await mongoose.createConnection(mongo_URI_MSG);
    const fileDB = await mongoose.createConnection(mongo_URI_FILE);

    console.log("✅ All MongoDB connections established");

    // Redis + Socket 설정
    await setupSocketIOWithRedis();

    // 서버 시작
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log("Environment:", process.env.NODE_ENV);
      console.log("API Base URL:", `http://0.0.0.0:${PORT}/api`);
    });

    // 원한다면 app.locals에 db 연결 저장
    app.locals.dbs = { authDB, roomDB, msgDB, fileDB };
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server };
