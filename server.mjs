import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const rootDir = resolve(import.meta.dirname);
const publicDir = join(rootDir, "public");
const seedFile = join(rootDir, "data", "store.json");
const dataDir = resolve(process.env.KANBAN_DATA_DIR ?? join(rootDir, "data"));
const dataFile = resolve(process.env.KANBAN_DATA_FILE ?? join(dataDir, "store.json"));
const handoffDir = join(dataDir, "handoffs");
const reviewDir = join(dataDir, "reviews");
const accessToken = process.env.KANBAN_ACCESS_TOKEN?.trim();
const githubToken = process.env.GITHUB_TOKEN?.trim();
const defaultGithubRepo = cleanRepoName(process.env.GITHUB_DEFAULT_REPO ?? "Creaboobot/Board");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3001);
const githubSyncIntervalMs = Math.max(0, Number(process.env.GITHUB_SYNC_INTERVAL_MS ?? 60000));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function now() {
  return new Date().toISOString();
}

function cleanRepoName(value) {
  const repo = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : "";
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function unauthorizedResponse(res) {
  res.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": "Bearer",
  });
  res.end(JSON.stringify({ error: "Access token required." }));
}

function textResponse(res, status, text) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function isAuthorized(req, url) {
  if (!accessToken || url.pathname === "/api/health") {
    return true;
  }

  const headerToken = req.headers["x-kanban-token"];
  const authorization = req.headers.authorization;

  return headerToken === accessToken || authorization === `Bearer ${accessToken}`;
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function loadStore() {
  await ensureDataFile();
  return normalizeStore(JSON.parse(await readFile(dataFile, "utf8")));
}

async function saveStore(store) {
  await mkdir(dataDir, { recursive: true });
  const tmpFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmpFile, dataFile);
}

async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(handoffDir, { recursive: true });
  await mkdir(reviewDir, { recursive: true });

  if (existsSync(dataFile)) {
    return;
  }

  const seed = existsSync(seedFile)
    ? await readFile(seedFile, "utf8")
    : JSON.stringify(createEmptyStore(), null, 2);

  await writeFile(dataFile, seed.endsWith("\n") ? seed : `${seed}\n`, "utf8");
}

function createEmptyStore() {
  return {
    version: 5,
    selectedProjectId: null,
    columns: [
      { id: "backlog", name: "Backlog", description: "Ideas, rough requests, and parking-lot work." },
      { id: "ready", name: "Ready", description: "Tasks shaped enough for Codex to pick up." },
      { id: "doing", name: "In Progress", description: "Work currently being implemented." },
      { id: "review", name: "Review", description: "Needs testing, approval, or a decision." },
      { id: "done", name: "Done", description: "Completed and no longer active." },
    ],
    projects: [],
    tasks: [],
    handoffs: [],
    taskReviews: [],
    taskResults: [],
    activities: [],
    githubExports: [],
  };
}

function normalizeStore(store) {
  store.version = Math.max(Number(store.version) || 1, 5);
  store.columns ??= createEmptyStore().columns;
  store.projects ??= [];
  store.tasks ??= [];
  store.handoffs ??= [];
  store.taskReviews ??= [];
  store.taskResults ??= [];
  store.activities ??= [];
  store.githubExports ??= [];

  for (const project of store.projects) {
    normalizeProjectRouting(project);
  }

  for (const task of store.tasks) {
    task.labels ??= [];
    task.acceptanceCriteria ??= [];
    task.links ??= [];
    task.contextImages = cleanContextImages(task.contextImages);
    task.githubRepo = cleanRepoName(task.githubRepo) || "";
    task.targetEnvironment = cleanString(task.targetEnvironment);
    task.codexHandoffStatus ??= "idle";
    task.codexReviewStatus ??= "idle";
    task.codexResultStatus ??= "idle";
    task.githubStatus ??= "idle";
    if (task.columnId === "done") {
      task.completedAt = cleanString(task.completedAt) || cleanString(task.githubIssueClosedAt) || cleanString(task.updatedAt);
    }
  }

  backfillActivities(store);

  return store;
}

function backfillActivities(store) {
  if (store.activities.length) {
    return;
  }

  for (const task of store.tasks) {
    store.activities.push({
      id: `activity-created-${task.id}`,
      taskId: task.id,
      projectId: task.projectId,
      type: "task-created",
      message: "Task created.",
      createdAt: task.createdAt ?? now(),
      meta: {},
    });
  }

  for (const review of store.taskReviews) {
    const statusMessage =
      review.status === "applied"
        ? "Task review proposal applied."
        : review.status === "proposed"
          ? "Task review proposal created."
          : "Task review requested.";

    store.activities.push({
      id: `activity-review-${review.id}`,
      taskId: review.taskId,
      projectId: review.projectId,
      type: `task-review-${review.status}`,
      message: statusMessage,
      createdAt: review.updatedAt ?? review.createdAt ?? now(),
      meta: { reviewId: review.id },
    });
  }

  for (const handoff of store.handoffs) {
    store.activities.push({
      id: `activity-handoff-${handoff.id}`,
      taskId: handoff.taskId,
      projectId: handoff.projectId,
      type: `handoff-${handoff.status}`,
      message:
        handoff.status === "claimed"
          ? "Codex started work."
          : handoff.status === "completed"
            ? "Codex completed work."
            : "Task sent to Codex.",
      createdAt: handoff.completedAt ?? handoff.claimedAt ?? handoff.requestedAt ?? now(),
      meta: { handoffId: handoff.id },
    });
  }

  store.activities.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function cleanCodexTargetMode(value, fallback = "ask") {
  const mode = cleanString(value, fallback).toLowerCase();
  return ["cloud", "local", "ask"].includes(mode) ? mode : fallback;
}

function normalizeProjectRouting(project) {
  project.githubRepo = cleanRepoName(project.githubRepo) || defaultGithubRepo || "";
  project.codexTargetMode = cleanCodexTargetMode(project.codexTargetMode);
  project.codexProfile = cleanString(project.codexProfile);
  project.localWorkspacePath = cleanString(project.localWorkspacePath);
  project.defaultBranch = cleanString(project.defaultBranch, "main");
  project.targetEnvironment = cleanString(project.targetEnvironment);
  project.syncGithub = project.syncGithub === false ? false : true;
  return project;
}

function cleanContextImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        const src = cleanString(item);
        return src ? { id: `context-${randomUUID().slice(0, 8)}`, name: "Screenshot", src } : null;
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const src = cleanString(item.src);
      if (!src) {
        return null;
      }

      return {
        id: cleanString(item.id) || `context-${randomUUID().slice(0, 8)}`,
        name: cleanString(item.name, "Screenshot"),
        src,
        type: cleanString(item.type),
        size: Number(item.size) || undefined,
        createdAt: cleanString(item.createdAt) || now(),
      };
    })
    .filter(Boolean);
}

function recordActivity(store, task, type, message, meta = {}) {
  store.activities ??= [];
  store.activities.push({
    id: `activity-${randomUUID().slice(0, 8)}`,
    taskId: task.id,
    projectId: task.projectId,
    type,
    message,
    createdAt: now(),
    meta,
  });

  store.activities = store.activities
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-1000);
}

function requireProject(store, projectId) {
  const project = store.projects.find((item) => item.id === projectId);

  if (!project) {
    const error = new Error("Project not found.");
    error.status = 404;
    throw error;
  }

  return project;
}

function requireColumn(store, columnId) {
  const column = store.columns.find((item) => item.id === columnId);

  if (!column) {
    const error = new Error("Column not found.");
    error.status = 400;
    throw error;
  }

  return column;
}

function requireTask(store, taskId) {
  const task = store.tasks.find((item) => item.id === taskId);

  if (!task) {
    const error = new Error("Task not found.");
    error.status = 404;
    throw error;
  }

  return task;
}

function nextSortOrder(store, projectId, columnId) {
  const orders = store.tasks
    .filter((task) => task.projectId === projectId && task.columnId === columnId)
    .map((task) => Number(task.sortOrder) || 0);

  return (Math.max(0, ...orders) || 0) + 1000;
}

function moveTaskToColumn(store, task, columnId) {
  requireColumn(store, columnId);

  if (task.columnId === columnId) {
    return false;
  }

  task.columnId = columnId;
  task.sortOrder = nextSortOrder(store, task.projectId, columnId);
  return true;
}

function taskById(store, taskId) {
  return store.tasks.find((task) => task.id === taskId);
}

function activeRequestedHandoffs(store) {
  return store.handoffs.filter((handoff) => {
    if (handoff.status !== "requested") {
      return false;
    }

    const task = taskById(store, handoff.taskId);
    return task?.columnId === "ready" && !["review-triggered", "issue-created", "codex-triggered", "completed", "accepted"].includes(task.githubStatus);
  });
}

function supersedeRequestedHandoffsForTask(store, task, timestamp, reason = "superseded") {
  for (const handoff of store.handoffs.filter(
    (item) => item.taskId === task.id && ["requested", "claimed", "changes-requested"].includes(item.status),
  )) {
    handoff.status = "superseded";
    handoff.supersededAt = timestamp;
    handoff.supersededReason = reason;
  }
}

