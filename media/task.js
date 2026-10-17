(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() ?? {};
  let state = { filter: "", status: "all", sort: "plan", ...saved };
  let selection = "";
  let restoreSelection = Boolean(saved.selected);
  window.addEventListener("nested-flow-change", () => { state.nestedFlows = { ...state.nestedFlows, ...window.maestrunNestedFlow.capture() }; persist(); });
  const persist = () => vscode.setState({ ...state, selected: selection });
  const applyFilters = () => {
    let rows = [...document.querySelectorAll(".task-row")];
    const priority = ["on_hold", "running", "failed", "blocked", "refactor", "cancelled", "pending", "completed"];
    rows.sort((a, b) => state.sort === "title" ? a.dataset.title.localeCompare(b.dataset.title)
      : state.sort === "status" ? priority.indexOf(a.dataset.status) - priority.indexOf(b.dataset.status)
      : Number(a.dataset.order) - Number(b.dataset.order));
    let count = 0;
    for (const row of rows) {
      const matches = state.status === "all" || (state.status === "attention"
        ? ["on_hold", "failed", "blocked", "cancelled", "refactor"].includes(row.dataset.status) : state.status === row.dataset.status);
      row.hidden = !matches || !`${row.textContent} ${row.dataset.executor ?? ""}`.toLowerCase().includes(state.filter.trim().toLowerCase());
    }
    rows = window.maestrunTaskHierarchy(rows, state);
    for (const row of rows) { if (!row.hidden) count++; row.parentNode.appendChild(row); }
    for (const button of document.querySelectorAll('.filters [data-filter]')) button.setAttribute("aria-pressed", String(button.dataset.filter === state.status));
    const empty = document.getElementById("no-matches");
    if (empty) empty.hidden = count > 0 || rows.length === 0;
    const result = document.getElementById("filter-result");
    if (result) result.textContent = `${count} of ${rows.length} tasks shown`;
  };
  const reveal = () => document.getElementById("detail-title")?.focus({ preventScroll: true });
  const closeMenu = () => { const menu = document.getElementById("project-menu"); if (menu) menu.open = false; };
  window.addEventListener("message", ({ data }) => {
    if (typeof data?.html !== "string") { if (data?.revealTask && data.focusTask !== false) reveal(); return; }
    const content = document.getElementById("content");
    const focused = document.hasFocus() ? document.activeElement : undefined;
    const focusKey = focused ? ["id", "data-action", "data-task-id", "data-step-id", "data-filter", "data-ui", "data-flow-mode", "data-flow-direction"]
      .filter((key) => focused.hasAttribute(key)).map((key) => [key, focused.getAttribute(key)]) : [];
    const scroll = ["task-list-scroll", "detail-body"].map((id) => [id, document.getElementById(id)?.scrollTop ?? 0]);
    const top = document.scrollingElement.scrollTop;
    const previous = document.querySelector('.dashboard');
    const oldView = previous?.dataset.editorView;
    const oldStep = previous?.dataset.step;
    const menuOpen = document.getElementById("project-menu")?.open;
    const noticeOpen = document.getElementById("project-notice")?.open;
    const logsOpen = document.querySelector(".step-logs")?.open;
    state.nestedFlows = { ...state.nestedFlows, ...window.maestrunNestedFlow.capture() };
    content.innerHTML = data.html;
    const dashboard = content.querySelector(".dashboard");
    if (!dashboard) return;
    const changedProject = state.project && state.project !== dashboard.dataset.project;
    if (changedProject) { state = { filter: "", status: "all", sort: "plan" }; restoreSelection = false; }
    state.project = dashboard.dataset.project;
    const changedSelection = dashboard.dataset.selection !== selection;
    selection = dashboard.dataset.selection;
    const filter = document.getElementById("task-filter"); if (filter) filter.value = state.filter;
    const sort = document.getElementById("task-sort"); if (sort) sort.value = state.sort;
    const menu = document.getElementById("project-menu"); if (menu) menu.open = Boolean(menuOpen);
    const notice = document.getElementById("project-notice"); if (notice) notice.open = !changedProject && Boolean(noticeOpen);
    const logs = document.querySelector(".step-logs");
    if (logs && !changedProject && !changedSelection && oldStep === dashboard.dataset.step && logsOpen !== undefined) logs.open = logsOpen;
    window.maestrunNestedFlow.restore(state.nestedFlows);
    applyFilters();
    for (const [id, value] of scroll) { const element = document.getElementById(id); if (element) element.scrollTop = id === "detail-body" && changedSelection ? 0 : value; }
    if (focusKey.length) [...content.querySelectorAll("button,input,select,summary,[tabindex]")]
      .find((element) => focusKey.every(([key, value]) => element.getAttribute(key) === value))?.focus({ preventScroll: true });
    document.scrollingElement.scrollTop = changedProject || oldView !== dashboard.dataset.editorView || oldStep !== dashboard.dataset.step ? 0 : top;
    if (restoreSelection) {
      restoreSelection = false;
      if (!selection && [...content.querySelectorAll(".task-select")].some((button) => button.dataset.taskId === saved.selected))
        vscode.postMessage({ action: "showTask", taskId: saved.selected });
    }
    persist();
    if (data.revealTask && data.focusTask !== false) reveal();
  });
  document.addEventListener("input", ({ target }) => {
    if (target.id !== "task-filter") return;
    state.filter = target.value; persist(); applyFilters();
  });
  document.addEventListener("change", ({ target }) => {
    if (target.id === "flow-task-selector") { vscode.postMessage({ action: "showTask", taskId: target.value }); return; }
    if (target.id !== "task-sort") return;
    state.sort = target.value; persist(); applyFilters();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button") ?? event.target.closest(".task-row")?.querySelector(".task-select");
    if (!button || button.disabled) return;
    if (button.dataset.ui === "toggle-task") {
      const collapsed = new Set(state.collapsedTasks ?? []);
      if (!collapsed.delete(button.dataset.taskId)) collapsed.add(button.dataset.taskId);
      state.collapsedTasks = [...collapsed]; persist(); applyFilters(); return;
    }
    if (button.dataset.filter) { state.status = button.dataset.filter; persist(); applyFilters(); }
    if (button.dataset.ui === "clear-filters") {
      state.filter = ""; state.status = "all"; document.getElementById("task-filter").value = "";
      persist(); applyFilters(); document.getElementById("task-filter").focus();
    }
    if (!button.dataset.action) return;
    closeMenu();
    vscode.postMessage({ action: button.dataset.action, taskId: button.dataset.taskId ?? button.closest("[data-task-id]")?.dataset.taskId, stepId: button.dataset.stepId });
  });
  vscode.postMessage({ action: "ready" });
})();
