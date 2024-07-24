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

        // io.to(info1.socketId).emit("opponentInfo", info2);
        // io.to(info2.socketId).emit("opponentInfo", info1);

        room.game = new GameState(player1, player2);

        setTimeout(()=>{
          io.to(info1.socketId).emit("opponentInfo", info2);
          io.to(info2.socketId).emit("opponentInfo", info1);
        },1000) // 임시로 해결 추후 변경필요

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

  socket.on('castSkill', (data) => {
    // 스킬을 시전하는 로직
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    if (room && room.game && room.game.gameStatus === 'playing') {
      const currentPlayerId = socket.id;
      const newState = room.game.setPlayerCastSkill(currentPlayerId, data.skillType);
      io.to(roomId).emit('gameState', newState );
    }
  });

   socket.on('useSkill', (data) => {
    // 스킬을 처리하는 로직
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    if (room && room.game && room.game.gameStatus === 'skillTime') {
      const currentPlayerId = socket.id;
      console.log("skill:",data.skillType,"similarAverage:",data.similarAverage);

      if (data.skillType === 'Heal'){
        const newState = room.game.setPlayerHeal(currentPlayerId, data.similarAverage);
        io.to(roomId).emit('gameState', newState);
      }
      else{
        const newState = room.game.setPlayerUseSkill(currentPlayerId, data.skillType, data.similarAverage);
        io.to(roomId).emit('gameState', newState);
        
        setTimeout(() => {
          const returnState = room.game.setPlayerUseSkill(currentPlayerId, null, null);
          io.to(roomId).emit('gameState', returnState);
        }, 8000);
      }

    }
  });

  socket.on('start', () => {
    // 게임시작
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    if (room && room.game) {
      const newState = room.game.gameStart();
      io.to(roomId).emit('gameState', newState)
      io.to(roomId).emit('roomInfo', room);
    }
  })

  socket.on('end', () => {
    // 게임종료
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    if (room && room.game) {
      const newState = room.game.gameEnd();
      console.log(newState)
      io.to(roomId).emit('gameState', newState)
    }
  })


  socket.on('leave room', () => {
    const roomId = socket.roomId;
    if (roomId) {
      socket.leave(roomId);
      const room = rooms.get(roomId);
      if (room) {
        // 플레이어 제거
        room.players = room.players.filter(id => id !== socket.id);
        room.playerInfo = room.playerInfo.filter(info => info.socketId !== socket.id);
  
        // 방에 남은 플레이어가 없으면 방 삭제
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          // 게임 중이었다면 게임 상태 업데이트
          if (room.game && room.game.gameStatus === 'playing') {
            room.game.gameStatus = 'finished';
            room.game.winner = room.players[0]; // 남은 플레이어를 승자로 설정
            io.to(roomId).emit('gameState', room.game.getGameState());
          }
          // 남은 플레이어에게 상대방 연결 끊김 알림
          io.to(roomId).emit('opponentDisconnected', { disconnectedPlayerId: socket.id });
        }
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
      [player1Id]: { health: 100, ready: false, skill: [null, null], },
      [player2Id]: { health: 100, ready: false, skill: [null, null], }
    };
    this.gameStatus = 'waiting'; // 'waiting', 'bothReady' ,'playing', 'skillTime' ,'finished', 'replaying'
    this.winner = null;
  }

  applyDamage(playerId, amount) {
    if(this.players[playerId].skill[0] === 'Attack'){
      this.players[playerId].health -= ( amount + (amount * this.players[playerId].skill[1]) );
    }else{
      this.players[playerId].health -= amount;
    }
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

  gameEnd() {
    this.gameStatus = 'finished';
    const [player1Id, player2Id] = Object.keys(this.players);
    const player1Health = this.players[player1Id].health;
    const player2Health = this.players[player2Id].health;
    
    if (player1Health > player2Health) {
      this.winner = player1Id;
    } else if (player2Health > player1Health) {
      this.winner = player2Id;
    } 
    // else {
    //   this.winner = 'draw'; // 무승부 처리
    // } 
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

  setPlayerCastSkill(playerId, skillType) {
    this.gameStatus = 'skillTime';
    this.players[playerId].skill = [skillType,null];
    return this.getGameState();
  }
  
  setPlayerUseSkill(playerId, skillType, similarAverage) {
    this.gameStatus = 'playing';
    this.players[playerId].skill = [skillType,similarAverage];
    return this.getGameState();
  }
  
  setPlayerHeal(playerId, similarAverage) {
    this.gameStatus = 'playing';
    if (similarAverage < 0.2){
      return this.getGameState();
    }else{
      const healAmount = 10 + (10 * similarAverage);
      if (this.players[playerId].health + healAmount >= 100) {
          this.players[playerId].health = 100;
      } else {
          this.players[playerId].health += healAmount;
      }
      return this.getGameState();
    }
  }

  getGameState() {
    return {
      players: this.players,
      gameStatus: this.gameStatus,
      winner: this.winner
    };
  }
}
