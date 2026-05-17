const stateUrl = "/api/state";
const tokenStorageKey = "codexKanbanAccessToken";

const els = {
  accessTokenInput: document.querySelector("#access-token-input"),
  acceptTaskButton: document.querySelector("#accept-task-button"),
  activityTimeline: document.querySelector("#activity-timeline"),
  applyReviewButton: document.querySelector("#apply-review-button"),
  authForm: document.querySelector("#auth-form"),
  authModal: document.querySelector("#auth-modal"),
  board: document.querySelector("#board"),
  codexStatusBody: document.querySelector("#codex-status-body"),
  codexStatusTitle: document.querySelector("#codex-status-title"),
  deleteTaskButton: document.querySelector("#delete-task-button"),
  doneHistoryList: document.querySelector("#done-history-list"),
  doneHistoryModal: document.querySelector("#done-history-modal"),
  doneHistoryTitle: document.querySelector("#done-history-title"),
  githubIssueLink: document.querySelector("#github-issue-link"),
  githubStatusBody: document.querySelector("#github-status-body"),
  githubStatusTitle: document.querySelector("#github-status-title"),
  newProjectButton: document.querySelector("#new-project-button"),
  newTaskButton: document.querySelector("#new-task-button"),
  projectColor: document.querySelector("#project-color"),
  projectCodexMode: document.querySelector("#project-codex-mode"),
  projectCodexProfile: document.querySelector("#project-codex-profile"),
  projectDefaultBranch: document.querySelector("#project-default-branch"),
  projectDescription: document.querySelector("#project-description"),
  projectDescriptionInput: document.querySelector("#project-description-input"),
  projectEnvironment: document.querySelector("#project-environment"),
  projectForm: document.querySelector("#project-form"),
  projectGithubRepo: document.querySelector("#project-github-repo"),
  projectList: document.querySelector("#project-list"),
  projectLocalWorkspace: document.querySelector("#project-local-workspace"),
  projectModal: document.querySelector("#project-modal"),
  projectModalTitle: document.querySelector("#project-modal-title"),
  projectName: document.querySelector("#project-name"),
  projectRouteSummary: document.querySelector("#project-route-summary"),
  projectSettingsButton: document.querySelector("#project-settings-button"),
  projectSubmitButton: document.querySelector("#project-submit-button"),
  projectSyncGithub: document.querySelector("#project-sync-github"),
  projectTitle: document.querySelector("#project-title"),
  proposalCard: document.querySelector("#proposal-card"),
  proposalDetails: document.querySelector("#proposal-details"),
  proposalSummary: document.querySelector("#proposal-summary"),
  requestReviewButton: document.querySelector("#request-review-button"),
  requestChangesButton: document.querySelector("#request-changes-button"),
  reviewStatusValue: document.querySelector("#review-status-value"),
  resultCard: document.querySelector("#result-card"),
  resultChangedPaths: document.querySelector("#result-changed-paths"),
  resultDetails: document.querySelector("#result-details"),
  resultFollowUps: document.querySelector("#result-follow-ups"),
  resultGithubLink: document.querySelector("#result-github-link"),
  resultSummary: document.querySelector("#result-summary"),
  resultVerification: document.querySelector("#result-verification"),
  routeBody: document.querySelector("#route-body"),
  routeDetails: document.querySelector("#route-details"),
  routePanel: document.querySelector("#route-panel"),
  routeTitle: document.querySelector("#route-title"),
  searchInput: document.querySelector("#search-input"),
  sendCodexButton: document.querySelector("#send-codex-button"),
  sendGithubButton: document.querySelector("#send-github-button"),
  saveTaskButton: document.querySelector("#save-task-button"),
  syncGithubButton: document.querySelector("#sync-github-button"),
  statsGrid: document.querySelector("#stats-grid"),
  taskAcceptance: document.querySelector("#task-acceptance"),
  taskColumn: document.querySelector("#task-column"),
  taskContextInput: document.querySelector("#task-context-input"),
  taskContextPreview: document.querySelector("#task-context-preview"),
  taskDescription: document.querySelector("#task-description"),
  taskEditFields: document.querySelector("#task-edit-fields"),
  taskEnvironment: document.querySelector("#task-environment"),
  taskForm: document.querySelector("#task-form"),
  taskGithubRepo: document.querySelector("#task-github-repo"),
  taskId: document.querySelector("#task-id"),
  taskInputSummary: document.querySelector("#task-input-summary"),
  taskInputSummaryBody: document.querySelector("#task-input-summary-body"),
  taskLabels: document.querySelector("#task-labels"),
  taskLinks: document.querySelector("#task-links"),
  taskModal: document.querySelector("#task-modal"),
  taskModalKicker: document.querySelector("#task-modal-kicker"),
  taskModalTitle: document.querySelector("#task-modal-title"),
  taskNotes: document.querySelector("#task-notes"),
  taskPriority: document.querySelector("#task-priority"),
  taskSize: document.querySelector("#task-size"),
  taskTitle: document.querySelector("#task-title"),
  toast: document.querySelector("#toast"),
  workStatusValue: document.querySelector("#work-status-value"),
};

let store = null;
let currentProjectId = null;
let draggedTaskId = null;
let toastTimer = null;
let contextImagesDraft = [];
let accessToken = window.localStorage.getItem(tokenStorageKey) ?? "";

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers ?? {}),
  };

  if (accessToken) {
    headers["x-kanban-token"] = accessToken;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    openAuthModal();
    throw new Error("Access token required.");
  }

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function openAuthModal() {
  if (!els.authModal.open) {
    els.authModal.showModal();
    els.accessTokenInput.focus();
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("visible");
  }, 2200);
}

function setStore(nextStore) {
  store = nextStore;
  currentProjectId = currentProjectId ?? store.selectedProjectId ?? store.projects[0]?.id;

  if (!store.projects.some((project) => project.id === currentProjectId)) {
    currentProjectId = store.projects[0]?.id ?? null;
  }

  render();
}

async function loadState() {
  setStore(await api(stateUrl));
}

function currentProject() {
  return store.projects.find((project) => project.id === currentProjectId) ?? store.projects[0];
}

function projectForTask(task) {
  return store.projects.find((project) => project.id === task?.projectId) ?? currentProject();
}

function targetGithubRepo(task) {
  return task?.githubRepo || projectForTask(task)?.githubRepo || "";
}

