const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const VALID_THEMES = ['classic', 'catdog', 'daynight', 'firewater', 'food', 'garden'];

// In-memory room state: { code: { board, turn, players: {X: socketId, O: socketId}, winner, line, rematch, theme } }
const rooms = {};

function emptyBoard() {
  return Array(9).fill(null);
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function checkWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every(Boolean)) return { winner: 'draw', line: null };
  return null;
}

function publicState(room) {
  return {
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    line: room.line,
    playersConnected: { X: !!room.players.X, O: !!room.players.O },
    rematch: room.rematch,
    theme: room.theme,
    lastMove: room.lastMove,
  };
}

function broadcast(code) {
  const room = rooms[code];
  if (room) io.to(code).emit('state', publicState(room));
}

io.on('connection', (socket) => {
  socket.data.room = null;
  socket.data.symbol = null;

  socket.on('create_room', (payload, cb) => {
    const requestedTheme = payload && payload.theme;
    const theme = VALID_THEMES.includes(requestedTheme) ? requestedTheme : 'classic';
    const code = genCode();
    rooms[code] = {
      board: emptyBoard(),
      turn: 'X',
      players: { X: socket.id, O: null },
      winner: null,
      line: null,
      rematch: { X: false, O: false },
      theme,
      lastMove: null,
    };
    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = 'X';
    cb({ ok: true, code, symbol: 'X', state: publicState(rooms[code]) });
  });

  socket.on('join_room', (code, cb) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (room.players.O) return cb({ ok: false, error: 'Room is full.' });
    room.players.O = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = 'O';
    cb({ ok: true, code, symbol: 'O', state: publicState(room) });
    broadcast(code);
  });

  socket.on('rejoin_room', ({ code, symbol } = {}, cb) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room || (symbol !== 'X' && symbol !== 'O')) {
      return cb && cb({ ok: false });
    }
    room.players[symbol] = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = symbol;
    cb && cb({ ok: true, state: publicState(room) });
    broadcast(code);
  });

  socket.on('get_state', (_, cb) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (room && cb) cb(publicState(room));
  });

  socket.on('play', (idx) => {
    const code = socket.data.room;
    const symbol = socket.data.symbol;
    const room = rooms[code];
    if (!room || room.winner) return;
    if (room.turn !== symbol) return;
    if (typeof idx !== 'number' || idx < 0 || idx > 8 || room.board[idx]) return;
    room.board[idx] = symbol;
    room.lastMove = idx;
    const result = checkWinner(room.board);
    if (result) {
      room.winner = result.winner;
      room.line = result.line;
    } else {
      room.turn = symbol === 'X' ? 'O' : 'X';
    }
    broadcast(code);
  });

  socket.on('request_rematch', () => {
    const code = socket.data.room;
    const symbol = socket.data.symbol;
    const room = rooms[code];
    if (!room || !symbol) return;
    room.rematch[symbol] = true;
    if (room.rematch.X && room.rematch.O) {
      room.board = emptyBoard();
      room.winner = null;
      room.line = null;
      room.turn = 'X';
      room.rematch = { X: false, O: false };
      room.lastMove = null;
    }
    broadcast(code);
  });

  socket.on('leave_room', () => {
    handleLeave(socket, { permanent: true });
  });

  socket.on('disconnect', () => {
    handleLeave(socket, { permanent: false });
  });

  function handleLeave(socket, { permanent }) {
    const code = socket.data.room;
    const symbol = socket.data.symbol;
    const room = rooms[code];
    if (!room) return;
    socket.leave(code);
    if (room.players[symbol] === socket.id) {
      room.players[symbol] = null;
    }
    socket.data.room = null;
    socket.data.symbol = null;
    if (permanent && !room.players.X && !room.players.O) {
      delete rooms[code];
      return;
    }
    broadcast(code);
  }
});

server.listen(PORT, () => {
  console.log(`Tic-tac-toe server running on http://localhost:${PORT}`);
});
