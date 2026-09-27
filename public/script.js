(function () {
  const app = document.getElementById('app');
  const socket = io();

  const THEMES = {
    classic:   { name: 'Hugs & Kisses', marks: { X: '🤗', O: '😘' }, win: 'The board belongs to you!', draw: 'Nobody won. Everybody cooked.', block: 'Not today.', center: 'Bold choice.' },
    catdog:    { name: 'Cats & Dogs',   marks: { X: '🐱', O: '🐶' }, win: 'Territory claimed!', draw: 'A cease-fire, for now.', block: 'Hiss. Blocked.', center: 'Claiming the middle.' },
    daynight:  { name: 'Day & Night',   marks: { X: '🌞', O: '🌙' }, win: 'The sky is yours!', draw: 'Dawn and dusk, evenly matched.', block: 'Eclipsed.', center: 'Rising to the center.' },
    firewater: { name: 'Fire & Water',  marks: { X: '🔥', O: '💧' }, win: 'Element mastered!', draw: 'Steam. Just steam.', block: 'Doused.', center: 'Igniting the middle.' },
    food:      { name: 'Pizza & Burgers', marks: { X: '🍕', O: '🍔' }, win: 'Lunch has been decided!', draw: "Guess we're ordering both.", block: 'Order denied.', center: 'Taking the best slice.' },
    garden:    { name: 'Garden Grower', marks: { X: '🌱', O: '🌸' }, win: 'The garden is yours!', draw: 'A well-tended tie.', block: 'Pruned.', center: 'Planting in the middle.' },
  };
  const STORAGE_KEY = 'ttt_session';

  let mySymbol = null;
  let roomCode = null;
  let latestState = null;
  let syncTimer = null;
  let hasConnectedBefore = false;
  let selectedTheme = 'classic';

  // Local tracking for animation/commentary diffing (never trust these for
  // game logic — only for deciding what to animate/announce on this client).
  let prevBoard = emptyBoard();
  let lastAnnouncedMoveCount = 0;
  let winCelebrated = false;

  function emptyBoard() { return Array(9).fill(null); }
  function themeOf(state) { return THEMES[(state && state.theme) || 'classic'] || THEMES.classic; }

  function saveSession() {
    if (roomCode && mySymbol) {
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code: roomCode, symbol: mySymbol })); }
      catch (e) { /* ignore */ }
    }
  }
  function clearSession() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }
  function loadSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function startSync() {
    stopSync();
    syncTimer = setInterval(() => {
      socket.emit('get_state', null, (state) => { if (state) renderBoard(state); });
    }, 2000);
  }
  function stopSync() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  function renderHome(errorMsg) {
    stopSync();
    roomCode = null;
    mySymbol = null;
    clearSession();
    const themeCards = Object.entries(THEMES).map(([id, t]) => `
      <button class="theme-btn ${id === selectedTheme ? 'selected' : ''}" data-theme="${id}">
        <span class="theme-marks">${t.marks.X}${t.marks.O}</span>
        <span class="theme-name">${t.name}</span>
      </button>`).join('');
    app.innerHTML = `
      <div class="screen">
        <div class="card">
          <h1>Tic-tac-toe</h1>
          <p class="sub">Play with a friend, live, from anywhere</p>
          <p class="sub" style="margin-bottom:8px">Choose a theme</p>
          <div class="theme-grid">${themeCards}</div>
          <button class="primary-btn" id="createBtn">Create a room</button>
        </div>
        <div class="card">
          <p class="sub" style="margin-bottom:8px">Have a room code?</p>
          <input type="text" id="joinInput" maxlength="4" placeholder="CODE" />
          <button class="primary-btn" id="joinBtn">Join room</button>
          <p class="error-text" id="joinError">${errorMsg || ''}</p>
        </div>
      </div>`;
    app.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.onclick = () => {
        selectedTheme = btn.dataset.theme;
        app.querySelectorAll('.theme-btn').forEach((b) => b.classList.toggle('selected', b === btn));
      };
    });
    document.getElementById('createBtn').onclick = createRoom;
    document.getElementById('joinBtn').onclick = joinRoom;
    document.getElementById('joinInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinRoom();
    });
  }

  function createRoom() {
    socket.emit('create_room', { theme: selectedTheme }, (res) => {
      if (!res.ok) return renderHome('Could not create a room. Try again.');
      roomCode = res.code;
      mySymbol = res.symbol;
      latestState = res.state;
      resetLocalTracking(res.state);
      saveSession();
      renderGame();
    });
  }

  function joinRoom() {
    const input = document.getElementById('joinInput');
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) {
      document.getElementById('joinError').textContent = 'Enter a 4-character code.';
      return;
    }
    socket.emit('join_room', code, (res) => {
      if (!res.ok) {
        document.getElementById('joinError').textContent = res.error;
        return;
      }
      roomCode = res.code;
      mySymbol = res.symbol;
      latestState = res.state;
      resetLocalTracking(res.state);
      saveSession();
      renderGame();
    });
  }

  function leaveRoom() {
    socket.emit('leave_room');
    renderHome();
  }

  function resetLocalTracking(state) {
    prevBoard = state ? state.board.slice() : emptyBoard();
    lastAnnouncedMoveCount = state ? state.board.filter(Boolean).length : 0;
    winCelebrated = !!(state && state.winner);
  }

  function renderGame() {
    const theme = themeOf(latestState);
    app.innerHTML = `
      <div class="screen">
        <div class="room-code">${roomCode}</div>
        <p class="sub" style="margin-top:-8px">Share this code with your opponent · ${theme.name}</p>
        <div class="players">
          <span>You are: <span class="you-badge">${theme.marks[mySymbol]}</span></span>
          <span id="oppStatus"><span class="conn-dot" id="oppDot"></span>Waiting for opponent…</span>
        </div>
        <div class="status" id="statusLine"></div>
        <div class="flavor" id="flavorLine"></div>
        <div class="board-wrap">
          <div class="board" id="board"></div>
          <div class="confetti-layer" id="confettiLayer"></div>
        </div>
        <button class="primary-btn" id="newGameBtn" style="display:none;">Play again</button>
        <button class="secondary-btn" id="leaveBtn">Leave room</button>
      </div>`;
    document.getElementById('leaveBtn').onclick = leaveRoom;
    document.getElementById('newGameBtn').onclick = () => socket.emit('request_rematch');
    renderBoard(latestState);
    startSync();
  }

  function showFlavor(text) {
    const el = document.getElementById('flavorLine');
    if (!el || !text) return;
    el.textContent = text;
    el.classList.remove('flavor-show');
    void el.offsetWidth; // restart animation
    el.classList.add('flavor-show');
  }

  function isBlockingMove(board, idx, mover) {
    const opponent = mover === 'X' ? 'O' : 'X';
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return lines.some(line => {
      if (!line.includes(idx)) return false;
      const others = line.filter(i => i !== idx);
      return others.every(i => board[i] === opponent);
    });
  }

  function spawnConfetti(marks) {
    const layer = document.getElementById('confettiLayer');
    if (!layer) return;
    const symbols = [marks.X, marks.O, '✨', '🎉'];
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('span');
      el.className = 'confetti-piece';
      el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      el.style.left = (10 + Math.random() * 80) + '%';
      el.style.animationDelay = (Math.random() * 0.3) + 's';
      el.style.animationDuration = (0.9 + Math.random() * 0.6) + 's';
      layer.appendChild(el);
      setTimeout(() => el.remove(), 1800);
    }
  }

  function renderBoard(state) {
    if (!state || !document.getElementById('board')) return;
    const prevWinner = latestState ? latestState.winner : null;
    latestState = state;
    const theme = themeOf(state);
    const boardEl = document.getElementById('board');
    const oppStatus = document.getElementById('oppStatus');
    const statusEl = document.getElementById('statusLine');
    const newGameBtn = document.getElementById('newGameBtn');

    const bothIn = state.playersConnected.X && state.playersConnected.O;
    oppStatus.innerHTML = `<span class="conn-dot ${bothIn ? 'on' : ''}"></span>${bothIn ? 'Opponent connected' : 'Waiting for opponent…'}`;

    // Figure out what changed since our last render, purely for
    // animation/commentary — never used to decide game outcomes.
    const filledCount = state.board.filter(Boolean).length;
    let newIdx = -1;
    for (let i = 0; i < 9; i++) {
      if (!prevBoard[i] && state.board[i]) { newIdx = i; break; }
    }

    const winLine = state.line || [];
    boardEl.innerHTML = state.board.map((v, i) => {
      const playable = !v && !state.winner && bothIn && state.turn === mySymbol;
      const isWin = winLine.includes(i);
      const isNew = i === newIdx && filledCount > lastAnnouncedMoveCount;
      const cls = ['cell', playable ? 'playable' : '', isWin ? 'win' : '', isNew ? 'just-placed' : ''].filter(Boolean).join(' ');
      const mark = v ? theme.marks[v] : '';
      return `<div class="${cls}" data-idx="${i}">${mark}</div>`;
    }).join('');
    boardEl.querySelectorAll('.cell.playable').forEach((el) => {
      el.onclick = () => socket.emit('play', parseInt(el.dataset.idx, 10));
    });

    // Contextual commentary, kept occasional on purpose.
    if (filledCount > lastAnnouncedMoveCount && newIdx !== -1) {
      const mover = state.board[newIdx];
      if (newIdx === 4 && filledCount === 1) {
        showFlavor(theme.center);
      } else if (isBlockingMove(prevBoard, newIdx, mover)) {
        showFlavor(theme.block);
      }
    }

    if (!bothIn) {
      statusEl.textContent = 'Waiting for your opponent to join…';
    } else if (state.winner === 'draw') {
      statusEl.textContent = "It's a draw!";
      if (!winCelebrated) showFlavor(theme.draw);
    } else if (state.winner) {
      if (state.winner === mySymbol) {
        statusEl.textContent = 'You win!';
        if (!winCelebrated) showFlavor(theme.win);
      } else {
        statusEl.textContent = 'So close — rematch?';
        if (!winCelebrated) showFlavor(`${theme.marks[state.winner]} got there first.`);
      }
      if (!winCelebrated) spawnConfetti(theme.marks);
    } else {
      statusEl.textContent = state.turn === mySymbol ? 'Your turn' : "Opponent's turn";
    }

    if (state.winner && !prevWinner) winCelebrated = true;
    if (!state.winner) winCelebrated = false;

    prevBoard = state.board.slice();
    lastAnnouncedMoveCount = Math.max(lastAnnouncedMoveCount, filledCount);
    if (!state.winner && filledCount === 0) lastAnnouncedMoveCount = 0; // rematch reset

    newGameBtn.style.display = state.winner ? 'block' : 'none';
    if (state.winner) {
      newGameBtn.textContent = state.rematch[mySymbol] ? 'Waiting for opponent…' : 'Play again';
    }
  }

  socket.on('state', (state) => {
    if (roomCode) renderBoard(state);
  });

  socket.on('connect', () => {
    if (!hasConnectedBefore) {
      hasConnectedBefore = true;
      const saved = loadSession();
      if (saved && saved.code && saved.symbol) {
        socket.emit('rejoin_room', saved, (res) => {
          if (res && res.ok) {
            roomCode = saved.code;
            mySymbol = saved.symbol;
            latestState = res.state;
            resetLocalTracking(res.state);
            renderGame();
          } else {
            renderHome();
          }
        });
      } else {
        renderHome();
      }
      return;
    }
    if (roomCode && mySymbol) {
      socket.emit('rejoin_room', { code: roomCode, symbol: mySymbol }, (res) => {
        if (res && res.ok) renderBoard(res.state);
      });
    }
  });
})();