function supersedeOpenReviewsForTask(store, task, timestamp, reason = "implementation-started") {
  for (const review of store.taskReviews.filter(
    (item) => item.taskId === task.id && ["requested", "claimed", "cloud-triggered", "proposed"].includes(item.status),
  )) {
    review.status = "superseded";
    review.supersededAt = timestamp;
    review.supersededReason = reason;
    review.updatedAt = timestamp;
  }

  if (["requested", "claimed", "cloud-triggered", "proposed"].includes(task.codexReviewStatus)) {
    task.codexReviewStatus = "superseded";
  }
}

function listMarkdown(items, fallback = "- none") {
  const list = cleanList(items);
  return list.length ? list.map((item) => `- ${item}`).join("\n") : fallback;
}

function contextImagesMarkdown(task) {
  const images = cleanContextImages(task.contextImages);

  if (!images.length) {
    return "- none";
  }

  return images
    .map((image) => {
      if (/^https?:\/\//i.test(image.src)) {
        return `- [${image.name}](${image.src})`;
      }

      return `- ${image.name} (stored on the board as screenshot context)`;
    })
    .join("\n");
}

function githubIssueMarkdown(store, task) {
  const project = requireProject(store, task.projectId);
  const routing = projectRoutingForTask(store, task);
  const targetRepo = routing.githubRepo;
  const targetEnvironment = routing.targetEnvironment || "No environment guidance provided.";

  return [
    "## Task",
    "",
    task.description || "No description provided.",
    "",
    "## Acceptance Criteria",
    listMarkdown(task.acceptanceCriteria),
    "",
    "## Notes",
    task.notes || "No notes.",
    "",
    "## Links",
    listMarkdown(task.links),
    "",
    "## Screenshot Context",
    contextImagesMarkdown(task),
    "",
    "## Target Repository",
    targetRepo || "No repository configured.",
    "",
    "## Target Environment",
    targetEnvironment,
    "",
    "## Board Metadata",
    `- Project: ${project.name}`,
    `- Board task ID: ${task.id}`,
    `- Priority: ${task.priority}`,
    `- Size: ${task.size}`,
    `- Status at export: ${requireColumn(store, task.columnId).name}`,
    `- Labels: ${(task.labels ?? []).join(", ") || "none"}`,
    `- Target repository: ${targetRepo || "none"}`,
    `- Target environment: ${targetEnvironment}`,
    `- Codex target mode: ${routing.codexTargetMode}`,
    `- Codex project/profile: ${routing.codexProfile || "none"}`,
    `- Local workspace: ${routing.localWorkspacePath || "none"}`,
    `- Default branch: ${routing.defaultBranch || "none"}`,
    `- GitHub sync: ${routing.syncGithub ? "enabled" : "disabled"}`,
  ].join("\n");
}

function codexCloudComment(store, task) {
  const project = requireProject(store, task.projectId);
  const routing = projectRoutingForTask(store, task);
  const targetRepo = routing.githubRepo;
  const targetEnvironment = routing.targetEnvironment || "not specified";

  return [
    "@codex please take this task.",
    "",
    "Work from the issue description above.",
    "Use the target repository and environment listed in this issue. If the current Codex environment does not match, say so before changing files.",
    "",
    "When done:",
    "- Add a `### Result` section containing the actual user-facing deliverable or answer.",
    "- If this is a writing, research, analysis, or summary task, put the finished prose directly under `### Result`. Do not only say that you created a file.",
    "- Open a pull request only when code or repository file changes are actually needed.",
    "- Include `### Summary`, changed paths, and verification notes after the result.",
    "- Keep changes scoped to this task.",
    "",
    `Board project: ${project.name}`,
    `Board task ID: ${task.id}`,
    `Target repository: ${targetRepo || "not configured"}`,
    `Target environment: ${targetEnvironment}`,
    `Codex project/profile: ${routing.codexProfile || "not configured"}`,
    `Default branch: ${routing.defaultBranch || "not configured"}`,
  ].join("\n");
}

function codexCloudReviewComment(store, task, review) {
  const project = requireProject(store, task.projectId);
  const routing = projectRoutingForTask(store, task);
  const targetRepo = routing.githubRepo;
  const targetEnvironment = routing.targetEnvironment;

  return [
    "@codex please review this task for implementation readiness only. Do not implement code.",
    "",
    "Return one GitHub comment with a concise proposal for improving the board card before implementation.",
    "The comment must include a fenced JSON block shaped exactly like this:",
    "",
    "```json",
    JSON.stringify(
      {
        type: "codex-kanban-review",
        boardTaskId: task.id,
        reviewId: review.id,
        summary: "What the review improved or confirmed.",
        reasoning: "Why these changes make the task easier to execute.",
        title: task.title,
        description: task.description || task.title,
        priority: task.priority || "Medium",
        size: task.size || "M",
        githubRepo: targetRepo,
        targetEnvironment,
        labels: task.labels ?? [],
        acceptanceCriteria: task.acceptanceCriteria ?? [],
        links: task.links ?? [],
        notes: task.notes || "",
      },
      null,
      2,
    ),
    "```",
    "",
    "Keep the proposal faithful to the original intent. Add missing acceptance criteria only when they are implied by the request.",
    "",
    "Current board card:",
    "",
    githubIssueMarkdown(store, task),
    "",
    `Board project: ${project.name}`,
    `Board task ID: ${task.id}`,
    `Target repository: ${targetRepo || "not configured"}`,
    `Target environment: ${targetEnvironment || "not specified"}`,
    `Codex project/profile: ${routing.codexProfile || "not configured"}`,
    `Review ID: ${review.id}`,
  ].join("\n");
}

function codexCloudFollowUpComment(store, task, note = "") {
  const project = requireProject(store, task.projectId);
  const guidance = cleanString(note);
  const routing = projectRoutingForTask(store, task);
  const targetRepo = routing.githubRepo;
  const targetEnvironment = routing.targetEnvironment || "not specified";

  return [
    "@codex please continue this task from the updated board card in this same GitHub issue thread.",
    "",
    guidance ? `Additional guidance: ${guidance}` : "Use the current issue and board task context.",
    "",
    "Current board card:",
    "",
    githubIssueMarkdown(store, task),
    "",
    "When done, add a completion comment with `### Result`, `### Summary`, changed paths, and verification notes. For writing or research tasks, the actual finished prose must be in `### Result`.",
    "Use the target repository and environment listed in the card. If the current Codex environment does not match, say so before changing files.",
    "",
    `Board project: ${project.name}`,
    `Board task ID: ${task.id}`,
    `Target repository: ${targetRepo || "not configured"}`,
    `Target environment: ${targetEnvironment}`,
    `Codex project/profile: ${routing.codexProfile || "not configured"}`,
    `Default branch: ${routing.defaultBranch || "not configured"}`,
  ].join("\n");
}

async function triggerExistingGithubIssue(store, task, repo, note = "") {
  const issueNumber = Number(task.githubIssueNumber);

  if (!repo || !issueNumber) {
    const error = new Error("This task does not have an existing GitHub issue to trigger.");
    error.status = 400;
    throw error;
  }

  const triggeredAt = now();
  const comment = await githubRequest(repo, `/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: codexCloudFollowUpComment(store, task, note),
    }),
  });

  task.githubStatus = "codex-triggered";
  task.githubRepo = repo;
  task.githubCodexCommentUrl = comment.html_url;
  task.githubLastTriggeredAt = triggeredAt;
  task.codexHandoffStatus = "cloud-triggered";
  task.codexResultStatus = "in-progress";
  task.updatedAt = triggeredAt;
  moveTaskToColumn(store, task, "doing");
  supersedeOpenReviewsForTask(store, task, triggeredAt, "implementation-started");
  supersedeRequestedHandoffsForTask(store, task, triggeredAt, "sent-to-github");
  updateGithubExportsForTask(store, task, "codex-triggered", triggeredAt, {
    codexCommentUrl: comment.html_url,
  });

  return { comment, triggeredAt };
}

async function ensureGithubIssueForTask(store, task, repo, timestamp, { status = "issue-created", labels = [] } = {}) {
  const project = requireProject(store, task.projectId);

  if (task.githubIssueNumber && task.githubRepo === repo) {
    return {
      created: false,
      issue: {
        number: Number(task.githubIssueNumber),
        html_url: task.githubIssueUrl,
      },
    };
  }

  const issue = await githubRequest(repo, "/issues", {
    method: "POST",
    body: JSON.stringify({
      title: task.title,
      body: githubIssueMarkdown(store, task),
      labels: uniqueValues(["codex-kanban", ...labels]),
    }),
  });

  store.githubExports.push({
    id: `github-${randomUUID().slice(0, 8)}`,
    taskId: task.id,
    projectId: project.id,
    repo,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    triggerCodex: false,
    codexCommentUrl: null,
    status,
    createdAt: timestamp,
  });

  task.githubStatus = status;
  task.githubRepo = repo;
  task.githubIssueNumber = issue.number;
  task.githubIssueUrl = issue.html_url;
  task.githubExportedAt = timestamp;
  task.updatedAt = timestamp;

  return { created: true, issue };
}

function buildTaskPacket(store, task, purpose) {
  const project = requireProject(store, task.projectId);
  const routing = projectRoutingForTask(store, task);
  const targetRepo = routing.githubRepo;
  const targetEnvironment = routing.targetEnvironment || "not specified";

  return [
    `# ${purpose}: ${task.title}`,
    "",
    `Project: ${project.name}`,
    `Task ID: ${task.id}`,
    `Priority: ${task.priority}`,
    `Size: ${task.size}`,
    `Status: ${requireColumn(store, task.columnId).name}`,
    `Labels: ${(task.labels ?? []).join(", ") || "none"}`,
    `Target repository: ${targetRepo || "not configured"}`,
    `Target environment: ${targetEnvironment}`,
    `Codex target mode: ${routing.codexTargetMode}`,
    `Codex project/profile: ${routing.codexProfile || "not configured"}`,
    `Local workspace: ${routing.localWorkspacePath || "not configured"}`,
    `Default branch: ${routing.defaultBranch || "not configured"}`,
    `GitHub sync: ${routing.syncGithub ? "enabled" : "disabled"}`,
    "",
    "## Context",
    task.description || "No description provided.",
    "",
    "## Acceptance Criteria",
    listMarkdown(task.acceptanceCriteria),
    "",
    "## Links",
    listMarkdown(task.links),
    "",
    "## Notes",
    task.notes || "No notes.",
  ].join("\n");
}

