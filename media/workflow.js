(() => {
  const vscode = acquireVsCodeApi();
  const main = document.getElementById("content");
  main.classList.add("workflow");
  main.innerHTML = '<header><h1>Maestrun workflow</h1><p>Configure your agents and guide their work.</p></header><p id="outcome" role="status">Working…</p><div id="prompt"></div><button id="cancel">Cancel operation</button><section><h2>Activity</h2><pre id="activity" aria-live="polite"></pre></section>';
  if (document.body.dataset.sidebarWorkflow === "true") {
    const back = document.createElement("button"); back.className = "text-button"; back.textContent = "Back to dashboard";
    back.addEventListener("click", () => vscode.postMessage({ type: "close" })); main.prepend(back);
  }
  let prompt;
  let executionChanged = false;
  let dragged;
  const builtins = ["planning", "implementation", "testing", "qa", "review"];
  function modelOptions(row, modelValue, effortValue, preserve = false) {
    const executor = row.querySelector('[data-field="executor"]').value;
    const catalog = prompt.catalog?.find((entry) => entry.executor === executor);
    const model = row.querySelector('[data-field="model"]');
    model.replaceChildren();
    for (const entry of catalog?.models ?? []) model.add(new Option(entry.name === entry.id ? entry.id : `${entry.name} (${entry.id})`, entry.id));
    if (preserve && modelValue && ![...model.options].some((option) => option.value === modelValue))
      model.add(new Option(`${modelValue} (saved; unavailable)`, modelValue));
    if (!model.options.length) model.add(new Option('No models available', ''));
    model.value = [...model.options].some((option) => option.value === modelValue) ? modelValue
      : catalog?.models.find((entry) => entry.isDefault)?.id ?? model.options[0].value;
    model.title = catalog?.message || 'Models available from this CLI';
    row.querySelector('.model-status').textContent = catalog?.message ?? '';
    effortOptions(row, effortValue, preserve);
  }
  function effortOptions(row, selected, preserve = false) {
    const executor = row.querySelector('[data-field="executor"]').value;
    const model = prompt.catalog?.find((entry) => entry.executor === executor)?.models.find((entry) => entry.id === row.querySelector('[data-field="model"]').value);
    const effort = row.querySelector('[data-field="effort"]');
    effort.replaceChildren(new Option(model?.defaultEffort ? `Default (${model.defaultEffort})` : 'Default (CLI)', ''));
    for (const value of model?.efforts ?? []) effort.add(new Option(value, value));
    if (preserve && selected && ![...effort.options].some((option) => option.value === selected)) effort.add(new Option(`${selected} (saved; unverified)`, selected));
    effort.value = [...effort.options].some((option) => option.value === selected) ? selected : '';
    effort.title = model?.efforts ? 'Supported effort levels for this model' : 'This CLI did not advertise effort levels for this model.';
  }
  function addRow(stage, focus = false) {
    const body = document.querySelector("#workflow-table tbody");
    const row = body.insertRow();
    row.stage = stage;
    const required = stage.id === "planning";
    const handle = document.createElement('button');
    handle.type = 'button'; handle.className = 'drag-handle'; handle.textContent = '⠿';
    handle.draggable = !required; handle.disabled = required;
    handle.setAttribute('aria-label', 'Drag to reorder step');
    handle.title = required ? 'Planning stays first' : 'Drag to reorder; use Arrow Up or Arrow Down when focused';
    row.insertCell().append(handle);
    for (const field of ["id", "executor", "model", "effort", "file"]) {
      const input = document.createElement(["executor", "model", "effort"].includes(field) ? "select" : "input");
      input.dataset.field = field;
      input.setAttribute("aria-label", `${field === "id" ? "Step name" : field} for step ${body.rows.length}`);
      if (field === "executor") {
        for (const entry of prompt.catalog ?? []) {
          if (!entry.available && entry.executor !== stage.executor) continue;
          const option = new Option(`${entry.executor}${entry.available ? '' : ' (unavailable)'}`, entry.executor);
          option.disabled = !entry.available && entry.executor !== stage.executor;
          input.add(option);
        }
        if (stage.executor && ![...input.options].some((option) => option.value === stage.executor)) input.add(new Option(`${stage.executor} (saved)`, stage.executor));
      }
      input.value = field === "id" ? stage.id.replace(/^custom:/, "") : stage[field] ?? "";
      if (field === "id") { input.readOnly = required; input.maxLength = 80; }
      if (field === "id" || field === "model") input.required = true;
      if (field === "file") input.placeholder = ".maestrun/steps/name.md";
      const cell = row.insertCell(); cell.append(input);
      if (field === 'model') { const status = document.createElement('small'); status.className = 'model-status muted'; cell.append(status); }
    }
    modelOptions(row, stage.model, stage.effort, true);
    const actions = row.insertCell();
    for (const [action, label] of [["up", "Move up"], ["down", "Move down"], ["remove", "Remove"]]) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = label; button.dataset.rowAction = action;
      button.disabled = required;
      actions.append(button);
    }
    if (focus) row.querySelector("input").focus();
  }
  function tableValue() {
    const stages = [...document.querySelectorAll("#workflow-table tbody tr")].map((row) => {
      const stage = { ...row.stage };
      for (const input of row.querySelectorAll("[data-field]")) {
        const field = input.dataset.field;
        const value = input.value.trim();
        if (field === "id") stage.id = builtins.includes(value) ? value : `custom:${value}`;
        else if (!value && (field === "effort" || field === "file")) delete stage[field];
        else stage[field] = value;
      }
      return stage;
    });
    const table = { ...prompt.table, stages };
    if (executionChanged) {
      table.execution = { ...table.execution, mode: document.getElementById("execution-mode").value,
        concurrency: Number(document.getElementById("execution-concurrency").value) };
      const repairs = document.getElementById("execution-repairs").value;
      if (repairs === "") delete table.execution.maxRepairs;
      else table.execution.maxRepairs = Number(repairs);
    }
    return table;
  }
  window.addEventListener("message", ({ data }) => {
    document.getElementById("activity").textContent = data.logs ?? "";
    document.getElementById("outcome").textContent = data.outcome ?? "Working…";
    document.getElementById("cancel").hidden = Boolean(data.outcome);
    if (typeof data.html !== "string") return;
    dragged = undefined;
    prompt = data.prompt;
    document.getElementById("prompt").innerHTML = data.html;
    executionChanged = false;
    if (prompt?.kind === "table") {
      for (const stage of prompt.table.stages) addRow(stage);
      const execution = prompt.table.execution;
      document.getElementById("execution-mode").value = execution?.mode ?? "sequential";
      document.getElementById("execution-concurrency").value = execution?.concurrency ?? 1;
      document.getElementById("execution-repairs").value = execution?.maxRepairs ?? "";
    }
    document.querySelector('#answer, #filter, input[name="choice"]')?.focus();
  });
  function moveRow(row, target, after) {
    if (!target || row === target || row.stage.id === 'planning') return false;
    const ordered = [...row.parentNode.rows].filter((entry) => entry !== row);
    ordered.splice(ordered.indexOf(target) + (after ? 1 : 0), 0, row);
    const ids = ordered.map((entry) => entry.querySelector('[data-field=id]').value);
    const order = ids.filter((id) => builtins.includes(id)).map((id) => builtins.indexOf(id));
    if (ids[0] !== 'planning' || order.some((value, index) => index > 0 && value <= order[index - 1])) {
      document.getElementById('reorder-status').textContent = 'Planning stays first; built-in steps must keep their required order.';
      return false;
    }
    if (after) target.after(row); else target.before(row);
    document.getElementById('reorder-status').textContent = `Step moved to position ${ordered.indexOf(row) + 1}. Save workflow to apply.`;
    return true;
  }
  const clearDrop = () => document.querySelectorAll('.drop-before,.drop-after').forEach((row) => row.classList.remove('drop-before', 'drop-after'));
  document.addEventListener('dragstart', (event) => {
    if (!event.target.matches('.drag-handle') || event.target.disabled) return;
    dragged = event.target.closest('tr');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'workflow-step');
    event.dataTransfer.setDragImage(dragged, 20, 20);
    dragged.classList.add('dragging');
  });
  document.addEventListener('dragover', (event) => {
    if (!dragged) return;
    clearDrop();
    const row = event.target.closest('#workflow-table tbody tr');
    if (!row || row === dragged) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const bounds = row.getBoundingClientRect();
    row.classList.add(event.clientY >= bounds.top + bounds.height / 2 ? 'drop-after' : 'drop-before');
  });
  document.addEventListener('drop', (event) => {
    if (!dragged) return;
    const row = event.target.closest('#workflow-table tbody tr');
    event.preventDefault();
    if (row) moveRow(dragged, row, row.classList.contains('drop-after'));
    clearDrop(); dragged.classList.remove('dragging'); dragged = undefined;
  });
  document.addEventListener('dragend', () => { clearDrop(); dragged?.classList.remove('dragging'); dragged = undefined; });
  document.addEventListener('keydown', (event) => {
    if (!event.target.matches('.drag-handle') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const row = event.target.closest('tr');
    const after = event.key === 'ArrowDown';
    moveRow(row, after ? row.nextElementSibling : row.previousElementSibling, after);
    event.target.focus();
  });
  document.addEventListener("change", ({target}) => {
    if (target.closest('#execution-settings')) executionChanged = true;
    const row = target.closest('#workflow-table tbody tr');
    if (!row) return;
    if (target.dataset.field === 'executor') modelOptions(row, '', '');
    if (target.dataset.field === 'model') effortOptions(row, '');
  });
  document.addEventListener("input", (event) => {
    if (event.target.closest("#execution-settings")) executionChanged = true;
    if (event.target.id !== "filter") return;
    const term = event.target.value.toLowerCase();
    for (const choice of document.querySelectorAll(".choice")) choice.hidden = !choice.textContent.toLowerCase().includes(term);
  });
  document.addEventListener("click", (event) => {
    if (event.target.id === 'refresh-models' && prompt) vscode.postMessage({ type: 'answer', id: prompt.id, value: { refreshCatalog: true, table: tableValue() } });
    if (event.target.id === "add-step") {
      const stages = tableValue().stages;
      const previous = stages.at(-1);
      addRow({ id: "", executor: previous?.executor ?? "codex", model: previous?.model ?? "",
        ...(previous?.effort ? { effort: previous.effort } : {}) }, true);
    }
    const rowButton = event.target.closest("[data-row-action]");
    if (rowButton) {
      const row = rowButton.closest("tr");
      const previous = row.previousElementSibling;
      const next = row.nextElementSibling;
      if (rowButton.dataset.rowAction === "remove") { const target = next ?? previous; row.remove(); target?.querySelector("input").focus(); }
      if (rowButton.dataset.rowAction === "up") moveRow(row, previous, false);
      if (rowButton.dataset.rowAction === "down") moveRow(row, next, true);
    }
    const navigation = event.target.closest("[data-navigation]")?.dataset.navigation;
    if (navigation && prompt) vscode.postMessage({ type: "answer", id: prompt.id, navigation });
    if (event.target.id === "cancel") vscode.postMessage({ type: "cancel" });
  });
  document.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!prompt) return;
    let value;
    if (prompt.kind === "table") value = tableValue();
    else if (prompt.kind === "confirm") value = event.submitter.value === "yes";
    else if (prompt.kind === "input" || prompt.kind === "paste") value = document.getElementById("answer").value;
    else {
      const choices = [...document.querySelectorAll('input[name="choice"]:checked:not(:disabled)')]
        .map((input) => prompt.choices[Number(input.value)].value);
      value = prompt.kind === "select" ? choices[0] : choices;
      if (value === undefined) { document.getElementById("validation").textContent = "Select an option to continue."; return; }
    }
    vscode.postMessage({ type: "answer", id: prompt.id, value });
  });
  vscode.postMessage({ type: "ready" });
})();
