(() => {
  const vscode = acquireVsCodeApi();
  let nestedFlows = vscode.getState()?.nestedFlows ?? {};
  window.addEventListener('nested-flow-change', () => { nestedFlows = { ...nestedFlows, ...window.maestrunNestedFlow.capture() }; vscode.setState({ nestedFlows }); });
  const content = document.getElementById('content');
  window.addEventListener('message', ({ data }) => {
    if (typeof data?.html !== 'string') return;
    const top = document.scrollingElement.scrollTop;
    const focused = document.activeElement;
    const key = [focused?.dataset.action, focused?.closest('[data-project-path]')?.dataset.projectPath,
      focused?.closest('[data-task-id]')?.dataset.taskId, focused?.dataset.stepId, focused?.dataset.flowMode, focused?.dataset.flowDirection];
    nestedFlows = { ...nestedFlows, ...window.maestrunNestedFlow.capture() };
    const previousLogs = content.querySelector('.step-logs');
    content.innerHTML = data.html;
    const logs = content.querySelector('.step-logs');
    if (logs && previousLogs?.dataset.logKey === logs.dataset.logKey) logs.open = previousLogs.open;
    window.maestrunNestedFlow.restore(nestedFlows);
    [...content.querySelectorAll('button')].find((button) => [button.dataset.action,
      button.closest('[data-project-path]')?.dataset.projectPath, button.closest('[data-task-id]')?.dataset.taskId,
      button.dataset.stepId, button.dataset.flowMode, button.dataset.flowDirection].every((value, i) => value === key[i]))?.focus({ preventScroll: true });
    document.scrollingElement.scrollTop = top;
  });
  document.addEventListener('click', ({ target }) => {
    const button = target.closest('button[data-action]');
    if (!button || button.disabled) return;
    vscode.postMessage({ action: button.dataset.action,
      projectPath: button.closest('[data-project-path]')?.dataset.projectPath,
      taskId: button.closest('[data-task-id]')?.dataset.taskId,
      stepId: button.dataset.stepId });
  });
  vscode.postMessage({ action: 'ready' });
})();
