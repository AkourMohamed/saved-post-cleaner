// Fills every .grid[data-tiles] with placeholder tiles. data-processing marks
// one tile (1-based) with the extension's real "currently working on this"
// outline; data-removing fades the listed ones.
document.querySelectorAll('.grid[data-tiles]').forEach((grid) => {
  const order = [1, 4, 2, 7, 3, 6, 5, 8, 2, 5, 1, 3, 8, 6, 4, 7, 3, 1, 6, 2];
  const n = Number(grid.dataset.tiles);
  const processing = Number(grid.dataset.processing || 0);
  const removing = (grid.dataset.removing || '').split(',').map(Number);
  for (let i = 1; i <= n; i++) {
    const t = document.createElement('div');
    t.className = 'tile t' + order[(i - 1) % order.length];
    if (i === processing) t.classList.add('igsc-processing');
    if (removing.includes(i)) t.classList.add('removing');
    grid.appendChild(t);
  }
});