function inferLabels(task) {
  const existing = new Set(task.labels ?? []);
  const haystack = `${task.title} ${task.description} ${task.notes}`.toLowerCase();
  const hints = [
    [/web|site|browser|frontend|ui|app/, "web-app"],
    [/api|server|backend|database|db/, "backend"],
    [/test|qa|verify|bug|fix/, "testing"],
    [/deploy|host|cloud|docker|domain|public/, "deployment"],
    [/design|layout|screen|mobile|responsive/, "ux"],
  ];

  for (const [pattern, label] of hints) {
    if (pattern.test(haystack)) {
      existing.add(label);
    }
  }

  return Array.from(existing).slice(0, 6);
}

function buildLocalReviewProposal(store, task) {
  const routing = projectRoutingForTask(store, task);
  const acceptanceCriteria = task.acceptanceCriteria?.length
    ? task.acceptanceCriteria
    : [
        "The primary user workflow described in the task can be completed end to end.",
        "The result is visible in the application or captured in the task result.",
        "Relevant checks or manual verification notes are recorded before the task moves to Review.",
      ];
  const notes = [
    task.notes,
    "Keep changes scoped to this task. Record changed local paths and verification steps in the result when work is complete.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    summary: "Local task review drafted a clearer handoff while keeping the original intent.",
    reasoning:
      "This first pass checks that Codex has enough context, acceptance criteria, labels, and completion expectations before implementation starts. It avoids paid API usage and can still be refined manually before handoff.",
    title: task.title,
    description: task.description || task.title,
    priority: task.priority || "Medium",
    size: task.size || "M",
    githubRepo: routing.githubRepo,
    targetEnvironment: routing.targetEnvironment,
    labels: inferLabels(task),
    acceptanceCriteria,
    links: task.links ?? [],
    notes,
  };
}

