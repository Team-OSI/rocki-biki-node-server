const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));
let rooms = [];
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('ROOMS_UPDATE', rooms);
  socket.on('ADD_ROOM', (roomData, callback) => {
    const roomId = uuidv4();
    const newRoom = { ...roomData, roomId, participants: 0, status: '참가하기', owner: socket.id };
    rooms.push(newRoom);
    io.emit('ROOMS_UPDATE', rooms);
    callback(newRoom);
    socket.join(roomId);
    socket.roomId = roomId; // 소켓 객체에 roomId 저장
    socket.isOwner = true; // 소켓 객체에 소유자 표시
  });
  socket.on('join room', (roomId) => {
    const room = rooms.find(r => r.roomId === roomId);
    if (room && room.participants < 2) {
      room.participants += 1;
      if (room.participants === 2) {
        room.status = '경기중';
      }
      io.emit('ROOMS_UPDATE', rooms);
      socket.join(roomId);
      socket.roomId = roomId; // 소켓 객체에 roomId 저장
      socket.isOwner = false; // 참가자는 소유자가 아님
    }
  });
  socket.on('offer', (data) => {
    const { roomId, type, sdp } = data;
    socket.to(roomId).emit('offer', { offer: { type, sdp } });
  });
  socket.on('answer', (data) => {
    const { roomId, type, sdp } = data;
    socket.to(roomId).emit('answer', { answer: { type, sdp } });
  });
  socket.on('candidate', (data) => {
    const { roomId, candidate } = data;
    socket.to(roomId).emit('candidate', { candidate });
  });
  socket.on('message', (data) => {
    console.log(`Message received in room ${data.sroomId}: ${data.mesage}`);
    socket.to(data.roomId).emit('message', data);
  });
  socket.on('disconnect', () => {
    console.log('Client disconnected');
    const roomId = socket.roomId;
    if (roomId) {
      const room = rooms.find(r => r.roomId === roomId);
      if (room) {
        if (socket.isOwner) {
          // 방장이 나가면 방을 삭제
          rooms = rooms.filter(r => r.roomId !== roomId);
        } else {
          // 참가자가 나가면 참가자 수를 줄임
          room.participants -= 1;
          if (room.participants < 2) {
            room.status = '참가하기';
          }
        }
        io.emit('ROOMS_UPDATE', rooms);
      }
    }
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
