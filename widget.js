(function () {
  var script = document.currentScript;
  if (!script) return;
  var shop = String(script.getAttribute('data-shop') || '').trim();
  if (!shop) return;
  var targetId = script.getAttribute('data-target');
  var target = targetId ? document.getElementById(targetId) : null;
  var frame = document.createElement('iframe');
  frame.title = 'Κράτηση ραντεβού';
  frame.src = 'https://quickbook.gr/?business_code=' + encodeURIComponent(shop) + '&embed=1';
  frame.style.cssText = 'width:100%;border:0;display:block;min-height:720px;background:transparent;';
  frame.setAttribute('loading', 'lazy');
  var box = target || document.createElement('div');
  if (!target) script.parentNode.insertBefore(box, script);
  box.appendChild(frame);
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'quickbook-height') return;
    if (event.source !== frame.contentWindow) return;
    var height = Number(event.data.height);
    if (height > 240 && height < 5000) frame.style.height = Math.ceil(height) + 'px';
  });
})();
