(() => {
  window.maestrunTaskHierarchy = (rows, state) => {
    if (!document.querySelector('#task-list[data-hierarchy=true]')) return rows;
    const byId = new Map(rows.map((row) => [row.dataset.taskId, row]));
    const included = new Set();
    for (const row of rows.filter((row) => !row.hidden)) {
      let current = row;
      while (current && !included.has(current.dataset.taskId)) {
        included.add(current.dataset.taskId);
        current = byId.get(current.dataset.parentId);
      }
    }
    const collapsed = new Set(state.collapsedTasks ?? []);
    const filtering = Boolean(state.filter.trim() || state.status !== 'all');
    const groups = new Map();
    for (const row of rows) {
      const parent = row.dataset.parentId;
      groups.set(parent, [...groups.get(parent) ?? [], row]);
      row.hidden = true;
    }
    const ordered = [];
    const visit = (parent, ancestors, hidden) => {
      const siblings = (groups.get(parent) ?? []).filter((row) => included.has(row.dataset.taskId));
      siblings.forEach((row, index) => {
        const last = index === siblings.length - 1;
        row.hidden = hidden;
        const expanded = filtering || !collapsed.has(row.dataset.taskId);
        const toggle = row.querySelector('.task-tree-toggle');
        if (toggle) {
          row.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${row.dataset.title}`);
        }
        row.querySelector('.task-tree-prefix').textContent = ancestors.slice(1).map((end) => end ? '   ' : '│  ').join('') + (ancestors.length ? (last ? '└─ ' : '├─ ') : '');
        ordered.push(row);
        visit(row.dataset.taskId, [...ancestors, last], hidden || !expanded);
      });
    };
    visit('', [], false);
    return [...ordered, ...rows.filter((row) => !included.has(row.dataset.taskId))];
  };
})();
