"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createServer } = require("../server");

function requestJson(port, path, method = "GET", body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({
            statusCode: response.statusCode,
            contentType: response.headers["content-type"],
            headers: response.headers,
            body: text ? JSON.parse(text) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function requestText(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: pathname }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        contentType: response.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8")
      }));
    }).on("error", reject);
  });
}

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("dedicated FitGuide pages and their shared scripts are served locally", async () => {
  await withServer(async (port) => {
    for (const [pathname, title] of [
      ["/my-workout.html", "My Workout"],
      ["/progress.html", "Progress"],
      ["/exercise-library.html", "Exercise Library"]
    ]) {
      const page = await requestText(port, pathname);
      assert.equal(page.statusCode, 200);
      assert.match(page.contentType, /text\/html/);
      assert.match(page.body, new RegExp(`<title>${title}`));
      assert.match(page.body, /page-common\.js/);
      assert.match(page.body, /href="exercise-library\.html"[^>]*>Exercise Library/);
    }
    const library = await requestText(port, "/exercise-library.html");
    assert.match(library.body, /app\.js/);
    assert.match(library.body, /id="exercise-grid"/);

    const homepage = await requestText(port, "/");
    assert.doesNotMatch(homepage.body, /id="library"/);
    assert.doesNotMatch(homepage.body, /id="theme-toggle"/);
    assert.match(homepage.body, /href="exercise-library\.html">Exercise Library/);

    for (const pathname of ["/page-common.js", "/my-workout.js", "/progress.js", "/app.js"]) {
      const script = await requestText(port, pathname);
      assert.equal(script.statusCode, 200);
      assert.match(script.contentType, /javascript/);
    }

    const banner = await requestText(port, "/Modern%20Fitness%20Progress%20Banner.png");
    assert.equal(banner.statusCode, 200);
    assert.match(banner.contentType, /image\/png/);
    assert.ok(banner.body.length > 0);
  });
});

function profile(overrides = {}) {
  return {
    age: 28,
    goals: ["General fitness"],
    level: "Beginner",
    experience: "New to exercise",
    minutes: 20,
    equipment: "No equipment",
    preferredType: "Balanced strength",
    ...overrides
  };
}

test("local generation endpoint creates distinct plans for contrasting profiles", async () => {
  await withServer(async (port) => {
    const health = await requestJson(port, "/api/health");
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.body, { success: true, status: "running", service: "FitGuide" });

    const catalog = await requestJson(port, "/api/exercises");
    assert.equal(catalog.statusCode, 200);
    assert.ok(catalog.body.exercises.length >= 100);

    const localCatalog = await requestJson(port, "/exercise-library.json");
    assert.equal(localCatalog.statusCode, 200);
    assert.equal(localCatalog.contentType, "application/json; charset=utf-8");
    assert.equal(localCatalog.body.length, catalog.body.exercises.length);

    const profiles = [
      profile(),
      profile({
        age: 41,
        goals: ["Stronger arms"],
        level: "Intermediate",
        experience: "Regularly active",
        minutes: 30,
        equipment: "Dumbbells"
      }),
      profile({
        age: 34,
        goals: ["Flexibility"],
        minutes: 15,
        preferredType: "Mobility first"
      })
    ];
    const generated = [];
    for (const userProfile of profiles) {
      const response = await requestJson(port, "/api/workouts/generate", "POST", { profile: userProfile });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
      generated.push(response.body.plan);
    }

    const [general, arms, flexibility] = generated;
    for (const plan of generated) {
      assert.equal(plan.schedule.length, 7);
      assert.equal(plan.schedule.filter((day) => day.kind === "workout").length, plan.weekly_workout_days);
      assert.ok(plan.schedule.filter((day) => day.kind === "workout").every((day) =>
        day.exercises.length >= 3 && day.duration_minutes <= plan.available_minutes));
      assert.ok(plan.schedule.flatMap((day) => day.exercises).every((exercise) =>
        exercise.instructions.length && exercise.safety_instructions.length && exercise.media));
    }
    assert.equal(general.weekly_workout_days, 2);
    assert.equal(arms.weekly_workout_days, 3);
    assert.ok(arms.schedule.flatMap((day) => day.exercises).some((exercise) =>
      exercise.equipment.includes("dumbbells")));
    assert.ok(flexibility.schedule.flatMap((day) => day.exercises).some((exercise) =>
      exercise.type === "timed" || exercise.target_muscles.some((muscle) => /mobility|flexibility/i.test(muscle))));

    const mainIds = generated.map((plan) => plan.exercises.map((exercise) => exercise.id));
    assert.notDeepEqual(mainIds[0], mainIds[1]);
    assert.notDeepEqual(mainIds[0], mainIds[2]);
    assert.notDeepEqual(mainIds[1], mainIds[2]);
  });
});

test("local pages can call the API from Live Server and receive JSON errors", async () => {
  await withServer(async (port) => {
    const origin = "http://127.0.0.1:5500";
    const health = await requestJson(port, "/api/health", "GET", undefined, { origin });
    assert.equal(health.statusCode, 200);
    assert.equal(health.headers["access-control-allow-origin"], origin);
    assert.match(health.contentType, /^application\/json\b/i);

    const preflight = await requestJson(port, "/api/workouts/generate", "OPTIONS", undefined, {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    });
    assert.equal(preflight.statusCode, 204);
    assert.match(preflight.headers["access-control-allow-methods"], /POST/);
    assert.match(preflight.headers["access-control-allow-headers"], /Content-Type/i);

    const invalid = await requestJson(port, "/api/workouts/generate", "POST", { profile: {} });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.success, false);
    assert.match(invalid.body.error, /age/i);
    assert.match(invalid.contentType, /^application\/json\b/i);
  });
});

test("completed exercise history encourages suitable alternatives in future plans", async () => {
  await withServer(async (port) => {
    const first = await requestJson(port, "/api/workouts/generate", "POST", { profile: profile() });
    const recentIds = first.body.plan.exercises.map((exercise) => exercise.id);
    const second = await requestJson(port, "/api/workouts/generate", "POST", {
      profile: profile({
        history: [{ focus: "General fitness", feedback: "just_right", exercise_ids: recentIds }]
      })
    });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.ok(second.body.plan.exercises.every((exercise) => !recentIds.includes(exercise.id)));
  });
});