function targetEnvironment(task) {
  return task?.targetEnvironment || projectForTask(task)?.targetEnvironment || "";
}

function codexModeLabel(mode) {
  if (mode === "cloud") {
    return "Codex Cloud";
  }

  if (mode === "local") {
    return "Local Codex";
  }

  return "Ask each time";
}

function projectRouteSummary(project) {
  if (!project) {
    return "";
  }

  const parts = [
    codexModeLabel(project.codexTargetMode),
    project.githubRepo ? project.githubRepo : "No GitHub repository",
    project.localWorkspacePath ? `Workspace: ${project.localWorkspacePath}` : "",
    project.defaultBranch ? `Branch: ${project.defaultBranch}` : "",
  ].filter(Boolean);

  return parts.join(" - ");
}

function resolvedTaskRoute(task) {
  const project = projectForTask(task);
  const mode = project?.codexTargetMode || "ask";
  const githubRepo = targetGithubRepo(task);
  const environment = targetEnvironment(task);

  return {
    mode,
    modeLabel: codexModeLabel(mode),
    githubRepo,
    githubRepoSource: task?.githubRepo ? "Task override" : "Project default",
    environment,
    environmentSource: task?.targetEnvironment ? "Task override" : "Project default",
    codexProfile: project?.codexProfile || "",
    localWorkspacePath: project?.localWorkspacePath || "",
    defaultBranch: project?.defaultBranch || "main",
    syncGithub: project?.syncGithub !== false,
  };
}

function allProjectTasks(projectId = currentProjectId) {
  return store.tasks.filter((task) => task.projectId === projectId);
}

