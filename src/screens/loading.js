export function render() {
  return `
    <div class="header"><h1>vibe composer</h1></div>
    <div class="loading-center">
      <div class="spinner"></div>
      <p class="loading-hint">composing your vibe...</p>
    </div>
  `;
}

// No attach() needed — loading screen has no interactive elements