function safeFilePart(value) {
  return cleanString(value, "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "task";
}

async function writePacket(directory, item, packet) {
  await mkdir(directory, { recursive: true });
  const stamp = now().replace(/[:.]/g, "-");
  const filePath = join(directory, `${stamp}-${safeFilePart(item.taskId ?? item.id)}.md`);
  await writeFile(filePath, `${packet}\n`, "utf8");
  return filePath;
}

async function removePacketFile(filePath) {
  if (!filePath) {
    return;
  }

  const resolvedPath = resolve(filePath);

  if (!resolvedPath.startsWith(`${dataDir}${sep}`)) {
    return;
  }

  await rm(resolvedPath, { force: true });
}

function latestReviewForTask(store, taskId) {
  return store.taskReviews
    .filter((review) => review.taskId === taskId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function latestResultForTask(store, taskId) {
  return store.taskResults
    .filter((result) => result.taskId === taskId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function applyReviewProposal(task, review) {
  const proposal = review.proposal;

  if (!proposal) {
    const error = new Error("Review does not have a proposal to apply.");
    error.status = 400;
    throw error;
  }

  for (const key of ["title", "description", "priority", "size", "targetEnvironment", "notes"]) {
    if (proposal[key] !== undefined) {
      task[key] = cleanString(proposal[key], task[key]);
    }
  }

  if (proposal.githubRepo !== undefined) {
    task.githubRepo = cleanRepoName(proposal.githubRepo) || task.githubRepo || "";
  }

  for (const key of ["labels", "acceptanceCriteria", "links"]) {
    if (proposal[key] !== undefined) {
      task[key] = cleanList(proposal[key]);
    }
  }
}

function githubApiPath(repo, path) {
  const [owner, name] = repo.split("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${path}`;
}

async function githubRequest(repo, path, options = {}) {
  if (!githubToken) {
    const error = new Error("GitHub token is not configured on the server.");
    error.status = 400;
    throw error;
  }

  const response = await fetch(githubApiPath(repo, path), {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${githubToken}`,
      "content-type": "application/json",
      "user-agent": "codex-kanban",
      "x-github-api-version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message ?? `GitHub request failed with ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

function githubRepoForTask(store, task) {
  return projectRoutingForTask(store, task).githubRepo;
}

function projectRoutingForTask(store, task) {
  const project = requireProject(store, task.projectId);

  return {
    githubRepo: cleanRepoName(task.githubRepo) || cleanRepoName(project.githubRepo) || defaultGithubRepo || "",
    codexTargetMode: cleanCodexTargetMode(project.codexTargetMode),
    codexProfile: cleanString(project.codexProfile),
    localWorkspacePath: cleanString(project.localWorkspacePath),
    defaultBranch: cleanString(project.defaultBranch, "main"),
    targetEnvironment: cleanString(task.targetEnvironment) || cleanString(project.targetEnvironment),
    syncGithub: project.syncGithub !== false,
  };
}

function htmlToText(value = "") {
  return cleanString(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeRemoteText(value = "") {
  return cleanString(value)
    .replace(/\u00e2\u0153\u2026/g, "\u2705")
    .replace(/\u00e2\u2020\u2019/g, "->")
    .replace(/\u00e2\u20ac\u2122/g, "'")
    .replace(/\u00e2\u20ac\u0153/g, "\"")
    .replace(/\u00e2\u20ac\u009d/g, "\"")
    .replace(/\u00e2\u20ac\u201c/g, "-")
    .replace(/\u00e2\u20ac\u201d/g, "-");
}

function parseMarkdownListUnderHeading(body, heading) {
  const lines = normalizeRemoteText(body).split(/\r?\n/);
  const start = lines.findIndex((line) => line.toLowerCase().includes(heading.toLowerCase()));

  if (start === -1) {
    return [];
  }

  const items = [];

  for (const line of lines.slice(start + 1)) {
    const trimmedLine = line.trim();

    if ((/^#{1,6}\s+/.test(trimmedLine) || /^\*\*[^*]+\*\*\s*$/.test(trimmedLine)) && items.length) {
      break;
    }

    if (/^\s*\*\s+/.test(line) || /^\s*-\s+/.test(line)) {
      items.push(line.replace(/^\s*[*-]\s+/, "").replace(/^✅\s*/, "").trim());
    }
  }

  return items.map((item) => item.replace(/^(?:\u2705|\u2713|\u00e2\u0153\u2026)\s*/u, "").trim()).filter(Boolean);
}

function parseMarkdownSection(body, heading) {
  const lines = normalizeRemoteText(body).split(/\r?\n/);
  const headingPattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const starts = lines
    .map((line, index) => (headingPattern.test(line.trim()) ? index : -1))
    .filter((index) => index !== -1)
    .reverse();

  for (const start of starts) {
    const section = [];

    for (const line of lines.slice(start + 1)) {
      const trimmedLine = line.trim();

      if (/^#{1,6}\s+/.test(trimmedLine)) {
        break;
      }

      section.push(line);
    }

    const text = section.join("\n").trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function commentTimestamp(comment) {
  const timestamp = new Date(comment.created_at ?? comment.updated_at ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestCodexCompletionComment(comments, task = {}) {
  const implementationTriggeredAt = new Date(task.githubLastTriggeredAt ?? 0).getTime();

  return comments
    .filter((comment) => comment.user?.login === "chatgpt-codex-connector[bot]")
    .filter((comment) => {
      const body = normalizeRemoteText(comment.body ?? "");

      if (/codex-kanban-review|implementation-readiness review proposal/i.test(body)) {
        return false;
      }

      if (Number.isFinite(implementationTriggeredAt) && implementationTriggeredAt > 0) {
        const createdAt = commentTimestamp(comment);
        if (createdAt && createdAt < implementationTriggeredAt) {
          return false;
        }
      }

      return /(^|\n)#{1,6}\s+(Result|Summary)\s*$/im.test(body) ||
        /(^|\n)#{1,6}\s+(Changed paths|Verification notes|Testing)\s*$/im.test(body) ||
        /Committed the change/i.test(body);
    })
    .slice(-1)[0];
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractMarkdownLinks(body) {
  const text = cleanString(body);
  const links = [];
  const seen = new Set();
  const addLink = (url, label = url) => {
    const cleanUrl = cleanString(url).replace(/[),.;]+$/g, "");

    if (!cleanUrl || seen.has(cleanUrl)) {
      return;
    }

    seen.add(cleanUrl);
    links.push({ label: cleanString(label, cleanUrl), url: cleanUrl });
  };

  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    addLink(match[2], match[1]);
  }

  for (const match of text.matchAll(/https?:\/\/[^\s<>)]+/g)) {
    addLink(match[0]);
  }

  return links;
}

function extractPathCandidates(text) {
  const ignoredNames = new Set(["AGENTS.MD", "SKILL.MD"]);
  const candidates = new Set();
  const body = cleanString(text);
  const pathPattern =
    /(?:^|[\s"'(`])([A-Za-z0-9_.-]+(?:[\/\\][A-Za-z0-9_. -]+)*\.(?:bat|c|cmd|cpp|cs|css|csv|gif|go|h|html|java|jpeg|jpg|js|json|jsx|lock|md|mjs|php|png|ps1|py|rb|rs|sh|sql|svg|toml|ts|tsx|txt|webp|ya?ml))(?=$|[\s"'`,).;:])/gi;

  for (const match of body.matchAll(pathPattern)) {
    const candidate = cleanString(match[1]).replace(/^[./\\]+/, "");

    if (!candidate || ignoredNames.has(candidate.toUpperCase())) {
      continue;
    }

    candidates.add(candidate);
  }

  return Array.from(candidates);
}

function extractChangedPaths(body) {
  const summary = parseMarkdownListUnderHeading(body, "Summary").join("\n");
  const summaryCandidates = extractPathCandidates(summary);

  if (summaryCandidates.length) {
    return summaryCandidates;
  }

  return extractPathCandidates(body);
}

function codexCompletionResultFromComment(task, issue, comment, syncedAt) {
  const rawBody = normalizeRemoteText(cleanString(comment.body) || htmlToText(comment.body_html));
  const resultSection = parseMarkdownSection(rawBody, "Result");
  const details = resultSection || normalizeRemoteText(htmlToText(comment.body_html) || rawBody);
  const summaryItems = parseMarkdownListUnderHeading(rawBody, "Summary");
  const verification = parseMarkdownListUnderHeading(rawBody, "Testing").length
    ? parseMarkdownListUnderHeading(rawBody, "Testing")
    : parseMarkdownListUnderHeading(rawBody, "Verification notes");
  const links = extractMarkdownLinks(rawBody);
  const codexTaskUrl = links.find((link) => link.url.includes("chatgpt.com/s/"))?.url ?? null;
  const prUrls = uniqueValues(links.map((link) => link.url).filter((url) => /github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(url)));
  const followUps = [];

  for (const prUrl of prUrls) {
    followUps.push(`Review pull request: ${prUrl}`);
  }

  if (issue.state !== "closed") {
    followUps.push("Review the GitHub result and close or continue the issue.");
  }

  return {
    taskId: task.id,
    projectId: task.projectId,
    githubIssueUrl: issue.html_url,
    githubCommentUrl: comment.html_url,
    status: "ready-for-review",
    summary: summaryItems[0] || "Codex Cloud completed the GitHub task.",
    details,
    changedPaths: extractChangedPaths(rawBody),
    verification,
    followUps,
    codexTaskUrl,
    prUrls,
    createdAt: syncedAt,
  };
}

function extractJsonObjectNear(text, marker) {
  const body = cleanString(text);
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // Fall through to marker-based extraction.
    }
  }

  const markerIndex = body.indexOf(marker);
  const start = markerIndex === -1 ? body.indexOf("{") : body.lastIndexOf("{", markerIndex);

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < body.length; index += 1) {
    const char = body[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function normalizeReviewProposal(task, proposal = {}) {
  return {
    summary: cleanString(proposal.summary, "Codex reviewed the task and proposed a clearer handoff."),
    reasoning: cleanString(
      proposal.reasoning,
      "Codex reviewed the task for implementation readiness and filled in missing execution details.",
    ),
    title: proposal.title === undefined ? task.title : cleanString(proposal.title, task.title),
    description:
      proposal.description === undefined
        ? task.description || task.title
        : cleanString(proposal.description, task.description || task.title),
      priority: proposal.priority === undefined ? task.priority || "Medium" : cleanString(proposal.priority, task.priority || "Medium"),
      size: proposal.size === undefined ? task.size || "M" : cleanString(proposal.size, task.size || "M"),
      githubRepo: proposal.githubRepo === undefined ? cleanRepoName(task.githubRepo) : cleanRepoName(proposal.githubRepo),
      targetEnvironment:
        proposal.targetEnvironment === undefined
          ? cleanString(task.targetEnvironment)
          : cleanString(proposal.targetEnvironment, task.targetEnvironment || ""),
      labels: proposal.labels === undefined ? task.labels ?? [] : cleanList(proposal.labels),
      acceptanceCriteria:
      proposal.acceptanceCriteria === undefined
        ? task.acceptanceCriteria ?? []
        : cleanList(proposal.acceptanceCriteria),
    links: proposal.links === undefined ? task.links ?? [] : cleanList(proposal.links),
    notes: proposal.notes === undefined ? task.notes || "" : cleanString(proposal.notes, task.notes || ""),
  };
}

function codexReviewProposalFromComment(task, review, comment, syncedAt) {
  const rawBody = normalizeRemoteText(cleanString(comment.body) || htmlToText(comment.body_html));
  const parsed = extractJsonObjectNear(rawBody, "codex-kanban-review");
  const proposal = parsed?.proposal ?? parsed ?? {};

  return {
    ...normalizeReviewProposal(task, proposal),
    source: "github-codex",
    sourceCommentUrl: comment.html_url,
    sourceCommentId: comment.id,
    reviewId: review.id,
    proposedAt: syncedAt,
  };
}

function latestCodexReviewComment(comments, review) {
  const reviewCreatedAt = new Date(review.createdAt ?? 0).getTime();

  return comments
    .filter((comment) => comment.user?.login === "chatgpt-codex-connector[bot]")
    .filter((comment) => Number(comment.id) !== Number(review.githubReviewCommentId))
    .filter((comment) => new Date(comment.created_at ?? 0).getTime() >= reviewCreatedAt)
    .filter((comment) => {
      const body = comment.body ?? "";
      return (
        body.includes("codex-kanban-review") ||
        body.includes(review.id) ||
        body.includes(review.taskId)
      );
    })
    .slice(-1)[0];
}

function githubSyncCandidate(task, includeCompleted = false) {
  if (!task.githubIssueNumber || !task.githubRepo) {
    return false;
  }

  return ["issue-created", "codex-triggered", ...(includeCompleted ? ["completed"] : [])].includes(task.githubStatus);
}

function updateGithubExportsForTask(store, task, status, timestamp, extra = {}) {
  for (const githubExport of store.githubExports.filter((item) => item.taskId === task.id)) {
    githubExport.status = status;
    githubExport.updatedAt = timestamp;

    if (status === "completed") {
      githubExport.completedAt = timestamp;
    }

    Object.assign(githubExport, extra);
  }
}

async function syncGithubTask(store, task, { recordNoResult = true } = {}) {
  const repo = task.githubRepo || githubRepoForTask(store, task);
  const issueNumber = Number(task.githubIssueNumber);

  if (!repo || !issueNumber) {
    return {
      checked: false,
      changed: false,
      synced: false,
      message: "This task does not have a GitHub issue to sync.",
    };
  }

  if (task.githubStatus === "accepted" || task.codexResultStatus === "accepted") {
    return {
      checked: true,
      changed: false,
      synced: false,
      message: "Task is already accepted.",
    };
  }

  const issue = await githubRequest(repo, `/issues/${issueNumber}`);
  const comments = await githubRequest(repo, `/issues/${issueNumber}/comments?per_page=100`);
  const completionComment = latestCodexCompletionComment(comments, task);
  const syncedAt = now();
  const previousGithubStatus = task.githubStatus;

  task.githubRepo = repo;
  task.githubIssueUrl = issue.html_url;
  task.githubIssueState = issue.state;
  task.githubLastSyncedAt = syncedAt;
  task.githubSyncError = "";
  task.updatedAt = syncedAt;

  if (!completionComment) {
    if (!["issue-created", "completed", "accepted"].includes(task.githubStatus)) {
      task.githubStatus = "codex-triggered";
    }

    if (recordNoResult) {
      recordActivity(store, task, "github-sync-no-result", "GitHub sync checked but no Codex result was found yet.", {
        repo,
        issueUrl: issue.html_url,
      });
    }

    return {
      checked: true,
      changed: true,
      synced: false,
      issue,
      message: "No Codex result found yet.",
    };
  }

  const resultPayload = codexCompletionResultFromComment(task, issue, completionComment, syncedAt);
  let result = store.taskResults.find(
    (item) => item.taskId === task.id && item.githubCommentUrl === completionComment.html_url,
  );
  const shouldRecordCompletion = !result || previousGithubStatus !== "completed";

  if (result) {
    if (result.manualOverride) {
      Object.assign(result, {
        githubIssueUrl: resultPayload.githubIssueUrl,
        githubCommentUrl: resultPayload.githubCommentUrl,
        status: "ready-for-review",
        codexTaskUrl: result.codexTaskUrl || resultPayload.codexTaskUrl,
        prUrls: result.prUrls?.length ? result.prUrls : resultPayload.prUrls,
        lastSyncedAt: syncedAt,
      });
    } else {
      Object.assign(result, {
        ...resultPayload,
        id: result.id,
        createdAt: result.createdAt,
        updatedAt: syncedAt,
      });
    }
  } else {
    result = {
      id: `result-${randomUUID().slice(0, 8)}`,
      ...resultPayload,
    };
    store.taskResults.push(result);
  }

  for (const staleResult of store.taskResults.filter(
    (item) => item.taskId === task.id && item.id !== result.id && item.status === "ready-for-review" && !item.manualOverride,
  )) {
    staleResult.status = "superseded";
    staleResult.supersededAt = syncedAt;
    staleResult.supersededReason = "newer-github-result";
  }

  task.githubStatus = "completed";
  task.githubLastSyncedAt = syncedAt;
  task.codexHandoffStatus = "completed";
  task.codexResultStatus = "ready-for-review";
  task.updatedAt = syncedAt;
  supersedeOpenReviewsForTask(store, task, syncedAt, "result-synced");
  supersedeRequestedHandoffsForTask(store, task, syncedAt, "github-result-synced");
  updateGithubExportsForTask(store, task, "completed", syncedAt, {
    resultCommentUrl: completionComment.html_url,
  });
  moveTaskToColumn(store, task, "review");

  if (shouldRecordCompletion) {
    recordActivity(store, task, "github-result-synced", "Codex Cloud result synced from GitHub.", {
      repo,
      issueUrl: issue.html_url,
      commentUrl: completionComment.html_url,
      resultId: result.id,
    });
  }

  return {
    checked: true,
    changed: true,
    synced: true,
    issue,
    comment: completionComment,
    result,
  };
}

async function syncGithubReview(store, review, { recordNoResult = false } = {}) {
  if (review.status !== "cloud-triggered") {
    return {
      checked: false,
      changed: false,
      synced: false,
      message: "Review is not waiting on Codex Cloud.",
    };
  }

  const task = requireTask(store, review.taskId);
  const repo = review.githubRepo || task.githubRepo || githubRepoForTask(store, task);
  const issueNumber = Number(review.githubIssueNumber || task.githubIssueNumber);

  if (!repo || !issueNumber) {
    return {
      checked: false,
      changed: false,
      synced: false,
      message: "This review does not have a GitHub issue to sync.",
    };
  }

  const comments = await githubRequest(repo, `/issues/${issueNumber}/comments?per_page=100`);
  const reviewComment = latestCodexReviewComment(comments, review);
  const syncedAt = now();

  review.githubLastSyncedAt = syncedAt;
  task.githubLastSyncedAt = syncedAt;
  task.updatedAt = syncedAt;

  if (!reviewComment) {
    if (recordNoResult) {
      recordActivity(store, task, "github-review-sync-no-result", "GitHub sync checked but no Codex review was found yet.", {
        repo,
        issueUrl: task.githubIssueUrl,
        reviewId: review.id,
      });
    }

    return {
      checked: true,
      changed: true,
      synced: false,
      message: "No Codex review found yet.",
    };
  }

  review.status = "proposed";
  review.proposal = codexReviewProposalFromComment(task, review, reviewComment, syncedAt);
  review.githubReviewResultCommentUrl = reviewComment.html_url;
  review.githubReviewResultCommentId = reviewComment.id;
  review.updatedAt = syncedAt;
  task.codexReviewStatus = "proposed";
  task.updatedAt = syncedAt;

  recordActivity(store, task, "task-review-proposed", "Codex Cloud review proposal synced from GitHub.", {
    repo,
    issueUrl: task.githubIssueUrl,
    reviewId: review.id,
    commentUrl: reviewComment.html_url,
  });

  return {
    checked: true,
    changed: true,
    synced: true,
    review,
    comment: reviewComment,
  };
}

async function syncGithubTasksOnce({ recordNoResult = false, includeCompleted = false } = {}) {
  const store = await loadStore();

  if (!githubToken) {
    return {
      store,
      checked: 0,
      synced: 0,
      reviewChecked: 0,
      reviewsSynced: 0,
      errors: [{ message: "GITHUB_TOKEN is not configured." }],
    };
  }

  const tasks = store.tasks.filter((task) => githubSyncCandidate(task, includeCompleted));
  const reviews = store.taskReviews.filter((review) => review.status === "cloud-triggered");
  const errors = [];
  let checked = 0;
  let synced = 0;
  let reviewChecked = 0;
  let reviewsSynced = 0;
  let changed = false;

  for (const review of reviews) {
    try {
      const result = await syncGithubReview(store, review, { recordNoResult });
      reviewChecked += result.checked ? 1 : 0;
      reviewsSynced += result.synced ? 1 : 0;
      changed = changed || result.changed;
    } catch (error) {
      const task = taskById(store, review.taskId);
      const syncedAt = now();
      review.githubSyncError = error.message;
      review.githubLastSyncedAt = syncedAt;
      review.updatedAt = syncedAt;

      if (task) {
        task.githubSyncError = error.message;
        task.githubLastSyncedAt = syncedAt;
        task.updatedAt = syncedAt;
      }

      errors.push({ reviewId: review.id, taskId: review.taskId, message: error.message });
      changed = true;
    }
  }

  for (const task of tasks) {
    try {
      const result = await syncGithubTask(store, task, { recordNoResult });
      checked += result.checked ? 1 : 0;
      synced += result.synced ? 1 : 0;
      changed = changed || result.changed;
    } catch (error) {
      const syncedAt = now();
      task.githubSyncError = error.message;
      task.githubLastSyncedAt = syncedAt;
      task.updatedAt = syncedAt;
      errors.push({ taskId: task.id, message: error.message });
      changed = true;
    }
  }

  if (changed) {
    await saveStore(store);
  }

  return { store, checked, synced, reviewChecked, reviewsSynced, errors };
}

async function handleApi(req, res, url) {
  const method = req.method ?? "GET";
  const segments = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/api/health") {
    return jsonResponse(res, 200, {
      status: "ok",
      service: "codex-kanban",
      dataFile,
      authRequired: Boolean(accessToken),
      github: {
        configured: Boolean(githubToken && defaultGithubRepo),
        defaultRepo: defaultGithubRepo || null,
        syncIntervalMs: githubSyncIntervalMs,
      },
    });
  }

  if (method === "GET" && url.pathname === "/api/state") {
    return jsonResponse(res, 200, await loadStore());
  }

  if (method === "POST" && url.pathname === "/api/github/sync") {
    const result = await syncGithubTasksOnce({ recordNoResult: true, includeCompleted: true });
    return jsonResponse(res, 200, result);
  }

  if (method === "GET" && url.pathname === "/api/codex/queue") {
    const store = await loadStore();
    return jsonResponse(res, 200, {
      taskReviews: store.taskReviews.filter((review) => review.status === "requested"),
      handoffs: activeRequestedHandoffs(store),
    });
  }

  if (method === "GET" && url.pathname === "/api/codex/next") {
    const store = await loadStore();
    const review = store.taskReviews
      .filter((item) => item.status === "requested")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

    if (review) {
      return jsonResponse(res, 200, {
        type: "task-review",
        item: review,
        task: requireTask(store, review.taskId),
        project: requireProject(store, review.projectId),
      });
    }

    const handoff = activeRequestedHandoffs(store)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))[0];

    if (handoff) {
      return jsonResponse(res, 200, {
        type: "handoff",
        item: handoff,
        task: requireTask(store, handoff.taskId),
        project: requireProject(store, handoff.projectId),
      });
    }

    return jsonResponse(res, 200, { type: "empty" });
  }

  if (method === "POST" && url.pathname === "/api/codex/claim-next") {
    const store = await loadStore();
    const review = store.taskReviews
      .filter((item) => item.status === "requested")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

    if (review) {
      const task = requireTask(store, review.taskId);
      const claimedAt = now();

      review.status = "claimed";
      review.claimedAt = claimedAt;
      review.updatedAt = claimedAt;
      task.codexReviewStatus = "claimed";
      task.codexReviewClaimedAt = claimedAt;
      task.updatedAt = claimedAt;
      recordActivity(store, task, "task-review-claimed", "Codex started reviewing the task.", {
        reviewId: review.id,
      });
      await saveStore(store);

      return jsonResponse(res, 200, {
        type: "task-review",
        item: review,
        task,
        project: requireProject(store, review.projectId),
        store,
      });
    }

    const handoff = activeRequestedHandoffs(store)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))[0];

    if (!handoff) {
      return jsonResponse(res, 200, { type: "empty", store });
    }

    const task = requireTask(store, handoff.taskId);
    const claimedAt = now();

    moveTaskToColumn(store, task, "doing");
    handoff.status = "claimed";
    handoff.claimedAt = claimedAt;
    task.codexHandoffStatus = "claimed";
    task.codexResultStatus = "in-progress";
    task.codexHandoffClaimedAt = claimedAt;
    task.updatedAt = claimedAt;
    supersedeOpenReviewsForTask(store, task, claimedAt, "implementation-started");
    recordActivity(store, task, "handoff-claimed", "Codex started work.", { handoffId: handoff.id });
    await saveStore(store);

    return jsonResponse(res, 200, {
      type: "handoff",
      item: handoff,
      task,
      project: requireProject(store, handoff.projectId),
      store,
    });
  }

  if (method === "POST" && url.pathname === "/api/projects") {
    const payload = await readBody(req);
    const store = await loadStore();
    const name = cleanString(payload.name);

    if (!name) {
      return jsonResponse(res, 400, { error: "Project name is required." });
    }

    const createdAt = now();
    const project = {
      id: `project-${randomUUID().slice(0, 8)}`,
      name,
      description: cleanString(payload.description),
      color: cleanString(payload.color, "#334155"),
      githubRepo: cleanRepoName(payload.githubRepo) || defaultGithubRepo || "",
      codexTargetMode: cleanCodexTargetMode(payload.codexTargetMode),
      codexProfile: cleanString(payload.codexProfile),
      localWorkspacePath: cleanString(payload.localWorkspacePath),
      defaultBranch: cleanString(payload.defaultBranch, "main"),
      targetEnvironment: cleanString(payload.targetEnvironment),
      syncGithub: payload.syncGithub === false ? false : true,
      createdAt,
      updatedAt: createdAt,
    };

    store.projects.push(project);
    store.selectedProjectId = project.id;
    await saveStore(store);
    return jsonResponse(res, 201, store);
  }

  if (method === "PATCH" && segments[0] === "api" && segments[1] === "projects" && segments[2]) {
    const payload = await readBody(req);
    const store = await loadStore();
    const project = requireProject(store, segments[2]);

    if (payload.name !== undefined) {
      const name = cleanString(payload.name);
      if (!name) {
        return jsonResponse(res, 400, { error: "Project name is required." });
      }
      project.name = name;
    }

    if (payload.description !== undefined) {
      project.description = cleanString(payload.description);
    }

    if (payload.color !== undefined) {
      project.color = cleanString(payload.color, project.color);
    }

    if (payload.githubRepo !== undefined) {
      project.githubRepo = cleanRepoName(payload.githubRepo);
    }

    if (payload.codexTargetMode !== undefined) {
      project.codexTargetMode = cleanCodexTargetMode(payload.codexTargetMode);
    }

    if (payload.codexProfile !== undefined) {
      project.codexProfile = cleanString(payload.codexProfile);
    }

    if (payload.localWorkspacePath !== undefined) {
      project.localWorkspacePath = cleanString(payload.localWorkspacePath);
    }

    if (payload.defaultBranch !== undefined) {
      project.defaultBranch = cleanString(payload.defaultBranch, "main");
    }

    if (payload.targetEnvironment !== undefined) {
      project.targetEnvironment = cleanString(payload.targetEnvironment);
    }

    if (payload.syncGithub !== undefined) {
      project.syncGithub = payload.syncGithub === false ? false : true;
    }

    if (payload.selected === true) {
      store.selectedProjectId = project.id;
    }

    normalizeProjectRouting(project);
    project.updatedAt = now();
    await saveStore(store);
    return jsonResponse(res, 200, store);
  }

  if (method === "POST" && url.pathname === "/api/tasks") {
    const payload = await readBody(req);
    const store = await loadStore();
    const projectId = cleanString(payload.projectId, store.selectedProjectId);
    const columnId = cleanString(payload.columnId, "backlog");
    const title = cleanString(payload.title);

    if (!title) {
      return jsonResponse(res, 400, { error: "Task title is required." });
    }

    requireProject(store, projectId);
    requireColumn(store, columnId);

    const createdAt = now();
    const task = {
      id: `task-${randomUUID().slice(0, 8)}`,
      projectId,
      columnId,
      title,
      description: cleanString(payload.description),
      priority: cleanString(payload.priority, "Medium"),
      size: cleanString(payload.size, "M"),
      githubRepo: cleanRepoName(payload.githubRepo),
      targetEnvironment: cleanString(payload.targetEnvironment),
      labels: cleanList(payload.labels),
      acceptanceCriteria: cleanList(payload.acceptanceCriteria),
      contextImages: cleanContextImages(payload.contextImages),
      notes: cleanString(payload.notes),
      links: cleanList(payload.links),
      codexHandoffStatus: "idle",
      codexReviewStatus: "idle",
      codexResultStatus: "idle",
      githubStatus: "idle",
      createdAt,
      updatedAt: createdAt,
      sortOrder: nextSortOrder(store, projectId, columnId),
    };

    store.tasks.push(task);
    recordActivity(store, task, "task-created", "Task created.");
    await saveStore(store);
    return jsonResponse(res, 201, store);
  }

  if (method === "POST" && segments[0] === "api" && segments[1] === "tasks" && segments[2] && segments[3] === "handoff") {
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const project = requireProject(store, task.projectId);
    const requestedAt = now();

    if (["backlog", "review"].includes(task.columnId)) {
      moveTaskToColumn(store, task, "ready");
    }

    const packet = buildTaskPacket(store, task, "Codex handoff");
    const existingHandoff = store.handoffs.find(
      (item) => item.taskId === task.id && item.status === "requested",
    );
    const packetPath = await writePacket(handoffDir, task, packet);

    for (const staleHandoff of store.handoffs.filter(
      (item) => item.taskId === task.id && ["requested", "claimed", "changes-requested"].includes(item.status),
    )) {
      if (existingHandoff?.id === staleHandoff.id) {
        continue;
      }
      staleHandoff.status = "superseded";
      staleHandoff.supersededAt = requestedAt;
    }

    if (existingHandoff) {
      await removePacketFile(existingHandoff.packetPath);
      existingHandoff.requestedAt = requestedAt;
      existingHandoff.packetPath = packetPath;
      existingHandoff.prompt = packet;
    } else {
      store.handoffs.push({
        id: `handoff-${randomUUID().slice(0, 8)}`,
        taskId: task.id,
        projectId: project.id,
        status: "requested",
        requestedAt,
        packetPath,
        prompt: packet,
      });
    }

    task.codexHandoffStatus = "requested";
    task.codexResultStatus = "queued";
    task.codexHandoffRequestedAt = requestedAt;
    task.updatedAt = requestedAt;
    supersedeOpenReviewsForTask(store, task, requestedAt, "local-handoff-requested");
    recordActivity(store, task, "handoff-requested", "Task sent to Codex.", {
      handoffId: existingHandoff?.id ?? store.handoffs.at(-1)?.id,
    });
    await saveStore(store);
    return jsonResponse(res, 201, store);
  }

  if (
    method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "tasks" &&
    segments[2] &&
    segments[3] === "github-export"
  ) {
    const payload = await readBody(req);
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const project = requireProject(store, task.projectId);
    const repo = cleanRepoName(payload.repo) || githubRepoForTask(store, task);

    if (!repo) {
      return jsonResponse(res, 400, { error: "No GitHub repository is configured for this project." });
    }

    const triggerCodex = payload.triggerCodex !== false;
    const exportedAt = now();

    if (task.githubIssueNumber && task.githubRepo === repo && !payload.forceNew) {
      if (triggerCodex) {
        const { comment, triggeredAt } = await triggerExistingGithubIssue(
          store,
          task,
          repo,
          "The board card was sent again without creating a duplicate issue.",
        );
        recordActivity(store, task, "github-codex-triggered", "Codex Cloud triggered again on the existing GitHub issue.", {
          repo,
          issueUrl: task.githubIssueUrl,
          codexCommentUrl: comment.html_url,
        });
        await saveStore(store);
        return jsonResponse(res, 200, {
          store,
          githubExport: store.githubExports.find((item) => item.taskId === task.id && item.issueNumber === task.githubIssueNumber),
          triggeredAt,
          comment,
        });
      }

      return jsonResponse(res, 200, {
        store,
        githubExport: store.githubExports.find((item) => item.taskId === task.id && item.issueNumber === task.githubIssueNumber),
        message: "This task already has a GitHub issue.",
      });
    }

    const issue = await githubRequest(repo, "/issues", {
      method: "POST",
      body: JSON.stringify({
        title: task.title,
        body: githubIssueMarkdown(store, task),
        labels: ["codex-kanban"],
      }),
    });

    let codexComment = null;

    if (triggerCodex) {
      codexComment = await githubRequest(repo, `/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: codexCloudComment(store, task),
        }),
      });
    }

    const githubExport = {
      id: `github-${randomUUID().slice(0, 8)}`,
      taskId: task.id,
      projectId: project.id,
      repo,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      triggerCodex,
      codexCommentUrl: codexComment?.html_url ?? null,
      status: triggerCodex ? "codex-triggered" : "issue-created",
      createdAt: exportedAt,
    };

    store.githubExports.push(githubExport);
    task.githubStatus = githubExport.status;
    task.githubRepo = repo;
    task.githubIssueNumber = issue.number;
    task.githubIssueUrl = issue.html_url;
    task.githubCodexCommentUrl = codexComment?.html_url ?? null;
    task.githubExportedAt = exportedAt;
    task.updatedAt = exportedAt;

    if (triggerCodex) {
      moveTaskToColumn(store, task, "doing");
      task.codexHandoffStatus = "cloud-triggered";
      task.codexResultStatus = "in-progress";
      supersedeOpenReviewsForTask(store, task, exportedAt, "implementation-started");
    } else if (task.columnId === "backlog") {
      moveTaskToColumn(store, task, "ready");
    }

    if (!triggerCodex && task.codexHandoffStatus === "requested") {
      task.codexHandoffStatus = "idle";
    }

    supersedeRequestedHandoffsForTask(store, task, exportedAt, "sent-to-github");

    recordActivity(
      store,
      task,
      triggerCodex ? "github-codex-triggered" : "github-issue-created",
      triggerCodex ? "GitHub issue created and Codex Cloud triggered." : "GitHub issue created.",
      { repo, issueUrl: issue.html_url, codexCommentUrl: codexComment?.html_url },
    );
    await saveStore(store);
    return jsonResponse(res, 201, { store, githubExport });
  }

  if (
    method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "tasks" &&
    segments[2] &&
    segments[3] === "github-retrigger"
  ) {
    const payload = await readBody(req);
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const repo = task.githubRepo || githubRepoForTask(store, task);
    const { comment, triggeredAt } = await triggerExistingGithubIssue(store, task, repo, payload.note);

    recordActivity(store, task, "github-codex-triggered", "Codex Cloud triggered on the existing GitHub issue.", {
      repo,
      issueUrl: task.githubIssueUrl,
      codexCommentUrl: comment.html_url,
    });
    await saveStore(store);
    return jsonResponse(res, 200, { store, comment, triggeredAt });
  }

  if (
    method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "tasks" &&
    segments[2] &&
    segments[3] === "github-sync"
  ) {
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const review = latestReviewForTask(store, task.id);

    if (review?.status === "cloud-triggered") {
      const reviewResult = await syncGithubReview(store, review, { recordNoResult: true });

      if (!reviewResult.checked) {
        return jsonResponse(res, 400, { error: reviewResult.message });
      }

      await saveStore(store);
      return jsonResponse(res, 200, {
        store,
        synced: reviewResult.synced,
        reviewSynced: reviewResult.synced,
        review: reviewResult.review,
        comment: reviewResult.comment,
        message: reviewResult.synced ? "Codex review synced." : reviewResult.message,
      });
    }

    const result = await syncGithubTask(store, task, { recordNoResult: true });

    if (!result.checked) {
      return jsonResponse(res, 400, { error: result.message });
    }

    await saveStore(store);
    return jsonResponse(res, 200, {
      store,
      synced: result.synced,
      issue: result.issue,
      comment: result.comment,
      result: result.result,
      message: result.synced ? "Codex result synced." : result.message,
    });
  }

  if (method === "POST" && segments[0] === "api" && segments[1] === "tasks" && segments[2] && segments[3] === "review") {
    const payload = await readBody(req);
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const project = requireProject(store, task.projectId);
    const routing = projectRoutingForTask(store, task);
    const requestedMode = cleanCodexTargetMode(payload.mode, routing.codexTargetMode);
    const repo = cleanRepoName(payload.repo) || routing.githubRepo;
    const createdAt = now();
    const packet = buildTaskPacket(store, task, "Codex task review request");
    const useLocalReview = requestedMode === "local" || !githubToken || !repo;
    const review = {
      id: `review-${randomUUID().slice(0, 8)}`,
      taskId: task.id,
      projectId: project.id,
      status: useLocalReview ? "proposed" : "cloud-triggered",
      reviewMode: useLocalReview ? "local" : "github-codex",
      routeMode: requestedMode,
      requestNote: cleanString(payload.note),
      createdAt,
      updatedAt: createdAt,
      packetPath: await writePacket(reviewDir, task, packet),
      prompt: packet,
    };

    for (const staleReview of store.taskReviews.filter(
      (item) => item.taskId === task.id && ["requested", "claimed", "cloud-triggered"].includes(item.status),
    )) {
      staleReview.status = "superseded";
      staleReview.supersededAt = createdAt;
      staleReview.supersededReason = "new-review-requested";
    }

    if (useLocalReview) {
      review.proposal = {
        ...buildLocalReviewProposal(store, task),
        proposedAt: createdAt,
      };
    } else {
      const { issue, created } = await ensureGithubIssueForTask(store, task, repo, createdAt, {
        status: "review-triggered",
        labels: ["codex-review"],
      });
      const reviewComment = await githubRequest(repo, `/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: codexCloudReviewComment(store, task, review),
        }),
      });

      review.githubRepo = repo;
      review.githubIssueNumber = issue.number;
      review.githubIssueUrl = issue.html_url;
      review.githubReviewCommentUrl = reviewComment.html_url;
      review.githubReviewCommentId = reviewComment.id;
      review.githubReviewCommentCreatedAt = reviewComment.created_at;
      task.githubStatus = "review-triggered";
      task.githubRepo = repo;
      task.githubIssueNumber = issue.number;
      task.githubIssueUrl = issue.html_url;
      task.githubReviewCommentUrl = reviewComment.html_url;
      task.githubLastTriggeredAt = createdAt;
      updateGithubExportsForTask(store, task, "review-triggered", createdAt, {
        reviewId: review.id,
        reviewCommentUrl: reviewComment.html_url,
      });
      recordActivity(
        store,
        task,
        created ? "github-review-issue-created" : "github-review-triggered",
        created ? "GitHub issue created and Codex Cloud review triggered." : "Codex Cloud review triggered in the existing GitHub issue.",
        { repo, issueUrl: issue.html_url, reviewId: review.id, reviewCommentUrl: reviewComment.html_url },
      );
    }

    store.taskReviews.push(review);
    task.codexReviewStatus = useLocalReview ? "proposed" : "cloud-triggered";
    task.codexReviewRequestedAt = createdAt;
    task.updatedAt = createdAt;
    recordActivity(
      store,
      task,
      useLocalReview ? "task-review-proposed" : "task-review-requested",
      useLocalReview ? "Task review proposal created." : "Task review requested from Codex Cloud.",
      { reviewId: review.id, reviewMode: review.reviewMode },
    );
    await saveStore(store);
    return jsonResponse(res, 201, store);
  }

  if (method === "PATCH" && segments[0] === "api" && segments[1] === "tasks" && segments[2]) {
    const payload = await readBody(req);
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const previousColumnId = task.columnId;

    if (payload.projectId !== undefined) {
      task.projectId = cleanString(payload.projectId, task.projectId);
      requireProject(store, task.projectId);
    }

    if (payload.columnId !== undefined) {
      task.columnId = cleanString(payload.columnId, task.columnId);
      requireColumn(store, task.columnId);
      task.sortOrder = nextSortOrder(store, task.projectId, task.columnId);
      if (task.columnId === "done") {
        task.completedAt = task.completedAt || now();
      } else if (previousColumnId === "done") {
        task.completedAt = "";
      }
    }

    for (const key of ["title", "description", "priority", "size", "targetEnvironment", "notes"]) {
      if (payload[key] !== undefined) {
        task[key] = cleanString(payload[key], task[key]);
      }
    }

    if (payload.githubRepo !== undefined) {
      task.githubRepo = cleanRepoName(payload.githubRepo);
    }

    if (!task.title) {
      return jsonResponse(res, 400, { error: "Task title is required." });
    }

    for (const key of ["labels", "acceptanceCriteria", "links"]) {
      if (payload[key] !== undefined) {
        task[key] = cleanList(payload[key]);
      }
    }

    if (payload.contextImages !== undefined) {
      task.contextImages = cleanContextImages(payload.contextImages);
    }

    task.updatedAt = now();
    recordActivity(
      store,
      task,
      previousColumnId === task.columnId ? "task-updated" : "task-moved",
      previousColumnId === task.columnId ? "Task updated." : `Task moved to ${requireColumn(store, task.columnId).name}.`,
      previousColumnId === task.columnId
        ? {}
        : { fromColumnId: previousColumnId, toColumnId: task.columnId },
    );
    await saveStore(store);
    return jsonResponse(res, 200, store);
  }

  if (method === "POST" && segments[0] === "api" && segments[1] === "task-reviews" && segments[2] && segments[3] === "proposal") {
    const payload = await readBody(req);
    const store = await loadStore();
    const review = store.taskReviews.find((item) => item.id === segments[2]);

    if (!review) {
      return jsonResponse(res, 404, { error: "Task review not found." });
    }

    const task = requireTask(store, review.taskId);
    const proposal = payload.proposal ?? payload;
    const proposedAt = now();

    review.status = "proposed";
    review.proposal = {
      summary: cleanString(proposal.summary),
      reasoning: cleanString(proposal.reasoning),
      title: proposal.title === undefined ? undefined : cleanString(proposal.title),
      description: proposal.description === undefined ? undefined : cleanString(proposal.description),
      priority: proposal.priority === undefined ? undefined : cleanString(proposal.priority),
      size: proposal.size === undefined ? undefined : cleanString(proposal.size),
      githubRepo: proposal.githubRepo === undefined ? undefined : cleanRepoName(proposal.githubRepo),
      targetEnvironment:
        proposal.targetEnvironment === undefined ? undefined : cleanString(proposal.targetEnvironment),
      labels: proposal.labels === undefined ? undefined : cleanList(proposal.labels),
      acceptanceCriteria:
        proposal.acceptanceCriteria === undefined ? undefined : cleanList(proposal.acceptanceCriteria),
      links: proposal.links === undefined ? undefined : cleanList(proposal.links),
      notes: proposal.notes === undefined ? undefined : cleanString(proposal.notes),
      proposedAt,
    };
    review.updatedAt = proposedAt;
    task.codexReviewStatus = "proposed";
    task.updatedAt = proposedAt;
    recordActivity(store, task, "task-review-proposed", "Task review proposal created.", {
      reviewId: review.id,
    });
    await saveStore(store);
    return jsonResponse(res, 200, store);
  }

  if (method === "POST" && segments[0] === "api" && segments[1] === "task-reviews" && segments[2] && segments[3] === "apply") {
    const store = await loadStore();
    const review = store.taskReviews.find((item) => item.id === segments[2]);

    if (!review) {
      return jsonResponse(res, 404, { error: "Task review not found." });
    }

    const task = requireTask(store, review.taskId);
    const appliedAt = now();
    applyReviewProposal(task, review);
    review.status = "applied";
    review.appliedAt = appliedAt;
    review.updatedAt = appliedAt;
    task.codexReviewStatus = "applied";
    task.updatedAt = appliedAt;
    recordActivity(store, task, "task-review-applied", "Task review proposal applied.", {
      reviewId: review.id,
    });
    await saveStore(store);
    return jsonResponse(res, 200, store);
  }

  if (method === "PATCH" && segments[0] === "api" && segments[1] === "task-results" && segments[2]) {
    const payload = await readBody(req);
    const store = await loadStore();
    const result = store.taskResults.find((item) => item.id === segments[2]);

    if (!result) {
      return jsonResponse(res, 404, { error: "Task result not found." });
    }

    const task = requireTask(store, result.taskId);
    const updatedAt = now();

    for (const key of ["summary", "details"]) {
      if (payload[key] !== undefined) {
        result[key] = cleanString(payload[key], result[key]);
      }
    }

    for (const key of ["changedPaths", "verification", "followUps"]) {
      if (payload[key] !== undefined) {
        result[key] = cleanList(payload[key]);
      }
    }

    result.updatedAt = updatedAt;
    result.manualOverride = true;
    task.updatedAt = updatedAt;
    if (["doing", "review", "done"].includes(task.columnId)) {
      supersedeOpenReviewsForTask(store, task, updatedAt, "result-updated");
    }
    recordActivity(store, task, "task-result-updated", "Task result updated.", {
      resultId: result.id,
    });
    await saveStore(store);
    return jsonResponse(res, 200, store);
  }

  if (
    method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "codex" &&
    segments[2] === "handoffs" &&
    segments[3] &&
    segments[4] === "complete"
  ) {
    const payload = await readBody(req);
    const store = await loadStore();
    const handoff = store.handoffs.find((item) => item.id === segments[3]);

    if (!handoff) {
      return jsonResponse(res, 404, { error: "Codex handoff not found." });
    }

    const task = requireTask(store, handoff.taskId);
    const completedAt = now();
    const result = {
      id: `result-${randomUUID().slice(0, 8)}`,
      taskId: task.id,
      projectId: task.projectId,
      handoffId: handoff.id,
      status: "ready-for-review",
      summary: cleanString(payload.summary, "Codex completed the task."),
      details: cleanString(payload.details),
      changedPaths: cleanList(payload.changedPaths),
      verification: cleanList(payload.verification),
      followUps: cleanList(payload.followUps),
      createdAt: completedAt,
    };

    store.taskResults.push(result);
    handoff.status = "completed";
    handoff.completedAt = completedAt;
    handoff.resultId = result.id;
    task.codexHandoffStatus = "completed";
    task.codexResultStatus = "ready-for-review";
    task.updatedAt = completedAt;
    moveTaskToColumn(store, task, "review");
    recordActivity(store, task, "handoff-completed", "Codex completed work and moved the task to Review.", {
      handoffId: handoff.id,
      resultId: result.id,
    });
    await saveStore(store);
    return jsonResponse(res, 200, { store, result, task, handoff });
  }

  if (method === "POST" && segments[0] === "api" && segments[1] === "tasks" && segments[2] && segments[3] === "accept") {
    const payload = await readBody(req);
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const result = latestResultForTask(store, task.id);
    const acceptedAt = now();
    let closedIssue = null;

    if (result) {
      result.status = "accepted";
      result.acceptedAt = acceptedAt;
    }

    if (payload.closeGithubIssue === true && task.githubIssueNumber) {
      const repo = task.githubRepo || githubRepoForTask(store, task);
      closedIssue = await githubRequest(repo, `/issues/${Number(task.githubIssueNumber)}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed" }),
      });
      task.githubIssueState = closedIssue.state;
      task.githubIssueClosedAt = acceptedAt;
    }

    moveTaskToColumn(store, task, "done");
    task.completedAt = acceptedAt;
    task.codexHandoffStatus = "accepted";
    task.codexResultStatus = "accepted";
    if (task.githubIssueNumber) {
      task.githubStatus = "accepted";
      updateGithubExportsForTask(store, task, "accepted", acceptedAt, {
        issueClosedAt: closedIssue ? acceptedAt : undefined,
      });
    }
    task.updatedAt = acceptedAt;
    supersedeRequestedHandoffsForTask(store, task, acceptedAt, "task-accepted");
    recordActivity(store, task, "task-accepted", closedIssue ? "Task accepted, GitHub issue closed, and moved to Done." : "Task accepted and moved to Done.", {
      resultId: result?.id,
      issueUrl: closedIssue?.html_url,
    });
    await saveStore(store);
    return jsonResponse(res, 200, store);
  }

  if (
    method === "POST" &&
    segments[0] === "api" &&
    segments[1] === "tasks" &&
    segments[2] &&
    segments[3] === "request-changes"
  ) {
    const payload = await readBody(req);
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const result = latestResultForTask(store, task.id);
    const requestedAt = now();
    const note = cleanString(payload.note, "Changes requested.");
    const postToGithub = payload.postToGithub === true && Boolean(task.githubIssueNumber);
    let githubComment = null;

    if (result) {
      result.status = "changes-requested";
      result.changeRequestedAt = requestedAt;
      result.changeRequestNote = note;
    }

    if (postToGithub) {
      const repo = task.githubRepo || githubRepoForTask(store, task);
      const triggered = await triggerExistingGithubIssue(store, task, repo, note);
      githubComment = triggered.comment;
      task.githubChangeCommentUrl = githubComment.html_url;
      task.codexHandoffStatus = "cloud-triggered";
      task.codexResultStatus = "in-progress";
      moveTaskToColumn(store, task, "doing");
      recordActivity(store, task, "changes-requested-github", "Changes requested and sent to Codex Cloud.", {
        resultId: result?.id,
        note,
        codexCommentUrl: githubComment.html_url,
      });
    } else {
      moveTaskToColumn(store, task, "doing");
      task.codexHandoffStatus = "changes-requested";
      task.codexResultStatus = "changes-requested";
      recordActivity(store, task, "changes-requested", "Changes requested.", {
        resultId: result?.id,
        note,
      });
    }

    task.updatedAt = requestedAt;
    await saveStore(store);
    return jsonResponse(res, 200, postToGithub ? { store, githubComment } : store);
  }

  if (method === "DELETE" && segments[0] === "api" && segments[1] === "tasks" && segments[2]) {
    const store = await loadStore();
    const task = requireTask(store, segments[2]);
    const packets = [
      ...store.handoffs.filter((item) => item.taskId === task.id).map((item) => item.packetPath),
      ...store.taskReviews.filter((item) => item.taskId === task.id).map((item) => item.packetPath),
    ];
    store.tasks = store.tasks.filter((item) => item.id !== task.id);
    store.handoffs = store.handoffs.filter((item) => item.taskId !== task.id);
    store.taskReviews = store.taskReviews.filter((item) => item.taskId !== task.id);
    store.taskResults = store.taskResults.filter((item) => item.taskId !== task.id);
    store.githubExports = store.githubExports.filter((item) => item.taskId !== task.id);
    store.activities = store.activities.filter((item) => item.taskId !== task.id);
    await Promise.all(packets.map((packetPath) => removePacketFile(packetPath)));
    await saveStore(store);
    return jsonResponse(res, 200, store);
  }

  return jsonResponse(res, 404, { error: "Not found." });
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalizedPath = normalize(requestedPath)
    .replace(/^([/\\])+/, "")
    .replace(/^(\.\.([/\\]|$))+/, "");
  const filePath = resolve(publicDir, normalizedPath);

  if (!filePath.startsWith(`${publicDir}${sep}`) && filePath !== join(publicDir, "index.html")) {
    return textResponse(res, 403, "Forbidden");
  }

  try {
    const info = await stat(filePath);

    if (!info.isFile()) {
      return textResponse(res, 404, "Not found");
    }

    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(content);
  } catch {
    const fallback = join(publicDir, "index.html");

    if (existsSync(fallback)) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(await readFile(fallback));
      return;
    }

    textResponse(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(req, url)) {
        unauthorizedResponse(res);
        return;
      }

      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    jsonResponse(res, error.status ?? 500, {
      error: error.message ?? "Unexpected server error.",
    });
  }
});

function startGithubAutoSync() {
  if (!githubToken || !githubSyncIntervalMs) {
    return;
  }

  let isRunning = false;
  const timer = setInterval(async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      const result = await syncGithubTasksOnce({ recordNoResult: false });

      if (result.checked || result.reviewChecked || result.errors.length) {
        console.log(
          `GitHub sync checked ${result.checked} task(s) and ${result.reviewChecked} review(s), synced ${result.synced} result(s) and ${result.reviewsSynced} review(s), errors ${result.errors.length}.`,
        );
      }
    } catch (error) {
      console.error("GitHub sync failed:", error);
    } finally {
      isRunning = false;
    }
  }, githubSyncIntervalMs);

  timer.unref?.();
}

server.listen(port, host, () => {
  const address = server.address();
  console.log(`Codex Kanban listening on http://localhost:${address.port}`);
  console.log("Data file:", dataFile);
  console.log("Auth required:", accessToken ? "yes" : "no");
  console.log(
    "GitHub sync:",
    githubToken && githubSyncIntervalMs ? `every ${Math.round(githubSyncIntervalMs / 1000)}s` : "disabled",
  );
  startGithubAutoSync();
});
