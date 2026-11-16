(() => {
  "use strict";

  const page = window.FitGuidePage;
  const state = page.readState();
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  let selectedDayIndex = page.todayIndex();
  let currentExerciseIndex = 0;
  let currentExercises = [];
  let activeSessionId = "";
  let sessionReturnFocus = null;
  let detailsReturnFocus = null;
  let timerHandle = null;
  let timerMode = "idle";
  let timerPaused = false;
  let timerSeconds = 0;

  function plan() {
    return state.plan && Array.isArray(state.plan.schedule) ? state.plan : null;
  }

  function dayExercises(day) {
    if (!day) return [];
    if (day.kind === "workout") return [...(day.warmup || []), ...(day.exercises || []), ...(day.cooldown || [])];
    return day.kind === "recovery" ? (day.exercises || []) : [];
  }

  function isCompleted(entry) {
    return !entry.status || entry.status === "completed";
  }

  function sessionForDay(dayIndex) {
    const key = page.dateKey(new Date());
    return state.history.slice().reverse().find((entry) =>
      entry.session_id && entry.date_key === key && Number(entry.day_index) === dayIndex
    ) || null;
  }

  function newSession(dayIndex) {
    const currentPlan = plan();
    const day = currentPlan.schedule[dayIndex];
    const exercises = dayExercises(day);
    const now = new Date();
    const sessionId = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `fitguide-${now.getTime()}-${state.history.length}`;
    const session = {
      session_id: sessionId,
      date: now.toISOString(),
      date_key: page.dateKey(now),
      day_index: dayIndex,
      workout_title: day.title,
      kind: day.kind,
      focus: day.focus || currentPlan.focus,
      planned_exercises: exercises.length,
      exercises: 0,
      exercise_ids: [],
      elapsed_seconds: 0,
      minutes: 0,
      status: "in_progress",
      feedback: ""
    };
    state.history.push(session);
    state.activeWorkoutId = sessionId;
    return session;
  }

  function ensureSession(dayIndex, startFreshWhenComplete = false) {
    const existing = sessionForDay(dayIndex);
    if (existing && !(startFreshWhenComplete && isCompleted(existing))) {
      activeSessionId = existing.session_id;
      state.activeWorkoutId = existing.session_id;
      return existing;
    }
    const session = newSession(dayIndex);
    activeSessionId = session.session_id;
    return session;
  }

  function currentSession() {
    return state.history.find((entry) => entry.session_id === activeSessionId) || null;
  }

  function progressPercent(session, exercises) {
    if (!session || !exercises.length) return 0;
    const done = new Set(session.exercise_ids || []);
    return Math.round(exercises.filter((exercise) => done.has(exercise.id)).length / exercises.length * 100);
  }

  function showFeedback(message, isError = false) {
    const output = document.getElementById("workout-feedback");
    output.textContent = message;
    output.classList.toggle("error", isError);
  }

  function save() {
    try {
      page.saveState(state);
      return true;
    } catch (error) {
      console.error("Could not save your FitGuide workout activity.", error);
      showFeedback("Your browser could not save this workout. Check its storage settings and try again.", true);
      return false;
    }
  }

  function updateSession(session, dayIndex) {
    const day = plan().schedule[dayIndex];
    const exercises = dayExercises(day);
    const exerciseIds = [...new Set(session.exercise_ids || [])];
    session.exercise_ids = exerciseIds;
    session.exercises = exerciseIds.length;
    session.planned_exercises = exercises.length;
    session.minutes = session.elapsed_seconds ? Math.ceil(session.elapsed_seconds / 60) : 0;
    session.status = exercises.length && exerciseIds.length >= exercises.length ? "completed" : "in_progress";
    if (session.status === "completed") session.completed_at = new Date().toISOString();
    else delete session.completed_at;
    return save();
  }

  function renderExerciseCard(exercise, session, dayIndex) {
    const done = new Set(session ? session.exercise_ids || [] : []).has(exercise.id);
    const muscles = exercise.target_muscles || exercise.muscle_groups || [];
    const prescription = exercise.type === "timed"
      ? page.formatDuration(exercise.work_seconds_per_set || exercise.duration_seconds)
      : `${exercise.sets || 1} × ${exercise.reps || "comfortable reps"}`;
    return `<article class="workout-exercise-card ${done ? "is-complete" : ""}">
      <div class="workout-exercise-head"><div><span class="workout-exercise-phase">${page.escapeHtml(exercise.phase || "exercise")}</span><h3>${page.escapeHtml(exercise.name)}</h3><p>${page.escapeHtml(muscles.join(" · "))}</p></div><span class="page-history-status ${done ? "" : "in-progress"}">${done ? "Completed" : "To do"}</span></div>
      ${page.illustration(exercise)}
      <div class="workout-exercise-facts"><div><span>Sets × reps / time</span><b>${page.escapeHtml(prescription)}</b></div><div><span>Rest</span><b>${page.escapeHtml(page.formatDuration(exercise.rest_seconds))}</b></div><div><span>Difficulty</span><b>${page.escapeHtml((exercise.difficulty || []).join(" · ") || "As planned")}</b></div></div>
      <details class="workout-instructions"><summary>Instructions</summary><ol>${(exercise.instructions || []).map((step) => `<li>${page.escapeHtml(step)}</li>`).join("")}</ol></details>
      <div class="workout-exercise-actions"><button class="button button-quiet" type="button" data-exercise-details="${page.escapeHtml(exercise.id)}">View Details</button><button class="button button-quiet ${done ? "is-marked" : ""}" type="button" data-mark-complete="${page.escapeHtml(exercise.id)}" data-day-index="${dayIndex}">${done ? "✓ Completed · Undo" : "Mark as Completed"}</button></div>
    </article>`;
  }

  function renderSchedule() {
    const currentPlan = plan();
    if (!currentPlan) return;
    const today = page.todayIndex();
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - today);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    document.getElementById("weekly-schedule").innerHTML = currentPlan.schedule.map((day, index) => {
      const completedThisWeek = state.history.some((entry) => {
        const date = new Date(entry.date);
        const entryDay = Number.isInteger(Number(entry.day_index))
          ? Number(entry.day_index)
          : (date.getDay() + 6) % 7;
        return isCompleted(entry) && entry.kind !== "rest" && entryDay === index && date >= weekStart && date < weekEnd;
      });
      const status = completedThisWeek ? "Completed" : day.kind === "rest" ? "Recovery day" : day.kind === "recovery" ? "Easy movement" : index === today ? "Today" : "Upcoming";
      return `<button class="schedule-day-button ${index === selectedDayIndex ? "selected" : ""} ${index === today ? "today" : ""}" type="button" data-schedule-day="${index}" aria-pressed="${index === selectedDayIndex}">
        <b>${weekdays[index]}${index === today ? " · TODAY" : ""}</b><span>${page.escapeHtml(day.title)}</span><small>${page.escapeHtml(status)}${day.duration_minutes ? ` · ${day.duration_minutes} min` : ""}</small>
      </button>`;
    }).join("");
  }

  function renderHistory() {
    const history = state.history.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 12);
    document.getElementById("workout-history").innerHTML = history.length ? history.map((entry) => {
      const complete = isCompleted(entry);
      const status = complete ? "Completed" : entry.status === "in_progress" ? "In progress" : "Partially completed";
      const seconds = Number(entry.elapsed_seconds) || Number(entry.minutes) * 60 || 0;
      const exerciseCount = Number(entry.exercises) || 0;
      return `<article class="page-history-row"><span class="page-history-icon ${complete ? "" : "in-progress"}">${complete ? "✓" : "◷"}</span><div class="page-history-copy"><b>${page.escapeHtml(entry.workout_title || entry.focus || "FitGuide workout")}</b><small>${page.formatDate(entry.date)} · ${page.formatDuration(seconds)} · ${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}</small></div><span class="page-history-status ${complete ? "" : "in-progress"}">${status}</span></article>`;
    }).join("") : `<div class="page-empty-state"><h3>No workout history yet</h3><p>Completed sessions will appear here and on your Progress page.</p></div>`;
  }

  function renderToday() {
    const currentPlan = plan();
    if (!currentPlan) {
      document.getElementById("plan-empty").classList.remove("hidden");
      document.getElementById("workout-content").classList.add("hidden");
      document.getElementById("workout-exercise-section").classList.add("hidden");
      document.getElementById("weekly-schedule").innerHTML = "";
      document.getElementById("workout-history").innerHTML = "";
      return;
    }
    document.getElementById("plan-empty").classList.add("hidden");
    document.getElementById("workout-content").classList.remove("hidden");
    document.getElementById("workout-exercise-section").classList.remove("hidden");
    const day = currentPlan.schedule[selectedDayIndex];
    const exercises = dayExercises(day);
    const session = sessionForDay(selectedDayIndex);
    const percent = progressPercent(session, exercises);
    const goal = Array.isArray(day.focus) ? day.focus.join(", ") : day.focus || (currentPlan.focus || []).join(", ");
    const label = selectedDayIndex === page.todayIndex() ? "TODAY’S WORKOUT" : `${weekdays[selectedDayIndex].toUpperCase()} · PLANNED SESSION`;
    document.getElementById("today-workout-day").textContent = label;
    document.getElementById("today-workout-title").textContent = day.title;
    document.getElementById("today-workout-goal").textContent = `Fitness goal: ${goal || "General fitness"}`;
    document.getElementById("today-workout-level").textContent = currentPlan.level || currentPlan.difficulty || "Beginner";
    document.getElementById("today-workout-duration").textContent = day.duration_minutes ? `${day.duration_minutes} min` : "Recovery";
    document.getElementById("today-workout-count").textContent = `${exercises.length}`;
    document.getElementById("today-workout-status").textContent = session
      ? isCompleted(session) ? "Completed" : `${percent}% complete`
      : day.kind === "rest" ? "Rest day" : "Not started";
    document.getElementById("today-workout-progress").style.width = `${percent}%`;
    const start = document.getElementById("start-workout");
    start.disabled = day.kind === "rest" || !exercises.length;
    start.innerHTML = day.kind === "rest" ? "Scheduled Rest Day" : day.kind === "recovery" ? "Start Easy Movement <span aria-hidden=\"true\">→</span>" : "Start Workout <span aria-hidden=\"true\">→</span>";
    document.getElementById("workout-exercise-list").innerHTML = exercises.length
      ? exercises.map((exercise) => renderExerciseCard(exercise, session, selectedDayIndex)).join("")
      : `<div class="page-empty-state"><h3>${day.kind === "rest" ? "Rest is part of your plan." : "No exercises are scheduled for this day."}</h3><p>Choose another day in your weekly schedule to view its movements.</p></div>`;
    renderSchedule();
    renderHistory();
  }

  function toggleExercise(id, dayIndex) {
    const day = plan().schedule[dayIndex];
    const exercise = dayExercises(day).find((item) => item.id === id);
    if (!exercise) return;
    const session = ensureSession(dayIndex);
    const ids = new Set(session.exercise_ids || []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    session.exercise_ids = [...ids];
    updateSession(session, dayIndex);
    renderToday();
    renderHistory();
  }

  function stopTimer() {
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
    timerMode = "idle";
    timerPaused = false;
  }

  function activeExercise() {
    return currentExercises[currentExerciseIndex] || null;
  }

  function renderCompletion() {
    const session = currentSession();
    const percent = progressPercent(session, currentExercises);
    document.getElementById("session-completion-bar").style.width = `${percent}%`;
    document.getElementById("session-completion-label").textContent = `${percent}% complete · ${session ? session.exercises : 0} of ${currentExercises.length} exercises`;
  }

  function renderSessionExercise() {
    const exercise = activeExercise();
    if (!exercise) return;
    stopTimer();
    timerSeconds = 0;
    const muscles = exercise.target_muscles || exercise.muscle_groups || [];
    const prescription = exercise.type === "timed"
      ? `${exercise.sets || 1} × ${page.formatDuration(exercise.work_seconds_per_set || exercise.duration_seconds)}`
      : `${exercise.sets || 1} × ${exercise.reps || "comfortable reps"}`;
    document.getElementById("session-exercise-position").textContent = `EXERCISE ${currentExerciseIndex + 1} OF ${currentExercises.length}`;
    document.getElementById("session-exercise-content").innerHTML = `<div class="session-exercise-content">
      ${page.illustration(exercise)}
      <span class="exercise-tag">${page.escapeHtml(muscles.join(" · "))}</span>
      <h2 id="session-exercise-name">${page.escapeHtml(exercise.name)}</h2>
      <p>${page.escapeHtml(exercise.purpose || "")}</p>
      <div class="session-exercise-facts"><div><span>Sets and repetitions</span><b>${page.escapeHtml(prescription)}</b></div><div><span>Rest</span><b>${page.escapeHtml(page.formatDuration(exercise.rest_seconds))}</b></div><div><span>Difficulty</span><b>${page.escapeHtml((exercise.difficulty || []).join(" · "))}</b></div></div>
      <div class="exercise-detail-copy"><b>Starting position</b><p>${page.escapeHtml(exercise.starting_position || "")}</p><b>Instructions</b><ol>${(exercise.instructions || []).map((step) => `<li>${page.escapeHtml(step)}</li>`).join("")}</ol><b>Safety</b><ul>${(exercise.safety_instructions || []).map((step) => `<li>${page.escapeHtml(step)}</li>`).join("")}</ul></div>
    </div>`;
    document.getElementById("session-previous").disabled = currentExerciseIndex === 0;
    document.getElementById("session-next").disabled = false;
    document.getElementById("session-next").textContent = currentExerciseIndex === currentExercises.length - 1 ? "Complete Exercise" : "Next Exercise →";
    document.getElementById("session-start").disabled = false;
    document.getElementById("session-start").textContent = "Start Exercise Timer";
    document.getElementById("session-pause").disabled = true;
    document.getElementById("session-pause").textContent = "Pause";
    document.getElementById("session-rest").disabled = !(Number(exercise.rest_seconds) > 0);
    document.getElementById("session-timer-label").textContent = exercise.type === "timed" ? "Timed exercise set" : "Exercise timer";
    document.getElementById("session-timer-display").textContent = "00:00";
    document.getElementById("session-total-time").textContent = `${page.formatDuration((currentSession() || {}).elapsed_seconds)} of active exercise time`;
    renderCompletion();
  }

  function openSession() {
    const currentPlan = plan();
    if (!currentPlan) return;
    const day = currentPlan.schedule[selectedDayIndex];
    currentExercises = dayExercises(day);
    if (!currentExercises.length) return;
    const session = ensureSession(selectedDayIndex, true);
    currentExerciseIndex = currentExercises.findIndex((exercise) => !(session.exercise_ids || []).includes(exercise.id));
    if (currentExerciseIndex < 0) currentExerciseIndex = 0;
    document.getElementById("session-day-title").textContent = day.title.toUpperCase();
    document.getElementById("session-feedback").value = session.feedback || "";
    renderSessionExercise();
    const modal = document.getElementById("session-modal");
    sessionReturnFocus = document.activeElement;
    modal.hidden = false;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    document.getElementById("session-close").focus();
    save();
  }

  function closeSession() {
    stopTimer();
    const modal = document.getElementById("session-modal");
    if (modal.contains(document.activeElement)) document.activeElement.blur();
    modal.classList.remove("open");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    const session = currentSession();
    if (session) {
      session.minutes = session.elapsed_seconds ? Math.ceil(session.elapsed_seconds / 60) : 0;
      save();
    }
    if (sessionReturnFocus && document.contains(sessionReturnFocus)) sessionReturnFocus.focus();
    sessionReturnFocus = null;
    renderToday();
  }

  function updateTimerView() {
    const exercise = activeExercise();
    const session = currentSession();
    document.getElementById("session-timer-display").textContent = page.formatClock(timerSeconds);
    document.getElementById("session-timer-label").textContent = timerMode === "rest"
      ? "Rest timer"
      : timerMode === "work-timed" ? "Timed exercise · countdown"
        : timerMode === "work-count" ? "Exercise timer · elapsed"
          : timerPaused ? "Paused" : exercise && exercise.type === "timed" ? "Timed exercise ready" : "Ready when you are";
    document.getElementById("session-total-time").textContent = `${page.formatDuration(session ? session.elapsed_seconds : 0)} of active exercise time`;
    document.getElementById("session-start").disabled = timerMode !== "idle";
    document.getElementById("session-start").textContent = timerMode === "rest" ? "Rest in progress"
      : timerMode.startsWith("work") ? "Exercise in progress" : "Start Exercise Timer";
    document.getElementById("session-pause").disabled = timerMode === "idle";
    document.getElementById("session-pause").textContent = timerPaused ? "Resume" : "Pause";
    document.getElementById("session-rest").disabled = timerMode === "rest" || !(exercise && Number(exercise.rest_seconds) > 0);
  }

  function tickTimer() {
    if (timerPaused || timerMode === "idle") return;
    const session = currentSession();
    if (timerMode === "rest") {
      timerSeconds = Math.max(0, timerSeconds - 1);
      if (timerSeconds === 0) {
        timerMode = "idle";
        window.clearInterval(timerHandle);
        timerHandle = null;
      }
    } else {
      if (timerMode === "work-timed") timerSeconds = Math.max(0, timerSeconds - 1);
      else timerSeconds += 1;
      if (session) {
        session.elapsed_seconds = (Number(session.elapsed_seconds) || 0) + 1;
        session.minutes = Math.ceil(session.elapsed_seconds / 60);
        if (session.elapsed_seconds % 5 === 0) save();
      }
      if (timerMode === "work-timed" && timerSeconds === 0) {
        timerMode = "idle";
        window.clearInterval(timerHandle);
        timerHandle = null;
        showFeedback("Timed set finished. Rest or move on when you feel ready.");
        if (session) updateSession(session, selectedDayIndex);
      }
    }
    updateTimerView();
  }

  function startTimer() {
    if (timerMode !== "idle") return;
    const exercise = activeExercise();
    if (!exercise) return;
    timerMode = exercise.type === "timed" ? "work-timed" : "work-count";
    timerPaused = false;
    timerSeconds = exercise.type === "timed"
      ? Number(exercise.work_seconds_per_set) || Number(exercise.duration_seconds) || 60
      : 0;
    timerHandle = window.setInterval(tickTimer, 1000);
    updateTimerView();
  }

  function startRestTimer() {
    if (timerMode === "rest") return;
    const exercise = activeExercise();
    if (!exercise || !Number(exercise.rest_seconds)) return;
    if (timerHandle) window.clearInterval(timerHandle);
    timerMode = "rest";
    timerPaused = false;
    timerSeconds = Number(exercise.rest_seconds);
    timerHandle = window.setInterval(tickTimer, 1000);
    updateTimerView();
  }

  function markCurrentExercise() {
    const exercise = activeExercise();
    const session = currentSession();
    if (!exercise || !session) return;
    const ids = new Set(session.exercise_ids || []);
    ids.add(exercise.id);
    session.exercise_ids = [...ids];
    updateSession(session, selectedDayIndex);
    renderCompletion();
    renderToday();
  }

  function finishWorkout() {
    const session = currentSession();
    if (!session || !session.exercise_ids || !session.exercise_ids.length) {
      showFeedback("Mark at least one exercise complete before finishing your workout.", true);
      return;
    }
    const feedback = document.getElementById("session-feedback");
    if (feedback) session.feedback = feedback.value;
    session.status = "completed";
    session.completed_at = new Date().toISOString();
    session.minutes = session.elapsed_seconds ? Math.ceil(session.elapsed_seconds / 60) : 0;
    if (!save()) return;
    closeSession();
    showFeedback("Workout saved. Your Progress page now reflects this session.");
    renderToday();
    renderHistory();
  }

  function showDetails(exercise) {
    const muscles = exercise.target_muscles || exercise.muscle_groups || [];
    const prescription = exercise.type === "timed"
      ? `${exercise.sets || 1} × ${page.formatDuration(exercise.work_seconds_per_set || exercise.duration_seconds)}`
      : `${exercise.sets || 1} × ${exercise.reps || "comfortable reps"}`;
    document.getElementById("exercise-details-content").innerHTML = `${page.illustration(exercise)}
      <span class="exercise-tag">${page.escapeHtml(muscles.join(" · "))}</span>
      <h2 id="exercise-detail-title">${page.escapeHtml(exercise.name)}</h2>
      <p>${page.escapeHtml(exercise.purpose || "")}</p>
      <div class="exercise-detail-facts"><span><b>Difficulty</b>${page.escapeHtml((exercise.difficulty || []).join(" · "))}</span><span><b>Equipment</b>${page.escapeHtml((exercise.equipment || []).join(", ") || "No equipment")}</span><span><b>Sets / reps</b>${page.escapeHtml(prescription)}</span></div>
      <div class="exercise-detail-copy"><b>Starting position</b><p>${page.escapeHtml(exercise.starting_position || "")}</p><b>Step-by-step instructions</b><ol>${(exercise.instructions || []).map((step) => `<li>${page.escapeHtml(step)}</li>`).join("")}</ol><b>Rest</b><p>${page.escapeHtml(page.formatDuration(exercise.rest_seconds))}</p><b>Common mistakes</b><ul>${(exercise.common_mistakes || []).map((step) => `<li>${page.escapeHtml(step)}</li>`).join("")}</ul><b>Easier alternative</b><p>${page.escapeHtml(exercise.easier_alternative || "Use a smaller range and move at a comfortable pace.")}</p><b>Safety</b><ul>${(exercise.safety_instructions || []).map((step) => `<li>${page.escapeHtml(step)}</li>`).join("")}</ul></div>`;
    const modal = document.getElementById("exercise-details-modal");
    detailsReturnFocus = document.activeElement;
    modal.hidden = false;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    document.getElementById("exercise-details-close").focus();
  }

  function closeDetails() {
    const modal = document.getElementById("exercise-details-modal");
    if (modal.contains(document.activeElement)) document.activeElement.blur();
    modal.classList.remove("open");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (detailsReturnFocus && document.contains(detailsReturnFocus)) detailsReturnFocus.focus();
    detailsReturnFocus = null;
  }

  function init() {
    page.initNavigation();
    document.getElementById("start-workout").addEventListener("click", openSession);
    document.getElementById("weekly-schedule").addEventListener("click", (event) => {
      const button = event.target.closest("[data-schedule-day]");
      if (!button) return;
      selectedDayIndex = Number(button.dataset.scheduleDay);
      showFeedback("");
      renderToday();
    });
    document.getElementById("workout-exercise-list").addEventListener("click", (event) => {
      const detailsButton = event.target.closest("[data-exercise-details]");
      if (detailsButton) {
        const day = plan() && plan().schedule[selectedDayIndex];
        const exercise = dayExercises(day).find((item) => item.id === detailsButton.dataset.exerciseDetails);
        if (exercise) showDetails(exercise);
        return;
      }
      const markButton = event.target.closest("[data-mark-complete]");
      if (markButton) toggleExercise(markButton.dataset.markComplete, Number(markButton.dataset.dayIndex));
    });
    document.getElementById("session-close").addEventListener("click", closeSession);
    document.getElementById("session-modal").addEventListener("click", (event) => {
      if (event.target.id === "session-modal") closeSession();
    });
    document.getElementById("session-start").addEventListener("click", startTimer);
    document.getElementById("session-pause").addEventListener("click", () => {
      if (timerMode === "idle") return;
      timerPaused = !timerPaused;
      updateTimerView();
    });
    document.getElementById("session-rest").addEventListener("click", startRestTimer);
    document.getElementById("session-previous").addEventListener("click", () => {
      if (currentExerciseIndex === 0) return;
      currentExerciseIndex -= 1;
      renderSessionExercise();
    });
    document.getElementById("session-next").addEventListener("click", () => {
      markCurrentExercise();
      if (currentExerciseIndex < currentExercises.length - 1) {
        currentExerciseIndex += 1;
        renderSessionExercise();
      } else {
        showFeedback("This is the last exercise. Complete the workout when you’re ready.");
      }
    });
    document.getElementById("session-finish").addEventListener("click", finishWorkout);
    document.getElementById("exercise-details-close").addEventListener("click", closeDetails);
    document.getElementById("exercise-details-modal").addEventListener("click", (event) => {
      if (event.target.id === "exercise-details-modal") closeDetails();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSession();
        closeDetails();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && timerMode !== "idle") {
        timerPaused = true;
        updateTimerView();
      }
    });
    window.addEventListener("pagehide", () => {
      if (timerMode !== "idle") timerPaused = true;
      if (currentSession()) save();
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== page.STORAGE_KEY && event.key !== null) return;
      const updated = page.readState();
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, updated);
      renderToday();
    });
    window.addEventListener("fitguide:themechange", (event) => {
      state.theme = event.detail;
    });
    renderToday();
    renderHistory();
  }

  init();
})();
