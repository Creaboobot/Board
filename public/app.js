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
  githubIssueLink: document.querySelector("#github-issue-link"),
  githubStatusBody: document.querySelector("#github-status-body"),
  githubStatusTitle: document.querySelector("#github-status-title"),
  newProjectButton: document.querySelector("#new-project-button"),
  newTaskButton: document.querySelector("#new-task-button"),
  projectColor: document.querySelector("#project-color"),
  projectDescription: document.querySelector("#project-description"),
  projectDescriptionInput: document.querySelector("#project-description-input"),
  projectForm: document.querySelector("#project-form"),
  projectList: document.querySelector("#project-list"),
  projectModal: document.querySelector("#project-modal"),
  projectName: document.querySelector("#project-name"),
  projectTitle: document.querySelector("#project-title"),
  proposalCard: document.querySelector("#proposal-card"),
  proposalDetails: document.querySelector("#proposal-details"),
  proposalSummary: document.querySelector("#proposal-summary"),
  requestReviewButton: document.querySelector("#request-review-button"),
  requestChangesButton: document.querySelector("#request-changes-button"),
  resultCard: document.querySelector("#result-card"),
  resultChangedPaths: document.querySelector("#result-changed-paths"),
  resultDetails: document.querySelector("#result-details"),
  resultFollowUps: document.querySelector("#result-follow-ups"),
  resultGithubLink: document.querySelector("#result-github-link"),
  resultSummary: document.querySelector("#result-summary"),
  resultVerification: document.querySelector("#result-verification"),
  searchInput: document.querySelector("#search-input"),
  sendCodexButton: document.querySelector("#send-codex-button"),
  sendGithubButton: document.querySelector("#send-github-button"),
  syncGithubButton: document.querySelector("#sync-github-button"),
  statsGrid: document.querySelector("#stats-grid"),
  taskAcceptance: document.querySelector("#task-acceptance"),
  taskColumn: document.querySelector("#task-column"),
  taskDescription: document.querySelector("#task-description"),
  taskEnvironment: document.querySelector("#task-environment"),
  taskForm: document.querySelector("#task-form"),
  taskGithubRepo: document.querySelector("#task-github-repo"),
  taskId: document.querySelector("#task-id"),
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
};

let store = null;
let currentProjectId = null;
let draggedTaskId = null;
let toastTimer = null;
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
    return;
  }

  els.projectTitle.textContent = project.name;
  els.projectDescription.textContent = project.description;
  els.projectColor.style.background = project.color;
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

    const columnTasks = tasks
      .filter((task) => task.columnId === column.id)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));

    if (!columnTasks.length) {
      list.append(createEl("p", "empty-column", "No tasks"));
    } else {
      for (const task of columnTasks) {
        list.append(renderTaskCard(task));
      }
    }

    columnEl.append(header, list);
    els.board.append(columnEl);
  }
}

