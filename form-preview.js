(function () {
    var classic = document.getElementById('classicLink');
    if (classic) classic.href = 'index.html' + location.search;

    var code = new URLSearchParams(location.search).get('business_code');
    if (!code) {
        var loader = document.getElementById('initialLoader');
        var errorEl = document.getElementById('loadingError');
        if (loader) loader.classList.add('hidden');
        if (errorEl) {
            errorEl.textContent = 'Άνοιξε τη σελίδα με ?business_code=, όπως την τωρινή φόρμα.';
            errorEl.classList.remove('hidden');
        }
    }

    var name = document.getElementById('businessName');
    var hero = document.getElementById('heroShop');
    if (!name || !hero) return;
    var sync = function () {
        var text = (name.textContent || '').trim();
        if (text) hero.textContent = text;
    };
    new MutationObserver(sync).observe(name, { childList: true, characterData: true, subtree: true });
})();
