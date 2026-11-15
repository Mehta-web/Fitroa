"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EXERCISES, buildPlan, generateWorkout, getCandidates, normalizeProfile, weeklyCounts } = require("../planner");

function profile(overrides = {}) {
  return normalizeProfile({
    age: 28,
    height: "170 cm",
    weight: "",
    goals: ["Core strength"],
    level: "Beginner",
    experience: "New to exercise",
    minutes: 20,
    equipment: "No equipment",
    preferredType: "Balanced strength",
    limitation: "",
    limitTags: [],
    avoidExercises: "",
    healthConcern: false,
    safetyConfirmed: false,
    history: [],
    ...overrides
  });
}

function mockSelection(candidates, user) {
  const mainIds = candidates.filter((item) => item.phase === "main").map((item) => item.id);
  const warmupId = candidates.find((item) => item.phase === "warmup").id;
  const cooldownId = candidates.find((item) => item.phase === "cooldown").id;
  const strengthCount = weeklyCounts(user).workout;
  assert.ok(mainIds.length >= strengthCount * 3, "test profile should have enough main exercises to rotate");
  const workoutDays = [
    { day: "Mon", title: "Core foundations", focus: "Core control" },
    { day: strengthCount === 2 ? "Thu" : "Wed", title: "Steady strength", focus: "Core and legs" },
    { day: "Fri", title: "Move with control", focus: "Core stability" }
  ].slice(0, strengthCount).map((day, index) => ({
    ...day, kind: "workout", warmup_ids: [warmupId],
    exercise_ids: mainIds.slice(index * 3, index * 3 + 3), cooldown_ids: [cooldownId]
  }));
  const recoveryId = candidates.find((item) => item.phase === "recovery").id;
  const schedule = strengthCount === 2
    ? [
      workoutDays[0],
      { day: "Tue", kind: "recovery", title: "Easy movement", focus: "Relaxed movement", warmup_ids: [], exercise_ids: [recoveryId], cooldown_ids: [] },
      { day: "Wed", kind: "rest", title: "Rest day", focus: "Recovery", warmup_ids: [], exercise_ids: [], cooldown_ids: [] },
      workoutDays[1],
      { day: "Fri", kind: "recovery", title: "Gentle walk", focus: "Easy pace", warmup_ids: [], exercise_ids: [recoveryId], cooldown_ids: [] },
      { day: "Sat", kind: "rest", title: "Rest day", focus: "Recovery", warmup_ids: [], exercise_ids: [], cooldown_ids: [] },
      { day: "Sun", kind: "rest", title: "Rest day", focus: "Recovery", warmup_ids: [], exercise_ids: [], cooldown_ids: [] }
    ]
    : [
      workoutDays[0],
      { day: "Tue", kind: "recovery", title: "Easy movement", focus: "Relaxed movement", warmup_ids: [], exercise_ids: [recoveryId], cooldown_ids: [] },
      workoutDays[1],
      { day: "Thu", kind: "rest", title: "Rest day", focus: "Recovery", warmup_ids: [], exercise_ids: [], cooldown_ids: [] },
      workoutDays[2],
      { day: "Sat", kind: "recovery", title: "Gentle walk", focus: "Easy pace", warmup_ids: [], exercise_ids: [recoveryId], cooldown_ids: [] },
      { day: "Sun", kind: "rest", title: "Rest day", focus: "Recovery", warmup_ids: [], exercise_ids: [], cooldown_ids: [] }
    ];
  return { coach_note: "A balanced week with time to recover.", schedule };
}

test("exercise candidates change with goal, equipment, and level", () => {
  const beginnerCore = profile();
  const intermediateBack = profile({
    goals: ["Back & posture"],
    level: "Intermediate",
    experience: "Some experience",
    minutes: 30,
    equipment: "Resistance bands"
  });
  const coreCandidates = getCandidates(beginnerCore);
  const backCandidates = getCandidates(intermediateBack);
  const coreIds = new Set(coreCandidates.map((item) => item.id));
  const backIds = new Set(backCandidates.map((item) => item.id));

  assert.ok(coreIds.has("dead-bug-heel-tap"));
  assert.ok(backIds.has("resistance-band-row"));
  assert.notDeepEqual([...coreIds].sort(), [...backIds].sort());
  assert.ok(!coreIds.has("resistance-band-row"));
});

test("saved favorites are prioritized only among suitable catalog exercises", () => {
  const user = profile();
  const ordinaryPlan = generateWorkout(user);
  const ordinaryIds = new Set(ordinaryPlan.exercises.map((exercise) => exercise.id));
  const favorite = getCandidates(user).find((exercise) => exercise.phase === "main" && !ordinaryIds.has(exercise.id));
  assert.ok(favorite, "profile should have a suitable alternate exercise to save");

  const personalizedPlan = generateWorkout({ ...user, favoriteExerciseIds: [favorite.id, "not-in-the-library"] });
  assert.ok(personalizedPlan.exercises.some((exercise) => exercise.id === favorite.id));
});

test("new exercisers and under-18 users receive beginner-safe, age-suitable candidates", () => {
  const teen = profile({
    age: 16,
    goals: ["Full body fitness"],
    level: "Advanced",
    experience: "New to exercise",
    equipment: "Dumbbells"
  });
  const candidates = getCandidates(teen);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((exercise) => exercise.age_suitable.includes("teen")));
  assert.ok(candidates.every((exercise) => !exercise.equipment.includes("dumbbells") && !exercise.equipment.includes("band")));
  assert.ok(!candidates.some((exercise) => exercise.phase === "main" && !exercise.difficulty.includes("Beginner")));
});

