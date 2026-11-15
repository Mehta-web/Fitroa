(() => {
  "use strict";

  const STORAGE_KEY = "fitguide.local.v1";
  const API_BASE = window.location.port === "4173" ? "" : "http://127.0.0.1:4173";
  const goalOptions = [
    "Core strength", "Stronger arms", "Chest strength", "Stronger legs",
    "Shoulder strength", "Back & posture", "Full body fitness", "Flexibility",
    "General fitness"
  ];
  let library = [];

  let state = loadState();
  let wizardStep = 0;
  let draft = {};
  let selectedGoals = [];
  let playerExercises = [];
  let playerIndex = 0;
  let timerValue = 0;
  let timerHandle = null;
  let timerPaused = false;
  let timerMode = null;
  let currentSet = 1;
  let setStarted = false;
  let elapsedSessionSeconds = 0;
  let completedExerciseCount = 0;
  let completedExerciseIds = [];
  let toastHandle = null;
  let modalReturnFocus = null;
  let generatorStatus = { available: false, model: "" };
  let libraryError = "";

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function readApiJson(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!/application\/json/i.test(contentType)) {
      throw new Error("fitora’s local server returned a non-JSON response. Start the backend with `npm start` on port 4173.");
    }
    try {
      return await response.json();
    } catch {
      throw new Error("fitora’s local server returned invalid JSON. Restart it with `npm start` and try again.");
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : { profile: null, plan: null, history: [], wins: [], favorites: [], theme: "light", reminder: "" };
    } catch (error) {
      console.error("Could not load fitora data from this browser.", error);
      return { profile: null, plan: null, history: [], wins: [], favorites: [], theme: "light", reminder: "" };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save fitora data in this browser.", error);
      showToast("Your browser could not save this update. Check your storage settings.");
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal.contains(document.activeElement)) modalReturnFocus = document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal.contains(document.activeElement)) document.activeElement.blur();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (id === "workout-modal") stopTimer();
    if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function openWizard() {
    draft = state.profile ? { ...state.profile, safetyConfirmed: false } : {
      name: "", age: "", height: "", weight: "", gender: "",
      level: "Beginner", experience: "", minutes: "20", equipment: "No equipment",
      preferredType: "Balanced strength", limitation: "", limitTags: [],
      avoidExercises: "", healthConcern: false, safetyConfirmed: false
    };
    selectedGoals = state.profile && state.profile.goals ? [...state.profile.goals] : [];
    if (!selectedGoals.length) {
      selectedGoals = [...document.querySelectorAll(".goal-chip.selected")].map((chip) => chip.dataset.goal);
    }
    document.querySelectorAll(".goal-chip").forEach((chip) => chip.classList.toggle("selected", selectedGoals.includes(chip.dataset.goal)));
    wizardStep = 0;
    renderWizard();
    openModal("wizard-modal");
  }

  function renderWizard() {
    const content = document.getElementById("wizard-content");
    const back = document.getElementById("wizard-back");
    const next = document.getElementById("wizard-next");
    const error = document.getElementById("wizard-error");
    error.textContent = "";
    document.getElementById("wizard-progress").style.width = `${((wizardStep + 1) / 3) * 100}%`;
    document.getElementById("wizard-step-label").textContent = `STEP ${wizardStep + 1} OF 3`;
    back.style.visibility = wizardStep === 0 ? "hidden" : "visible";
    next.innerHTML = wizardStep === 2 ? "Create my plan <span>→</span>" : "Continue <span>→</span>";
    if (wizardStep === 0) {
      content.innerHTML = `<h2>Let’s make this yours.</h2><p>A few details help us suggest a plan that fits. Share only what you’re comfortable with.</p>
        <div class="form-grid">
          <div class="form-field"><label for="profile-name">Name <span class="optional">(optional)</span></label><input id="profile-name" name="name" autocomplete="given-name" value="${escapeHtml(draft.name)}" placeholder="What should we call you?"></div>
          <div class="form-field"><label for="profile-age">Age <span aria-label="required">*</span></label><input id="profile-age" name="age" type="number" min="13" max="110" inputmode="numeric" value="${escapeHtml(draft.age)}" placeholder="Your age"></div>
          <div class="form-field"><label for="profile-height">Height <span class="optional">(optional)</span></label><input id="profile-height" name="height" value="${escapeHtml(draft.height)}" placeholder="e.g. 170 cm"></div>
          <div class="form-field"><label for="profile-weight">Weight <span class="optional">(optional)</span></label><input id="profile-weight" name="weight" value="${escapeHtml(draft.weight)}" placeholder="Optional"></div>
          <div class="form-field"><label for="profile-gender">Gender <span class="optional">(optional)</span></label><select id="profile-gender" name="gender"><option value="">Prefer not to say</option><option ${draft.gender === "Woman" ? "selected" : ""}>Woman</option><option ${draft.gender === "Man" ? "selected" : ""}>Man</option><option ${draft.gender === "Non-binary" ? "selected" : ""}>Non-binary</option><option ${draft.gender === "Self-describe" ? "selected" : ""}>Self-describe</option></select></div>
          <div class="form-field"><label for="profile-level">Current fitness level</label><select id="profile-level" name="level">${["Beginner", "Intermediate", "Advanced"].map((item) => `<option ${draft.level === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="form-field"><label for="profile-experience">Exercise experience <span class="optional">(optional)</span></label><select id="profile-experience" name="experience"><option value="">Choose if you like</option>${["New to exercise", "Some experience", "Regularly active"].map((item) => `<option ${draft.experience === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="form-field"><label for="profile-minutes">Available time</label><select id="profile-minutes" name="minutes">${["10", "15", "20", "30", "45"].map((item) => `<option value="${item}" ${String(draft.minutes) === item ? "selected" : ""}>${item} minutes</option>`).join("")}</select></div>
          <div class="form-field"><label for="profile-equipment">Available equipment</label><select id="profile-equipment" name="equipment">${["No equipment", "Dumbbells", "Resistance bands", "Full home gym"].map((item) => `<option ${draft.equipment === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="form-field"><label for="profile-preferred-type">Preferred workout type</label><select id="profile-preferred-type" name="preferredType">${["Balanced strength", "Low impact", "Mobility first", "Bodyweight"].map((item) => `<option ${draft.preferredType === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
        </div><div class="health-note">Your age helps keep suggestions appropriate. For anyone under 18, plans focus on general movement and strength—not weight loss or body transformation.</div>`;
    } else if (wizardStep === 1) {
      content.innerHTML = `<h2>Let’s keep movement comfortable.</h2><p>Tell us about movements or areas to avoid. These details are sent only to fitora’s own local recommendation engine so it can filter unsuitable movements; they are not sent to an external service.</p>
        <div class="form-field full"><label for="profile-limitation">Anything you’d like us to be mindful of? <span class="optional">(optional)</span></label><textarea id="profile-limitation" name="limitation" placeholder="You can leave this blank.">${escapeHtml(draft.limitation)}</textarea></div>        <div class="field-label limitation-heading">Movement limitations <span class="optional">(select any that apply)</span></div>
        <div class="limitation-grid">${[
          ["knee-pain", "Knee limitation"], ["wrist-pain", "Wrist or hand limitation"],
          ["shoulder-pain", "Shoulder limitation"], ["back-pain", "Back limitation"],
          ["balance", "Balance concerns"], ["impact", "Avoid impact or jumping"],
          ["floor-work", "Avoid floor exercises"], ["hip-pain", "Hip limitation"],
          ["ankle-pain", "Ankle limitation"], ["kneeling", "Avoid kneeling"]
        ].map(([value, label]) => `<label class="checkbox-note"><input type="checkbox" name="limitTags" value="${value}" ${draft.limitTags && draft.limitTags.includes(value) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
        <div class="form-field full exclusion-field"><label for="profile-exclusions">Exercises you cannot or prefer not to do <span class="optional">(optional)</span></label><textarea id="profile-exclusions" name="avoidExercises" placeholder="e.g. push-ups, kneeling">${escapeHtml(draft.avoidExercises || "")}</textarea></div>
        <label class="checkbox-note" style="margin-top:13px"><input id="health-concern" type="checkbox" ${draft.healthConcern ? "checked" : ""}><span>I have a health concern, injury, or exercise limitation.</span></label>
        <label class="checkbox-note" id="consult-label" style="margin-top:11px;${draft.healthConcern || draft.limitation || (draft.limitTags && draft.limitTags.length) ? "" : "display:none"}"><input id="safety-confirmed" type="checkbox" ${draft.safetyConfirmed ? "checked" : ""}><span>I’ve checked with a qualified healthcare professional about starting or adapting exercise.</span></label>
        <div class="health-note">fitora is not medical care. If you have a concern or are unsure whether exercise is appropriate, consult a qualified healthcare professional first. Stop if you experience pain, dizziness, or unusual discomfort.</div>`;
    } else {
      content.innerHTML = `<h2>What would you like to work on?</h2><p>Choose one or more areas. You can update your goals whenever life changes.</p>
        <div class="goal-pick-grid">${goalOptions.map((goal) => `<button type="button" class="goal-pick ${selectedGoals.includes(goal) ? "selected" : ""}" data-goal="${escapeHtml(goal)}"><span>${selectedGoals.includes(goal) ? "✓" : ""}</span>${escapeHtml(goal)}</button>`).join("")}</div>
        <div class="form-field custom-goal"><label for="custom-goal">Something else? <span class="optional">(optional)</span></label><input id="custom-goal" value="${escapeHtml(draft.customGoal || "")}" placeholder="Add your own goal"></div>
        <div class="health-note" id="generator-status-message">Checking local recommendation engine…</div>
        <div class="health-note">Your answers are processed by fitora’s own rule-based engine. No AI provider, API key, or external service is used.</div>
        <div class="health-note">Goals are about strength, wellbeing, mobility, and gradual progress—not a promised appearance or specific result.</div>`;
      document.getElementById("generator-status-message").textContent = "Checking local recommendation engine…";
      checkGeneratorStatus();
    }
    if (wizardStep === 1) {
      const concern = document.getElementById("health-concern");
      concern.addEventListener("change", () => {
        const hasLimitTag = document.querySelectorAll('[name="limitTags"]:checked').length > 0;
        document.getElementById("consult-label").style.display = concern.checked || document.getElementById("profile-limitation").value.trim() || hasLimitTag ? "flex" : "none";
      });
      document.getElementById("profile-limitation").addEventListener("input", (event) => {
        const hasLimitTag = document.querySelectorAll('[name="limitTags"]:checked').length > 0;
        document.getElementById("consult-label").style.display = concern.checked || event.currentTarget.value.trim() || hasLimitTag ? "flex" : "none";
      });
      document.querySelectorAll('[name="limitTags"]').forEach((input) => input.addEventListener("change", () => {
        const hasLimitTag = document.querySelectorAll('[name="limitTags"]:checked').length > 0;
        document.getElementById("consult-label").style.display = concern.checked || document.getElementById("profile-limitation").value.trim() || hasLimitTag ? "flex" : "none";
      }));
    }
  }

  function captureDraft() {
    const names = ["name", "age", "height", "weight", "gender", "level", "experience", "minutes", "equipment", "preferredType", "avoidExercises"];
    names.forEach((name) => {
      const element = document.querySelector(`[name="${name}"]`);
      if (element) draft[name] = element.value.trim();
    });
    const limitation = document.getElementById("profile-limitation");
    if (limitation) draft.limitation = limitation.value.trim();
    const concern = document.getElementById("health-concern");
    if (concern) draft.healthConcern = concern.checked;
    const limitTags = document.querySelectorAll('[name="limitTags"]:checked');
    if (document.querySelector('[name="limitTags"]')) draft.limitTags = [...limitTags].map((element) => element.value);
    const confirmed = document.getElementById("safety-confirmed");
    if (confirmed) draft.safetyConfirmed = confirmed.checked;
    const customGoal = document.getElementById("custom-goal");
    if (customGoal) draft.customGoal = customGoal.value.trim();
  }

  function generationProfile(profile, goals) {
    return {
      age: Number(profile.age),
      height: profile.height || "",
      weight: profile.weight || "",
      goals,
      level: profile.level,
      experience: profile.experience || "New to exercise",
      minutes: Number(profile.minutes),
      equipment: profile.equipment,
      preferredType: profile.preferredType || "Balanced strength",
      limitation: profile.limitation || "",
      limitTags: profile.limitTags || [],
      avoidExercises: profile.avoidExercises || "",
      healthConcern: profile.healthConcern === true,
      safetyConfirmed: profile.safetyConfirmed === true,
      favoriteExerciseIds: Array.isArray(state.favorites) ? state.favorites : [],
      history: (state.history || []).slice(-5).map((entry) => ({
        focus: entry.focus || "",
        feedback: entry.feedback || "just_right",
        exercise_ids: Array.isArray(entry.exercise_ids) ? entry.exercise_ids : []
      }))
    };
  }

  function validatePlan(plan, profile) {
    if (!plan || typeof plan !== "object" || !Array.isArray(plan.schedule) || plan.schedule.length !== 7) {
      throw new Error("The local planner returned an incomplete weekly schedule. Please try again.");
    }
    const experience = profile.experience || "New to exercise";
    const beginnerPlan = Number(profile.age) < 18 || Number(profile.age) > 65 ||
      profile.level === "Beginner" || experience === "New to exercise";
    const strengthDays = beginnerPlan ? 2 : 3;
    const requiredKinds = { workout: strengthDays, recovery: 2, rest: 7 - strengthDays - 2 };
    for (const kind of Object.keys(requiredKinds)) {
      if (plan.schedule.filter((day) => day && day.kind === kind).length !== requiredKinds[kind]) {
        throw new Error("The local planner returned an invalid recovery schedule. Please try again.");
      }
    }
    for (const day of plan.schedule) {
      if (!day || !["workout", "recovery", "rest"].includes(day.kind)) {
        throw new Error("The local planner returned an invalid day in the weekly schedule.");
      }
      if (day.kind === "rest") continue;
      if (!Array.isArray(day.warmup) || !Array.isArray(day.exercises) || !Array.isArray(day.cooldown)) {
        throw new Error("The local planner returned an incomplete exercise list.");
      }
      const exercises = [...day.warmup, ...day.exercises, ...day.cooldown];
      if (exercises.length < (day.kind === "workout" ? 5 : 1)) {
        throw new Error("The local planner returned a session without enough exercises. Please try again.");
      }
      if (day.kind === "workout" && (day.exercises.length < 3 || !day.warmup.length || !day.cooldown.length)) {
        throw new Error("A strength workout must include multiple exercises, a warm-up, and a cool-down.");
      }
      for (const exercise of exercises) {
        if (!exercise || !exercise.id || !exercise.name || !exercise.phase || !exercise.type ||
            !Array.isArray(exercise.instructions) || !exercise.instructions.length ||
            !Array.isArray(exercise.common_mistakes) || !Array.isArray(exercise.safety_instructions) ||
            !Array.isArray(exercise.target_muscles) || !exercise.target_muscles.length ||
            !exercise.starting_position || !exercise.purpose || !exercise.easier_alternative ||
            !exercise.media || !Number.isFinite(exercise.duration_seconds) ||
            !Number.isInteger(exercise.sets) || exercise.sets < 1 ||
            !Number.isInteger(exercise.rest_seconds) || exercise.rest_seconds < 0) {
          throw new Error("An exercise was missing required instructions or safety details.");
        }
      }
    }
    if (!Array.isArray(plan.safety_notes) || !plan.safety_notes.length || !plan.workout_title ||
        !Number.isFinite(plan.total_duration) || !Number.isFinite(plan.available_minutes)) {
      throw new Error("The local planner returned an incomplete plan. Please try again.");
    }
    return plan;
  }

  async function requestWorkoutPlan(profile, goals) {
    let response;
    try {
      response = await fetch(apiUrl("/api/workouts/generate"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: generationProfile(profile, goals) })
      });
    } catch (error) {
      throw new Error("fitora’s local server could not be reached. Start it with `npm start` and keep the backend running while you use the website.");
    }
    const result = await readApiJson(response);
    if (!response.ok || result.success !== true) {
      throw new Error(result && result.error ? result.error : `Workout generation failed (HTTP ${response.status}).`);
    }
    return validatePlan(result.plan, profile);
  }

  async function checkGeneratorStatus() {
    try {
      const response = await fetch(apiUrl("/api/health"), { cache: "no-store" });
      if (!response.ok) throw new Error(`Health check failed (${response.status}).`);
      const result = await readApiJson(response);
      generatorStatus = {
        available: result.success === true && result.status === "running" && result.service === "FitGuide",
        model: result.service || "FitGuide"
      };
    } catch (error) {
      generatorStatus = { available: false, model: "" };
    }
    updateGeneratorStatusMessage();
  }

  function updateGeneratorStatusMessage() {
    const message = document.getElementById("generator-status-message");
    if (message) {
      message.textContent = generatorStatus.available
        ? `Backend connected: ${generatorStatus.model} is running. Plans use the built-in exercise library.`
        : `Backend disconnected: fitora could not reach ${apiUrl("/api/health")}. Start the backend with \`npm start\`; if using Live Server, leave both servers running.`;
    }
  }

  async function finishWizard() {
    if (!selectedGoals.length && !draft.customGoal) {
      document.getElementById("wizard-error").textContent = "Choose at least one goal or add your own.";
      return;
    }
    const goals = [...selectedGoals];
    if (draft.customGoal && !goals.includes(draft.customGoal)) goals.push(draft.customGoal);
    draft.goals = goals;
    if (Number(draft.age) < 18) {
      draft.level = "Beginner";
      showToast("Your plan will focus on safe, general movement and gradual strength.");
    }
    const next = document.getElementById("wizard-next");
    next.disabled = true;
    next.textContent = "Building your plan…";
    document.getElementById("wizard-error").textContent = "";
    try {
      const plan = await requestWorkoutPlan(draft, goals);
      state.profile = { ...draft, goals };
      state.plan = plan;
      saveState();
      closeModal("wizard-modal");
      renderDashboard();
      document.getElementById("progress").classList.remove("hidden");
      showToast("Your personalized plan is ready. Let’s take it one step at a time.");
      document.getElementById("my-plan").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      document.getElementById("wizard-error").textContent = error.message || "Workout generation failed. Please try again.";
      await checkGeneratorStatus();
    } finally {
      next.disabled = false;
      next.innerHTML = "Create my plan <span>→</span>";
    }
  }

  function currentDayIndex() {
    return (new Date().getDay() + 6) % 7;
  }

  function todayPlan() {
    if (!state.plan) return null;
    return state.plan.schedule[currentDayIndex()];
  }

  function upcomingWorkout() {
    if (!state.plan) return null;
    for (let offset = 1; offset <= 7; offset += 1) {
      const day = state.plan.schedule[(currentDayIndex() + offset) % 7];
      if (day.kind === "workout") return { ...day, offset };
    }
    return null;
  }

  function sessionExercises(day) {
    if (!state.plan || !day) return [];
    if (day.kind === "workout") return [...day.warmup, ...day.exercises, ...day.cooldown];
    if (day.kind === "recovery") return day.exercises || [];
    return [];
  }

  function renderDashboard() {
    const profile = state.profile;
    const plan = state.plan;
    const greeting = document.getElementById("dashboard-greeting");
    if (!profile || !plan) {
      greeting.textContent = "Your next small win starts here.";
      document.getElementById("dashboard-subtitle").textContent = "Create your plan to see your personal schedule and progress.";
      document.getElementById("today-title").textContent = "A fresh start";
      document.getElementById("today-summary").textContent = "Your personalized session will appear here.";
      document.getElementById("today-duration").textContent = "Choose a goal to begin";
      document.getElementById("upcoming-title").textContent = "Your next session";
      document.getElementById("upcoming-summary").textContent = "It will appear here once your plan is ready.";
      document.getElementById("dashboard-start").disabled = false;
      document.getElementById("dashboard-start").textContent = "Build my plan →";
      document.getElementById("week-dots").innerHTML = "<i></i><i></i><i></i><i></i><i></i><i></i><i></i>";
      document.getElementById("week-count").textContent = "A week at your pace";
      document.getElementById("schedule-grid").innerHTML = "";
      document.getElementById("today-exercises").innerHTML = "";
      renderDashboardDetails();
      renderProgress();
      return;
    }
    greeting.textContent = profile.name ? `A plan that fits you, ${profile.name}.` : "Your plan is ready when you are.";
    document.getElementById("dashboard-subtitle").textContent = `${plan.available_minutes} minutes available · ${plan.level.toLowerCase()} friendly · ${plan.focus.join(", ")}`;
    const today = todayPlan();
    const upcoming = upcomingWorkout();
    const startButton = document.getElementById("dashboard-start");
    startButton.disabled = today.kind === "rest";
    startButton.textContent = today.kind === "rest" ? "Enjoy your rest day" : today.kind === "recovery" ? "Start easy movement →" : "Start today’s workout →";
    const activity = sessionExercises(today);
    document.getElementById("today-title").textContent = today.title;
    const mainNames = today.kind === "workout" ? today.exercises.slice(0, 4).map((exercise) => exercise.name) : [];
    const remaining = today.kind === "workout" ? today.exercises.length - mainNames.length : 0;
    document.getElementById("today-summary").textContent = today.kind === "rest"
      ? "Recovery is part of getting stronger."
      : today.kind === "recovery"
        ? "Keep it easy and do what feels comfortable."
        : `${mainNames.join(" · ")}${remaining > 0 ? ` · +${remaining} more` : ""}`;
    document.getElementById("today-duration").textContent = today.kind === "workout" ? `${today.duration_minutes} minutes · warm-up included` : today.kind === "rest" ? "A well-earned rest day" : `${today.duration_minutes} minutes · easy pace`;
    const completedIds = completedExerciseIdsToday();
    document.getElementById("today-exercises").innerHTML = activity.length
      ? activity.map((exercise) => {
        const complete = completedIds.has(exercise.id);
        return `<li class="${complete ? "exercise-done" : ""}"><span aria-hidden="true">${complete ? "✓" : "○"}</span>${escapeHtml(exercise.name)}<small>${complete ? "Done" : "To do"}</small></li>`;
      }).join("")
      : `<li class="today-rest-note">${today.kind === "rest" ? "Rest is part of your weekly plan." : "Your workout movements will appear here."}</li>`;
    document.getElementById("upcoming-title").textContent = upcoming ? `${upcoming.day} · ${upcoming.title}` : "Take it one day at a time";
    document.getElementById("upcoming-summary").textContent = upcoming ? `${upcoming.duration_minutes} minutes · ${upcoming.offset === 1 ? "tomorrow" : `in ${upcoming.offset} days`}` : "Your next session will show here.";
    const completedCount = activity.filter((exercise) => completedIds.has(exercise.id)).length;
    document.getElementById("today-progress").style.width = activity.length ? `${completedCount / activity.length * 100}%` : "0%";
    document.getElementById("week-dots").innerHTML = plan.schedule.map((day, index) => `<i class="${day.kind === "rest" ? "rest" : day.kind === "workout" ? "active" : ""} ${index === currentDayIndex() ? "today-dot" : ""}" title="${day.day}: ${day.title}"></i>`).join("");
    const week = workoutsThisWeek();
    const weeklyTarget = plan.schedule.filter((day) => day.kind === "workout").length;
    document.getElementById("week-count").textContent = `${week} of ${weeklyTarget} strength sessions this week`;
    document.getElementById("schedule-grid").innerHTML = plan.schedule.map((day, index) => `<div class="schedule-day ${day.kind === "rest" ? "rest-day" : ""} ${index === currentDayIndex() ? "today" : ""}"><b>${day.day}${index === currentDayIndex() ? " · TODAY" : ""}</b><span>${escapeHtml(day.title)}</span><small>${day.kind === "rest" ? "Recovery" : `${day.duration_minutes} min`}</small></div>`).join("");
    document.getElementById("progress").classList.remove("hidden");
    renderDashboardDetails();
    renderProgress();
  }

  function completedExerciseIdsToday() {
    const today = new Date().toDateString();
    return new Set((state.history || [])
      .filter((entry) => new Date(entry.date).toDateString() === today)
      .flatMap((entry) => Array.isArray(entry.exercise_ids) ? entry.exercise_ids : []));
  }

  function favorites() {
    if (!Array.isArray(state.favorites)) state.favorites = [];
    return state.favorites;
  }

  function renderDashboardDetails() {
    const profile = state.profile;
    const plan = state.plan;
    document.getElementById("profile-goals").textContent = profile && profile.goals.length ? profile.goals.join(", ") : "Create a plan to personalize your dashboard.";
    document.getElementById("profile-level").textContent = profile ? `${plan ? plan.level : profile.level} · ${profile.experience || "New to exercise"}` : "—";
    document.getElementById("profile-equipment").textContent = profile ? profile.equipment : "—";
    document.getElementById("profile-duration").textContent = profile ? `${profile.minutes} minutes` : "—";

    const savedIds = favorites();
    const savedExercises = library.filter((exercise) => savedIds.includes(exercise.id));
    document.getElementById("favorite-count").textContent = `${savedIds.length} saved ${savedIds.length === 1 ? "exercise" : "exercises"}`;
    document.getElementById("favorite-summary").textContent = savedExercises.length
      ? savedExercises.slice(0, 3).map((exercise) => exercise.name).join(" · ")
      : savedIds.length ? "Your saved movements are available from the exercise library." : "Save exercises from the library to keep them close.";

    const title = document.getElementById("daily-recommendation-title");
    const message = document.getElementById("daily-recommendation");
    const latest = (state.history || []).slice(-1)[0];
    if (!profile || !plan) {
      title.textContent = "Start with what feels manageable.";
      message.textContent = "Create a plan to see a recommendation shaped by your goals and completed workouts.";
    } else if (latest && latest.feedback === "too_hard") {
      title.textContent = "Keep your next session gentle.";
      message.textContent = `Your last workout felt challenging. Keep your ${profile.goals[0].toLowerCase()} goal, take the planned recovery time, and choose comfortable ranges of motion.`;
    } else if (latest && latest.feedback === "too_easy") {
      title.textContent = "Build gradually from your last session.";
      message.textContent = `Your last session felt manageable. Follow your ${profile.level.toLowerCase()} plan and increase effort only when each movement still feels controlled.`;
    } else if (todayPlan() && todayPlan().kind === "rest") {
      title.textContent = "Recovery is part of your plan.";
      message.textContent = `Today is a scheduled rest day. Let your ${profile.goals[0].toLowerCase()} focus recover; your next session is already mapped out.`;
    } else if (latest) {
      title.textContent = "Keep showing up at your pace.";
      const completedSessions = state.history.filter(isCompletedSession).length;
      message.textContent = `You’ve logged ${completedSessions} completed ${completedSessions === 1 ? "session" : "sessions"}. Continue with your ${profile.goals[0].toLowerCase()} plan and take breaks whenever you need them.`;
    } else {
      title.textContent = "Make your first session a small win.";
      message.textContent = `Your ${profile.goals.join(", ").toLowerCase()} plan is ready. Begin with today’s session and use the built-in timer at a comfortable pace.`;
    }
  }

  function workoutsThisWeek() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return state.history.filter((entry) => isCompletedSession(entry) && new Date(entry.date) >= start && entry.kind !== "recovery").length;
  }

  function isCompletedSession(entry) {
    return !entry.status || entry.status === "completed";
  }

  function renderProgress() {
    const history = state.history || [];
    const totalMinutes = history.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
    const totalExercises = history.reduce((sum, item) => sum + (Number(item.exercises) || 0), 0);
    const completedHistory = history.filter(isCompletedSession);
    const workoutCount = completedHistory.filter((entry) => entry.kind !== "recovery").length;
    const weeklyTarget = state.plan ? state.plan.schedule.filter((day) => day.kind === "workout").length : 0;
    const weeklyCount = workoutsThisWeek();
    const consistency = weeklyTarget ? Math.min(100, Math.round(weeklyCount / weeklyTarget * 100)) : 0;
    document.getElementById("completed-count").textContent = `${workoutCount} ${workoutCount === 1 ? "session" : "sessions"}`;
    document.getElementById("minutes-count").textContent = `${totalMinutes} active minutes so far`;
    document.getElementById("progress-workouts").textContent = workoutCount;
    document.getElementById("progress-exercises").textContent = totalExercises;
    document.getElementById("progress-minutes").textContent = totalMinutes;
    document.getElementById("progress-week").textContent = weeklyCount;
    document.getElementById("progress-consistency").textContent = `${consistency}%`;
    document.getElementById("consistency-caption").textContent = weeklyTarget
      ? `${weeklyCount} of ${weeklyTarget} planned workouts this week`
      : "Create a plan to track weekly consistency";
    document.getElementById("progress-milestones").textContent = (state.wins || []).length;
    document.getElementById("dashboard-consistency").textContent = state.plan
      ? `Weekly consistency: ${consistency}% (${weeklyCount}/${weeklyTarget})`
      : "Create a plan to track weekly consistency";

    const today = new Date();
    const days = [];
    for (let offset = 6; offset >= 0; offset--) {
      const day = new Date(today);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - offset);
      const minutes = history.filter((entry) => new Date(entry.date).toDateString() === day.toDateString()).reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
      days.push({ label: day.toLocaleDateString(undefined, { weekday: "short" }), minutes });
    }
    const max = Math.max(15, ...days.map((day) => day.minutes));
    document.getElementById("activity-chart").innerHTML = days.map((day) => `<div class="chart-day"><div class="chart-bar ${day.minutes ? "active" : ""}" title="${day.minutes} minutes" style="height:${Math.max(4, day.minutes / max * 95)}%"></div><small>${day.label}</small></div>`).join("");
    const monthStart = new Date(today);
    monthStart.setHours(0, 0, 0, 0);
    monthStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7) - 21);
    const monthWeeks = Array.from({ length: 4 }, (_, index) => {
      const start = new Date(monthStart);
      start.setDate(start.getDate() + index * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const count = completedHistory.filter((entry) => {
        const date = new Date(entry.date);
        return entry.kind !== "recovery" && date >= start && date < end;
      }).length;
      return { label: `Week ${index + 1}`, count };
    });
    const monthlyMax = Math.max(1, ...monthWeeks.map((week) => week.count));
    document.getElementById("monthly-chart").innerHTML = monthWeeks.map((week) =>
      `<div class="month-week" title="${week.count} completed ${week.count === 1 ? "workout" : "workouts"}"><div class="month-bar-track"><span style="height:${Math.max(4, week.count / monthlyMax * 100)}%"></span></div><b>${week.count}</b><small>${week.label}</small></div>`
    ).join("");
    const recentSessions = history.slice(-6);
    const recentMax = Math.max(1, ...recentSessions.map((entry) => Number(entry.exercises) || 0));
    document.getElementById("exercise-consistency").innerHTML = recentSessions.length
      ? recentSessions.map((entry) => {
        const exerciseCount = Number(entry.exercises) || 0;
        const date = new Date(entry.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return `<div class="consistency-row"><span>${escapeHtml(date)}</span><div class="consistency-track"><i style="width:${exerciseCount / recentMax * 100}%"></i></div><b>${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}</b></div>`;
      }).join("")
      : `<p class="empty-history">Complete a workout to see your exercise consistency here.</p>`;
    const recent = [...history].reverse().slice(0, 5);
    document.getElementById("workout-history").innerHTML = recent.length ? recent.map((item) => {
      const exerciseNames = Array.isArray(item.exercise_ids)
        ? item.exercise_ids.map((id) => exerciseName(id)).filter(Boolean)
        : [];
      const status = isCompletedSession(item) ? "Completed" : item.status === "in_progress" ? "In progress" : "Partially completed";
      return `<div class="history-row"><span class="history-check">${isCompletedSession(item) ? "✓" : "○"}</span><div><b>${escapeHtml(item.workout_title || item.focus || "Home workout")}</b><small>${new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${Number(item.minutes) || 0} min · ${Number(item.exercises) || 0} exercises · ${status}</small>${exerciseNames.length ? `<small class="history-exercise-names">${escapeHtml(exerciseNames.join(", "))}</small>` : ""}</div></div>`;
    }).join("") : `<p class="empty-history">Your completed sessions will show up here.</p>`;
    const wins = state.wins || [];
    document.getElementById("strength-wins").innerHTML = wins.slice(-3).reverse().map((win) => `<div class="win-row"><span>✦</span><div><b>${escapeHtml(win.text)}</b><small>${new Date(win.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></div></div>`).join("");
    const milestone = workoutCount >= 10 ? "10 sessions completed. That’s a meaningful habit you’ve built." : workoutCount >= 5 ? "5 sessions completed. You’re building a rhythm that’s yours." : workoutCount >= 1 ? "Your first session is a milestone. Keep going at your own pace." : "Your first milestone is simply beginning—there’s no rush.";
    document.getElementById("milestone-note").textContent = `✦ ${milestone}`;
    const reminder = document.getElementById("reminder-time");
    if (reminder) reminder.value = state.reminder || "";
  }

  function startWorkout() {
    const day = todayPlan();
    if (!day) {
      openWizard();
      return;
    }
    if (day.kind === "rest") {
      showToast("Today is a planned rest day. Recovery is part of your progress.");
      return;
    }
    playerExercises = sessionExercises(day);
    playerIndex = 0;
    currentSet = 1;
    setStarted = false;
    elapsedSessionSeconds = 0;
    completedExerciseCount = 0;
    completedExerciseIds = [];
    timerPaused = false;
    renderPlayer();
    openModal("workout-modal");
  }

  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function renderPlayer() {
    stopTimer();
    const exercise = playerExercises[playerIndex];
    if (!exercise) return;
    timerValue = 0;
    timerMode = null;
    setStarted = false;
    timerPaused = false;
    document.getElementById("player-step").textContent = `EXERCISE ${playerIndex + 1} OF ${playerExercises.length}`;
    document.getElementById("player-day").textContent = (todayPlan() || { title: "TODAY’S SESSION" }).title.toUpperCase();
    document.getElementById("player-progress").style.width = `${((playerIndex + 1) / playerExercises.length) * 100}%`;
    document.getElementById("player-content").innerHTML = `<div class="player-content">
      ${renderExerciseDemo(exercise.media)}
      <div class="exercise-phase">${escapeHtml(exercise.phase || "exercise")} · ${escapeHtml(exercise.target_muscles.join(", "))}</div>
      <h2 id="player-title">${escapeHtml(exercise.name)}</h2>
      <p class="exercise-purpose">${escapeHtml(exercise.purpose)}</p>
      <div class="exercise-details"><div class="exercise-detail"><span>Set</span><b id="set-count">${currentSet} of ${exercise.sets}</b></div><div class="exercise-detail"><span>Repetitions</span><b>${escapeHtml(exercise.reps || "Timed")}</b></div><div class="exercise-detail"><span>Rest between sets</span><b>${formatDuration(exercise.rest_seconds)}</b></div></div>
      <div class="instruction-box"><b>Starting position</b><p>${escapeHtml(exercise.starting_position)}</p><b class="instruction-label">Step-by-step</b><ol>${exercise.instructions.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
        <b class="instruction-label">Common mistakes</b><ul>${exercise.common_mistakes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        <b class="instruction-label">Easier alternative</b><p>${escapeHtml(exercise.easier_alternative)}</p>
        <b class="instruction-label">Safety</b><ul>${exercise.safety_instructions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      <div class="timer-box"><span id="timer-label">Ready when you are · ${exercise.type === "timed" ? `${formatDuration(exercise.work_seconds_per_set)} per set` : "elapsed time for this set"}</span><strong id="timer-display">00:00</strong></div>
      ${playerIndex === playerExercises.length - 1 ? `<label class="feedback-field">How did this session feel?<select id="workout-feedback"><option value="just_right">Just right</option><option value="too_hard">Harder than I wanted</option><option value="too_easy">Easier than expected</option></select></label>` : ""}
    </div>`;
    updatePlayerControls();
    timerHandle = setInterval(tickPlayerTimer, 1000);
  }

  function renderExerciseDemo(media) {
    const variants = {
      standing: '<circle cx="50" cy="18" r="10"/><path d="M50 29v34m0-24L31 49m19-10 19 10M50 63 36 88m14-25 16 25"/>',
      arms: '<circle cx="50" cy="18" r="10"/><path d="M50 29v34m0-24L31 42l-4 18m23-18 19 4 4 14M50 63 36 88m14-25 16 25"/>',
      hinge: '<circle cx="53" cy="18" r="9"/><path d="m49 29-15 24-19 7m38-28 15 13m-34 8 20 2m-20-2-2 28m22-27 12 27"/>',
      squat: '<circle cx="50" cy="15" r="9"/><path d="M50 25v25m0-17L31 43m19-10 18 10M50 50 35 64l15 7m0-21 17 10-10 16"/>',
      push: '<circle cx="29" cy="29" r="8"/><path d="m36 34 27 16m-16-9-9 12m25-3 15 13M44 50 34 72m30-22 8 22"/>',
      bridge: '<circle cx="24" cy="63" r="8"/><path d="M31 62 49 48l19 2 14 14m-33-16L43 78m25-28 12 28"/>',
      floor: '<circle cx="51" cy="20" r="9"/><path d="M50 30v28m0-18L31 50v18m19-10 20 10m-20-10-11 21m31-11 12 11"/>',
      row: '<circle cx="49" cy="20" r="9"/><path d="m47 31-9 26m8-18 20 5m-20-5-17 13m28-8 9 10m-28 3-10 25m18-22 19 22"/>',
      lunge: '<circle cx="50" cy="16" r="9"/><path d="M50 27v25m0-17L32 44m18-9 18 8M50 52 38 73l-13 12m25-33 11 19 17 8"/>',
      stretch: '<circle cx="50" cy="18" r="9"/><path d="M50 29v34m0-23L31 27m19 13 13-22M50 63 36 88m14-25 16 25"/>',
      mobility: '<circle cx="50" cy="18" r="9"/><path d="M50 29v34M50 39 28 27m22 12 22-12M50 63 36 88m14-25 16 25"/>'
    };
    const variant = variants[media && media.variant] ? media.variant : "standing";
    const symbol = media && media.symbol ? media.symbol : "✦";
    const alt = media && media.alt ? media.alt : "Exercise movement illustration";
    return `<div class="exercise-demo" role="img" aria-label="${escapeHtml(alt)}"><svg viewBox="0 0 100 100" aria-hidden="true"><g>${variants[variant]}</g></svg><span>${escapeHtml(symbol)}</span></div>`;
  }

  function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    if (value < 60) return `${value} sec`;
    const minutes = Math.floor(value / 60);
    const remain = value % 60;
    return remain ? `${minutes} min ${remain} sec` : `${minutes} min`;
  }

  function formatTime(seconds) {
    return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  }

  function updatePlayerControls() {
    const exercise = playerExercises[playerIndex];
    if (!exercise) return;
    const start = document.getElementById("player-start");
    const pause = document.getElementById("player-pause");
    const rest = document.getElementById("player-rest");
    const next = document.getElementById("player-next");
    const timerLabel = document.getElementById("timer-label");
    const setCount = document.getElementById("set-count");
    const display = document.getElementById("timer-display");
    if (timerMode === "rest") {
      start.textContent = "Rest in progress";
      start.disabled = true;
      timerLabel.textContent = "Rest timer";
    } else {
      start.disabled = timerMode === "exercise" || (exercise.type === "timed" && setStarted && !timerMode && timerValue === 0);
      start.textContent = timerMode === "exercise"
        ? "Set in progress"
        : exercise.type === "timed" && setStarted && timerValue === 0 ? "Timed set complete" : `Start set ${currentSet}`;
      timerLabel.textContent = timerMode === "exercise"
        ? exercise.type === "timed" ? `Timed movement · ${formatDuration(exercise.work_seconds_per_set)} per set` : "Elapsed time for this set"
        : exercise.type === "timed" ? `${formatDuration(exercise.work_seconds_per_set)} per set` : "Start when you’re ready";
    }
    pause.disabled = !timerMode;
    pause.textContent = timerPaused ? "Resume" : "Pause";
    rest.disabled = timerMode === "rest" || timerMode === "exercise" || !setStarted || !exercise.rest_seconds;
    if (setCount) setCount.textContent = `${currentSet} of ${exercise.sets}`;
    if (display) display.textContent = formatTime(timerValue);
    next.disabled = !setStarted || timerMode === "rest";
    next.textContent = currentSet < exercise.sets
      ? setStarted ? "Set complete · rest →" : "Start this set first"
      : playerIndex === playerExercises.length - 1 ? "Complete workout ✓" : "Next exercise →";
  }

  function startExerciseTimer() {
    const exercise = playerExercises[playerIndex];
    if (!exercise || timerMode) return;
    timerMode = "exercise";
    timerPaused = false;
    setStarted = true;
    timerValue = exercise.type === "timed" ? exercise.work_seconds_per_set : 0;
    updatePlayerControls();
  }

  function startRestTimer() {
    const exercise = playerExercises[playerIndex];
    if (!exercise || !exercise.rest_seconds) {
      showToast("No rest timer is needed for this movement.");
      return;
    }
    timerMode = "rest";
    timerPaused = false;
    timerValue = exercise.rest_seconds;
    updatePlayerControls();
  }

  function handlePlayerNext() {
    if (timerMode === "rest") {
      showToast("Finish the rest timer or pause it before continuing.");
      return;
    }
    stopTimer();
    timerMode = null;
    timerPaused = false;
    const exercise = playerExercises[playerIndex];
    if (currentSet < exercise.sets) {
      currentSet += 1;
      setStarted = false;
      startRestTimer();
      updatePlayerControls();
      timerHandle = setInterval(tickPlayerTimer, 1000);
      return;
    }
    completedExerciseCount += 1;
    completedExerciseIds.push(exercise.id);
    if (playerIndex === playerExercises.length - 1) {
      completeWorkout();
      return;
    }
    playerIndex += 1;
    currentSet = 1;
    setStarted = false;
    renderPlayer();
  }

  function tickPlayerTimer() {
    if (timerPaused || !timerMode) return;
    const exercise = playerExercises[playerIndex];
    if (timerMode === "rest" || (timerMode === "exercise" && exercise.type === "timed")) {
      timerValue = Math.max(0, timerValue - 1);
      if (timerValue === 0) {
        timerMode = null;
        timerPaused = false;
      }
    } else {
      timerValue += 1;
    }
    elapsedSessionSeconds += 1;
    updatePlayerControls();
  }

  function skipExercise() {
    stopTimer();
    timerMode = null;
    timerPaused = false;
    if (playerIndex === playerExercises.length - 1) {
      closeModal("workout-modal");
      showToast("Workout ended early. Skipped movements were not counted as completed.");
      return;
    }
    playerIndex += 1;
    currentSet = 1;
    renderPlayer();
  }

  function completeWorkout() {
    stopTimer();
    const day = todayPlan();
    const minutes = Math.max(1, Math.ceil(elapsedSessionSeconds / 60));
    const feedback = document.getElementById("workout-feedback");
    state.history.push({
      session_id: `fitguide-${Date.now()}`,
      date: new Date().toISOString(),
      elapsed_seconds: elapsedSessionSeconds,
      minutes,
      exercises: completedExerciseCount,
      exercise_ids: [...completedExerciseIds],
      workout_title: day ? day.title : "Home workout",
      kind: day ? day.kind : "workout",
      focus: day ? day.focus : state.plan.focus.join(", "),
      status: "completed",
      feedback: feedback ? feedback.value : "just_right"
    });
    saveState();
    closeModal("workout-modal");
    renderDashboard();
    showToast("Workout complete. Thanks for showing up for yourself.");
  }

  function renderLibrary() {
    const grid = document.getElementById("exercise-grid");
    if (!grid) return;
    const query = document.getElementById("exercise-search").value;
    const category = document.getElementById("exercise-filter").value.toLowerCase();
    const difficulty = document.getElementById("exercise-difficulty-filter").value;
    const equipment = document.getElementById("exercise-equipment-filter").value;
    const type = document.getElementById("exercise-type-filter").value;
    const savedIds = favorites();
    if (!library.length) {
      grid.innerHTML = `<p class="no-results">${escapeHtml(libraryError || "Exercise catalog is loading…")}</p>`;
      document.getElementById("library-result-count").textContent = "";
      return;
    }
    const categoryMatches = (exercise) => {
      if (category === "all") return true;
      if (category === "warm-up") return exercise.phase === "warmup";
      if (category === "cool-down") return exercise.phase === "cooldown";
      if (category === "full body") return exercise.muscle_groups.some((group) => /^(full body|whole body)$/i.test(group)) ||
        exercise.goals.some((goal) => /full body|general fitness/i.test(goal));
      if (category === "flexibility") return exercise.goals.some((goal) => /flexibility/i.test(goal)) ||
        exercise.muscle_groups.some((group) => /flexibility/i.test(group));
      if (category === "mobility") return exercise.goals.some((goal) => /mobility/i.test(goal)) ||
        exercise.muscle_groups.some((group) => /mobility/i.test(group));
      return exercise.muscle_groups.some((group) => group.toLowerCase() === category);
    };
    const items = library.filter((exercise) => {
      return categoryMatches(exercise) &&
        (difficulty === "all" || exercise.difficulty.includes(difficulty)) &&
        (equipment === "all" || (equipment === "none" ? exercise.equipment.length === 0 : exercise.equipment.includes(equipment))) &&
        (type === "all" || exercise.type === type) &&
        matchesExerciseSearch(exercise, query);
    });
    document.getElementById("library-result-count").textContent = `Showing ${items.length} of ${library.length} exercises`;
    grid.innerHTML = items.length ? items.map((exercise) => {
      const saved = savedIds.includes(exercise.id);
      return `<article class="exercise-card">
        <div class="exercise-card-top"><span class="exercise-difficulty">${escapeHtml(exercise.difficulty.join(" · "))}</span><button class="favorite-button ${saved ? "saved" : ""}" type="button" data-favorite-exercise="${escapeHtml(exercise.id)}" aria-label="${saved ? "Remove from" : "Save to"} favorites" aria-pressed="${saved}">${saved ? "♥" : "♡"}</button></div>
        ${renderExerciseDemo(exercise.media)}
        <h3>${escapeHtml(exercise.name)}</h3>
        <p>${escapeHtml(exercise.purpose)}</p>
        <span class="exercise-tag">${escapeHtml(exercise.muscle_groups.join(" · "))}</span>
        <dl class="exercise-card-facts"><div><dt>Equipment</dt><dd>${escapeHtml(equipmentLabel(exercise.equipment))}</dd></div><div><dt>Duration</dt><dd>${escapeHtml(exerciseDuration(exercise))}</dd></div></dl>
        <button class="button button-quiet exercise-detail-button" type="button" data-exercise-details="${escapeHtml(exercise.id)}">View Details <span aria-hidden="true">→</span></button>
      </article>`;
    }).join("") : `<p class="no-results"><strong>No exercises found.</strong><span>Try a different exercise name or category.</span></p>`;
  }

  function normalizeSearchText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesExerciseSearch(exercise, query) {
    const terms = normalizeSearchText(query).split(" ").filter(Boolean);
    if (!terms.length) return true;

    const muscleAliases = {
      back: ["lats", "upper back"],
      biceps: ["bicep"],
      chest: ["pec", "pecs", "pectoral", "pectorals"],
      core: ["abs", "abdominal", "abdominals"],
      glutes: ["buttocks"],
      hamstrings: ["hamstring"],
      quadriceps: ["quad", "quads", "quadricep"],
      shoulders: ["shoulder", "deltoid", "delts"],
      triceps: ["tricep"]
    };
    const muscles = exercise.muscle_groups.flatMap((group) => [
      group,
      ...(muscleAliases[normalizeSearchText(group)] || [])
    ]);
    const phaseKeywords = exercise.phase === "warmup" ? ["warm up", "warmup"] :
      exercise.phase === "cooldown" ? ["cool down", "cooldown"] : [];
    const typeKeywords = exercise.type === "reps"
      ? ["repetitions", "reps", "strength"]
      : ["timed", "time", "duration", "hold"];
    const searchable = normalizeSearchText([
      exercise.name,
      exercise.goals,
      muscles,
      exercise.purpose,
      exercise.equipment,
      equipmentLabel(exercise.equipment),
      exercise.difficulty,
      exercise.type,
      typeKeywords,
      phaseKeywords,
      exercise.instructions,
      exercise.starting_position,
      exercise.common_mistakes,
      exercise.easier_alternative,
      exercise.safety_instructions
    ].flat().join(" "));
    const words = searchable.split(" ");
    const compact = searchable.replace(/\s/g, "");
    const compactQuery = terms.join("");

    return terms.every((term) => {
      const singular = term.length > 3 && term.endsWith("s") ? term.slice(0, -1) : term;
      const plural = term.length > 3 && !term.endsWith("s") ? `${term}s` : term;
      return words.some((word) => word === term || word === singular || word === plural) ||
        compact.includes(compactQuery);
    });
  }

  function exerciseName(id) {
    const exercise = library.find((item) => item.id === id);
    return exercise ? exercise.name : "";
  }

  function equipmentLabel(items) {
    const labels = {
      band: "Resistance bands",
      chair: "Chair",
      counter: "Counter",
      dumbbells: "Dumbbells",
      mat: "Exercise mat",
      wall: "Wall"
    };
    return items.length ? items.map((item) => labels[item] || item).join(", ") : "No equipment";
  }

  function exerciseDuration(exercise) {
    const seconds = Number(exercise.duration_seconds) ||
      Number(exercise.work_seconds_per_set) * (Number(exercise.sets) || 1);
    return seconds ? formatDuration(seconds) : "Varies by pace";
  }

  function populateEquipmentFilter() {
    const select = document.getElementById("exercise-equipment-filter");
    if (!select) return;
    const options = [...new Set(library.flatMap((exercise) => exercise.equipment))].sort();
    const selected = select.value;
    select.innerHTML = `<option value="all">Any equipment</option><option value="none">No equipment</option>${options.map((item) =>
      `<option value="${escapeHtml(item)}">${escapeHtml(equipmentLabel([item]))}</option>`
    ).join("")}`;
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function renderExerciseDetails(exercise) {
    const saved = favorites().includes(exercise.id);
    const level = state.plan ? state.plan.level : "Beginner";
    const sets = exercise.sets_by_level ? exercise.sets_by_level[level] : exercise.sets;
    const reps = exercise.reps_by_level ? exercise.reps_by_level[level] : exercise.reps;
    const rest = exercise.rest_seconds_by_level ? exercise.rest_seconds_by_level[level] : exercise.rest_seconds;
    const prescription = exercise.type === "timed"
      ? `${sets || 1} × ${formatDuration(exercise.work_seconds_per_set || exercise.duration_seconds)}`
      : `${sets || 1} × ${reps || "comfortable repetitions"}`;
    document.getElementById("exercise-detail-content").innerHTML = `
      ${renderExerciseDemo(exercise.media)}
      <span class="exercise-tag">${escapeHtml(exercise.muscle_groups.join(" · "))}</span>
      <h2 id="exercise-detail-title">${escapeHtml(exercise.name)}</h2>
      <p>${escapeHtml(exercise.purpose)}</p>
      <div class="exercise-detail-facts"><span><b>Difficulty</b>${escapeHtml(exercise.difficulty.join(" · "))}</span><span><b>Equipment</b>${escapeHtml(equipmentLabel(exercise.equipment))}</span><span><b>Duration</b>${escapeHtml(exerciseDuration(exercise))}</span></div>
      <div class="exercise-detail-copy"><b>Starting position</b><p>${escapeHtml(exercise.starting_position)}</p><b>Step-by-step technique</b><ol>${exercise.instructions.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol><b>Sets and repetitions</b><p>${escapeHtml(prescription)}</p><b>Rest time</b><p>${formatDuration(rest)}</p><b>Common mistakes</b><ul>${exercise.common_mistakes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><b>Easier alternative</b><p>${escapeHtml(exercise.easier_alternative)}</p><b>Safety instructions</b><ul>${exercise.safety_instructions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      <button class="button ${saved ? "button-dark" : "button-primary"} detail-favorite-button" type="button" data-favorite-exercise="${escapeHtml(exercise.id)}" aria-pressed="${saved}">${saved ? "♥ Saved to favorites" : "♡ Save to favorites"}</button>`;
  }

  function toggleFavorite(id) {
    const savedIds = favorites();
    if (savedIds.includes(id)) {
      state.favorites = savedIds.filter((savedId) => savedId !== id);
    } else if (library.some((exercise) => exercise.id === id)) {
      state.favorites = [...savedIds, id];
    } else {
      return;
    }
    saveState();
    renderLibrary();
    if (document.getElementById("favorite-count")) renderDashboardDetails();
    if (document.getElementById("progress-workouts")) renderProgress();
    const selected = library.find((exercise) => exercise.id === id);
    const modal = document.getElementById("exercise-modal");
    if (selected && modal && modal.classList.contains("open")) renderExerciseDetails(selected);
  }

  async function loadExerciseLibrary() {
    try {
      const response = await fetch(apiUrl("/api/exercises"));
      if (!response.ok) throw new Error(`Exercise catalog request failed (HTTP ${response.status}).`);
      const result = await readApiJson(response);
      if (!result || !Array.isArray(result.exercises)) throw new Error("Exercise catalog response was incomplete.");
      library = result.exercises;
      libraryError = "";
    } catch (apiError) {
      try {
        const response = await fetch("./exercise-library.json", { cache: "no-cache" });
        if (!response.ok) throw new Error(`Local exercise file request failed (HTTP ${response.status}).`);
        const exercises = await readApiJson(response);
        if (!Array.isArray(exercises)) throw new Error("Local exercise file did not contain an exercise list.");
        library = exercises;
        libraryError = "";
      } catch (fileError) {
        library = [];
        libraryError = "Exercise catalog unavailable. Start the fitora server with npm start or serve the project folder.";
        console.error("fitora could not load its local exercise catalog.", { apiError, fileError });
      }
    }
    if (library.length && document.getElementById("exercise-equipment-filter")) populateEquipmentFilter();
    renderLibrary();
    if (document.getElementById("favorite-count")) renderDashboardDetails();
    if (document.getElementById("progress-workouts")) renderProgress();
  }

  function answerAssistant(question) {
    const value = question.toLowerCase();
    if (/(pain|injur|dizz|medical|diagnos|condition|hurt)/.test(value)) return "If you’re experiencing pain, dizziness, or have a health concern, stop exercising and speak with a qualified healthcare professional. fitora can’t diagnose conditions or replace medical advice.";
    if (/(push.?up|wall push)/.test(value)) return "For a wall push-up, place your hands at chest height on a wall, slightly wider than your shoulders. Keep your body comfortable and steady, bend your elbows toward the wall, then gently press away. Move slowly and use a smaller range if that feels better.";
    if (/(core|abs|middle)/.test(value)) return "Try steady, comfortable movements such as bird dogs or heel taps. Focus on breathing normally and keeping the movement controlled. Start with a small range, and stop if anything feels painful.";
    if (/(rest|recover|day off)/.test(value)) return "Rest is part of training, not a setback. You could take a full rest day or choose an easy walk and gentle mobility if that feels good. Skip movement if you need more recovery.";
    if (/(flex|stretch|mobility)/.test(value)) return "Begin with comfortable shoulder rolls, gentle side reaches, or easy leg stretches. Keep the range light—never bounce or force a stretch. Stop if you feel pain.";
    if (/(today|plan|workout|session)/.test(value)) {
      if (!state.plan) return "Start by choosing a goal and sharing a few preferences. fitora will create a short, home-friendly plan with warm-ups, clear instructions, and recovery days.";
      return `Your current plan allows ${state.plan.available_minutes} minutes per session, with a ${state.plan.level.toLowerCase()}-friendly focus on ${state.plan.focus.join(", ")}. Open “Your weekly rhythm” to see today’s session. You can update your plan anytime.`;
    }
    if (/(equipment|home|house)/.test(value)) return "You can get started with bodyweight movements and a sturdy chair or wall for support. Choose “No equipment” in your plan settings, or add equipment you already have.";
    return "I can help with general exercise technique, home movement ideas, core strength, flexibility, recovery, or explaining your plan. What would you like to explore? This guide is educational, not medical advice.";
  }

  function setupReminder() {
    const input = document.getElementById("reminder-time");
    if (!input.value) {
      showToast("Choose a time for your reminder first.");
      return;
    }
    state.reminder = input.value;
    saveState();
    showToast("Reminder saved for this browser. Keep fitora open to receive the reminder.");
  }

  function checkReminder() {
    if (!state.reminder || !state.profile || document.visibilityState !== "visible") return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (time === state.reminder && localStorage.getItem(`${STORAGE_KEY}.reminded`) !== today) {
      localStorage.setItem(`${STORAGE_KEY}.reminded`, today);
      showToast("A gentle reminder: your fitora session is ready whenever you are.");
    }
  }

  function downloadPlan() {
    if (!state.plan || !state.profile) {
      showToast("Create a plan before downloading it.");
      return;
    }
    const lines = [
      "fitora — Your Home. Your Fitness. Your Progress.",
      `Goals: ${state.plan.focus.join(", ")}`,
      `Experience: ${state.plan.level} | Available time: ${state.plan.available_minutes} minutes | Equipment: ${state.plan.equipment}`,
      "",
      "Weekly rhythm:"
    ];
    state.plan.schedule.forEach((day) => {
      lines.push("", `${day.day}: ${day.title} (${day.kind}${day.duration_minutes ? `, ${day.duration_minutes} min` : ""})`);
      [...(day.warmup || []), ...(day.exercises || []), ...(day.cooldown || [])].forEach((exercise, index) => {
        lines.push(`${index + 1}. ${exercise.name} — ${exercise.sets} set(s), ${exercise.reps || formatDuration(exercise.duration_seconds)}; rest ${formatDuration(exercise.rest_seconds)}.`);
        lines.push(`   Start: ${exercise.starting_position}`);
        exercise.instructions.forEach((step, stepIndex) => lines.push(`   ${stepIndex + 1}) ${step}`));
        lines.push(`   Easier option: ${exercise.easier_alternative}`);
        lines.push(`   Safety: ${exercise.safety_instructions.join(" ")}`);
      });
    });
    lines.push("", "Safety: General fitness education only, not medical advice. Stop if you experience pain, dizziness, or unusual discomfort.");
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fitguide-workout-plan.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  function setupLibraryInteractions() {
    document.getElementById("exercise-grid").addEventListener("click", (event) => {
      const favoriteButton = event.target.closest("[data-favorite-exercise]");
      if (favoriteButton) {
        toggleFavorite(favoriteButton.dataset.favoriteExercise);
        return;
      }
      const detailsButton = event.target.closest("[data-exercise-details]");
      if (!detailsButton) return;
      const exercise = library.find((item) => item.id === detailsButton.dataset.exerciseDetails);
      if (!exercise) return;
      detailsButton.focus();
      renderExerciseDetails(exercise);
      openModal("exercise-modal");
      document.getElementById("exercise-modal-close").focus();
    });
    document.getElementById("exercise-detail-content").addEventListener("click", (event) => {
      const favoriteButton = event.target.closest("[data-favorite-exercise]");
      if (favoriteButton) toggleFavorite(favoriteButton.dataset.favoriteExercise);
    });
    document.getElementById("exercise-modal-close").addEventListener("click", () => closeModal("exercise-modal"));
    document.getElementById("exercise-modal").addEventListener("click", (event) => {
      if (event.target.id === "exercise-modal") closeModal("exercise-modal");
    });

    const exerciseSearch = document.getElementById("exercise-search");
    const clearExerciseSearch = document.getElementById("clear-exercise-search");
    exerciseSearch.addEventListener("input", () => {
      clearExerciseSearch.hidden = !exerciseSearch.value;
      renderLibrary();
    });
    clearExerciseSearch.addEventListener("click", () => {
      exerciseSearch.value = "";
      clearExerciseSearch.hidden = true;
      renderLibrary();
      exerciseSearch.focus();
    });
    document.getElementById("reset-library-filters").addEventListener("click", () => {
      exerciseSearch.value = "";
      clearExerciseSearch.hidden = true;
      ["exercise-filter", "exercise-difficulty-filter", "exercise-equipment-filter", "exercise-type-filter"].forEach((id) => {
        document.getElementById(id).value = "all";
      });
      renderLibrary();
    });
    ["exercise-filter", "exercise-difficulty-filter", "exercise-equipment-filter", "exercise-type-filter"].forEach((id) =>
      document.getElementById(id).addEventListener("change", renderLibrary));
  }

  function initExerciseLibraryPage() {
    if (window.FitGuidePage) window.FitGuidePage.initNavigation();
    setupLibraryInteractions();
    loadExerciseLibrary();
    document.addEventListener("keydown", (event) => {
      const modal = document.getElementById("exercise-modal");
      if (event.key === "Escape" && modal.classList.contains("open")) closeModal("exercise-modal");
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      state = loadState();
      document.body.classList.toggle("dark", state.theme === "dark");
      document.getElementById("theme-toggle").textContent = state.theme === "dark" ? "☀" : "☾";
      renderLibrary();
      const modal = document.getElementById("exercise-modal");
      const favoriteButton = modal.classList.contains("open")
        ? modal.querySelector("[data-favorite-exercise]")
        : null;
      const selectedId = favoriteButton ? favoriteButton.dataset.favoriteExercise : "";
      const selected = library.find((exercise) => exercise.id === selectedId);
      if (selected) renderExerciseDetails(selected);
    });
  }

  function init() {
    if (document.body.classList.contains("exercise-library-page")) {
      initExerciseLibraryPage();
      return;
    }

    document.getElementById("year").textContent = new Date().getFullYear();
    if (state.theme === "dark") document.body.classList.add("dark");
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) themeToggle.textContent = state.theme === "dark" ? "☀" : "☾";
    loadExerciseLibrary();
    renderDashboard();

    document.querySelectorAll("[data-open-wizard]:not(#dashboard-start)").forEach((button) => button.addEventListener("click", openWizard));
    document.getElementById("dashboard-start").addEventListener("click", () => state.plan ? startWorkout() : openWizard());
    document.getElementById("wizard-close").addEventListener("click", () => closeModal("wizard-modal"));
    document.getElementById("wizard-back").addEventListener("click", () => {
      captureDraft();
      if (wizardStep > 0) wizardStep -= 1;
      renderWizard();
    });
    document.getElementById("wizard-next").addEventListener("click", () => {
      captureDraft();
      const error = document.getElementById("wizard-error");
      if (wizardStep === 0) {
        const age = Number(draft.age);
        if (!draft.age || !Number.isInteger(age) || age < 13 || age > 110) {
          error.textContent = "Enter an age from 13 to 110. For younger users, please involve a parent/guardian and qualified professional.";
          return;
        }
        wizardStep = 1;
        renderWizard();
      } else if (wizardStep === 1) {
        if ((draft.healthConcern || draft.limitation || (draft.limitTags && draft.limitTags.length)) && !draft.safetyConfirmed) {
          error.textContent = "Please check with a qualified healthcare professional before creating an exercise plan.";
          return;
        }
        wizardStep = 2;
        renderWizard();
      } else finishWizard();
    });
    document.getElementById("wizard-content").addEventListener("click", (event) => {
      const button = event.target.closest("[data-goal]");
      if (!button) return;
      const goal = button.dataset.goal;
      selectedGoals = selectedGoals.includes(goal) ? selectedGoals.filter((item) => item !== goal) : [...selectedGoals, goal];
      button.classList.toggle("selected", selectedGoals.includes(goal));
      button.querySelector("span").textContent = selectedGoals.includes(goal) ? "✓" : "";
    });
    document.getElementById("wizard-modal").addEventListener("click", (event) => {
      if (event.target.id === "wizard-modal") closeModal("wizard-modal");
    });

    document.getElementById("player-close").addEventListener("click", () => closeModal("workout-modal"));
    document.getElementById("workout-modal").addEventListener("click", (event) => {
      if (event.target.id === "workout-modal") closeModal("workout-modal");
    });
    document.getElementById("player-start").addEventListener("click", startExerciseTimer);
    document.getElementById("player-rest").addEventListener("click", startRestTimer);
    document.getElementById("player-skip").addEventListener("click", skipExercise);
    document.getElementById("player-pause").addEventListener("click", () => {
      timerPaused = !timerPaused;
      updatePlayerControls();
    });
    document.getElementById("player-next").addEventListener("click", handlePlayerNext);

    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        document.body.classList.toggle("dark");
        state.theme = document.body.classList.contains("dark") ? "dark" : "light";
        themeToggle.textContent = state.theme === "dark" ? "☀" : "☾";
        saveState();
      });
    }
    const menuToggle = document.getElementById("menu-toggle");
    const mainNav = document.querySelector(".main-nav");
    menuToggle.addEventListener("click", () => {
      const isOpen = mainNav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    });
    document.querySelectorAll(".main-nav a").forEach((link) => link.addEventListener("click", () => {
      mainNav.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open menu");
    }));

    document.querySelectorAll(".goal-chip").forEach((button) => button.addEventListener("click", () => button.classList.toggle("selected")));
    document.getElementById("assistant-send").addEventListener("click", () => {
      const input = document.getElementById("assistant-input");
      if (!input.value.trim()) return;
      const answer = document.getElementById("assistant-answer");
      answer.textContent = answerAssistant(input.value.trim());
      answer.classList.add("visible");
    });
    document.getElementById("assistant-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") document.getElementById("assistant-send").click();
    });
    document.getElementById("download-plan").addEventListener("click", downloadPlan);
    document.getElementById("delete-data").addEventListener("click", () => {
      if (!window.confirm("Delete your fitora profile, plan, preferences, and workout history from this browser? This cannot be undone.")) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(`${STORAGE_KEY}.reminded`);
      state = { profile: null, plan: null, history: [], wins: [], favorites: [], theme: "light", reminder: "" };
      document.body.classList.remove("dark");
      const themeToggle = document.getElementById("theme-toggle");
      if (themeToggle) themeToggle.textContent = "☾";
      document.getElementById("progress").classList.add("hidden");
      document.getElementById("dashboard-start").textContent = "Build my plan →";
      renderDashboard();
      showToast("Your fitora data has been deleted from this browser.");
    });
    const setReminder = document.getElementById("set-reminder");
    if (setReminder) setReminder.addEventListener("click", setupReminder);
    document.getElementById("strength-win-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("strength-win-input");
      const text = input.value.trim();
      if (!text) {
        showToast("Add a short note about your strength win first.");
        return;
      }
      if (!state.wins) state.wins = [];
      state.wins.push({ text, date: new Date().toISOString() });
      input.value = "";
      saveState();
      renderProgress();
      showToast("Your strength win has been saved.");
    });

    document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (target && target.classList.contains("hidden")) {
        target.classList.remove("hidden");
        setTimeout(() => target.scrollIntoView({ behavior: "smooth" }), 0);
      }
    }));
    const hashTarget = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (hashTarget && hashTarget.classList.contains("hidden")) hashTarget.classList.remove("hidden");
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal("wizard-modal");
        closeModal("workout-modal");
      }
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      state = loadState();
      document.body.classList.toggle("dark", state.theme === "dark");
      const themeToggle = document.getElementById("theme-toggle");
      if (themeToggle) themeToggle.textContent = state.theme === "dark" ? "☀" : "☾";
      renderDashboard();
      renderLibrary();
    });
    setInterval(checkReminder, 30000);
  }

  init();
})();
