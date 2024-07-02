const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Next.js 클라이언트가 실행되는 주소
    methods: ["GET", "POST"]
  }
});
app.use(cors({
  origin: "*", // Next.js 클라이언트가 실행되는 주소
  methods: ["GET", "POST"],
  credentials: true
}));
io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('join room', (roomId) => {
    socket.join(roomId);
    console.log(`Client joined room: ${roomId}`);
  });
  socket.on('offer', (data) => {
    socket.to(data.roomId).emit('offer', data);
  });
  socket.on('answer', (data) => {
    socket.to(data.roomId).emit('answer', data);
  });
  socket.on('candidate', (data) => {
    socket.to(data.roomId).emit('candidate', data);
  });
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});
const PORT = process.env.PORT || 7777;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
