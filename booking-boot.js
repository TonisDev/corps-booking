document.documentElement.dataset.mode = new URLSearchParams(location.search).get('business_code') ? 'book' : 'home';
if (document.documentElement.dataset.mode === 'home') document.title = 'Σύστημα κρατήσεων';
