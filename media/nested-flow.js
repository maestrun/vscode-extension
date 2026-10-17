(() => {
  const svgElement = (name, attributes) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const layout = (flow) => {
    const graph = flow.querySelector('.flow-graph');
    const vertical = flow.dataset.direction === 'vertical';
    const nodes = [...flow.querySelectorAll('.flow-branch')].map((element) => {
      const card = element.querySelector('.nested-task');
      const box = card.getBoundingClientRect();
      return { element, id: card.dataset.taskId, level: Number(element.dataset.level),
        parents: JSON.parse(element.dataset.predecessors), width: box.width, height: box.height };
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = nodes.flatMap((to) => to.parents.filter((id) => byId.has(id)).map((id) => ({ from: byId.get(id), to })));
    const skipped = edges.filter(({ from, to }) => to.level > from.level + 1);
    const gutter = skipped.length ? 24 + skipped.length * 12 : 0;
    let offset = 0, span = 0;
    for (let level = 0; level <= Math.max(-1, ...nodes.map((node) => node.level)); level++) {
      const layer = nodes.filter((node) => node.level === level);
      let cross = gutter;
      for (const node of layer) {
        node.x = vertical ? cross : offset;
        node.y = vertical ? offset : cross;
        node.element.style.left = `${node.x}px`;
        node.element.style.top = `${node.y}px`;
        cross += (vertical ? node.width : node.height) + 24;
      }
      span = Math.max(span, cross - 24);
      const next = nodes.filter((node) => node.level === level + 1).length;
      offset += Math.max(0, ...layer.map((node) => vertical ? node.height : node.width))
        + (next ? Math.max(64, 32 + 12 * (layer.length + next)) : 64);
    }
    const width = Math.max(0, vertical ? span : offset - 64), height = Math.max(0, vertical ? offset - 64 : span);
    graph.style.width = `${width}px`;
    graph.style.height = `${height}px`;
    const svg = graph.querySelector('.dependency-edges');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren(...edges.map(({ from, to }) => {
      const lane = 12 + skipped.findIndex((edge) => edge.from === from && edge.to === to) * 12;
      const start = vertical ? [from.x + from.width / 2, from.y + from.height] : [from.x + from.width, from.y + from.height / 2];
      const end = vertical ? [to.x + to.width / 2, to.y - 2] : [to.x - 2, to.y + to.height / 2];
      const layer = nodes.filter((node) => node.level === from.level);
      const exit = Math.max(...layer.map((node) => vertical ? node.y + node.height : node.x + node.width))
        + 12 + layer.indexOf(from) * 12;
      const entry = 12 + nodes.filter((node) => node.level === to.level).indexOf(to) * 12;
      const points = edgePoints(start, end, { vertical, lane, exit, entry, skip: to.level > from.level + 1 });
      const path = svgElement('path', { 'data-from': from.id, 'data-to': to.id,
        d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + (vertical ? 'm-4-6 4 6 4-6' : 'm-6-4 6 4-6 4') });
      const title = svgElement('title', {});
      title.textContent = `${from.id} → ${to.id}`;
      path.append(title);
      return path;
    }));
  };
  const edgePoints = (start, end, { vertical, lane, exit, entry, skip }) => {
    const [x1, y1] = start, [x2, y2] = end;
    if (skip) return vertical
      ? [start, [x1, exit], [lane, exit], [lane, y2 - entry], [x2, y2 - entry], end]
      : [start, [exit, y1], [exit, lane], [x2 - entry, lane], [x2 - entry, y2], end];
    return vertical ? [start, [x1, y2 - entry], [x2, y2 - entry], end]
      : [start, [x2 - entry, y1], [x2 - entry, y2], end];
  };
  const resize = new ResizeObserver((entries) => {
    for (const flow of new Set(entries.map(({ target }) => target.closest('.nested-flow'))))
      if (flow?.isConnected) layout(flow);
  });
  const capture = () => Object.fromEntries([...document.querySelectorAll('.nested-flow')].map((flow) => {
    const scroll = flow.querySelector('.nested-scroll');
    return [flow.dataset.flowKey, { mode: flow.dataset.mode, direction: flow.dataset.direction, left: scroll.scrollLeft, top: scroll.scrollTop }];
  }));
  const apply = (flow, state) => {
    flow.dataset.mode = state.mode === 'steps' ? 'steps' : 'tasks';
    flow.dataset.direction = state.direction === 'vertical' ? 'vertical' : 'horizontal';
    for (const button of flow.querySelectorAll('[data-flow-direction]'))
      button.setAttribute('aria-pressed', String(button.dataset.flowDirection === flow.dataset.direction));
    for (const button of flow.querySelectorAll('[data-flow-mode]'))
      button.setAttribute('aria-pressed', String(button.dataset.flowMode === flow.dataset.mode));
    layout(flow);
  };
  window.maestrunNestedFlow = {
    capture,
    restore(saved = {}) {
      resize.disconnect();
      for (const flow of document.querySelectorAll('.nested-flow')) {
        const state = saved[flow.dataset.flowKey] ?? {};
        apply(flow, state);
        const scroll = flow.querySelector('.nested-scroll');
        scroll.scrollLeft = state.left ?? 0;
        scroll.scrollTop = state.top ?? 0;
        for (const card of flow.querySelectorAll('.nested-task')) resize.observe(card);
      }
    }
  };
  // Chromium keeps a wheel gesture latched to its first scroller, even at an edge.
  document.addEventListener('wheel', (event) => {
    const scroll = event.target.closest('.nested-scroll');
    if (!scroll || event.defaultPrevented || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1);
    const atEdge = delta < 0 ? scroll.scrollTop <= 0 : scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1;
    if (!atEdge) return;
    const page = document.scrollingElement;
    const before = page.scrollTop;
    page.scrollTop += delta;
    if (page.scrollTop !== before) event.preventDefault();
  }, { passive: false });
  document.addEventListener('click', ({ target }) => {
    const button = target.closest('[data-flow-mode],[data-flow-direction]');
    if (!button) return;
    const flow = button.closest('.nested-flow');
    apply(flow, { mode: button.dataset.flowMode ?? flow.dataset.mode, direction: button.dataset.flowDirection ?? flow.dataset.direction });
    if (button.dataset.flowDirection) flow.querySelector('.nested-scroll').scrollTo(0, 0);
    window.dispatchEvent(new Event('nested-flow-change'));
  });
})();
