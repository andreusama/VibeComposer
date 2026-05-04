export function writeShareUrl(progression) {
  window.history.replaceState(null, '', '#' + btoa(JSON.stringify(progression)));
}

export function clearShareUrl() {
  window.history.replaceState(null, '', '#');
}

export function readShareUrl() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    return JSON.parse(atob(hash));
  } catch {
    return null;
  }
}

export async function copyCurrentUrl() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch {
    return false;
  }
}
