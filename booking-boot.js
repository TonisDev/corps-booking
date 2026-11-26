const bootParams = new URLSearchParams(location.search);
document.documentElement.dataset.mode = bootParams.get('business_code') ? 'book' : 'home';
if (bootParams.get('embed') === '1') document.documentElement.dataset.embed = '1';
if (document.documentElement.dataset.mode === 'home') document.title = 'QuickBook';
(function () {
  if (document.documentElement.dataset.embed !== '1') return;
  function postEmbedHeight() {
    const card = document.querySelector('.booking-card') || document.body;
    if (!card || !window.parent || window.parent === window) return;
    const height = Math.ceil(card.getBoundingClientRect().height + 16);
    window.parent.postMessage({ type: 'quickbook-height', height }, '*');
  }
  function armEmbedHeight() {
    postEmbedHeight();
    const card = document.querySelector('.booking-card') || document.body;
    if (card && window.ResizeObserver) new ResizeObserver(postEmbedHeight).observe(card);
    window.addEventListener('load', postEmbedHeight);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armEmbedHeight);
  else armEmbedHeight();
})();
