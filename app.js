const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// CORS 설정
const corsOptions = {
  origin: '*', // 모든 출처를 허용
  methods: ["GET", "POST"]
};

app.use(cors(corsOptions));

const io = socketIo(server, {
  cors: {
    origin: '*', // 모든 출처를 허용
    methods: ["GET", "POST"]
  }
});

const port = 8090;

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("message", (message) => {
    io.emit("message", message);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

server.listen(port, () => console.log(`Server is running on port ${port}`));
