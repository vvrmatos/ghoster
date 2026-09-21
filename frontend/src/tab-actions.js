export function nextTabIndex(length, current, delta) {
  if (length <= 0) return -1;
  return (current + delta + length) % length;
}

export function numberedTabIndex(number, length) {
  if (length <= 0 || number < 1 || number > 9) return -1;
  return number === 9 ? length - 1 : Math.min(number - 1, length - 1);
}

export function rememberClosed(stack, snapshot, limit = 10) {
  stack.push(snapshot);
  if (stack.length > limit) stack.splice(0, stack.length - limit);
  return stack;
}
