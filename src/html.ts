export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

export function errorHtml(value: string): string {
  return escapeHtml(value).replaceAll("https://maestrun.com", '<a href="https://maestrun.com">https://maestrun.com</a>');
}
