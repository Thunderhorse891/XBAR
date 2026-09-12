const film = document.getElementById('film'),
  toggle = document.getElementById('motion'),
  pref = matchMedia('(prefers-reduced-motion: reduce)');
const limitedNetwork =
  !!navigator.connection?.saveData || ['2g', 'slow-2g'].includes(navigator.connection?.effectiveType);
let paused = pref.matches || limitedNetwork,
  visible = true,
  chosenByHand = false;
function sync() {
  document.body.classList.toggle('paused', paused);
  toggle.textContent = film.ended ? 'Replay motion' : paused ? 'Play motion' : 'Pause motion';
  toggle.setAttribute('aria-pressed', String(paused));
  if (paused || !visible || document.hidden) film.pause();
  else {
    const source = film.querySelector('source');
    if (!source.getAttribute('src')) {
      source.src = source.dataset.src;
      film.load();
    }
    film.play().catch(() => {
      paused = true;
      sync();
    });
  }
}
toggle.addEventListener('click', () => {
  chosenByHand = true;
  if (film.ended) film.currentTime = 0;
  paused = !paused;
  sync();
});
pref.addEventListener('change', (e) => {
  // A newly enabled accessibility preference stops playback. Disabling it
  // must not undo an explicit manual pause or a user's playback choice.
  if (e.matches) paused = true;
  else if (!chosenByHand) paused = limitedNetwork || film.ended;
  sync();
});
film.addEventListener('ended', () => {
  paused = true;
  sync();
});
new IntersectionObserver(
  ([e]) => {
    visible = e.isIntersecting;
    sync();
  },
  { threshold: 0.1 },
).observe(film);
document.addEventListener('visibilitychange', sync);
sync();
const views = {
  passport: [
    'Every record has a place.',
    'See how identity, care and ownership connect. Select a view above to explore the proposed workspace.',
    ['Identity', 'Care', 'Ownership'],
    ['Registration', 'Health documents', 'Ownership'],
    ['On file', 'Review needed', 'In progress'],
  ],
  sale: [
    'Know what stands between now and sold.',
    'Show the asking price alongside the records still needed. Clear status takes precedence over a decorative readiness score.',
    ['Prepare', 'Review', 'Share'],
    ['Asking price', 'Ownership proof', 'Sale gate'],
    ['$14,000', 'Missing', 'Blocked'],
  ],
  records: [
    'From a document to a useful record.',
    'Keep uploaded files and their review status visible. An extracted detail is a suggestion until someone verifies it.',
    ['Upload', 'Review', 'Record'],
    ['Files received', 'Awaiting review', 'Verified'],
    ['3 files', '2 files', '1 file'],
  ],
};
const tabs = [...document.querySelectorAll('[role=tab]')];
function select(t) {
  tabs.forEach((b) => {
    b.setAttribute('aria-selected', String(b === t));
    b.tabIndex = b === t ? 0 : -1;
  });
  document.getElementById('panel').setAttribute('aria-labelledby', t.id);
  const v = views[t.dataset.tab];
  document.getElementById('detail-title').textContent = v[0];
  document.getElementById('detail-copy').textContent = v[1];
  ['a', 'b', 'c'].forEach((key, i) => {
    document.getElementById('node-' + key).textContent = v[2][i];
    document.getElementById('label-' + key).textContent = v[3][i];
    document.getElementById('value-' + key).textContent = v[4][i];
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t));
  t.addEventListener('keydown', (e) => {
    let n;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') n = (i + tabs.length - 1) % tabs.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = tabs.length - 1;
    if (n !== undefined) {
      e.preventDefault();
      select(tabs[n]);
      tabs[n].focus();
    }
  });
});
