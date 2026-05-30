/* universal-form-handler.js
 *
 * Drop-in client-side form handler for sites whose forms used to submit to
 * Netlify Forms. Intercepts any <form> that has an email field, posts the
 * data to /api/lead (the universal Cloudflare Pages endpoint), and shows a
 * success/error state without leaving the page.
 *
 * Activation: include <script src="/form-handler.js" defer></script> in
 * <head>. The script auto-binds on DOMContentLoaded.
 *
 * Behavior:
 *  - Captures every <form> on the page on load + on DOM mutation.
 *  - Skips: forms with data-no-intercept, role="search", forms that already
 *    have a fetch() submit listener, and forms where action points to an
 *    external host or a known non-lead endpoint.
 *  - On submit: collects all named field values, posts to /api/lead as
 *    urlencoded, shows inline success or error message.
 *  - Honors data-success-redirect to redirect on success.
 */
(function () {
  'use strict';

  var LEAD_ENDPOINT = '/api/lead';
  var BOUND_FLAG = '__formHandlerBound';

  function showInlineMessage(form, kind, text) {
    var existing = form.querySelector('[data-form-message]');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.setAttribute('data-form-message', kind);
    div.textContent = text;
    div.style.cssText = (
      kind === 'success'
        ? 'margin:16px 0;padding:14px 18px;border-radius:8px;background:#10391f;color:#7ce0a0;border:1px solid #1c5934;font-size:14px;'
        : 'margin:16px 0;padding:14px 18px;border-radius:8px;background:#3b1818;color:#ffb4b4;border:1px solid #6a2828;font-size:14px;'
    );
    form.appendChild(div);
  }

  function setSubmitting(btn, submitting) {
    if (!btn) return;
    if (submitting) {
      btn.dataset.originalText = btn.textContent;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
      btn.textContent = 'Sending...';
    } else {
      if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  }

  function shouldHandle(form) {
    if (form[BOUND_FLAG]) return false;
    if (form.hasAttribute('data-no-intercept')) return false;
    if (form.getAttribute('role') === 'search') return false;
    // Must have an email field
    var emailField = form.querySelector('input[type="email"], input[name="email"]');
    if (!emailField) return false;
    var action = (form.getAttribute('action') || '').trim();
    // Skip forms whose action is an absolute URL on a different origin
    if (/^https?:\/\//.test(action)) {
      try {
        var u = new URL(action);
        if (u.origin !== location.origin) return false;
      } catch (e) { /* ignore */ }
    }
    // Skip if action is clearly a Square checkout, Calendly, etc.
    if (/square\.link|squareup\.com|calendly\.com|stripe\.com/.test(action)) return false;
    return true;
  }

  function collectFields(form) {
    var fd = new FormData(form);
    var out = {};
    fd.forEach(function (v, k) {
      if (typeof v === 'string') out[k] = v;
    });
    if (!out['form-name']) out['form-name'] = form.getAttribute('name') || form.id || 'contact';
    if (!out.source) out.source = location.pathname || 'unknown';
    return out;
  }

  function bind(form) {
    if (!shouldHandle(form)) return;
    form[BOUND_FLAG] = true;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      e.stopPropagation();

      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      setSubmitting(btn, true);

      var fields = collectFields(form);
      var body = new URLSearchParams(fields).toString();

      try {
        var res = await fetch(LEAD_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body,
          credentials: 'same-origin',
        });

        if (!res.ok) {
          var detail = '';
          try { detail = (await res.json()).error || ''; } catch (e) {}
          showInlineMessage(form, 'error', detail || ('Submission failed (status ' + res.status + '). Please try again or email mark@markcmo.com directly.'));
          setSubmitting(btn, false);
          return;
        }

        // Default: redirect to /thank-you (every site has one).
        // Override per-form with data-success-redirect="...", or disable
        // the redirect entirely with data-no-redirect on the form.
        var customRedirect = form.getAttribute('data-success-redirect');
        var noRedirect = form.hasAttribute('data-no-redirect');
        if (!noRedirect) {
          var target = customRedirect || '/thank-you';
          // Pass the submitter email along so the thank-you page can
          // personalize ("Thanks {name}, we'll be in touch at {email}")
          try {
            var qs = new URLSearchParams();
            if (fields.email) qs.set('e', fields.email);
            if (fields.first_name || fields.name) qs.set('n', fields.first_name || fields.name);
            if (fields['form-name']) qs.set('f', fields['form-name']);
            var sep = target.indexOf('?') >= 0 ? '&' : '?';
            window.location.assign(target + sep + qs.toString());
          } catch (e) {
            window.location.assign(target);
          }
          return;
        }

        showInlineMessage(form, 'success', "Thanks — we got your message. We'll be in touch shortly.");
        try { form.reset(); } catch (e) {}
        setSubmitting(btn, false);

        // Fire optional gtag conversion if available
        if (typeof window.gtag === 'function') {
          try { window.gtag('event', 'lead_submitted', { form_name: fields['form-name'] }); } catch (e) {}
        }
      } catch (err) {
        showInlineMessage(form, 'error', 'Network error: ' + (err && err.message || err) + '. Please try again.');
        setSubmitting(btn, false);
      }
    }, { capture: true });
  }

  function bindAll() {
    document.querySelectorAll('form').forEach(bind);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAll);
  } else {
    bindAll();
  }

  // Re-bind any forms injected later
  if (window.MutationObserver) {
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes && m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'FORM') bind(n);
          n.querySelectorAll && n.querySelectorAll('form').forEach(bind);
        });
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
