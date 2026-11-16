"use strict";

const IS_NODE = typeof module !== "undefined" && Boolean(module.exports);
let EXERCISES = IS_NODE
  ? JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "exercise-library.json"), "utf8"))
  : [];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const EQUIPMENT = ["No equipment", "Dumbbells", "Resistance bands", "Full home gym"];
const FEEDBACK = ["too_easy", "just_right", "too_hard"];
let EXERCISE_IDS = new Set(EXERCISES.map((exercise) => exercise.id));
let exerciseLibraryPromise = Promise.resolve(EXERCISES);
const LIMIT_TAGS = new Set([
  "knee-pain", "wrist-pain", "shoulder-pain", "back-pain",
  "balance", "impact", "floor-work", "ankle-pain", "hip-pain", "kneeling"
]);

const LIMITATION_PATTERNS = [
  ["knee-pain", /\bknee(s)?\b|kneecap/i],
  ["wrist-pain", /\bwrist(s)?\b|hand pain/i],
  ["shoulder-pain", /\bshoulder(s)?\b|rotator cuff/i],
  ["back-pain", /\bback\b|spine|disc/i],
  ["balance", /\bbalance\b|fall(s|ing)?|unsteady/i],
  ["impact", /\bimpact\b|jump(s|ing)?|jarring/i],
  ["floor-work", /\b(on the floor|floor work|lying down|kneeling)\b/i],
  ["ankle-pain", /\bankle(s)?\b/i],
  ["hip-pain", /\bhip(s)?\b/i],
  ["kneeling", /\bkneel(ing)?\b/i]
];

const RELATED_GOALS = {
  "core strength": ["Core strength", "Back & posture", "Full body fitness", "General fitness"],
  "stronger arms": ["Stronger arms", "Chest strength", "Shoulder strength", "Back & posture", "Full body fitness"],
  "chest strength": ["Chest strength", "Stronger arms", "Shoulder strength", "Full body fitness"],
  "stronger legs": ["Stronger legs", "Full body fitness", "General fitness"],
  "shoulder strength": ["Shoulder strength", "Stronger arms", "Chest strength", "Back & posture"],
  "back & posture": ["Back & posture", "Core strength", "Full body fitness", "General fitness"],
  "full body fitness": ["Full body fitness", "General fitness", "Core strength", "Stronger legs", "Stronger arms", "Chest strength", "Back & posture"],
  flexibility: ["Flexibility", "General fitness", "Back & posture", "Stronger legs", "Shoulder strength"],
  "general fitness": ["General fitness", "Full body fitness", "Core strength", "Stronger legs", "Stronger arms", "Chest strength", "Back & posture", "Flexibility"]
};

class PlannerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "PlannerError";
    this.statusCode = statusCode;
  }
}

function boundedText(value, field, maxLength) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new PlannerError(`${field} must be text no longer than ${maxLength} characters.`);
  }
  return value.trim();
}

function normalizeProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PlannerError("Add your profile details before generating a plan.");
  }
  const age = Number(input.age);
  if (!Number.isInteger(age) || age < 13 || age > 110) {
    throw new PlannerError("Enter an age from 13 to 110 before generating a plan.");
  }
  if (!Array.isArray(input.goals) || input.goals.length < 1 || input.goals.length > 6) {
    throw new PlannerError("Choose between 1 and 6 fitness goals.");
  }
  const goals = input.goals.map((goal) => boundedText(goal, "Goal", 80));
  if (goals.some((goal) => !goal)) throw new PlannerError("Fitness goals cannot be blank.");

  const level = LEVELS.includes(input.level) ? input.level : null;
  if (!level) throw new PlannerError("Choose a valid fitness level.");
  const minutes = Number(input.minutes);
  if (![10, 15, 20, 30, 45].includes(minutes)) throw new PlannerError("Choose a workout time from 10 to 45 minutes.");
  if (!EQUIPMENT.includes(input.equipment)) throw new PlannerError("Choose a valid equipment option.");
  const preferredTypes = ["Balanced strength", "Low impact", "Mobility first", "Bodyweight"];
  const preferredType = preferredTypes.includes(input.preferredType) ? input.preferredType : "Balanced strength";
  const limitation = boundedText(input.limitation, "Movement limitations", 1000);
  const avoidExercises = boundedText(input.avoidExercises, "Exercise exclusions", 500);
  const limitTags = Array.isArray(input.limitTags)
    ? [...new Set(input.limitTags.filter((tag) => LIMIT_TAGS.has(tag)))]
    : [];
  for (const [tag, pattern] of LIMITATION_PATTERNS) {
    if (pattern.test(limitation)) limitTags.push(tag);
  }
  const uniqueLimitTags = [...new Set(limitTags)];
  const healthConcern = input.healthConcern === true;
  if ((healthConcern || limitation || uniqueLimitTags.length) && input.safetyConfirmed !== true) {
    throw new PlannerError("Please confirm that you have discussed exercise with a qualified healthcare professional.");
  }
  if ((healthConcern || limitation) && uniqueLimitTags.length === 0) {
    throw new PlannerError("Your movement limitation needs a clearer affected area or movement. Please clarify it or consult a qualified healthcare professional before planning.");
  }
  const experienceOptions = ["New to exercise", "Some experience", "Regularly active"];
  const experience = experienceOptions.includes(input.experience) ? input.experience : "New to exercise";
  const height = boundedText(input.height, "Height", 32);
  const weight = boundedText(input.weight, "Weight", 32);
  const history = Array.isArray(input.history) ? input.history.slice(-5).map((entry) => ({
    focus: boundedText(entry && entry.focus, "History focus", 100),
    feedback: FEEDBACK.includes(entry && entry.feedback) ? entry.feedback : "just_right",
    exercise_ids: Array.isArray(entry && entry.exercise_ids)
      ? [...new Set(entry.exercise_ids.filter((id) => typeof id === "string" && EXERCISE_IDS.has(id)))].slice(0, 20)
      : []
  })) : [];
  const favoriteExerciseIds = Array.isArray(input.favoriteExerciseIds)
    ? [...new Set(input.favoriteExerciseIds.filter((id) => typeof id === "string" && EXERCISE_IDS.has(id)))].slice(0, 100)
    : [];

  return {
    age, height, weight, goals, level, experience, minutes,
    equipment: input.equipment, preferredType, limitation,
    limitTags: uniqueLimitTags, avoidExercises, healthConcern, history, favoriteExerciseIds
  };
}

function equipmentAvailable(profile) {
  const available = new Set(["wall", "chair", "counter", "mat"]);
  if (profile.equipment === "Dumbbells") available.add("dumbbells");
  if (profile.equipment === "Resistance bands") available.add("band");
  if (profile.equipment === "Full home gym") {
    ["dumbbells", "band"].forEach((item) => available.add(item));
  }
  return available;
}

function normalizeExerciseText(value) {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b([a-z]+[^s])s\b/g, "$1")
    .trim();
}

function eligibleExercises(profile) {
  const available = equipmentAvailable(profile);
  const goalSet = new Set();
  for (const goal of profile.goals) {
    const related = RELATED_GOALS[goal.toLowerCase()];
    if (related) related.forEach((item) => goalSet.add(item.toLowerCase()));
  }
  const exclusions = profile.avoidExercises.split(/[,;\n]+/).map(normalizeExerciseText).filter(Boolean);
  const ageGroup = profile.age < 18 ? "teen" : profile.age > 65 ? "older-adult" : "adult";
  const level = profile.age < 18 || profile.age > 65 || profile.experience === "New to exercise"
    ? "Beginner"
    : profile.level;
  const levelRank = { Beginner: 0, Intermediate: 1, Advanced: 2 };
  const maxLevel = levelRank[level];
  return EXERCISES.filter((exercise) => {
    if (!exercise.age_suitable.includes(ageGroup)) return false;
    if (!exercise.difficulty.some((difficulty) => levelRank[difficulty] <= maxLevel)) return false;
    if (exercise.equipment.some((item) => !available.has(item))) return false;
    if (exercise.avoid_if.some((tag) => profile.limitTags.includes(tag))) return false;
    if (ageGroup === "teen" && exercise.equipment.some((item) => item === "dumbbells" || item === "band")) return false;
    const exerciseName = normalizeExerciseText(exercise.name);
    if (exclusions.some((term) => exerciseName.includes(term) || term.includes(exerciseName))) return false;
    if (exercise.phase === "main" && goalSet.size > 0 && !exercise.goals.some((goal) => goalSet.has(goal.toLowerCase()))) return false;
    if (exercise.phase === "main" && goalSet.size === 0 && !exercise.goals.some((goal) => ["general fitness", "full body fitness"].includes(goal.toLowerCase()))) return false;
    return true;
  });
}

