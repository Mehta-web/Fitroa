(() => {
  "use strict";

  const page = window.FitGuidePage;
  let state = page.readState();
  let selectedRange = "weekly";
  const ranges = ["weekly", "monthly", "all"];

  function isCompleted(entry) {
    return !entry.status || entry.status === "completed";
  }

  function hasActivity(entry) {
    return (Number(entry.exercises) || 0) > 0 || (Number(entry.elapsed_seconds) || 0) > 0 ||
      (!entry.status && (Number(entry.minutes) || 0) > 0);
  }

  function entryKey(entry) {
    return entry.date_key || page.dateKey(entry.date);
  }

  function entryDate(entry) {
    return new Date(`${entryKey(entry)}T12:00:00`);
  }

  function activitySeconds(entry) {
    if (Number.isFinite(Number(entry.elapsed_seconds)) && entry.elapsed_seconds !== null) {
      return Math.max(0, Number(entry.elapsed_seconds));
    }
    return Math.max(0, Number(entry.minutes) || 0) * 60;
  }

  function completedWorkouts() {
    return state.history.filter((entry) => isCompleted(entry) && entry.kind !== "recovery" && entry.kind !== "rest");
  }

  function completedThisWeek() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return completedWorkouts().filter((entry) => {
      const date = entryDate(entry);
      return date >= start && date < end;
    });
  }

  function goalText(value) {
    return Array.isArray(value) ? value.join(", ") : String(value || "");
  }

  function goalMatches(entry, goal) {
    const focus = goalText(entry.focus).toLowerCase();
    if (focus.includes(goal.toLowerCase())) return true;
    const aliases = {
      "core strength": ["core", "abdominal", "abs"],
      "stronger arms": ["arm", "bicep", "tricep"],
      "chest strength": ["chest", "pec"],
      "stronger legs": ["leg", "glute", "hamstring", "quad"],
      "shoulder strength": ["shoulder", "deltoid"],
      "back & posture": ["back", "posture", "upper back"],
      "full body fitness": ["full body", "whole body", "general fitness"],
      flexibility: ["flexibility", "stretch"],
      "general fitness": ["general fitness", "full body"]
    };
    const terms = aliases[goal.toLowerCase()] || [goal.toLowerCase()];
    return terms.some((term) => focus.includes(term));
  }

  function reflectionLabel(feedback) {
    return feedback === "too_easy" ? "Felt easier than expected"
      : feedback === "too_hard" ? "Felt harder than expected"
        : feedback === "just_right" ? "Felt just right" : "No reflection recorded";
  }

  function renderStatistics() {
    const history = state.history;
    const workouts = completedWorkouts();
    const weekly = completedThisWeek();
    const totalSeconds = history.reduce((sum, entry) => sum + activitySeconds(entry), 0);
    const totalExercises = history.reduce((sum, entry) => sum + (Number(entry.exercises) || 0), 0);
    const weeklyTarget = state.plan && Array.isArray(state.plan.schedule)
      ? state.plan.schedule.filter((day) => day.kind === "workout").length : 0;
    const consistency = weeklyTarget ? Math.min(100, Math.round(weekly.length / weeklyTarget * 100)) : 0;
    document.getElementById("total-workouts").textContent = workouts.length;
    document.getElementById("workout-stat-caption").textContent = `${workouts.length} completed ${workouts.length === 1 ? "session" : "sessions"} recorded`;
    document.getElementById("total-minutes").textContent = Math.round(totalSeconds / 60);
    document.getElementById("total-exercises").textContent = totalExercises;
    document.getElementById("weekly-activity").textContent = weekly.length;
    document.getElementById("weekly-activity-caption").textContent = `${weekly.length} completed ${weekly.length === 1 ? "workout" : "workouts"} this week`;
    document.getElementById("workout-consistency").textContent = `${consistency}%`;
    document.getElementById("consistency-caption").textContent = weeklyTarget
      ? `${weekly.length} of ${weeklyTarget} planned workout sessions this week`
      : "Create a plan to set a weekly target";
    const minutes = Math.round(totalSeconds / 60);
    document.getElementById("week-chart-total").textContent = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    document.getElementById("week-chart-caption").textContent = `${weekly.length} completed ${weekly.length === 1 ? "session" : "sessions"} this week`;
  }

  function mondayOf(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }

  function dayRecords(date) {
    const key = page.dateKey(date);
    return state.history.filter((entry) => entryKey(entry) === key && hasActivity(entry));
  }

  function renderWeeklyChart() {
    const now = new Date();
    const monday = mondayOf(now);
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weeklyPlan = state.plan && Array.isArray(state.plan.schedule) ? state.plan.schedule : [];
    const records = days.map((label, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const entries = dayRecords(date);
      const seconds = entries.reduce((sum, entry) => sum + activitySeconds(entry), 0);
      const sessions = entries.length;
      const rest = weeklyPlan[index] && weeklyPlan[index].kind === "rest" && sessions === 0;
      return {
        label,
        date,
        sessions,
        minutes: Math.round(seconds / 60),
        rest,
        value: seconds / 60
      };
    });
    const max = Math.max(1, ...records.map((item) => item.value));
    document.getElementById("weekly-chart").innerHTML = records.map((item) => {
      const height = item.value ? Math.max(5, item.value / max * 100) : 0;
      const date = page.formatDate(item.date, { month: "short", day: "numeric" });
      return `<div class="activity-period" title="${date}: ${item.sessions} sessions, ${item.minutes} exercise minutes${item.rest ? ", planned rest day" : ""}">
        <div class="activity-bar-track ${item.rest ? "rest-day" : ""}"><span class="activity-bar" style="height:${height}%"></span></div>
        <div class="activity-values">${item.sessions} ${item.sessions === 1 ? "session" : "sessions"}<span>${item.minutes} min</span></div>
        <b>${item.label}</b><small>${item.rest ? "Rest day" : date}</small>
      </div>`;
    }).join("");
  }

  function groupEntries(entries, start, end, label) {
    const periodRecords = entries.filter((entry) => {
      const date = entryDate(entry);
      return date >= start && date < end;
    });
    const seconds = periodRecords.reduce((sum, entry) => sum + activitySeconds(entry), 0);
    const sessions = periodRecords.filter((entry) => isCompleted(entry) && entry.kind !== "rest").length;
    return { label, seconds, sessions, minutes: Math.round(seconds / 60) };
  }

  function trendPeriods() {
    const history = state.history.filter((entry) => hasActivity(entry) || isCompleted(entry));
    const now = new Date();
    if (selectedRange === "weekly") {
      const monday = mondayOf(now);
      const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      return labels.map((label, index) => {
        const start = new Date(monday);
        start.setDate(start.getDate() + index);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return groupEntries(history, start, end, label);
      });
    }
    if (selectedRange === "monthly") {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const periods = [];
      for (let day = 1; day <= daysInMonth; day += 7) {
        const endDay = Math.min(daysInMonth + 1, day + 7);
        const start = new Date(now.getFullYear(), now.getMonth(), day);
        const end = new Date(now.getFullYear(), now.getMonth(), endDay);
        periods.push(groupEntries(history, start, end, `${day}–${endDay - 1}`));
      }
      if (!periods.length) return [groupEntries(history, first, new Date(now.getFullYear(), now.getMonth() + 1, 1), "This month")];
      return periods;
    }
    const dates = history.map(entryDate).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => a - b);
    const first = dates.length ? new Date(dates[0].getFullYear(), dates[0].getMonth(), 1) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const periods = [];
    for (let start = new Date(first); start < endMonth; start.setMonth(start.getMonth() + 1)) {
      const periodStart = new Date(start);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      periods.push(groupEntries(history, periodStart, end, periodStart.toLocaleDateString(undefined, { month: "short", year: "2-digit" })));
    }
    return periods;
  }

  function renderTrendChart() {
    const labels = { weekly: "Weekly activity", monthly: "Monthly activity", all: "All-time activity" };
    const captions = { weekly: "Recorded exercise minutes, Monday through Sunday", monthly: "Recorded activity grouped by week this month", all: "All recorded activity grouped by month" };
    const periods = trendPeriods();
    const max = Math.max(1, ...periods.map((item) => item.minutes));
    document.getElementById("trend-chart-title").textContent = labels[selectedRange];
    document.getElementById("trend-chart-caption").textContent = captions[selectedRange];
    document.getElementById("activity-trend-chart").style.gridTemplateColumns = `repeat(${periods.length}, minmax(72px, 1fr))`;
    document.getElementById("activity-trend-chart").innerHTML = periods.map((item) => {
      const height = item.minutes ? Math.max(5, item.minutes / max * 100) : 0;
      return `<div class="activity-period" title="${item.label}: ${item.sessions} sessions, ${item.minutes} exercise minutes">
        <div class="activity-bar-track"><span class="activity-bar" style="height:${height}%"></span></div>
        <div class="activity-values">${item.sessions} ${item.sessions === 1 ? "session" : "sessions"}<span>${item.minutes} min</span></div>
        <b>${page.escapeHtml(item.label)}</b><small>${item.sessions ? "Activity" : "No activity recorded"}</small>
      </div>`;
    }).join("");
    document.querySelectorAll("[data-chart-range]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.chartRange === selectedRange));
    });
  }

  function activeDayCount() {
    return new Set(state.history.filter(hasActivity).map(entryKey)).size;
  }

  function renderAchievements() {
    const workouts = completedWorkouts().length;
    const weeklyTarget = state.plan && Array.isArray(state.plan.schedule)
      ? state.plan.schedule.filter((day) => day.kind === "workout").length : 0;
    const thisWeek = completedThisWeek().length;
    const achievements = [
      { title: "First Workout Completed", detail: "Complete your first FitGuide workout.", value: workouts >= 1, icon: "✓" },
      { title: "5 Workouts Completed", detail: "Five completed workouts, at your pace.", value: workouts >= 5, icon: "⑤" },
      { title: "10 Workouts Completed", detail: "Ten completed workouts recorded.", value: workouts >= 10, icon: "⑩" },
      { title: "7-Day Activity Milestone", detail: "Record activity on seven different days.", value: activeDayCount() >= 7, icon: "▦" },
      { title: "Consistency Champion", detail: "Complete at least 80% of your weekly workout target.", value: weeklyTarget > 0 && thisWeek / weeklyTarget >= .8, icon: "✦" }
    ];
    document.getElementById("achievement-list").innerHTML = achievements.map((item) =>
      `<article class="achievement-card ${item.value ? "unlocked" : "locked"}"><span class="achievement-icon">${item.icon}</span><h3>${item.title}</h3><p>${item.detail}</p><small>${item.value ? "Unlocked" : "Not yet unlocked"}</small></article>`
    ).join("");
  }

  function renderGoalProgress() {
    const profileGoals = state.profile && Array.isArray(state.profile.goals) ? state.profile.goals : [];
    const planGoals = state.plan && Array.isArray(state.plan.focus) ? state.plan.focus : [];
    const goals = [...new Set(profileGoals.length ? profileGoals : planGoals)];
    if (!goals.length) {
      document.getElementById("goal-progress-list").innerHTML = `<div class="page-empty-state"><h3>Your goals will appear here</h3><p>Choose your focus when you create a plan on the FitGuide home page.</p><a class="button button-quiet" href="index.html#my-plan">Set my goals</a></div>`;
      return;
    }
    const workouts = completedWorkouts();
    document.getElementById("goal-progress-list").innerHTML = goals.map((goal) => {
      const matching = workouts.filter((entry) => goalMatches(entry, goal));
      const percent = Math.min(100, Math.round(matching.length / 5 * 100));
      const latest = matching.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      const reflection = latest ? reflectionLabel(latest.feedback) : "No session reflection recorded yet";
      return `<article class="goal-progress-card"><h3>${page.escapeHtml(goal)}</h3><p>Progress from your completed sessions and personal reflections.</p><div class="goal-progress-track" role="progressbar" aria-label="${page.escapeHtml(goal)} logged sessions" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div><div class="goal-progress-meta"><span>${matching.length} of 5 focus sessions logged</span><span>${percent}%</span></div><p class="goal-reflection">${page.escapeHtml(reflection)}</p></article>`;
    }).join("");
  }

  function renderRecentActivity() {
    const history = state.history.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    document.getElementById("recent-activity").innerHTML = history.length ? history.map((entry) => {
      const complete = isCompleted(entry);
      const status = complete ? "Completed" : entry.status === "in_progress" ? "In progress" : "Partially completed";
      const seconds = activitySeconds(entry);
      const exercises = Number(entry.exercises) || 0;
      return `<article class="page-history-row"><span class="page-history-icon ${complete ? "" : "in-progress"}">${complete ? "✓" : "◷"}</span><div class="page-history-copy"><b>${page.escapeHtml(entry.workout_title || entry.focus || "FitGuide workout")}</b><small>${page.formatDate(entry.date)} · ${page.formatDuration(seconds)} · ${exercises} ${exercises === 1 ? "exercise" : "exercises"}</small></div><span class="page-history-status ${complete ? "" : "in-progress"}">${status}</span></article>`;
    }).join("") : `<div class="page-empty-state"><h3>No activity recorded yet</h3><p>Your completed workouts and exercise sessions will appear here.</p><a class="button button-primary" href="my-workout.html">Go to My Workout</a></div>`;
  }

  function render() {
    renderStatistics();
    renderWeeklyChart();
    renderTrendChart();
    renderAchievements();
    renderGoalProgress();
    renderRecentActivity();
  }

  function init() {
    page.initNavigation();
    document.querySelectorAll("[data-chart-range]").forEach((button) => button.addEventListener("click", () => {
      if (!ranges.includes(button.dataset.chartRange)) return;
      selectedRange = button.dataset.chartRange;
      renderTrendChart();
    }));
    window.addEventListener("storage", (event) => {
      if (event.key !== page.STORAGE_KEY && event.key !== null) return;
      state = page.readState();
      render();
    });
    window.addEventListener("fitguide:themechange", (event) => {
      state.theme = event.detail;
    });
    render();
  }

  init();
})();
