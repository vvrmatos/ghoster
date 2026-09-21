export function recordHistory(tab, url) {
  if (!url || tab.history[tab.historyIndex] === url) return;
  tab.history = tab.history.slice(0, tab.historyIndex + 1);
  tab.history.push(url);
  tab.historyIndex = tab.history.length - 1;
}

export function stepHistory(tab, direction) {
  const next = tab.historyIndex + direction;
  if (next < 0 || next >= tab.history.length) return null;
  tab.historyIndex = next;
  return tab.history[next];
}