test("exercise exclusions match common plural and hyphenated names", () => {
  const candidates = getCandidates(profile({
    goals: ["Full body fitness"],
    avoidExercises: "push-ups, squats"
  }));
  assert.ok(candidates.length >= 3);
  assert.ok(!candidates.some((exercise) => /push.?up|squat/i.test(exercise.name)));
});

test("plans are structured, varied across the week, and fit available time", () => {
  const user = profile();
  const candidates = getCandidates(user);
  const plan = buildPlan(user, mockSelection(candidates, user), candidates);

  assert.equal(plan.schedule.length, 7);
  assert.equal(plan.schedule.filter((day) => day.kind === "workout").length, weeklyCounts(user).workout);
  assert.equal(plan.schedule.filter((day) => day.kind === "recovery").length, 2);
  assert.equal(plan.schedule.filter((day) => day.kind === "rest").length, weeklyCounts(user).rest);
  assert.ok(plan.schedule.filter((day) => day.kind === "workout").every((day) => day.exercises.length >= 3));
  assert.ok(plan.schedule.filter((day) => day.kind === "workout").every((day) => day.duration_minutes <= user.minutes));
  assert.ok(plan.exercises.every((exercise) => Array.isArray(exercise.instructions) && exercise.safety_instructions.length));
  assert.equal(plan.exercises[0].sets, 2);

  const harderFeedback = profile({ history: [{ focus: "Core", feedback: "too_hard" }] });
  const harderCandidates = getCandidates(harderFeedback);
  const adaptedPlan = buildPlan(harderFeedback, mockSelection(harderCandidates, harderFeedback), harderCandidates);
  assert.equal(adaptedPlan.exercises[0].sets, 1);
});

test("limitations, goals, and profile requirements are enforced before planning", () => {
  assert.throws(() => profile({ limitation: "My knee is painful" }), /qualified healthcare professional/);
  assert.throws(() => profile({ goals: [] }), /fitness goals/);
});

test("the built-in exercise library contains 100 complete, uniquely named exercises", () => {
  assert.ok(EXERCISES.length >= 100);
  assert.equal(new Set(EXERCISES.map((exercise) => exercise.id)).size, EXERCISES.length);
  assert.equal(new Set(EXERCISES.map((exercise) => exercise.name.toLowerCase())).size, EXERCISES.length);
  const categories = new Set(EXERCISES.flatMap((exercise) => [
    ...exercise.muscle_groups, ...exercise.goals, exercise.phase
  ]).map((category) => category.toLowerCase()));
  const mainInstructionSets = EXERCISES
    .filter((exercise) => exercise.phase === "main")
    .map((exercise) => JSON.stringify(exercise.instructions));
  assert.equal(new Set(mainInstructionSets).size, mainInstructionSets.length);
  for (const category of [
    "chest", "back", "biceps", "triceps", "shoulders", "core", "legs",
    "full body", "flexibility", "mobility", "warmup", "cooldown"
  ]) {
    assert.ok(categories.has(category), `catalog should include the ${category} category`);
  }
  for (const exercise of EXERCISES) {
    assert.ok(exercise.name && exercise.phase && exercise.type);
    assert.ok(Array.isArray(exercise.muscle_groups) && exercise.muscle_groups.length);
    assert.ok(Array.isArray(exercise.difficulty) && exercise.difficulty.length);
    assert.ok(Array.isArray(exercise.equipment));
    assert.ok(Array.isArray(exercise.instructions) && exercise.instructions.length);
    const levelBasedPrescription = exercise.sets_by_level && exercise.reps_by_level &&
      exercise.rest_seconds_by_level;
    assert.ok((Number.isInteger(exercise.sets) && exercise.sets > 0) || levelBasedPrescription);
    assert.ok(Number.isInteger(exercise.rest_seconds) || exercise.rest_seconds_by_level);
    assert.ok(exercise.duration_seconds || exercise.work_seconds_per_set);
    assert.ok(exercise.easier_alternative && exercise.safety_instructions.length);
    assert.ok(exercise.media && exercise.media.variant && exercise.media.alt);
    if (levelBasedPrescription) {
      for (const level of ["Beginner", "Intermediate", "Advanced"]) {
        assert.ok(Number.isInteger(exercise.sets_by_level[level]) && exercise.sets_by_level[level] > 0);
        assert.ok(exercise.reps_by_level[level] || exercise.type === "timed");
        assert.ok(Number.isInteger(exercise.rest_seconds_by_level[level]));
      }
    } else if (exercise.type !== "timed") {
      assert.ok(exercise.reps);
    }
  }
});

test("height and weight do not change exercise difficulty or selection", () => {
  const withoutMeasurements = generateWorkout({
    age: 28, goals: ["Core strength"], level: "Beginner", experience: "New to exercise",
    minutes: 20, equipment: "No equipment"
  });
  const withMeasurements = generateWorkout({
    age: 28, height: "170 cm", weight: "80 kg", goals: ["Core strength"],
    level: "Beginner", experience: "New to exercise", minutes: 20, equipment: "No equipment"
  });
  assert.deepEqual(
    withoutMeasurements.exercises.map((exercise) => exercise.id),
    withMeasurements.exercises.map((exercise) => exercise.id)
  );
  assert.match(withMeasurements.personalization_notes, /height and weight are not used to determine difficulty/i);
});
