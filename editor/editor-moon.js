(() => {
  const phases = ['🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒'];
  const moons = document.querySelectorAll('[data-editor-moon]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  window.setInterval(() => {
    if (document.hidden || reducedMotion.matches) return;
    index = (index + 1) % phases.length;
    for (const moon of moons) moon.textContent = phases[index];
    document.title = document.title.replace(/(Moonlit )[🌑🌒🌓🌔🌕🌖🌗🌘]( Desk)/u, '$1' + phases[index] + '$2');
  }, 1500);
})();