function renderTaskCard(task) {
  const card = createEl("article", "task-card");
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

function fillColumnOptions(selectedColumnId) {
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
  els.sendCodexButton.textContent = "Send to Codex";

  if (!task) {
    els.codexStatusTitle.textContent = "Ready when the card is saved";
    els.codexStatusBody.textContent =
      "Save or send this task to create a Codex-readable packet without copy-paste.";
    return;
  }

  const review = latestReviewForTask(task.id);
  const handoff = latestHandoffForTask(task.id);

  if (task.githubStatus === "codex-triggered" || task.codexHandoffStatus === "cloud-triggered") {
    els.codexStatusTitle.textContent = "Codex Cloud is working";
    els.codexStatusBody.textContent =
      "The task is running through the GitHub/Codex Cloud path. The board will sync the result back into Review.";
    els.sendCodexButton.textContent = "Send to local Codex";
    return;
  }

  if (task.codexHandoffStatus === "completed" || task.codexResultStatus === "ready-for-review") {
    els.codexStatusTitle.textContent = "Codex result is ready";
    els.codexStatusBody.textContent =
      "The task has moved to Review with a read-only result for you to accept or send back for changes.";
    els.sendCodexButton.textContent = "Resend to Codex";
    return;
  }

  if (review?.status === "proposed" && review.proposal && !["doing", "review", "done"].includes(task.columnId)) {
    els.codexStatusTitle.textContent = "Codex review proposal is ready";
    els.codexStatusBody.textContent = "Review the proposed task shape below, then apply it before sending the task to Codex.";
    renderProposal(review);
    return;
  }

  if (review?.status === "requested") {
    els.codexStatusTitle.textContent = "Task review requested";
    els.codexStatusBody.textContent =
      "The task is in the Codex review queue. Ask me to review the next task when you want a proposal.";
    return;
  }

  if (review?.status === "cloud-triggered" || task.codexReviewStatus === "cloud-triggered") {
    els.codexStatusTitle.textContent = "Codex Cloud is reviewing";
    els.codexStatusBody.textContent =
      `A review-only @codex request is running in ${task.githubRepo ?? "GitHub"}. The proposal will appear here after sync.`;
    return;
  }

  if (review?.status === "claimed" || task.codexReviewStatus === "claimed") {
    els.codexStatusTitle.textContent = "Codex is reviewing this task";
    els.codexStatusBody.textContent =
      "The review has been claimed. A proposal will appear here when it is posted back to the card.";
    return;
  }

  if (task.codexHandoffStatus === "changes-requested" || task.codexResultStatus === "changes-requested") {
    els.codexStatusTitle.textContent = "Changes requested";
    els.codexStatusBody.textContent =
      "Update the card with your final guidance, then send it to Codex again when it is ready.";
    els.sendCodexButton.textContent = "Send revised task";
    return;
  }

  if (task.codexHandoffStatus === "accepted" || task.codexResultStatus === "accepted") {
    els.codexStatusTitle.textContent = "Task accepted";
    els.codexStatusBody.textContent = "The result has been accepted and the task is done.";
    els.sendCodexButton.textContent = "Resend to Codex";
    return;
  }

  if (hasActiveLocalHandoff(task, handoff) && handoff.status === "requested") {
    els.codexStatusTitle.textContent = "Task sent to Codex";
    els.codexStatusBody.textContent =
      "The task is in Ready and queued for Codex. A Codex instance can claim the next queued task without pasting the card.";
    els.sendCodexButton.textContent = "Resend to Codex";
    return;
  }

  if ((hasActiveLocalHandoff(task, handoff) && handoff.status === "claimed") || (task.codexHandoffStatus === "claimed" && !hasCloudWorkflow(task))) {
    els.codexStatusTitle.textContent = "Codex is working on this task";
    els.codexStatusBody.textContent =
      "The handoff has been claimed and the task has moved into In Progress.";
    els.sendCodexButton.textContent = "Resend to Codex";
    return;
  }

  if (review?.status === "applied" || task.codexReviewStatus === "applied") {
    els.codexStatusTitle.textContent = "Review proposal applied";
    els.codexStatusBody.textContent =
      "The task has been updated from the review proposal and is ready to send to Codex when you want implementation to begin.";
    return;
  }

  els.codexStatusTitle.textContent = "No Codex activity yet";
  els.codexStatusBody.textContent =
    "Request a task review to shape the card first, or send it directly when it is ready.";
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
  els.sendGithubButton.textContent = "Send to GitHub/Codex Cloud";
  els.syncGithubButton.hidden = !task?.githubIssueUrl || task?.githubStatus === "accepted";
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
      `Issue #${task.githubIssueNumber} exists in ${task.githubRepo}. Trigger Codex Cloud from here when you are ready.${environmentText}${githubLastSyncText(task)}`;
    return;
  }

  els.githubStatusTitle.textContent = "Not sent to GitHub";
  els.githubStatusBody.textContent =
    `Create a GitHub issue from this card and optionally trigger Codex Cloud without using this local chat.${targetText}${environmentText}`;
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
  els.acceptTaskButton.dataset.taskId = task?.id ?? "";
  els.requestChangesButton.dataset.taskId = task?.id ?? "";

  if (!result) {
    return;
  }

  els.resultSummary.textContent = result.summary || "Codex completed the task.";
  els.resultDetails.textContent = result.details || "No additional detail recorded.";
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

function openTaskModal(task = null) {
  const fallbackColumn = "backlog";

  els.taskId.value = task?.id ?? "";
  els.taskTitle.value = text(task?.title);
  els.taskDescription.value = text(task?.description);
  els.taskGithubRepo.value = text(task?.githubRepo);
  els.taskGithubRepo.placeholder = currentProject()?.githubRepo
    ? `${currentProject().githubRepo} (project default)`
    : "owner/repo";
  els.taskEnvironment.value = text(task?.targetEnvironment);
  els.taskPriority.value = task?.priority ?? "Medium";
  els.taskSize.value = task?.size ?? "M";
  els.taskLabels.value = (task?.labels ?? []).join(", ");
  els.taskAcceptance.value = (task?.acceptanceCriteria ?? []).join("\n");
  els.taskLinks.value = (task?.links ?? []).join("\n");
  els.taskNotes.value = text(task?.notes);
  els.taskModalKicker.textContent = currentProject()?.name ?? "Task";
  els.taskModalTitle.textContent = task ? "Edit task" : "New task";
  els.deleteTaskButton.hidden = !task;
  fillColumnOptions(task?.columnId ?? fallbackColumn);
  renderCodexPanel(task);
  renderGithubPanel(task);
  renderResultPanel(task);
  renderActivityPanel(task);
  if (!els.taskModal.open) {
    els.taskModal.showModal();
  }
  els.taskTitle.focus();
}

function readTaskForm() {
  return {
    projectId: currentProjectId,
    columnId: els.taskColumn.value,
    title: els.taskTitle.value.trim(),
    description: els.taskDescription.value.trim(),
    priority: els.taskPriority.value,
    size: els.taskSize.value,
    githubRepo: els.taskGithubRepo.value.trim(),
    targetEnvironment: els.taskEnvironment.value.trim(),
    labels: els.taskLabels.value
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
    acceptanceCriteria: els.taskAcceptance.value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    links: els.taskLinks.value
      .split("\n")
      .map((link) => link.trim())
      .filter(Boolean),
    notes: els.taskNotes.value.trim(),
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
    renderCodexPanel(savedTask);
    renderGithubPanel(savedTask);
    renderResultPanel(savedTask);
    renderActivityPanel(savedTask);
  }

  return savedTask;
}

els.searchInput.addEventListener("input", renderBoard);

els.newTaskButton.addEventListener("click", () => openTaskModal());

els.newProjectButton.addEventListener("click", () => {
  els.projectName.value = "";
  els.projectDescriptionInput.value = "";
  els.projectModal.showModal();
  els.projectName.focus();
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

    const nextStore = await api(`/api/tasks/${task.id}/review`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStore(nextStore);
    const updatedTask = nextStore.tasks.find((item) => item.id === task.id);
    if (updatedTask) {
      openTaskModal(updatedTask);
    }
    showToast(updatedTask?.codexReviewStatus === "proposed" ? "Review proposal ready" : "Codex review requested");
  } catch (error) {
    showToast(error.message);
  }
});

els.sendCodexButton.addEventListener("click", async () => {
  try {
    const task = await persistTaskFromForm();
    if (!task) {
      throw new Error("Save the task before sending it to Codex.");
    }

    const nextStore = await api(`/api/tasks/${task.id}/handoff`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStore(nextStore);
    const updatedTask = nextStore.tasks.find((item) => item.id === task.id);
    if (updatedTask) {
      openTaskModal(updatedTask);
    }
    showToast("Task moved to Ready and sent to Codex");
  } catch (error) {
    showToast(error.message);
  }
});

els.sendGithubButton.addEventListener("click", async () => {
  try {
    const task = await persistTaskFromForm();
    if (!task) {
      throw new Error("Save the task before sending it to GitHub.");
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
      const updatedTask = response.store.tasks.find((item) => item.id === task.id);
      if (updatedTask) {
        openTaskModal(updatedTask);
      }
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
    const updatedTask = response.store.tasks.find((item) => item.id === task.id);
    if (updatedTask) {
      openTaskModal(updatedTask);
    }
    showToast(triggerCodex ? "GitHub issue created and Codex Cloud triggered" : "GitHub issue created");
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
    showToast(closeGithubIssue ? "Task done and GitHub issue closed" : "Task moved to Done");
  } catch (error) {
    showToast(error.message);
  }
});

els.requestChangesButton.addEventListener("click", async () => {
  const taskId = els.requestChangesButton.dataset.taskId || els.taskId.value;

  if (!taskId) {
    return;
  }

  const note = window.prompt("What should Codex change?", "");

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
  const payload = {
    name: els.projectName.value.trim(),
    description: els.projectDescriptionInput.value.trim(),
    color: document.querySelector("#project-color-input").value,
  };

  if (!payload.name) {
    showToast("Project name is required");
    return;
  }

  const nextStore = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  currentProjectId = nextStore.selectedProjectId;
  setStore(nextStore);
  els.projectModal.close();
  showToast("Project created");
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
