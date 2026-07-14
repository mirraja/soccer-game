(() => {
  const ZONE_LABELS = [
    "Left Low",
    "Left High",
    "Center Low",
    "Center High",
    "Right Low",
    "Right High",
  ];

  // Grid fills row-by-row; layout is 3 columns × 2 rows (low row, then high row).
  const ZONE_LAYOUT = [0, 2, 4, 1, 3, 5];

  const $ = (id) => document.getElementById(id);

  const lobby = $("lobby");
  const gameSection = $("game");
  const setupScreen = $("setup-screen");
  const goalGridEl = $("goal-grid");
  const lobbyError = $("lobby-error");
  const playerNameInput = $("player-name");
  const roomCodeInput = $("room-code-input");
  const roomCodeDisplay = $("room-code-display");
  const playersLabel = $("players-label");
  const roundLabel = $("round-label");
  const statusLabel = $("status-label");
  const resultLabel = $("result-label");
  const homeNameEl = $("home-name");
  const awayNameEl = $("away-name");
  const homeScoreEl = $("home-score");
  const awayScoreEl = $("away-score");
  const btnPlayAgain = $("btn-play-again");

  let db = null;
  let roomRef = null;
  let roomCode = null;
  let playerId = localStorage.getItem("soccer-player-id");
  let mySide = null;
  let unsubscribe = null;
  let lastResultRound = 0;
  let resolving = false;

  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem("soccer-player-id", playerId);
  }

  const savedName = localStorage.getItem("soccer-player-name");
  if (savedName) playerNameInput.value = savedName;

  function isFirebaseConfigured() {
    return (
      typeof firebaseConfig !== "undefined" &&
      firebaseConfig.apiKey &&
      firebaseConfig.apiKey !== "YOUR_API_KEY" &&
      firebaseConfig.databaseURL &&
      !firebaseConfig.databaseURL.includes("YOUR_PROJECT_ID")
    );
  }

  function initFirebase() {
    if (!isFirebaseConfigured()) {
      lobby.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      return false;
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    return true;
  }

  function showError(msg) {
    lobbyError.textContent = msg;
    lobbyError.classList.remove("hidden");
  }

  function clearError() {
    lobbyError.classList.add("hidden");
  }

  function getPlayerName() {
    const name = playerNameInput.value.trim() || "Player";
    localStorage.setItem("soccer-player-name", name);
    return name;
  }

  function generateRoomCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function initialState(homeName) {
    return {
      playerHome: homeName,
      playerAway: null,
      playerHomeId: playerId,
      playerAwayId: null,
      score: { home: 0, away: 0 },
      round: 1,
      phase: "aim",
      shooter: "home",
      shotZone: null,
      diveZone: null,
      history: [],
      status: "playing",
      winner: null,
    };
  }

  function checkMatchEnd(score, round) {
    if (score.home === score.away) return null;
    if (round < 10) return null;
    if (round === 10) return score.home > score.away ? "home" : "away";
    if (round > 10 && round % 2 === 0) {
      return score.home > score.away ? "home" : "away";
    }
    return null;
  }

  function buildGoalZones() {
    goalGridEl.innerHTML = "";
    ZONE_LAYOUT.forEach((zoneIndex) => {
      const label = ZONE_LABELS[zoneIndex];
      const btn = document.createElement("button");
      btn.className = "zone";
      btn.type = "button";
      btn.dataset.zone = String(zoneIndex);
      btn.setAttribute("aria-label", label);
      btn.textContent = label;
      btn.addEventListener("pointerup", (e) => {
        e.preventDefault();
        handleZoneTap(zoneIndex);
      });
      goalGridEl.appendChild(btn);
    });
  }

  function renderGoalGrid(state) {
    const zones = goalGridEl.querySelectorAll(".zone");
    const amShooter = state.shooter === mySide;
    const amKeeper = mySide && state.shooter !== mySide;
    const canPick =
      state.status === "playing" &&
      state.phase === "aim" &&
      state.playerAway &&
      mySide;

    const myZone = amShooter ? state.shotZone : amKeeper ? state.diveZone : null;
    const lastEntry = state.history?.[state.history.length - 1];

    zones.forEach((zone) => {
      const i = Number(zone.dataset.zone);
      zone.className = "zone";
      const isMyPick = myZone === i;
      const isActive = canPick && ((amShooter && state.shotZone === null) || (amKeeper && state.diveZone === null));

      if (isMyPick) zone.classList.add("selected");
      if (isActive) zone.classList.add("active");

      if (lastEntry && lastEntry.round === state.round - 1) {
        if (lastEntry.shotZone === i) {
          zone.classList.add(lastEntry.scored ? "reveal-goal" : "reveal-save");
        }
        if (lastEntry.diveZone === i && !lastEntry.scored) {
          zone.classList.add("reveal-save");
        }
      }

      zone.disabled = !isActive || (amShooter && state.shotZone !== null) || (amKeeper && state.diveZone !== null);
    });
  }

  function renderScoreboard(state) {
    homeNameEl.textContent = state.playerHome || "Home";
    awayNameEl.textContent = state.playerAway || "Away";
    homeScoreEl.textContent = String(state.score?.home ?? 0);
    awayScoreEl.textContent = String(state.score?.away ?? 0);

    const homeTeam = $("scoreboard").querySelector(".score-team.home");
    const awayTeam = $("scoreboard").querySelector(".score-team.away");
    homeTeam.classList.toggle("shooting", state.shooter === "home" && state.status === "playing");
    awayTeam.classList.toggle("shooting", state.shooter === "away" && state.status === "playing");
  }

  function updateStatus(state) {
    const homeName = state.playerHome || "Home";
    const awayName = state.playerAway || "Waiting…";
    playersLabel.textContent = `${homeName} (Home) vs ${awayName} (Away)`;

    const maxRound = state.round > 10 ? state.round : 10;
    const sd = state.round > 10 ? " — Sudden death!" : "";
    roundLabel.textContent = `Round ${state.round} of ${maxRound}${sd}`;

    renderScoreboard(state);

    if (state.status === "finished") {
      if (state.winner === mySide) {
        statusLabel.textContent = "You win! 🎉";
      } else {
        statusLabel.textContent = "You lose — good game!";
      }
      resultLabel.classList.add("hidden");
      btnPlayAgain.classList.remove("hidden");
      return;
    }

    btnPlayAgain.classList.add("hidden");

    if (!state.playerAway) {
      statusLabel.textContent = "Waiting for someone to join… Share the room code!";
      resultLabel.classList.add("hidden");
      return;
    }

    const lastEntry = state.history?.[state.history.length - 1];
    if (lastEntry && lastEntry.round !== lastResultRound) {
      lastResultRound = lastEntry.round;
      resultLabel.classList.remove("hidden");
      if (lastEntry.scored) {
        resultLabel.textContent = "GOAL! ⚽";
        resultLabel.className = "result goal";
      } else {
        resultLabel.textContent = "SAVED! 🧤";
        resultLabel.className = "result save";
      }
    }

    const amShooter = state.shooter === mySide;
    const shooterName = state.shooter === "home" ? homeName : awayName;

    if (state.phase === "aim") {
      if (state.shotZone != null && state.diveZone != null) {
        statusLabel.textContent = "Scoring the round…";
        return;
      }

      if (amShooter) {
        if (state.shotZone === null) {
          statusLabel.textContent = "Your turn to shoot! Tap a zone.";
        } else {
          statusLabel.textContent = "Shot locked in — waiting for keeper…";
        }
      } else {
        if (state.diveZone === null) {
          statusLabel.textContent = `${shooterName} is shooting — pick where to dive!`;
        } else {
          statusLabel.textContent = "Dive locked in — waiting for shot…";
        }
      }
    }
  }

  function renderGame(state) {
    renderGoalGrid(state);
    updateStatus(state);
  }

  async function maybeResolveRound() {
    if (!roomRef || resolving) return;
    // Home player (game creator) resolves rounds to avoid conflicts
    if (mySide !== "home") return;

    const snap = await roomRef.once("value");
    const state = snap.val();
    if (!state || state.status !== "playing" || state.phase !== "aim") return;
    if (state.shotZone == null || state.diveZone == null) return;
    if (state.history?.some((h) => h.round === state.round)) return;

    resolving = true;
    try {
      const scored = state.shotZone !== state.diveZone;
      const newScore = { home: state.score.home, away: state.score.away };
      if (scored) newScore[state.shooter] += 1;

      const historyEntry = {
        round: state.round,
        shooter: state.shooter,
        shotZone: state.shotZone,
        diveZone: state.diveZone,
        scored,
      };
      const newHistory = [...(state.history || []), historyEntry];
      const winner = checkMatchEnd(newScore, state.round);

      if (winner) {
        await roomRef.update({
          score: newScore,
          history: newHistory,
          status: "finished",
          winner,
          phase: "finished",
        });
      } else {
        await roomRef.update({
          score: newScore,
          history: newHistory,
          round: state.round + 1,
          shooter: state.shooter === "home" ? "away" : "home",
          shotZone: null,
          diveZone: null,
          phase: "aim",
        });
      }
    } catch (err) {
      console.error("Resolve failed:", err);
    } finally {
      resolving = false;
    }
  }

  function enterGame(code, side) {
    roomCode = code;
    mySide = side;
    lastResultRound = 0;
    roomCodeDisplay.textContent = code;
    lobby.classList.add("hidden");
    gameSection.classList.remove("hidden");
    buildGoalZones();

    roomRef = db.ref(`rooms/${code}`);
    if (unsubscribe) roomRef.off("value", unsubscribe);

    unsubscribe = roomRef.on("value", (snap) => {
      const state = snap.val();
      if (!state) return;
      renderGame(state);
      maybeResolveRound();
    });
  }

  function leaveGame() {
    if (roomRef && unsubscribe) roomRef.off("value", unsubscribe);
    roomRef = null;
    roomCode = null;
    mySide = null;
    lastResultRound = 0;
    gameSection.classList.add("hidden");
    lobby.classList.remove("hidden");
    clearError();
  }

  function firebaseErrorMessage(err) {
    const code = err?.code || "";
    if (code === "PERMISSION_DENIED") {
      return "Database permission denied. In Firebase Console → Realtime Database → Rules, allow read/write for testing.";
    }
    if (code === "UNAVAILABLE" || code === "NETWORK_ERROR") {
      return "Cannot reach Firebase. Check that Realtime Database is created and databaseURL in firebase-config.js is correct.";
    }
    return "Could not connect to Firebase. Enable Realtime Database in Firebase Console and verify databaseURL.";
  }

  async function createGame() {
    clearError();
    const btn = $("btn-create");
    btn.disabled = true;
    btn.textContent = "Creating…";

    try {
      const name = getPlayerName();
      let code = generateRoomCode();
      let ref = db.ref(`rooms/${code}`);

      let existing = await ref.once("value");
      while (existing.val()) {
        code = generateRoomCode();
        ref = db.ref(`rooms/${code}`);
        existing = await ref.once("value");
      }

      await ref.set(initialState(name));
      enterGame(code, "home");
    } catch (err) {
      console.error(err);
      showError(firebaseErrorMessage(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Create new game";
    }
  }

  async function joinGame() {
    clearError();
    const code = roomCodeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      showError("Enter a valid 6-digit room code.");
      return;
    }

    const btn = $("btn-join");
    btn.disabled = true;
    btn.textContent = "Joining…";

    try {
      const name = getPlayerName();
      const ref = db.ref(`rooms/${code}`);
      const snap = await ref.once("value");
      const state = snap.val();

      if (!state) {
        showError("Room not found. Check the code and try again.");
        return;
      }

      if (state.playerHomeId === playerId) {
        enterGame(code, "home");
        return;
      }

      if (state.playerAwayId && state.playerAwayId !== playerId) {
        showError("This room is full.");
        return;
      }

      if (!state.playerAway) {
        await ref.update({
          playerAway: name,
          playerAwayId: playerId,
        });
        enterGame(code, "away");
        return;
      }

      if (state.playerAwayId === playerId) {
        enterGame(code, "away");
        return;
      }

      showError("This room is full.");
    } catch (err) {
      console.error(err);
      showError(firebaseErrorMessage(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Join game";
    }
  }

  async function handleZoneTap(zone) {
    if (!roomRef || !mySide) return;

    const snap = await roomRef.once("value");
    const state = snap.val();
    if (!state || state.status !== "playing" || state.phase !== "aim") return;
    if (!state.playerAway) return;

    const amShooter = state.shooter === mySide;
    const amKeeper = !amShooter;

    if (amShooter && state.shotZone !== null) return;
    if (amKeeper && state.diveZone !== null) return;
    if (!amShooter && !amKeeper) return;

    const updates = {};
    if (amShooter) updates.shotZone = zone;
    if (amKeeper) updates.diveZone = zone;
    await roomRef.update(updates);
    await maybeResolveRound();
  }

  async function playAgain() {
    if (!roomRef) return;
    const snap = await roomRef.once("value");
    const state = snap.val();
    if (!state) return;

    lastResultRound = 0;
    await roomRef.update({
      score: { home: 0, away: 0 },
      round: 1,
      phase: "aim",
      shooter: "home",
      shotZone: null,
      diveZone: null,
      history: [],
      status: "playing",
      winner: null,
    });
  }

  function copyRoomCode() {
    navigator.clipboard.writeText(roomCode).catch(() => {});
  }

  async function shareRoomCode() {
    const text = `Join my Penalty Shootout! Room code: ${roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Penalty Shootout", text });
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }
    copyRoomCode();
  }

  $("btn-create").addEventListener("click", createGame);
  $("btn-join").addEventListener("click", joinGame);
  $("btn-leave").addEventListener("click", leaveGame);
  $("btn-play-again").addEventListener("click", playAgain);
  $("btn-copy-code").addEventListener("click", copyRoomCode);
  $("btn-share-code").addEventListener("click", shareRoomCode);

  roomCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinGame();
  });

  if (initFirebase()) {
    buildGoalZones();
  }
})();
