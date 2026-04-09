/* BusBrother.com - Main JS */

document.addEventListener('DOMContentLoaded', () => {

  // -- Click-Based Dropdown Navigation --
  const dropdownBtns = document.querySelectorAll('.nav-dropdown-btn');

  dropdownBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentLi = btn.closest('li');
      const dropdown = parentLi.querySelector('.dropdown');
      const isOpen = dropdown.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        dropdown.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  document.addEventListener('click', () => closeAllDropdowns());
  document.querySelectorAll('.dropdown').forEach(dd => {
    dd.addEventListener('click', e => e.stopPropagation());
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllDropdowns(); });

  function closeAllDropdowns() {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.nav-dropdown-btn[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  // -- Mobile Nav Toggle --
  const hamburger = document.getElementById('hamburger');
  const navMenu   = document.getElementById('navMenu');
  if (hamburger && navMenu) {
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      navMenu.classList.toggle('open');
      hamburger.textContent = navMenu.classList.contains('open') ? '\u2715' : '\u2630';
    });
  }

  // -- Scroll Animations --
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        const delay = parseInt(e.target.dataset.delay || 0);
        setTimeout(() => e.target.classList.add('visible'), delay * 100);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.anim').forEach((el, i) => {
    el.dataset.delay = i % 5;
    observer.observe(el);
  });

  // -- FAQ Accordion --
  document.querySelectorAll('.faq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const answer = btn.nextElementSibling;
      const icon   = btn.querySelector('.faq-icon');
      const isOpen = answer.classList.contains('open');
      document.querySelectorAll('.faq-answer').forEach(a => a.classList.remove('open'));
      document.querySelectorAll('.faq-icon').forEach(i => { i.classList.remove('open'); i.textContent = '+'; });
      document.querySelectorAll('.faq-btn').forEach(b => b.setAttribute('aria-expanded','false'));
      if (!isOpen) {
        answer.classList.add('open');
        icon.classList.add('open');
        btn.setAttribute('aria-expanded','true');
      }
    });
  });

  // -- Netlify Form Submission via AJAX --
  document.querySelectorAll('form[data-netlify]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const origText = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }

      const body = new URLSearchParams(new FormData(form)).toString();

      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      })
      .then(res => {
        if (res.ok) {
          if (btn) {
            btn.textContent = '\u2713 Sent! We\'ll reply within 24 hours.';
            btn.style.background = '#2ecc71';
            btn.style.color = '#fff';
          }
          form.reset();
        } else {
          throw new Error('Status ' + res.status);
        }
      })
      .catch(err => {
        console.error('Form error:', err);
        // Fallback: submit the form natively
        form.removeEventListener('submit', arguments.callee);
        form.submit();
      });
    });
  });

  // -- Sticky Nav Shadow --
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('navbar');
    if (nav) nav.style.boxShadow = window.scrollY > 20 ? '0 2px 30px rgba(0,0,0,0.5)' : 'none';
  });

  // -- Animated Counters --
  function animateCount(el, target, suffix) {
    suffix = suffix || '';
    let start = null;
    const dur = 1600;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.floor(ease * target) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const statObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const num = e.target.dataset.count;
        const suf = e.target.dataset.suffix || '';
        if (num) animateCount(e.target, parseInt(num), suf);
        statObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.stat-num[data-count]').forEach(el => statObserver.observe(el));

});
