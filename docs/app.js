(function () {
  // 1. Mobile Navigation Toggle
  const navToggle = document.getElementById('navToggle');
  const sidebar = document.getElementById('docsSidebar');

  if (navToggle && sidebar) {
    navToggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });

    sidebar.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        if (window.innerWidth <= 960) {
          sidebar.classList.remove('open');
        }
      });
    });
  }

  // 2. Active Section Highlighting
  const navLinks = Array.from(document.querySelectorAll('#docsSidebar a[href^="#"]'));
  const sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length > 0) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          const id = '#' + entry.target.id;
          navLinks.forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('href') === id);
          });
        }
      });
    }, { rootMargin: '-20% 0px -65% 0px', threshold: 0.01 });

    sections.forEach(function (sec) { observer.observe(sec); });
  }

  // 3. Copy Code Snippet Buttons
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const block = btn.closest('.code-block');
      const pre = block ? block.querySelector('pre') : null;
      if (!pre) return;

      navigator.clipboard.writeText(pre.innerText.trim()).then(function () {
        const prev = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () {
          btn.textContent = prev;
        }, 1400);
      }).catch(function () {});
    });
  });

  // 4. Interactive System Tray + Glass Overlay Preview
  const previewSwitch = document.getElementById('previewSwitch');
  const previewPill = document.getElementById('previewStatePill');
  const previewContentOff = document.getElementById('previewOff');
  const previewContentOn = document.getElementById('previewOn');
  const previewFootState = document.getElementById('previewFootState');

  function setPreviewState(isOn) {
    if (!previewSwitch) return;
    previewSwitch.setAttribute('aria-checked', isOn ? 'true' : 'false');

    if (isOn) {
      previewPill.textContent = 'ON - Port 4040 Active';
      previewPill.className = 'pill pill-success';
      previewContentOff.style.display = 'none';
      previewContentOn.style.display = 'block';
      previewFootState.textContent = 'Glass Pairing QR Overlay Active';
    } else {
      previewPill.textContent = 'OFF - Startup Default';
      previewPill.className = 'pill';
      previewContentOff.style.display = 'block';
      previewContentOn.style.display = 'none';
      previewFootState.textContent = 'Port 4040 Closed (~2 MB Tray)';
    }
  }

  if (previewSwitch) {
    previewSwitch.addEventListener('click', function () {
      const nextOn = previewSwitch.getAttribute('aria-checked') !== 'true';
      setPreviewState(nextOn);
    });
  }
})();
