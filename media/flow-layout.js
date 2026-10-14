(() => {
  const content = document.getElementById('content');
  function layout(chart) {
    const stages = [...chart.children];
    const style = getComputedStyle(chart);
    const gap = parseFloat(style.columnGap);
    const width = chart.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const columns = Math.max(1, Math.min(stages.length, Math.floor((width + gap) / ((parseFloat(style.getPropertyValue("--flow-node-min")) || 230) + gap))));
    chart.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    stages.forEach((stage, index) => {
      const row = Math.floor(index / columns);
      stage.style.gridRow = String(row + 1);
      stage.style.gridColumn = String(row % 2 ? columns - index % columns : index % columns + 1);
      stage.dataset.direction = index % columns === 0 ? 'down' : row % 2 ? 'left' : 'right';
    });
    const connector = chart.parentElement.querySelector('.repair-connector');
    if (!connector) return;
    const source = chart.querySelector('.repair-source');
    const target = chart.querySelector('.repair-target');
    if (!source || !target) return;
    const bounds = chart.parentElement.getBoundingClientRect();
    const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
    const x1 = from.left + from.width / 2 - bounds.left, y1 = from.bottom - bounds.top;
    const x2 = to.left + to.width / 2 - bounds.left, y2 = to.top - bounds.top - 3;
    connector.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    // Route repair feedback through the row gaps and outer margin, clear of the nodes.
    connector.querySelector('path').setAttribute('d', `M${x1} ${y1}v16H4V${y2 - 13}H${x2}V${y2}m-4-5 4 5 4-5`);
  }
  const resize = new ResizeObserver((entries) => entries.forEach(({ target }) => layout(target)));
  const connect = () => {
    resize.disconnect();
    for (const chart of content.querySelectorAll('.flowchart')) { layout(chart); resize.observe(chart); }
  };
  new MutationObserver(connect).observe(content, { childList: true });
  connect();
})();
