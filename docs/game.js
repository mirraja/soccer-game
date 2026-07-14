(() => {
  const GOAL = { left: 10, top: 5, width: 80, height: 34 };
  const SAVE_RADIUS = 14;
  const ANIM_MS = 1500;

  const ZONE_SCENE_POS = {
    0: { left: 22, top: 54 },
    1: { left: 22, top: 34 },
    2: { left: 50, top: 54 },
    3: { left: 50, top: 34 },
    4: { left: 78, top: 54 },
    5: { left: 78, top: 34 },
  };

  const $ = (id) => document.getElementById(id);

  const lobby = $("lobby");
  const gameSection = $("game");
  const setupScreen = $("setup-screen");
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
  const pitchScene = $("pitch-scene");
  const goalTouchZone = $("goal-touch-zone");
  const shotMarker = $("shot-marker");

  let db = null;
  let roomRef = null;
  let roomCode = null;
  let playerId = sessionStorage.getItem("soccer-player-id");
  let mySide = null;
  let unsubscribe = null;
  let lastResultRound = 0;
  let lastAnimatedRound = 0;
  let resolving = false;
  let animating = false;
  let pitchInputReady = false;
  let keeperDragging = false;
  let previewDive = null;
  let lastWindUpRound = 0;

  if (!playerId) {
    playerId = crypto.randomUUID();
    sessionStorage.setItem("soccer-player-id", playerId);
  }

  const savedName = localStorage.getItem("soccer-player-name");
  if (savedName) playerNameInput.value = savedName;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

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
      phase: "shoot",
      shooter: "home",
      shotX: null,
      shotY: null,
      diveX: null,
      diveY: null,
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

  function goalToPitch(x, y) {
    return {
      left: GOAL.left + (x / 100) * GOAL.width,
      top: GOAL.top + (y / 100) * GOAL.height,
    };
  }

  function pitchToGoal(left, top) {
    return {
      x: clamp(((left - GOAL.left) / GOAL.width) * 100, 4, 96),
      y: clamp(((top - GOAL.top) / GOAL.height) * 100, 4, 96),
    };
  }

  function getShotCoords(state) {
    if (state.shotX != null && state.shotY != null) {
      return { x: state.shotX, y: state.shotY };
    }
    if (state.shotZone != null && ZONE_SCENE_POS[state.shotZone]) {
      const p = ZONE_SCENE_POS[state.shotZone];
      return pitchToGoal(p.left, p.top);
    }
    return null;
  }

  function getDiveCoords(state) {
    if (state.diveX != null && state.diveY != null) {
      return { x: state.diveX, y: state.diveY };
    }
    if (state.diveZone != null && ZONE_SCENE_POS[state.diveZone]) {
      const p = ZONE_SCENE_POS[state.diveZone];
      return pitchToGoal(p.left, p.top);
    }
    return null;
  }

  function getPhase(state) {
    if (state.shotX != null && state.diveX == null) return "dive";
    if (state.shotX == null && state.diveX == null) return "shoot";
    if (state.phase === "dive" || state.phase === "shoot") return state.phase;
    if (state.phase === "aim") {
      if (state.shotX != null && state.diveX == null) return "dive";
      return "shoot";
    }
    return "shoot";
  }

  function isScored(shotX, shotY, diveX, diveY) {
    return Math.hypot(shotX - diveX, shotY - diveY) > SAVE_RADIUS;
  }

  function getGoalPercent(clientX, clientY) {
    const rect = goalTouchZone.getBoundingClientRect();
    return {
      x: clamp(((clientX - rect.left) / rect.width) * 100, 4, 96),
      y: clamp(((clientY - rect.top) / rect.height) * 100, 4, 96),
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function positionKeeperInGoal(x, y) {
    const keeper = $("scene-keeper");
    if (!keeper) return;
    keeper.style.left = `${x}%`;
    keeper.style.top = `${y}%`;
    keeper.style.bottom = "auto";
    keeper.style.transform = "translate(-50%, -55%)";
  }

  function showShotMarker(x, y) {
    if (!shotMarker) return;
    shotMarker.classList.remove("hidden");
    shotMarker.style.left = `${x}%`;
    shotMarker.style.top = `${y}%`;
  }

  function hideShotMarker() {
    shotMarker?.classList.add("hidden");
  }

  function clearKickHints() {
    const shooter = $("scene-shooter");
    shooter?.classList.remove(
      "wind-up", "hint-left", "hint-right", "hint-center", "hint-high", "hint-low"
    );
  }

  function applyKickWindUp(state) {
    const { amKeeper } = getRole(state);
    if (!amKeeper || getPhase(state) !== "dive") {
      clearKickHints();
      pitchScene?.classList.remove("keeper-react");
      return;
    }
    const shot = getShotCoords(state);
    if (!shot) return;

    pitchScene?.classList.add("keeper-react");

    const shooter = $("scene-shooter");
    if (!shooter) return;
    clearKickHints();
    shooter.classList.remove("idle");
    shooter.classList.add("wind-up");
    if (shot.x < 34) shooter.classList.add("hint-left");
    else if (shot.x > 66) shooter.classList.add("hint-right");
    else shooter.classList.add("hint-center");
    if (shot.y < 42) shooter.classList.add("hint-high");
    else shooter.classList.add("hint-low");
  }

  function resetScene() {
    if (!pitchScene) return;
    const ball = $("scene-ball");
    const keeper = $("scene-keeper");
    const shooter = $("scene-shooter");
    const burst = $("action-burst");
    const goal3d = pitchScene.querySelector(".goal-3d");

    ball.className = "scene-ball";
    ball.style.left = "50%";
    ball.style.top = "auto";
    ball.style.bottom = "8%";

    keeper.className = "scene-keeper idle";
    positionKeeperInGoal(50, 92);

    shooter.className = "scene-shooter idle";
    clearKickHints();
    pitchScene.classList.remove("simulating", "is-goal", "is-save");
    goal3d?.classList.remove("goal-shake");
    burst.classList.add("hidden");
    burst.className = "action-burst hidden";
    burst.textContent = "";
    hideShotMarker();
    previewDive = null;
    keeperDragging = false;
  }

  async function playActionAnimation(entry, state) {
    if (animating || entry.round === lastAnimatedRound) return;
    animating = true;
    lastAnimatedRound = entry.round;

    const ball = $("scene-ball");
    const keeper = $("scene-keeper");
    const shooter = $("scene-shooter");
    const burst = $("action-burst");
    const goal3d = pitchScene?.querySelector(".goal-3d");
    const shot = { x: entry.shotX, y: entry.shotY };
    const dive = { x: entry.diveX, y: entry.diveY };
    if (!ball || !keeper || !shooter) {
      animating = false;
      return;
    }

    const shotPitch = goalToPitch(shot.x, shot.y);

    pitchScene.classList.add("simulating");
    pitchScene.classList.toggle("shooter-home", entry.shooter === "home");
    pitchScene.classList.toggle("shooter-away", entry.shooter === "away");

    shooter.classList.remove("idle");
    shooter.classList.add("kick");
    await delay(200);

    ball.classList.add("fly");
    ball.style.bottom = "auto";
    ball.style.left = `${shotPitch.left}%`;
    ball.style.top = `${shotPitch.top}%`;

    keeper.classList.remove("idle", "dragging");
    keeper.classList.add("dive");
    positionKeeperInGoal(dive.x, dive.y);

    await delay(600);

    if (entry.scored) {
      pitchScene.classList.add("is-goal");
      goal3d?.classList.add("goal-shake");
      burst.textContent = "GOAL! ⚽";
      burst.className = "action-burst goal-text";
    } else {
      pitchScene.classList.add("is-save");
      ball.classList.add("save-bounce");
      burst.textContent = "SAVED! 🧤";
      burst.className = "action-burst save-text";
    }

    await delay(ANIM_MS);
    resetScene();
    animating = false;
    if (state) renderGame(state);
  }

  function getRole(state) {
    const amShooter = state.shooter === mySide;
    const amKeeper = Boolean(mySide && state.shooter && state.shooter !== mySide);
    return { amShooter, amKeeper };
  }

  function canShooterPick(state) {
    const { amShooter } = getRole(state);
    return (
      !animating &&
      state.status === "playing" &&
      getPhase(state) === "shoot" &&
      state.playerAway &&
      amShooter &&
      state.shotX == null
    );
  }

  function canKeeperDive(state) {
    const { amKeeper } = getRole(state);
    return (
      !animating &&
      state.status === "playing" &&
      getPhase(state) === "dive" &&
      state.playerAway &&
      amKeeper &&
      state.diveX == null &&
      state.shotX != null
    );
  }

  function renderPitchInteraction(state) {
    if (!pitchScene) return;

    const phase = getPhase(state);
    pitchScene.classList.toggle("phase-shoot", phase === "shoot");
    pitchScene.classList.toggle("phase-dive", phase === "dive");

    if (animating) return;
    pitchScene.setAttribute("aria-hidden", "false");
    pitchScene.classList.toggle("shooter-home", state.shooter === "home");
    pitchScene.classList.toggle("shooter-away", state.shooter === "away");

    const { amShooter, amKeeper } = getRole(state);

    goalTouchZone.className = "goal-touch-zone";
    $("scene-keeper")?.classList.remove("locked");

    if (canShooterPick(state)) {
      goalTouchZone.classList.add("shooter-active");
    } else if (canKeeperDive(state)) {
      goalTouchZone.classList.add("keeper-active", "keeper-mode");
    } else {
      goalTouchZone.classList.add("locked");
      $("scene-keeper")?.classList.add("locked");
    }

    const shot = getShotCoords(state);
    if (amShooter && shot) {
      showShotMarker(shot.x, shot.y);
      clearKickHints();
    } else {
      hideShotMarker();
      if (amKeeper && phase === "dive") applyKickWindUp(state);
      else if (!amKeeper) clearKickHints();
    }

    const dive = previewDive || getDiveCoords(state);
    if (dive) positionKeeperInGoal(dive.x, dive.y);
    else if (!keeperDragging) positionKeeperInGoal(50, 92);
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

    if (animating) {
      statusLabel.textContent = "Watch the action! ⚽";
      return;
    }

    if (state.status === "finished") {
      statusLabel.textContent = state.winner === mySide ? "You win! 🎉" : "You lose — good game!";
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
    if (lastEntry && lastEntry.round !== lastAnimatedRound && !animating) {
      playActionAnimation(lastEntry, state);
    }
    if (lastEntry && lastEntry.round !== lastResultRound) {
      lastResultRound = lastEntry.round;
      resultLabel.classList.remove("hidden");
      resultLabel.textContent = lastEntry.scored ? "GOAL! ⚽" : "SAVED! 🧤";
      resultLabel.className = lastEntry.scored ? "result goal" : "result save";
    }

    const { amShooter, amKeeper } = getRole(state);
    const shooterName = state.shooter === "home" ? homeName : awayName;

    const phase = getPhase(state);

    if (state.status === "playing" && state.playerAway) {
      if (phase === "shoot") {
        if (amShooter) {
          statusLabel.textContent = "Tap the goal to pick your target (only you see it).";
        } else if (amKeeper) {
          statusLabel.textContent = "Watch the shooter… get ready to read the kick!";
        } else {
          statusLabel.textContent = `${shooterName} is lining up the shot…`;
        }
        return;
      }
      if (phase === "dive") {
        if (amShooter) {
          statusLabel.textContent = "Target locked — waiting for the keeper to react.";
        } else if (amKeeper) {
          statusLabel.textContent =
            state.diveX == null
              ? "Read the leg movement — drag to dive!"
              : "Dive locked — resolving…";
        } else {
          statusLabel.textContent = `${shooterName} shot — keeper is deciding…`;
        }
        return;
      }
    }
  }

  function renderGame(state) {
    renderPitchInteraction(state);
    updateStatus(state);
  }

  async function maybeResolveRound() {
    if (!roomRef || resolving) return;

    resolving = true;
    try {
      const result = await roomRef.transaction((state) => {
        if (!state || state.status !== "playing" || getPhase(state) !== "dive") return;
        if (state.shotX == null || state.shotY == null || state.diveX == null || state.diveY == null) return;
        if (state.history?.some((h) => h.round === state.round)) return;

        const scored = isScored(state.shotX, state.shotY, state.diveX, state.diveY);
        const newScore = { home: state.score.home, away: state.score.away };
        if (scored) newScore[state.shooter] += 1;

        const historyEntry = {
          round: state.round,
          shooter: state.shooter,
          shotX: state.shotX,
          shotY: state.shotY,
          diveX: state.diveX,
          diveY: state.diveY,
          scored,
        };
        const newHistory = [...(state.history || []), historyEntry];
        const winner = checkMatchEnd(newScore, state.round);

        if (winner) {
          return {
            ...state,
            score: newScore,
            history: newHistory,
            status: "finished",
            winner,
            phase: "finished",
          };
        }

        return {
          ...state,
          score: newScore,
          history: newHistory,
          round: state.round + 1,
          shooter: state.shooter === "home" ? "away" : "home",
          shotX: null,
          shotY: null,
          diveX: null,
          diveY: null,
          phase: "shoot",
        };
      });

      if (result.committed && result.snapshot.val()) {
        lastWindUpRound = 0;
      }
    } catch (err) {
      console.error("Resolve failed:", err);
    } finally {
      resolving = false;
    }
  }

  async function submitShot(x, y) {
    if (!roomRef) return;
    try {
      await roomRef.update({ shotX: x, shotY: y, phase: "dive" });
    } catch (err) {
      console.error(err);
      hideShotMarker();
      statusLabel.textContent = firebaseErrorMessage(err);
    }
  }

  async function submitDive(x, y) {
    if (!roomRef) return;
    try {
      await roomRef.update({ diveX: x, diveY: y });
      previewDive = null;
      await maybeResolveRound();
    } catch (err) {
      console.error(err);
      statusLabel.textContent = firebaseErrorMessage(err);
    }
  }

  function setupPitchInput() {
    if (pitchInputReady || !goalTouchZone) return;
    pitchInputReady = true;

    const keeper = $("scene-keeper");

    function onGoalPointerDown(e) {
      if (!roomRef || animating) return;
      roomRef.once("value").then((snap) => {
        const state = snap.val();
        const pos = getGoalPercent(e.clientX, e.clientY);

        if (canShooterPick(state)) {
          showShotMarker(pos.x, pos.y);
          submitShot(pos.x, pos.y);
          return;
        }

        if (canKeeperDive(state)) {
          keeperDragging = true;
          previewDive = pos;
          keeper?.classList.add("dragging");
          keeper?.classList.remove("idle");
          positionKeeperInGoal(pos.x, pos.y);
          goalTouchZone.setPointerCapture(e.pointerId);
        }
      });
    }

    function onGoalPointerMove(e) {
      if (!keeperDragging) return;
      const pos = getGoalPercent(e.clientX, e.clientY);
      previewDive = pos;
      positionKeeperInGoal(pos.x, pos.y);
    }

    function onGoalPointerUp(e) {
      if (!keeperDragging) return;
      keeperDragging = false;
      keeper?.classList.remove("dragging");
      try {
        goalTouchZone.releasePointerCapture(e.pointerId);
      } catch (_) { /* ignore */ }

      if (previewDive) submitDive(previewDive.x, previewDive.y);
    }

    goalTouchZone.addEventListener("pointerdown", onGoalPointerDown);
    goalTouchZone.addEventListener("pointermove", onGoalPointerMove);
    goalTouchZone.addEventListener("pointerup", onGoalPointerUp);
    goalTouchZone.addEventListener("pointercancel", onGoalPointerUp);

    keeper?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      onGoalPointerDown(e);
    });
  }

  function enterGame(code, side) {
    roomCode = code;
    mySide = side;
    lastResultRound = 0;
    lastAnimatedRound = 0;
    lastWindUpRound = 0;
    resetScene();
    setupPitchInput();
    roomCodeDisplay.textContent = code;
    lobby.classList.add("hidden");
    gameSection.classList.remove("hidden");

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
    lastAnimatedRound = 0;
    lastWindUpRound = 0;
    animating = false;
    keeperDragging = false;
    resetScene();
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
        await ref.update({ playerAway: name, playerAwayId: playerId });
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

  async function playAgain() {
    if (!roomRef) return;
    lastResultRound = 0;
    lastAnimatedRound = 0;
    lastWindUpRound = 0;
    await roomRef.update({
      score: { home: 0, away: 0 },
      round: 1,
      phase: "shoot",
      shooter: "home",
      shotX: null,
      shotY: null,
      diveX: null,
      diveY: null,
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
    setupPitchInput();
    resetScene();
  }
})();
