// Decorative corner mascot — a small looping cat idle ("gatin", from the
// MIT-licensed lottie-web demo set) rendered by the SAME vendored lottie-web
// build the intro uses. Purely presentational: no interactions, no gameplay
// role, and it never intercepts pointer events (see .mascot CSS).
// Reduced motion: instead of looping, it freezes on its first frame.

const MASCOT_JSON_URL = '/animations/mascot.json';
let mascotAnim = null;

export function initMascot() {
  const host = document.querySelector('#mascot');
  if (!host || mascotAnim || typeof window === 'undefined' || !window.lottie) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  try {
    mascotAnim = window.lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: !reduced,
      autoplay: !reduced,
      path: MASCOT_JSON_URL,
    });
    if (reduced) {
      // Freeze on the first frame instead of looping (project-wide rule).
      mascotAnim.addEventListener('DOMLoaded', () => mascotAnim.goToAndStop(0, true));
    }
  } catch {
    host.classList.add('hidden'); // never let decoration break the app
    mascotAnim = null;
  }
}
