const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();
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

let rooms = new Map();

io.on('connection', (socket) => {
  console.log('Client connected : ', socket.id); 
  const roomsObject = Object.fromEntries(rooms);
  socket.emit('ROOMS_UPDATE', roomsObject); // 처음에 로비에서 게임룸 업데이트

  socket.on('ADD_ROOM', (roomData, callback) => {
    // 게임룸 생성
    const roomId = uuidv4();
    const newRoom = { ...roomData, players: [], playerInfo: [], game: null, owner: socket.id };
    rooms.set(roomId, newRoom);
    
    callback(roomId);
    socket.join(roomId);
    socket.roomId = roomId; // 소켓 객체에 roomId 저장
    socket.isOwner = true; // 소켓 객체에 소유자 표시
    // Map을 객체로 변환하여 전송
    const roomsObject = Object.fromEntries(rooms);
    io.emit('ROOMS_UPDATE', roomsObject);

  });

  socket.on('join room', (roomId, email, nickname, image) => {
    // 게임룸 입장
    const room = rooms.get(roomId);
    const roomsObject = Object.fromEntries(rooms);
    if (room && room.players.length < 2) {
      room.players.push(socket.id);
      room.playerInfo.push({ socketId: socket.id, email, nickname, image });
      socket.join(roomId)
      socket.roomId = roomId; // 소켓 객체에 roomId 저장
      socket.isOwner = socket.id === room.owner;

      if (room.players.length === 2){
        const [player1, player2] = room.players;
        const [info1, info2] = room.playerInfo;

        io.to(info1.socketId).emit("opponentInfo", info2);
        io.to(info2.socketId).emit("opponentInfo", info1);

        room.game = new GameState(player1, player2);
        io.to(roomId).emit('gameState', room.game.getGameState());
      }
      io.emit('ROOMS_UPDATE', roomsObject); // 로비 게임룸 정보 업데이트
    }
  });

  socket.on('ready', (data)=> {
    // 준비상태관리
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    if (room && room.game) {
      const newState = room.game.setPlayerReady(socket.id, data.state);
      console.log(newState)
      io.to(roomId).emit('gameState', newState)
    }
  });

  socket.on('attackDamage', (data) => {
    // 데미지를 처리하는 로직
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    if (room && room.game && room.game.gameStatus === 'playing') {
      const targetPlayerId = room.players.find(id => id !== socket.id);
      const newState = room.game.applyDamage(targetPlayerId, data.amount);
      io.to(roomId).emit('gameState', newState)
    }
  });

  socket.on('castSkill', ({ roomId, skillType }) => {
    const room = rooms.get(roomId);
    if (room && room.game && room.game.gameStatus === 'playing') {
      io.to(roomId).emit('opponentSkillUsed', { skillType: skillType });
    }
  });

  // socket.on('castSkill', ({ skillType }) => {
  //   const roomId = socket.roomId;
  //   const room = rooms.get(roomId);
  //   if (room && room.game && room.game.gameStatus === 'playing') {
  //     io.to(roomId).emit('opponentSkillUsed', { skillType: skillType });
  //   }
  // }) 

  socket.on('start', () => {
    // 게임시작
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    if (room && room.game) {
      const newState = room.game.gameStart();
      io.to(roomId).emit('gameState', newState)
    }
  })


  socket.on('leave room', () => {
    const roomId = socket.roomId;
    if (roomId) {
      socket.leave(roomId);
      const room = rooms.get(roomId);
      if (room) {
        room.players = room.players.filter(playerId => playerId !== socket.id);

        if (socket.isOwner) {
          const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
          if (socketsInRoom) {
            socketsInRoom.forEach(socketId => {
              const clientSocket = io.sockets.sockets.get(socketId);
              if (clientSocket) {
                clientSocket.leave(roomId);
                clientSocket.emit('ROOM_CLOSE');
              }
            });
          }
          rooms.delete(roomId);
        } else if (room.players.length === 0) {
          rooms.delete(roomId);
        }

        const roomsObject = Object.fromEntries(rooms);
        io.emit('ROOMS_UPDATE', roomsObject);
        socket.to(roomId).emit('user_left', { userId: socket.id });
      }
    }
  });

  // webRTC 연결관련
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

  // socket.on('damage', (data) => {
  //   if (data.roomId) {
  //     console.log('damage: ', data.amount, data.socketId)
  //     socket.to(data.roomId).emit('damage', { amount: data.amount, socketId: data.socketId });
  //   }
  // });


  // socket.on('ready', (data) => {
  //   const { roomId, state } = data;
  //   if (roomId) {
  //     console.log('ready: ',roomId, state)
  //     socket.to(roomId).emit('opponentIsReady', state);
  //   }
  // });

});


const PORT = process.env.PORT || 7777;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


class GameState {
  constructor(player1Id, player2Id) {
    this.players = {
      [player1Id]: { health: 100, ready: false, skill: [null, null]},
      [player2Id]: { health: 100, ready: false, skill: [null, null]}
    };
    this.gameStatus = 'waiting'; // 'waiting', 'bothReady' ,'playing', 'skillTime' ,'finished', 'replaying'
    this.winner = null;
  }

  applyDamage(playerId, amount) {
    this.players[playerId].health -= amount;
    if (this.players[playerId].health <= 0) {
      this.gameStatus = 'finished';
      this.winner = Object.keys(this.players).find(id => id !== playerId);
    }
    return this.getGameState();
  }

  gameStart(){
      this.gameStatus = 'playing';
      this.winner = null;
      return this.getGameState();
  }

  setPlayerReady(playerId, state) {
    this.players[playerId].ready = state;
    if (Object.values(this.players).every(player => player.ready)) {
      this.gameStatus = 'bothReady';
    } else {
      this.gameStatus = 'waiting'
    }
    return this.getGameState();
  }

  getGameState() {
    return {
      players: this.players,
      gameStatus: this.gameStatus,
      winner: this.winner
    };
  }
}
