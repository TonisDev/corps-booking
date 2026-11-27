(function () {
  const API = 'https://corporate-bookings.tonisdevv.workers.dev';
  const form = document.getElementById('legalContact');
  if (!form) return;
  const topicInput = document.getElementById('legalTopic');
  const title = document.getElementById('legalContactTitle');
  const status = form.querySelector('.legal-status');

  document.querySelectorAll('[data-legal-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const topic = button.getAttribute('data-legal-open') || 'Επικοινωνία';
      if (topicInput) topicInput.value = topic;
      if (title) title.textContent = topic;
      form.hidden = false;
      form.querySelector('[name="email"]')?.focus();
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const body = Object.fromEntries(new FormData(form).entries());
    if (status) {
      status.textContent = '';
      status.className = 'legal-status';
    }
    if (button) button.disabled = true;
    try {
      const res = await fetch(`${API}/api/legal-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Το μήνυμα δεν στάλθηκε.');
      form.reset();
      if (topicInput && title) topicInput.value = title.textContent || 'Επικοινωνία';
      if (status) {
        status.classList.add('is-ok');
        status.textContent = 'Στάλθηκε. Θα απαντήσουμε στο email που έγραψες.';
      }
    } catch (err) {
      if (status) {
        status.classList.add('is-err');
        status.textContent = err.message || 'Το μήνυμα δεν στάλθηκε.';
      }
    } finally {
      if (button) button.disabled = false;
    }
  });
})();