function getCandidates(profile) {
  const candidates = eligibleExercises(profile);
  const mainCount = candidates.filter((exercise) => exercise.phase === "main").length;
  if (mainCount < 3) {
    throw new PlannerError("There are not enough suitable catalog exercises for these goals and restrictions. Adjust exclusions or consult a qualified professional about safe alternatives.", 422);
  }
  return candidates;
}

function effectiveLevel(profile) {
  if (profile.age < 18 || profile.age > 65) return "Beginner";
  if (profile.experience === "New to exercise" && profile.level !== "Beginner") return "Beginner";
  return profile.level;
}

function weeklyCounts(profile) {
  const workout = effectiveLevel(profile) === "Beginner" ? 2 : 3;
  return { workout, recovery: 2, rest: 7 - workout - 2 };
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scoreExercise(exercise, profile) {
  const profileGoals = new Set(profile.goals.map((goal) => goal.toLowerCase()));
  const relatedGoals = new Set();
  for (const goal of profileGoals) {
    (RELATED_GOALS[goal] || []).forEach((related) => relatedGoals.add(related.toLowerCase()));
  }
  let score = exercise.goals.reduce((total, goal) => {
    const normalized = goal.toLowerCase();
    return total + (profileGoals.has(normalized) ? 12 : relatedGoals.has(normalized) ? 3 : 0);
  }, 0);
  if (profile.equipment !== "No equipment" && exercise.equipment.length) score += 2;
  if (profile.preferredType === "Mobility first" && /mobility|flexibility/i.test(`${exercise.type} ${exercise.goals.join(" ")}`)) score += 8;
  if (profile.preferredType === "Bodyweight" && exercise.equipment.length) score -= 4;
  if (profile.preferredType === "Low impact" && exercise.avoid_if.includes("impact")) score -= 20;
  if (profile.history.some((entry) => entry.feedback === "too_hard" && entry.exercise_ids.includes(exercise.id))) score -= 5;
  if (profile.favoriteExerciseIds.includes(exercise.id)) score += 100;
  return score;
}

function chooseExercises(pool, profile, count, rotation, usedIds, avoidRecent) {
  if (count < 1 || !pool.length) return [];
  const historyIds = new Set(profile.history.flatMap((entry) => entry.exercise_ids));
  const seed = hashText(`${profile.goals.join("|")}:${profile.preferredType}:${profile.history.length}:${rotation}`);
  const ranked = pool.map((exercise, index) => ({
    exercise,
    index: (index - seed % pool.length + pool.length) % pool.length,
    score: scoreExercise(exercise, profile)
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = [];
  const selectedGroups = new Set();
  while (selected.length < count) {
    let available = ranked.filter(({ exercise }) => !selected.some((item) => item.id === exercise.id) && !usedIds.has(exercise.id));
    if (available.length < count - selected.length) {
      const alreadyAvailable = new Set(available.map(({ exercise }) => exercise.id));
      const reuse = ranked.filter(({ exercise }) =>
        !selected.some((item) => item.id === exercise.id) && !alreadyAvailable.has(exercise.id));
      available = [...available, ...reuse];
    }
    if (!available.length) break;
    const fresh = available.filter(({ exercise }) => !historyIds.has(exercise.id));
    const options = avoidRecent && fresh.length >= count - selected.length ? fresh : available;
    options.sort((left, right) => {
      const diversity = (entry) => entry.exercise.muscle_groups.reduce((total, group) => total + (selectedGroups.has(group) ? 0 : 2), 0);
      return right.score + diversity(right) - left.score - diversity(left) || left.index - right.index;
    });
    const choice = options[0].exercise;
    selected.push(choice);
    choice.muscle_groups.forEach((group) => selectedGroups.add(group));
  }
  return selected;
}

function workoutTitle(profile, index) {
  const goal = profile.goals[index % profile.goals.length];
  if (/flexibility/i.test(goal)) return "Flexibility and mobility";
  if (/general fitness/i.test(goal)) return "Everyday strength";
  return `${goal} foundations`.slice(0, 48);
}

function sessionSelection(profile, candidates, sessionIndex, previouslyUsed) {
  const maxExercises = profile.minutes <= 10 ? 3 : profile.minutes <= 15 ? 4 : profile.minutes <= 20 ? 5 : 6;
  const mainPool = candidates.filter((exercise) => exercise.phase === "main");
  const main = chooseExercises(mainPool, profile, maxExercises, sessionIndex, previouslyUsed, true);
  const warmupCount = profile.minutes >= 20 ? 2 : 1;
  const warmup = chooseExercises(candidates.filter((exercise) => exercise.phase === "warmup"), profile, warmupCount, sessionIndex + 31, new Set(), false);
  const cooldown = chooseExercises(candidates.filter((exercise) => exercise.phase === "cooldown"), profile, profile.minutes >= 30 ? 2 : 1, sessionIndex + 67, new Set(), false);
  const feedback = profile.history.length ? profile.history[profile.history.length - 1].feedback : "just_right";
  const getDuration = (items, phase) => items.reduce((total, item) => total + makeExercise(item, profile, feedback, phase).duration_seconds, 0);
  const durationForMain = () => getDuration(main, "main") + getDuration(warmup, "warmup") +
    getDuration(cooldown, "cooldown") + 30 * Math.max(0, main.length - 1);
  while (durationForMain() > profile.minutes * 60 && main.length > 3) main.pop();
  if (main.length < 3 || durationForMain() > profile.minutes * 60) {
    throw new PlannerError("The available movements do not fit your time and safety preferences. Increase your session time or adjust your exclusions.", 422);
  }
  return {
    title: workoutTitle(profile, sessionIndex),
    focus: [...new Set(main.flatMap((exercise) => exercise.muscle_groups))].slice(0, 3).join(", "),
    warmup_ids: warmup.map((exercise) => exercise.id),
    exercise_ids: main.map((exercise) => exercise.id),
    cooldown_ids: cooldown.map((exercise) => exercise.id)
  };
}

function createRecommendation(profile, candidates) {
  const workoutDays = weeklyCounts(profile).workout;
  const usedInPreviousWorkout = new Set();
  const workouts = Array.from({ length: workoutDays }, (_, index) => {
    const selection = sessionSelection(profile, candidates, index, usedInPreviousWorkout);
    selection.exercise_ids.forEach((id) => usedInPreviousWorkout.add(id));
    return selection;
  });
  const recoveryPool = candidates.filter((exercise) => exercise.phase === "recovery");
  const recovery = chooseExercises(recoveryPool, profile, 1, profile.history.length, new Set(), false)[0];
  if (!recovery) throw new PlannerError("No suitable recovery movements are available for this profile.", 422);
  const makeDay = (day, kind, title, focus, selection) => ({
    day, kind, title, focus,
    warmup_ids: selection ? selection.warmup_ids : [],
    exercise_ids: selection ? selection.exercise_ids : kind === "recovery" ? [recovery.id] : [],
    cooldown_ids: selection ? selection.cooldown_ids : []
  });
  const optionalMeasurementsNote = profile.height || profile.weight
    ? " Optional height and weight are not used to determine difficulty."
    : "";
  const coachNote = `Selected for ${profile.goals.join(", ")} at ${effectiveLevel(profile).toLowerCase()} level, with ${profile.minutes} minutes and your equipment and movement preferences in mind.${optionalMeasurementsNote}`;
  const schedule = workoutDays === 2
    ? [
      makeDay("Mon", "workout", workouts[0].title, workouts[0].focus, workouts[0]),
      makeDay("Tue", "recovery", "Easy movement", "Comfortable recovery"),
      makeDay("Wed", "rest", "Rest day", "Recovery"),
      makeDay("Thu", "workout", workouts[1].title, workouts[1].focus, workouts[1]),
      makeDay("Fri", "recovery", "Gentle mobility", "Comfortable recovery"),
      makeDay("Sat", "rest", "Rest day", "Recovery"),
      makeDay("Sun", "rest", "Rest day", "Recovery")
    ]
    : [
      makeDay("Mon", "workout", workouts[0].title, workouts[0].focus, workouts[0]),
      makeDay("Tue", "recovery", "Easy movement", "Comfortable recovery"),
      makeDay("Wed", "workout", workouts[1].title, workouts[1].focus, workouts[1]),
      makeDay("Thu", "rest", "Rest day", "Recovery"),
      makeDay("Fri", "workout", workouts[2].title, workouts[2].focus, workouts[2]),
      makeDay("Sat", "recovery", "Gentle mobility", "Comfortable recovery"),
      makeDay("Sun", "rest", "Rest day", "Recovery")
    ];
  return { coach_note: coachNote, schedule };
}

function makeExercise(exercise, profile, feedback, phase) {
  const level = effectiveLevel(profile);
  const prescriptionLevel = exercise.sets_by_level ? level : null;
  let sets = prescriptionLevel ? exercise.sets_by_level[level] : exercise.sets;
  let reps = prescriptionLevel ? exercise.reps_by_level[level] : exercise.reps;
  const restSeconds = prescriptionLevel ? exercise.rest_seconds_by_level[level] : exercise.rest_seconds;
  if (prescriptionLevel && profile.age < 18) sets = Math.min(sets, 2);
  if (prescriptionLevel && profile.age > 65) sets = Math.min(sets, 2);
  if (prescriptionLevel && feedback === "too_hard") sets = Math.max(1, sets - 1);
  if (prescriptionLevel && feedback === "too_easy" && level !== "Beginner" && profile.age >= 18 && profile.age <= 65) sets = Math.min(3, sets + 1);
  const workSeconds = exercise.duration_seconds || exercise.work_seconds_per_set;
  const durationSeconds = exercise.duration_seconds
    ? exercise.duration_seconds
    : workSeconds * sets + restSeconds * Math.max(0, sets - 1);
  return {
    id: exercise.id,
    name: exercise.name,
    phase,
    type: exercise.type,
    difficulty: exercise.difficulty,
    equipment: exercise.equipment,
    target_muscles: exercise.muscle_groups,
    purpose: exercise.purpose,
    starting_position: exercise.starting_position,
    instructions: exercise.instructions,
    sets,
    reps,
    duration_seconds: durationSeconds,
    work_seconds_per_set: workSeconds,
    rest_seconds: restSeconds,
    common_mistakes: exercise.common_mistakes,
    easier_alternative: exercise.easier_alternative,
    safety_instructions: exercise.safety_instructions,
    media: exercise.media
  };
}

function selectionError(message) {
  throw new PlannerError(`FitGuide's local recommendation engine could not create a safe plan (${message}). Adjust your preferences and try again.`, 422);
}

function buildPlan(profile, selection, candidates) {
  if (!selection || typeof selection !== "object" || !Array.isArray(selection.schedule) || selection.schedule.length !== 7) {
    selectionError("weekly schedule must contain seven days");
  }
  const eligibleById = new Map(candidates.map((exercise) => [exercise.id, exercise]));
  const schedule = selection.schedule;
  const selectedIds = new Set();
  let previousWorkoutIds = [];
  const kinds = { workout: 0, recovery: 0, rest: 0 };
  const maxMainExercises = profile.minutes <= 10 ? 3 : profile.minutes <= 15 ? 4 : profile.minutes <= 20 ? 5 : 6;
  const eligibleMainCount = candidates.filter((exercise) => exercise.phase === "main").length;

  schedule.forEach((day, index) => {
    if (!day || day.day !== DAYS[index] || !["workout", "recovery", "rest"].includes(day.kind)) selectionError("days must be in Monday-to-Sunday order");
    if (typeof day.title !== "string" || day.title.trim().length < 2 || day.title.length > 48 || typeof day.focus !== "string" || day.focus.length > 80) {
      selectionError(`invalid title or focus for ${day.day}`);
    }
    kinds[day.kind] += 1;
    for (const key of ["warmup_ids", "exercise_ids", "cooldown_ids"]) {
      if (!Array.isArray(day[key]) || day[key].some((id) => typeof id !== "string")) selectionError(`invalid ${key} for ${day.day}`);
    }
    if (day.kind === "workout") {
      if (day.exercise_ids.length < 3 || day.exercise_ids.length > maxMainExercises) selectionError(`${day.day} needs 3 to ${maxMainExercises} main exercises`);
      if (day.warmup_ids.length < 1 || day.warmup_ids.length > 3 || day.cooldown_ids.length < 1 || day.cooldown_ids.length > 2) {
        selectionError(`${day.day} needs a warm-up and cool-down`);
      }
      if (new Set(day.exercise_ids).size !== day.exercise_ids.length) selectionError("exercises must be distinct within each session");
      const overlap = day.exercise_ids.filter((id) => previousWorkoutIds.includes(id)).length;
      const unavoidableOverlap = Math.max(0, previousWorkoutIds.length + day.exercise_ids.length - eligibleMainCount);
      const allowedOverlap = Math.max(
        Math.floor(Math.min(day.exercise_ids.length, previousWorkoutIds.length) / 2),
        unavoidableOverlap
      );
      if (previousWorkoutIds.length && overlap > allowedOverlap) {
        selectionError("consecutive strength sessions should vary their exercises");
      }
      day.exercise_ids.forEach((id) => selectedIds.add(id));
      previousWorkoutIds = day.exercise_ids;
      for (const id of day.warmup_ids) {
        const exercise = eligibleById.get(id);
        if (!exercise || exercise.phase !== "warmup") selectionError(`ineligible warm-up ${id}`);
      }
      for (const id of day.cooldown_ids) {
        const exercise = eligibleById.get(id);
        if (!exercise || exercise.phase !== "cooldown") selectionError(`ineligible cool-down ${id}`);
      }
      for (const id of day.exercise_ids) {
        const exercise = eligibleById.get(id);
        if (!exercise || exercise.phase !== "main") selectionError(`ineligible main exercise ${id}`);
      }
    } else if (day.kind === "recovery") {
      if (day.exercise_ids.length < 1 || day.exercise_ids.length > 2 || day.warmup_ids.length || day.cooldown_ids.length) {
        selectionError(`${day.day} must be a short recovery session`);
      }
      for (const id of day.exercise_ids) {
        const exercise = eligibleById.get(id);
        if (!exercise || exercise.phase !== "recovery") selectionError(`ineligible recovery exercise ${id}`);
      }
    } else if (day.exercise_ids.length || day.warmup_ids.length || day.cooldown_ids.length) {
      selectionError(`${day.day} rest day must not contain exercises`);
    }
    if (index && day.kind === "workout" && schedule[index - 1].kind === "workout") selectionError("workout days must not be consecutive");
  });
  const requiredKinds = weeklyCounts(profile);
  if (kinds.workout !== requiredKinds.workout || kinds.recovery !== requiredKinds.recovery || kinds.rest !== requiredKinds.rest) {
    selectionError(`the week needs ${requiredKinds.workout} strength days, two recovery days, and ${requiredKinds.rest} rest days`);
  }
  if (schedule[0].kind === "workout" && schedule[6].kind === "workout") selectionError("Sunday and Monday strength days are consecutive");
  if (selectedIds.size < 3) selectionError("the week needs some exercise variation");

  const latestFeedback = profile.history.length ? profile.history[profile.history.length - 1].feedback : "just_right";
  const detailedSchedule = schedule.map((day) => {
    const warmup = day.warmup_ids.map((id) => makeExercise(eligibleById.get(id), profile, latestFeedback, "warmup"));
    const exercises = day.exercise_ids.map((id) => makeExercise(eligibleById.get(id), profile, latestFeedback, day.kind === "recovery" ? "recovery" : "main"));
    const cooldown = day.cooldown_ids.map((id) => makeExercise(eligibleById.get(id), profile, latestFeedback, "cooldown"));
    const interExerciseRest = day.kind === "workout" ? 30 * Math.max(0, exercises.length - 1) : 0;
    const durationSeconds = [...warmup, ...exercises, ...cooldown].reduce((sum, item) => sum + item.duration_seconds, 0) + interExerciseRest;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    if (durationMinutes > profile.minutes) selectionError(`${day.day} duration is ${durationMinutes} minutes, above the ${profile.minutes}-minute limit`);
    return {
      day: day.day,
      title: day.title.trim(),
      kind: day.kind,
      focus: day.focus.trim(),
      warmup,
      exercises,
      cooldown,
      inter_exercise_rest_seconds: interExerciseRest,
      duration_seconds: durationSeconds,
      duration_minutes: durationMinutes
    };
  });

  const firstWorkout = detailedSchedule.find((day) => day.kind === "workout");
  const safetyNotes = [
    "This plan is general fitness education, not medical advice or rehabilitation.",
    "Use only a comfortable range; stop for pain, dizziness, or unusual discomfort.",
    "Allow recovery between strength days and adjust or skip a session when needed."
  ];
  if (profile.age < 18) safetyNotes.push("Under-18 plans emphasize enjoyable movement and technique, not weight loss or appearance.");
  if (profile.limitTags.length) safetyNotes.push("Movement restrictions were applied to exercise selection; seek professional advice if symptoms persist or change.");
  const coachNote = typeof selection.coach_note === "string" ? selection.coach_note.trim().slice(0, 240) : "";

  return {
    workout_title: firstWorkout.title,
    fitness_goal: profile.goals.join(", "),
    difficulty: effectiveLevel(profile),
    available_minutes: profile.minutes,
    minutes: profile.minutes,
    weekly_workout_days: requiredKinds.workout,
    total_duration: firstWorkout.duration_minutes,
    focus: profile.goals,
    level: effectiveLevel(profile),
    equipment: profile.equipment,
    personalization_notes: coachNote,
    safety_notes: safetyNotes,
    warmup: firstWorkout.warmup,
    exercises: firstWorkout.exercises,
    cooldown: firstWorkout.cooldown,
    schedule: detailedSchedule,
    createdAt: new Date().toISOString()
  };
}

function generateWorkout(profileInput) {
  if (!EXERCISES.length) {
    return exerciseLibraryPromise.then(() => generateWorkout(profileInput));
  }
  const profile = normalizeProfile(profileInput);
  const candidates = getCandidates(profile);
  return buildPlan(profile, createRecommendation(profile, candidates), candidates);
}

const plannerApi = {
  DAYS,
  PlannerError,
  buildPlan,
  createRecommendation,
  generateWorkout,
  getCandidates,
  normalizeProfile,
  weeklyCounts
};

Object.defineProperty(plannerApi, "EXERCISES", { get: () => EXERCISES });
Object.defineProperty(plannerApi, "ready", { get: () => exerciseLibraryPromise });

if (IS_NODE) {
  module.exports = plannerApi;
} else {
  exerciseLibraryPromise = fetch(new URL("./exercise-library.json", document.baseURI), { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`Exercise catalog request failed (HTTP ${response.status}).`);
      return response.json();
    })
    .then((exercises) => {
      if (!Array.isArray(exercises) || exercises.length < 3 ||
          exercises.some((exercise) => !exercise || typeof exercise.id !== "string" || !exercise.id)) {
        throw new Error("The exercise catalog is missing or invalid.");
      }
      EXERCISES = exercises;
      EXERCISE_IDS = new Set(EXERCISES.map((exercise) => exercise.id));
      return EXERCISES;
    });
  window.FitGuidePlanner = Object.freeze(plannerApi);
}
