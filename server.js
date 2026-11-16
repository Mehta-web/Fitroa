"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { EXERCISES, PlannerError, generateWorkout } = require("./planner");

const ROOT = __dirname;
const MAX_BODY_BYTES = 32 * 1024;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/planner.js", ["planner.js", "text/javascript; charset=utf-8"]],
  ["/exercise-library.json", ["exercise-library.json", "application/json; charset=utf-8"]],
  ["/page-common.js", ["page-common.js", "text/javascript; charset=utf-8"]],
  ["/my-workout.html", ["my-workout.html", "text/html; charset=utf-8"]],
  ["/my-workout.js", ["my-workout.js", "text/javascript; charset=utf-8"]],
  ["/progress.html", ["progress.html", "text/html; charset=utf-8"]],
  ["/progress.js", ["progress.js", "text/javascript; charset=utf-8"]],
  ["/exercise-library.html", ["exercise-library.html", "text/html; charset=utf-8"]],
  ["/Modern%20Fitness%20Progress%20Banner.png", ["Modern Fitness Progress Banner.png", "image/png"]]
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function allowLocalOrigin(request, response) {
  const origin = request.headers.origin;
  response.setHeader("vary", "Origin");
  if (!origin) return true;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !LOCAL_HOSTNAMES.has(hostname)) return false;

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "Content-Type");
  response.setHeader("access-control-max-age", "600");
  return true;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PlannerError("Request is too large.", 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new PlannerError("Request body must be valid JSON.", 400));
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(request, response, pathname) {
  const item = STATIC_FILES.get(pathname);
  if (!item) return false;
  const file = path.join(ROOT, item[0]);
  fs.readFile(file, (error, content) => {
    if (error) {
      sendJson(response, 500, { success: false, error: "Could not read the FitGuide application files." });
      return;
    }
    response.writeHead(200, {
      "content-type": item[1],
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    });
    response.end(content);
  });
  return true;
}

function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!allowLocalOrigin(request, response)) {
      sendJson(response, 403, { success: false, error: "Only local FitGuide pages can access this server." });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { success: true, status: "running", service: "FitGuide" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/exercises") {
      sendJson(response, 200, { exercises: EXERCISES });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/workouts/generate") {
      try {
        const body = await readJsonBody(request);
        const plan = await generateWorkout(body && body.profile);
        sendJson(response, 200, { success: true, plan });
      } catch (error) {
        if (error instanceof PlannerError) {
          sendJson(response, error.statusCode, { success: false, error: error.message });
          return;
        }
        console.error("FitGuide workout generation failed unexpectedly.", error);
        sendJson(response, 500, { success: false, error: "The workout plan could not be generated. Please try again." });
      }
      return;
    }
    if (request.method === "GET" && serveStatic(request, response, url.pathname)) return;
    sendJson(response, 404, { success: false, error: "Route not found." });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 4173;
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`FitGuide is available at http://127.0.0.1:${port}`);
    console.log("Workout recommendations run locally with FitGuide's exercise catalog.");
  });
}

module.exports = { createServer, generateWorkout };