function latestReviewForTask(taskId) {
  return (store.taskReviews ?? [])
    .filter((review) => review.taskId === taskId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function latestHandoffForTask(taskId) {
  return (store.handoffs ?? [])
    .filter((handoff) => handoff.taskId === taskId)
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0];
}

function latestResultForTask(taskId) {
  return (store.taskResults ?? [])
    .filter((result) => result.taskId === taskId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function completedAtValue(task) {
  return task?.completedAt || task?.githubIssueClosedAt || task?.updatedAt || task?.createdAt || "";
}

function reviewStatusLabel(task) {
  const status = task?.codexReviewStatus ?? "idle";

  if (["requested", "claimed", "cloud-triggered"].includes(status)) {
    return "In progress";
  }

  if (status === "proposed") {
    return "Ready";
  }

  if (status === "applied") {
    return "Applied";
  }

  return "Not done";
}

function workStatusLabel(task) {
  if (!task) {
    return "Not started";
  }

  if (task.columnId === "done") {
    return "Done";
  }

  if (task.columnId === "review" || task.codexResultStatus === "ready-for-review") {
    return "Ready for review";
  }

  if (["claimed", "cloud-triggered"].includes(task.codexHandoffStatus) || task.githubStatus === "codex-triggered") {
    return "In progress";
  }

  if (task.codexHandoffStatus === "requested" || task.columnId === "ready") {
    return "Ready";
  }

  return "Not started";
}

function isResultMode(task) {
  return Boolean(task && ["review", "done"].includes(task.columnId));
}

function currentModalTask() {
  return store?.tasks.find((task) => task.id === els.taskId.value) ?? null;
}

function taskActivities(taskId) {
  return (store.activities ?? [])
    .filter((activity) => activity.taskId === taskId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 12);
}

function visibleProjectTasks() {
  const query = els.searchInput.value.trim().toLowerCase();
  const tasks = allProjectTasks();

  if (!query) {
    return tasks;
  }

  return tasks.filter((task) => {
    const haystack = [
      task.title,
      task.description,
      task.priority,
      task.size,
      task.notes,
      task.codexHandoffStatus,
      task.codexReviewStatus,
      task.codexResultStatus,
      task.githubStatus,
      task.githubRepo,
      task.targetEnvironment,
      task.githubIssueNumber,
      ...(task.labels ?? []),
      ...(task.acceptanceCriteria ?? []),
      ...(task.links ?? []),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function text(value) {
  return value ?? "";
}

function createEl(tagName, className, content) {
  const el = document.createElement(tagName);

  if (className) {
    el.className = className;
  }

  if (content !== undefined) {
    el.textContent = content;
  }

  return el;
}

function normalizeContextImage(image) {
  if (!image) {
    return null;
  }

  if (typeof image === "string") {
    return {
      id: `context-${Math.random().toString(36).slice(2)}`,
      name: "Screenshot",
      src: image,
      type: "image",
    };
  }

  const src = text(image.src);
  if (!src) {
    return null;
  }

  return {
    id: text(image.id) || `context-${Math.random().toString(36).slice(2)}`,
    name: text(image.name) || "Screenshot",
    src,
    type: text(image.type) || "image",
    size: Number(image.size) || undefined,
    createdAt: text(image.createdAt) || new Date().toISOString(),
  };
}

function taskContextImages(task) {
  return (task?.contextImages ?? []).map(normalizeContextImage).filter(Boolean);
}

function fileToContextImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve({
        id: `context-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        src: reader.result,
        type: file.type,
        size: file.size,
        createdAt: new Date().toISOString(),
      });
    });
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}`)));
    reader.readAsDataURL(file);
  });
}

function renderContextPreview(target, images, { removable = false } = {}) {
  target.replaceChildren();
  const values = (images ?? []).map(normalizeContextImage).filter(Boolean);

  if (!values.length) {
    target.append(createEl("p", "empty-list-item", "No screenshots added."));
    return;
  }

  for (const image of values) {
    const item = createEl("figure", "context-image");
    const preview = document.createElement("img");
    preview.src = image.src;
    preview.alt = image.name;
    const caption = createEl("figcaption", "", image.name);
    item.append(preview, caption);

    if (removable) {
      const remove = createEl("button", "icon-button", "x");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${image.name}`);
      remove.addEventListener("click", () => {
        contextImagesDraft = contextImagesDraft.filter((candidate) => candidate.id !== image.id);
        renderContextPreview(els.taskContextPreview, contextImagesDraft, { removable: true });
      });
      item.append(remove);
    }

    target.append(item);
  }
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function githubLastSyncText(task) {
  return task?.githubLastSyncedAt ? ` Last checked ${formatDateTime(task.githubLastSyncedAt)}.` : "";
}

function hasCloudWorkflow(task) {
  return ["review-triggered", "issue-created", "codex-triggered", "completed", "accepted"].includes(task?.githubStatus);
}

function hasActiveLocalHandoff(task, handoff) {
  if (!task || !handoff || hasCloudWorkflow(task)) {
    return false;
  }

  if (handoff.status === "requested") {
    return task.columnId === "ready";
  }

  return handoff.status === "claimed" && task.columnId === "doing";
}

function startCodexButtonLabel(task) {
  if (!task) {
    return "Start Codex";
  }

  const route = resolvedTaskRoute(task);

  if (route.mode === "cloud") {
    return route.githubRepo ? `Start Codex Cloud in ${route.githubRepo}` : "Start Codex Cloud";
  }

  if (route.mode === "local") {
    return "Start Local Codex";
  }

  return "Start Codex";
}

function chooseCodexStartMode(task) {
  const route = resolvedTaskRoute(task);

  if (route.mode === "cloud" || route.mode === "local") {
    return route.mode;
  }

  if (route.githubRepo) {
    const startCloud = window.confirm(`Start Codex Cloud in ${route.githubRepo}?`);
    if (startCloud) {
      return "cloud";
    }
  }

  return window.confirm("Start Local Codex instead?") ? "local" : null;
}

function chooseCodexReviewMode(task) {
  const route = resolvedTaskRoute(task);

  if (route.mode === "cloud" || route.mode === "local") {
    return route.mode;
  }

  if (route.githubRepo) {
    const useCloudReview = window.confirm(`Request a Codex Cloud readiness review in ${route.githubRepo}?`);
    if (useCloudReview) {
      return "cloud";
    }
  }

  return window.confirm("Create a local review proposal instead?") ? "local" : null;
}

function renderList(target, items, emptyText) {
  target.replaceChildren();
  const values = (items ?? []).filter(Boolean);

  if (!values.length) {
    target.append(createEl("li", "empty-list-item", emptyText));
    return;
  }

  for (const item of values) {
    target.append(createEl("li", "", item));
  }
}

function render() {
  if (!store) {
    return;
  }

  renderProjects();
  renderHeader();
  renderStats();
  renderBoard();
}

function renderProjects() {
  els.projectList.replaceChildren();

  for (const project of store.projects) {
    const button = createEl("button", "project-button");
    button.type = "button";
    button.classList.toggle("active", project.id === currentProjectId);
    button.addEventListener("click", async () => {
      currentProjectId = project.id;
      setStore(await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ selected: true }),
      }));
    });

    const dot = createEl("span", "project-dot");
    dot.style.background = project.color;

    const name = createEl("span", "project-name", project.name);
    const count = createEl("span", "project-count", String(allProjectTasks(project.id).length));

    button.append(dot, name, count);
    els.projectList.append(button);
  }
}

function renderHeader() {
  const project = currentProject();

  if (!project) {
    els.projectTitle.textContent = "No project";
    els.projectDescription.textContent = "";
    els.projectRouteSummary.textContent = "";
    els.projectSettingsButton.disabled = true;
    return;
  }

  els.projectTitle.textContent = project.name;
  els.projectDescription.textContent = project.description;
  els.projectRouteSummary.textContent = projectRouteSummary(project);
  els.projectColor.style.background = project.color;
  els.projectSettingsButton.disabled = false;
}

function renderStats() {
  const tasks = allProjectTasks();
  const ready = tasks.filter((task) => task.columnId === "ready").length;
  const active = tasks.filter((task) => task.columnId === "doing").length;
  const reviewColumn = tasks.filter((task) => task.columnId === "review").length;
  const reviewQueue = tasks.filter((task) => ["requested", "proposed"].includes(task.codexReviewStatus)).length;
  const sent = tasks.filter((task) =>
    ["requested", "claimed"].includes(task.codexHandoffStatus),
  ).length;
  const done = tasks.filter((task) => task.columnId === "done").length;

  const stats = [
    ["Total", tasks.length],
    ["Ready", ready],
    ["Active", active],
    ["Review", reviewColumn],
    ["Codex review", reviewQueue],
    ["Sent", sent],
    ["Done", done],
  ];

  els.statsGrid.replaceChildren(
    ...stats.map(([label, value]) => {
      const stat = createEl("article", "stat");
      stat.append(createEl("strong", "", String(value)), createEl("span", "", label));
      return stat;
    }),
  );
}

function renderBoard() {
  const tasks = visibleProjectTasks();
  els.board.replaceChildren();

  for (const column of store.columns) {
    const columnEl = createEl("article", "column");
    const header = createEl("header", "column-header");
    const titleRow = createEl("div", "column-title-row");
    const count = tasks.filter((task) => task.columnId === column.id).length;
    const list = createEl("div", "task-list");

    list.dataset.columnId = column.id;
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      list.classList.add("drop-target");
    });
    list.addEventListener("dragleave", () => list.classList.remove("drop-target"));
    list.addEventListener("drop", async (event) => {
      event.preventDefault();
      list.classList.remove("drop-target");

      if (!draggedTaskId) {
        return;
      }

      const task = store.tasks.find((item) => item.id === draggedTaskId);

      if (!task || task.columnId === column.id) {
        return;
      }

      setStore(await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ columnId: column.id }),
      }));
    });

    titleRow.append(createEl("h3", "", column.name), createEl("span", "task-count", String(count)));
    header.append(titleRow, createEl("p", "column-description", column.description));

    const allColumnTasks = tasks
      .filter((task) => task.columnId === column.id)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
    const columnTasks =
      column.id === "done"
        ? [...allColumnTasks].sort((left, right) => completedAtValue(right).localeCompare(completedAtValue(left))).slice(0, 10)
        : allColumnTasks;

    if (!columnTasks.length) {
      list.append(createEl("p", "empty-column", "No tasks"));
    } else {
      for (const task of columnTasks) {
        list.append(renderTaskCard(task));
      }
    }

    if (column.id === "done" && allColumnTasks.length > 10) {
      const historyButton = createEl("button", "history-button", `View ${allColumnTasks.length - 10} older`);
      historyButton.type = "button";
      historyButton.addEventListener("click", () => openDoneHistory());
      list.append(historyButton);
    }

    columnEl.append(header, list);
    els.board.append(columnEl);
  }
}

function renderTaskCard(task) {
  const card = createEl("article", "task-card");
  card.classList.toggle("task-card-compact", task.columnId === "done");
  card.draggable = true;
  card.tabIndex = 0;
  card.addEventListener("click", () => openTaskModal(task));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      openTaskModal(task);
    }
  });
  card.addEventListener("dragstart", () => {
    draggedTaskId = task.id;
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    draggedTaskId = null;
    card.classList.remove("dragging");
  });

  const title = createEl("h4", "", task.title);
  if (task.columnId === "done") {
    const completed = createEl("span", "completed-date", completedAtValue(task) ? `Completed ${formatDateTime(completedAtValue(task))}` : "Completed");
    card.append(title, completed);
    return card;
  }

  const description = createEl("p", "", task.description);
  const meta = createEl("div", "task-meta");
  const priority = createEl("span", `pill ${task.priority.toLowerCase()}`, task.priority);
  const size = createEl("span", "pill", task.size);
  const targetRepo = targetGithubRepo(task);

  meta.append(priority, size);

  if (targetRepo) {
    meta.append(createEl("span", "pill github", targetRepo));
  }

  if (task.codexReviewStatus === "requested") {
    meta.append(createEl("span", "pill review", "review requested"));
  }

  if (task.codexReviewStatus === "claimed") {
    meta.append(createEl("span", "pill review", "reviewing"));
  }

  if (task.codexReviewStatus === "cloud-triggered") {
    meta.append(createEl("span", "pill review", "Codex review"));
  }

  if (task.codexReviewStatus === "proposed") {
    meta.append(createEl("span", "pill review", "proposal ready"));
  }

  if (task.codexReviewStatus === "applied") {
    meta.append(createEl("span", "pill review", "review applied"));
  }

  if (task.codexHandoffStatus === "requested" && task.columnId === "ready" && !hasCloudWorkflow(task)) {
    meta.append(createEl("span", "pill codex", "sent to Codex"));
  }

  if (task.codexHandoffStatus === "claimed" && !hasCloudWorkflow(task)) {
    meta.append(createEl("span", "pill codex", "Codex working"));
  }

  if (task.codexHandoffStatus === "completed") {
    meta.append(createEl("span", "pill result", "ready for review"));
  }

  if (task.codexHandoffStatus === "changes-requested") {
    meta.append(createEl("span", "pill result", "changes requested"));
  }

  if (task.codexHandoffStatus === "accepted") {
    meta.append(createEl("span", "pill result", "accepted"));
  }

  if (task.githubStatus === "issue-created") {
    meta.append(createEl("span", "pill github", "GitHub issue"));
  }

  if (task.githubStatus === "review-triggered") {
    meta.append(createEl("span", "pill github", "review in GitHub"));
  }

  if (task.githubStatus === "codex-triggered") {
    meta.append(createEl("span", "pill github", "Codex Cloud"));
  }

  if (task.githubStatus === "completed") {
    meta.append(createEl("span", "pill github", "GitHub result"));
  }

  if (task.githubStatus === "accepted") {
    meta.append(createEl("span", "pill github", "GitHub accepted"));
  }

  const labels = createEl("div", "label-row");
  for (const label of task.labels ?? []) {
    labels.append(createEl("span", "pill", label));
  }

  card.append(title, meta);

  if (task.description) {
    card.append(description);
  }

  if ((task.labels ?? []).length) {
    card.append(labels);
  }

  return card;
}

function openDoneHistory() {
  const project = currentProject();
  const doneTasks = allProjectTasks()
    .filter((task) => task.columnId === "done")
    .sort((left, right) => completedAtValue(right).localeCompare(completedAtValue(left)));

  els.doneHistoryTitle.textContent = project ? `${project.name} completed tasks` : "Completed tasks";
  els.doneHistoryList.replaceChildren();

  if (!doneTasks.length) {
    els.doneHistoryList.append(createEl("li", "empty-list-item", "No completed tasks."));
  } else {
    for (const task of doneTasks) {
      const item = createEl("li", "history-item");
      const button = createEl("button", "", task.title);
      button.type = "button";
      button.addEventListener("click", () => {
        els.doneHistoryModal.close();
        openTaskModal(task);
      });
      const completed = createEl("span", "", completedAtValue(task) ? formatDateTime(completedAtValue(task)) : "No completion time");
      item.append(button, completed);
      els.doneHistoryList.append(item);
    }
  }

  if (!els.doneHistoryModal.open) {
    els.doneHistoryModal.showModal();
  }
}

function openProjectModal(project = null) {
  els.projectForm.dataset.projectId = project?.id ?? "";
  els.projectModalTitle.textContent = project ? "Project settings" : "New project";
  els.projectSubmitButton.textContent = project ? "Save project" : "Create project";
  els.projectName.value = text(project?.name);
  els.projectDescriptionInput.value = text(project?.description);
  document.querySelector("#project-color-input").value = text(project?.color) || "#334155";
  els.projectGithubRepo.value = text(project?.githubRepo);
  els.projectCodexMode.value = ["cloud", "local", "ask"].includes(project?.codexTargetMode)
    ? project.codexTargetMode
    : "ask";
  els.projectCodexProfile.value = text(project?.codexProfile);
  els.projectLocalWorkspace.value = text(project?.localWorkspacePath);
  els.projectDefaultBranch.value = text(project?.defaultBranch) || "main";
  els.projectEnvironment.value = text(project?.targetEnvironment);
  els.projectSyncGithub.checked = project?.syncGithub !== false;
  els.projectModal.showModal();
  els.projectName.focus();
}

function fillColumnOptions(selectedColumnId) {
  if (!els.taskColumn) {
    return;
  }

  els.taskColumn.replaceChildren();

  for (const column of store.columns) {
    const option = document.createElement("option");
    option.value = column.id;
    option.textContent = column.name;
    option.selected = column.id === selectedColumnId;
    els.taskColumn.append(option);
  }
}

function renderCodexPanel(task) {
  els.proposalCard.hidden = true;
  els.proposalDetails.replaceChildren();
  els.applyReviewButton.dataset.reviewId = "";
  els.sendCodexButton.textContent = startCodexButtonLabel(task);
  els.reviewStatusValue.textContent = reviewStatusLabel(task);
  els.workStatusValue.textContent = workStatusLabel(task);

  if (!task) {
    els.codexStatusTitle.textContent = "Draft task";
    els.codexStatusBody.textContent = "Save the task before requesting a review or starting Codex.";
    return;
  }

  const review = latestReviewForTask(task.id);
  const handoff = latestHandoffForTask(task.id);

  if (task.githubStatus === "codex-triggered" || task.codexHandoffStatus === "cloud-triggered") {
    els.codexStatusTitle.textContent = "Codex is working";
    els.codexStatusBody.textContent = "The task is in progress. Results will appear when Codex completes the work.";
    return;
  }

  if (task.codexHandoffStatus === "completed" || task.codexResultStatus === "ready-for-review") {
    els.codexStatusTitle.textContent = "Result ready";
    els.codexStatusBody.textContent = "Review the result below, then confirm it or provide further directions.";
    return;
  }

  if (review?.status === "proposed" && review.proposal && !["doing", "review", "done"].includes(task.columnId)) {
    els.codexStatusTitle.textContent = "Review ready";
    els.codexStatusBody.textContent = "A task review is ready to apply before implementation starts.";
    return;
  }

  if (review?.status === "requested") {
    els.codexStatusTitle.textContent = "Review requested";
    els.codexStatusBody.textContent = "The task is waiting for a Codex readiness review.";
    return;
  }

  if (review?.status === "cloud-triggered" || task.codexReviewStatus === "cloud-triggered") {
    els.codexStatusTitle.textContent = "Review in progress";
    els.codexStatusBody.textContent = "A review-only Codex request is running.";
    return;
  }

  if (review?.status === "claimed" || task.codexReviewStatus === "claimed") {
    els.codexStatusTitle.textContent = "Review in progress";
    els.codexStatusBody.textContent = "Codex has claimed the review.";
    return;
  }

  if (task.codexHandoffStatus === "changes-requested" || task.codexResultStatus === "changes-requested") {
    els.codexStatusTitle.textContent = "Further directions sent";
    els.codexStatusBody.textContent = "The task has been sent back to In Progress.";
    return;
  }

  if (task.codexHandoffStatus === "accepted" || task.codexResultStatus === "accepted") {
    els.codexStatusTitle.textContent = "Task confirmed";
    els.codexStatusBody.textContent = "The result has been accepted and the task is done.";
    return;
  }

  if (hasActiveLocalHandoff(task, handoff) && handoff.status === "requested") {
    els.codexStatusTitle.textContent = "Task sent to Codex";
    els.codexStatusBody.textContent = "The task is queued for local Codex.";
    return;
  }

  if ((hasActiveLocalHandoff(task, handoff) && handoff.status === "claimed") || (task.codexHandoffStatus === "claimed" && !hasCloudWorkflow(task))) {
    els.codexStatusTitle.textContent = "Codex is working on this task";
    els.codexStatusBody.textContent = "The handoff has been claimed.";
    return;
  }

  if (review?.status === "applied" || task.codexReviewStatus === "applied") {
    els.codexStatusTitle.textContent = "Review proposal applied";
    els.codexStatusBody.textContent =
      "The task has been updated from the review proposal and is ready to start Codex when you want implementation to begin.";
    return;
  }

  els.codexStatusTitle.textContent = "No Codex activity yet";
  els.codexStatusBody.textContent = "Request a task review or start Codex when it is ready.";
}

function renderRoutePanel(task, { hidden = false } = {}) {
  els.routePanel.hidden = hidden;
  els.routeDetails.replaceChildren();

  if (hidden) {
    return;
  }

  const route = resolvedTaskRoute(task);
  els.routeTitle.textContent = route.mode === "ask" ? "Choose route when starting Codex" : route.modeLabel;

  if (route.mode === "cloud") {
    els.routeBody.textContent = route.githubRepo
      ? `Work will start in Codex Cloud for ${route.githubRepo}.`
      : "Codex Cloud is selected, but no GitHub repository is configured.";
  } else if (route.mode === "local") {
    els.routeBody.textContent = route.localWorkspacePath
      ? `Work will start in Local Codex using ${route.localWorkspacePath}.`
      : "Local Codex is selected, but no local workspace path is configured.";
  } else {
    els.routeBody.textContent = "The route will be chosen when implementation starts.";
  }

  const details = [
    ["GitHub repository", route.githubRepo || "Not configured", route.githubRepoSource],
    ["Local workspace", route.localWorkspacePath || "Not configured"],
    ["Codex project/profile", route.codexProfile || "Not configured"],
    ["Default branch", route.defaultBranch || "Not configured"],
    ["Environment", route.environment || "Not configured", route.environmentSource],
    ["GitHub sync", route.syncGithub ? "Enabled" : "Disabled"],
  ];

  for (const [label, value, source] of details) {
    const group = createEl("div", "route-detail");
    group.append(createEl("dt", "", label));
    const dd = createEl("dd", "", value);
    if (source && value !== "Not configured") {
      dd.append(createEl("span", "route-source", source));
    }
    group.append(dd);
    els.routeDetails.append(group);
  }
}

function renderProposal(review) {
  const proposal = review.proposal;
  const detailRows = [
    ["Title", proposal.title],
    ["Description", proposal.description],
    ["Priority", proposal.priority],
    ["Size", proposal.size],
    ["Repository", proposal.githubRepo],
    ["Environment", proposal.targetEnvironment],
    ["Labels", (proposal.labels ?? []).join(", ")],
    ["Acceptance criteria", (proposal.acceptanceCriteria ?? []).join("\n")],
    ["Notes", proposal.notes],
    ["Reasoning", proposal.reasoning],
  ].filter(([, value]) => value !== undefined && value !== "");

  els.proposalSummary.textContent = proposal.summary || "Codex proposed updates to make this task easier to execute.";

  for (const [label, value] of detailRows) {
    const dt = createEl("dt", "", label);
    const dd = createEl("dd", "", Array.isArray(value) ? value.join("\n") : value);
    els.proposalDetails.append(dt, dd);
  }

  els.applyReviewButton.dataset.reviewId = review.id;
  els.proposalCard.hidden = false;
}

function renderGithubPanel(task) {
  els.githubIssueLink.hidden = true;
  els.githubIssueLink.href = "#";
  els.sendGithubButton.hidden = true;
  els.sendGithubButton.textContent = "Start Codex Cloud";
  els.syncGithubButton.hidden = true;
  els.syncGithubButton.dataset.taskId = task?.id ?? "";
  els.syncGithubButton.textContent = task?.githubStatus === "completed" ? "Sync again" : "Check GitHub result";

  if (!task) {
    els.githubStatusTitle.textContent = "Ready when the card is saved";
    els.githubStatusBody.textContent = "Save this task before creating a GitHub issue for Codex Cloud.";
    return;
  }

  const targetRepo = targetGithubRepo(task);
  const targetText = targetRepo ? ` Target repository: ${targetRepo}.` : "";
  const environmentText = task.targetEnvironment ? ` Environment: ${task.targetEnvironment}` : "";

  if (task.githubIssueUrl) {
    els.githubIssueLink.href = task.githubIssueUrl;
    els.githubIssueLink.hidden = false;
    els.sendGithubButton.textContent = task.githubStatus === "review-triggered" ? "Start implementation in same issue" : "Trigger Codex Cloud again";
  }

  if (task.githubStatus === "review-triggered") {
    els.githubStatusTitle.textContent = "Codex Cloud review running";
    els.githubStatusBody.textContent =
      `Issue #${task.githubIssueNumber} is being used as the Codex thread for this task. When you start implementation, the board will reuse this same issue.${targetText}${environmentText}${githubLastSyncText(task)}`;
    return;
  }

  if (task.githubStatus === "codex-triggered") {
    els.githubStatusTitle.textContent = "Codex Cloud triggered";
    els.githubStatusBody.textContent =
      `Issue #${task.githubIssueNumber} is active in ${task.githubRepo}. The server checks GitHub automatically.${environmentText}${githubLastSyncText(task)}`;
    return;
  }

  if (task.githubStatus === "completed") {
    els.githubStatusTitle.textContent = "Codex Cloud result synced";
    els.githubStatusBody.textContent =
      `A result from issue #${task.githubIssueNumber} in ${task.githubRepo} has been synced into this card.${githubLastSyncText(task)}`;
    return;
  }

  if (task.githubStatus === "accepted") {
    els.githubStatusTitle.textContent = "GitHub task accepted";
    els.githubStatusBody.textContent =
      `The board task is done. Issue #${task.githubIssueNumber} in ${task.githubRepo} is linked for history.${githubLastSyncText(task)}`;
    return;
  }

  if (task.githubStatus === "issue-created") {
    els.githubStatusTitle.textContent = "GitHub issue created";
    els.githubStatusBody.textContent =
      `Issue #${task.githubIssueNumber} exists in ${task.githubRepo}. Use Start Codex when you are ready to trigger Codex Cloud.${environmentText}${githubLastSyncText(task)}`;
    return;
  }

  els.githubStatusTitle.textContent = "Not sent to GitHub";
  els.githubStatusBody.textContent =
    `Start Codex Cloud from this card to create a GitHub issue and trigger implementation without using this local chat.${targetText}${environmentText}`;
}

function stripCodexCommentary(value) {
  const body = text(value).trim();

  if (!body) {
    return "";
  }

  const resultMatch = body.match(/(?:^|\n)#{2,3}\s*Result\s*\n([\s\S]*?)(?=\n#{2,3}\s*(Summary|Testing|Verification|Changed paths|Follow-ups|Notes|$))/i);
  if (resultMatch?.[1]?.trim()) {
    return resultMatch[1].trim();
  }

  return body
    .replace(/\n#{2,3}\s*(Summary|Testing|Verification|Verification notes|Changed paths|Follow-ups|Pull requests?|GitHub)[\s\S]*$/i, "")
    .trim();
}

function renderResultPanel(task) {
  const result = task ? latestResultForTask(task.id) : null;
  const resultIsClosed =
    !result ||
    result.status === "accepted" ||
    result.status === "changes-requested" ||
    task?.codexResultStatus === "in-progress" ||
    task?.githubStatus === "codex-triggered";
  els.resultCard.hidden = !result;
  els.resultGithubLink.hidden = true;
  els.resultGithubLink.href = "#";
  els.acceptTaskButton.hidden = resultIsClosed;
  els.requestChangesButton.hidden = resultIsClosed;
  els.acceptTaskButton.textContent = "Confirm result";
  els.requestChangesButton.textContent = "Further directions";
  els.acceptTaskButton.dataset.taskId = task?.id ?? "";
  els.requestChangesButton.dataset.taskId = task?.id ?? "";

  if (!result) {
    return;
  }

  els.resultSummary.textContent = result.summary || "Codex completed the task.";
  els.resultDetails.textContent = stripCodexCommentary(result.details) || "No result text recorded.";
  if (result.githubCommentUrl || result.codexTaskUrl || result.githubIssueUrl) {
    els.resultGithubLink.href = result.githubCommentUrl || result.codexTaskUrl || result.githubIssueUrl;
    els.resultGithubLink.hidden = false;
  }
  renderList(els.resultChangedPaths, result.changedPaths, "No changed paths recorded.");
  renderList(els.resultVerification, result.verification, "No verification recorded.");
  renderList(els.resultFollowUps, result.followUps, "No follow-up items recorded.");

  if (result.status === "changes-requested") {
    const note = result.changeRequestNote || "Changes requested.";
    els.resultDetails.textContent = `${els.resultDetails.textContent}\n\nChange request: ${note}`;
  }
}

function renderActivityPanel(task) {
  els.activityTimeline.replaceChildren();

  if (!task) {
    els.activityTimeline.append(createEl("li", "empty-list-item", "Save the card to start activity."));
    return;
  }

  const activities = taskActivities(task.id);

  if (!activities.length) {
    els.activityTimeline.append(createEl("li", "empty-list-item", "No activity yet."));
    return;
  }

  for (const activity of activities) {
    const item = createEl("li", "activity-item");
    const message = createEl("strong", "", activity.message);
    const time = createEl("span", "", formatDateTime(activity.createdAt));
    item.append(message, time);
    els.activityTimeline.append(item);
  }
}

function renderInputSummary(task) {
  els.taskInputSummaryBody.replaceChildren();

  if (!task) {
    return;
  }

  const rows = [
    ["Title", task.title],
    ["Description", task.description || "No description."],
    ["Acceptance criteria", (task.acceptanceCriteria ?? []).join("\n") || "No acceptance criteria."],
  ];

  for (const [label, value] of rows) {
    const group = createEl("div", "summary-row");
    group.append(createEl("strong", "", label), createEl("p", "", value));
    els.taskInputSummaryBody.append(group);
  }

  const images = taskContextImages(task);
  if (images.length) {
    const group = createEl("div", "summary-row");
    const preview = createEl("div", "context-preview");
    group.append(createEl("strong", "", "Screenshot context"), preview);
    els.taskInputSummaryBody.append(group);
    renderContextPreview(preview, images);
  }
}

function openTaskModal(task = null) {
  const fallbackColumn = "backlog";
  const resultMode = isResultMode(task);

  els.taskId.value = task?.id ?? "";
  els.taskTitle.value = text(task?.title);
  els.taskDescription.value = text(task?.description);
  els.taskAcceptance.value = (task?.acceptanceCriteria ?? []).join("\n");
  contextImagesDraft = taskContextImages(task);
  renderContextPreview(els.taskContextPreview, contextImagesDraft, { removable: true });
  els.taskModalKicker.textContent = currentProject()?.name ?? "Task";
  els.taskModalTitle.textContent = task ? (resultMode ? "Task result" : "Edit task") : "New task";
  els.deleteTaskButton.hidden = !task || resultMode;
  fillColumnOptions(task?.columnId ?? fallbackColumn);
  els.taskEditFields.hidden = resultMode;
  els.taskInputSummary.hidden = !resultMode;
  renderInputSummary(task);
  renderCodexPanel(task);
  renderRoutePanel(task, { hidden: resultMode });
  renderGithubPanel(task);
  renderResultPanel(task);
  renderActivityPanel(task);
  els.requestReviewButton.hidden = resultMode;
  els.sendCodexButton.hidden = resultMode;
  els.saveTaskButton.hidden = resultMode;
  if (!els.taskModal.open) {
    els.taskModal.showModal();
  }
  if (!resultMode) {
    els.taskTitle.focus();
  }
}

function readTaskForm() {
  const task = currentModalTask();

  return {
    projectId: task?.projectId ?? currentProjectId,
    columnId: task?.columnId ?? "backlog",
    title: els.taskTitle.value.trim(),
    description: els.taskDescription.value.trim(),
    acceptanceCriteria: els.taskAcceptance.value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    contextImages: contextImagesDraft,
  };
}

function findSavedTask(nextStore, payload, id) {
  if (id) {
    return nextStore.tasks.find((task) => task.id === id);
  }

  return nextStore.tasks
    .filter((task) => task.projectId === payload.projectId && task.title === payload.title)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

async function persistTaskFromForm() {
  const id = els.taskId.value;
  const payload = readTaskForm();

  if (!payload.title) {
    throw new Error("Task title is required.");
  }

  const path = id ? `/api/tasks/${id}` : "/api/tasks";
  const method = id ? "PATCH" : "POST";
  const nextStore = await api(path, { method, body: JSON.stringify(payload) });
  const savedTask = findSavedTask(nextStore, payload, id);

  setStore(nextStore);

  if (savedTask) {
    els.taskId.value = savedTask.id;
    contextImagesDraft = taskContextImages(savedTask);
    renderContextPreview(els.taskContextPreview, contextImagesDraft, { removable: true });
    renderCodexPanel(savedTask);
    renderGithubPanel(savedTask);
    renderResultPanel(savedTask);
    renderActivityPanel(savedTask);
  }

  return savedTask;
}

function reopenTaskFromStore(nextStore, taskId) {
  const updatedTask = nextStore.tasks.find((item) => item.id === taskId);

  if (updatedTask) {
    openTaskModal(updatedTask);
  }

  return updatedTask;
}

async function startLocalCodex(task) {
  const nextStore = await api(`/api/tasks/${task.id}/handoff`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  setStore(nextStore);
  reopenTaskFromStore(nextStore, task.id);
  showToast("Task moved to Ready and sent to Local Codex");
}

async function startCloudCodex(task) {
  const route = resolvedTaskRoute(task);

  if (!route.githubRepo && !task.githubRepo) {
    throw new Error("No GitHub repository is configured for this project.");
  }

  if (task.githubIssueUrl) {
    const triggerExisting = window.confirm(
      "Post the implementation @codex request to the existing GitHub issue so this task stays in the same issue thread?",
    );

    if (!triggerExisting) {
      return;
    }

    const response = await api(`/api/tasks/${task.id}/github-retrigger`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStore(response.store);
    reopenTaskFromStore(response.store, task.id);
    showToast("Codex Cloud triggered on existing issue");
    return;
  }

  const triggerCodex = window.confirm(
    "Create a GitHub issue and add an @codex comment to start Codex Cloud work?",
  );

  if (!triggerCodex) {
    const issueOnly = window.confirm("Create the GitHub issue without triggering Codex Cloud?");
    if (!issueOnly) {
      return;
    }
  }

  const response = await api(`/api/tasks/${task.id}/github-export`, {
    method: "POST",
    body: JSON.stringify({ triggerCodex }),
  });
  setStore(response.store);
  reopenTaskFromStore(response.store, task.id);
  showToast(triggerCodex ? "GitHub issue created and Codex Cloud triggered" : "GitHub issue created");
}

async function startCodexForTask(task) {
  const mode = chooseCodexStartMode(task);

  if (!mode) {
    return;
  }

  if (mode === "cloud") {
    await startCloudCodex(task);
    return;
  }

  await startLocalCodex(task);
}

els.searchInput.addEventListener("input", renderBoard);

els.newTaskButton.addEventListener("click", () => openTaskModal());

els.taskContextInput.addEventListener("change", async () => {
  const files = Array.from(els.taskContextInput.files ?? []);

  if (!files.length) {
    return;
  }

  try {
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        throw new Error(`${file.name} is not an image.`);
      }

      if (file.size > 1_500_000) {
        throw new Error(`${file.name} is larger than 1.5 MB.`);
      }
    }

    const images = await Promise.all(files.map(fileToContextImage));
    contextImagesDraft = [...contextImagesDraft, ...images];
    renderContextPreview(els.taskContextPreview, contextImagesDraft, { removable: true });
    els.taskContextInput.value = "";
  } catch (error) {
    showToast(error.message);
  }
});

els.newProjectButton.addEventListener("click", () => {
  openProjectModal();
});

els.projectSettingsButton.addEventListener("click", () => {
  const project = currentProject();
  if (project) {
    openProjectModal(project);
  }
});

document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

els.taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const wasExisting = Boolean(els.taskId.value);
    await persistTaskFromForm();
    els.taskModal.close();
    showToast(wasExisting ? "Task saved" : "Task created");
  } catch (error) {
    showToast(error.message);
  }
});

els.deleteTaskButton.addEventListener("click", async () => {
  const id = els.taskId.value;

  if (!id || !window.confirm("Delete this task?")) {
    return;
  }

  setStore(await api(`/api/tasks/${id}`, { method: "DELETE" }));
  els.taskModal.close();
  showToast("Task deleted");
});

els.requestReviewButton.addEventListener("click", async () => {
  try {
    const task = await persistTaskFromForm();
    if (!task) {
      throw new Error("Save the task before requesting review.");
    }

    const mode = chooseCodexReviewMode(task);
    if (!mode) {
      return;
    }

    const nextStore = await api(`/api/tasks/${task.id}/review`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    setStore(nextStore);
    const updatedTask = nextStore.tasks.find((item) => item.id === task.id);
    if (updatedTask) {
      openTaskModal(updatedTask);
    }
    showToast(updatedTask?.codexReviewStatus === "proposed" ? "Local review proposal ready" : "Codex Cloud review requested");
  } catch (error) {
    showToast(error.message);
  }
});

els.sendCodexButton.addEventListener("click", async () => {
  try {
    const task = await persistTaskFromForm();
    if (!task) {
      throw new Error("Save the task before starting Codex.");
    }

    await startCodexForTask(task);
  } catch (error) {
    showToast(error.message);
  }
});

els.sendGithubButton.addEventListener("click", async () => {
  try {
    const task = await persistTaskFromForm();
    if (!task) {
      throw new Error("Save the task before starting Codex Cloud.");
    }

    await startCloudCodex(task);
  } catch (error) {
    showToast(error.message);
  }
});

els.syncGithubButton.addEventListener("click", async () => {
  const taskId = els.syncGithubButton.dataset.taskId || els.taskId.value;

  if (!taskId) {
    return;
  }

  try {
    const response = await api(`/api/tasks/${taskId}/github-sync`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStore(response.store);
    const updatedTask = response.store.tasks.find((item) => item.id === taskId);
    if (updatedTask) {
      openTaskModal(updatedTask);
    }
    showToast(response.reviewSynced ? "Codex review synced" : response.synced ? "GitHub result synced" : response.message);
  } catch (error) {
    showToast(error.message);
  }
});

els.applyReviewButton.addEventListener("click", async () => {
  const reviewId = els.applyReviewButton.dataset.reviewId;

  if (!reviewId) {
    showToast("No proposal is available yet");
    return;
  }

  try {
    const nextStore = await api(`/api/task-reviews/${reviewId}/apply`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStore(nextStore);
    const task = nextStore.tasks.find((item) => item.id === els.taskId.value);
    if (task) {
      openTaskModal(task);
    }
    showToast("Proposal applied");
  } catch (error) {
    showToast(error.message);
  }
});

els.acceptTaskButton.addEventListener("click", async () => {
  const taskId = els.acceptTaskButton.dataset.taskId || els.taskId.value;

  if (!taskId) {
    return;
  }

  try {
    const currentTask = store.tasks.find((item) => item.id === taskId);
    const closeGithubIssue = currentTask?.githubIssueUrl
      ? window.confirm("Close the linked GitHub issue too?")
      : false;
    const nextStore = await api(`/api/tasks/${taskId}/accept`, {
      method: "POST",
      body: JSON.stringify({ closeGithubIssue }),
    });
    setStore(nextStore);
    const task = nextStore.tasks.find((item) => item.id === taskId);
    if (task) {
      openTaskModal(task);
    }
    showToast(closeGithubIssue ? "Task confirmed and GitHub issue closed" : "Task confirmed");
  } catch (error) {
    showToast(error.message);
  }
});

els.requestChangesButton.addEventListener("click", async () => {
  const taskId = els.requestChangesButton.dataset.taskId || els.taskId.value;

  if (!taskId) {
    return;
  }

  const note = window.prompt("What further direction should Codex follow?", "");

  if (note === null) {
    return;
  }

  try {
    const currentTask = store.tasks.find((item) => item.id === taskId);
    const postToGithub = currentTask?.githubIssueUrl
      ? window.confirm("Post this change request to GitHub and trigger Codex Cloud again?")
      : false;
    const response = await api(`/api/tasks/${taskId}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ note, postToGithub }),
    });
    const nextStore = response.store ?? response;
    setStore(nextStore);
    const task = nextStore.tasks.find((item) => item.id === taskId);
    if (task) {
      openTaskModal(task);
    }
    showToast(postToGithub ? "Changes sent to Codex Cloud" : "Changes requested");
  } catch (error) {
    showToast(error.message);
  }
});

els.projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = els.projectForm.dataset.projectId;
  const payload = {
    name: els.projectName.value.trim(),
    description: els.projectDescriptionInput.value.trim(),
    color: document.querySelector("#project-color-input").value,
    githubRepo: els.projectGithubRepo.value.trim(),
    codexTargetMode: els.projectCodexMode.value,
    codexProfile: els.projectCodexProfile.value.trim(),
    localWorkspacePath: els.projectLocalWorkspace.value.trim(),
    defaultBranch: els.projectDefaultBranch.value.trim() || "main",
    targetEnvironment: els.projectEnvironment.value.trim(),
    syncGithub: els.projectSyncGithub.checked,
  };

  if (!payload.name) {
    showToast("Project name is required");
    return;
  }

  const nextStore = await api(projectId ? `/api/projects/${projectId}` : "/api/projects", {
    method: projectId ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
  currentProjectId = projectId || nextStore.selectedProjectId;
  setStore(nextStore);
  els.projectModal.close();
  showToast(projectId ? "Project settings saved" : "Project created");
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  accessToken = els.accessTokenInput.value.trim();
  window.localStorage.setItem(tokenStorageKey, accessToken);
  els.authModal.close();

  try {
    await loadState();
    showToast("Board unlocked");
  } catch (error) {
    showToast(error.message);
  }
});

window.setInterval(() => {
  if (document.hidden || els.taskModal.open || els.projectModal.open || els.authModal.open) {
    return;
  }

  loadState().catch((error) => console.error(error));
}, 30000);

loadState().catch((error) => {
  console.error(error);
  showToast(error.message);
});
