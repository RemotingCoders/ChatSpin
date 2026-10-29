(() => {
  'use strict';
  const supported = value => value === 'en' || value === 'es';
  const params = new URLSearchParams(location.search);
  let saved, appLanguage;
  try {
    saved = localStorage.getItem('chatspin.legalLanguage');
    appLanguage = localStorage.getItem('chatspin.uiLanguage');
  } catch { /* Language selection still works when browser storage is blocked. */ }
  const legacy = location.hash === '#espanol' ? 'es' : location.hash === '#english' ? 'en' : undefined;
  const browserLanguage = (navigator.languages?.[0] || navigator.language || 'en').split('-')[0];
  let language = [params.get('lang'), legacy, saved, appLanguage, browserLanguage].find(supported) || 'en';
  const root = document.documentElement;
  root.classList.add('legal-js');
  root.dataset.legalLanguage = language;
  root.lang = language;
  function render() {
    root.dataset.legalLanguage = language;
    root.lang = language;
    document.querySelectorAll('[data-text-en]').forEach(element => {
      element.textContent = element.getAttribute('data-text-' + language);
    });
    document.querySelectorAll('[data-language-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.languageChoice === language));
    });
    document.querySelectorAll('section[lang]').forEach(section => { section.hidden = section.lang !== language; });
    document.querySelectorAll('a[href]').forEach(link => {
      const url = new URL(link.getAttribute('href'), location.href);
      if (url.origin === location.origin && ['/privacy.html', '/terms.html'].includes(url.pathname)) {
        url.searchParams.set('lang', language);
        link.setAttribute('href', url.pathname + url.search + url.hash);
      }
    });
    const title = document.querySelector('h1');
    if (title) document.title = title.textContent + ' · ChatSpin by TapLinko';
  }
  function ready() {
    document.querySelectorAll('[data-language-choice]').forEach(button => button.addEventListener('click', () => {
      language = button.dataset.languageChoice;
      try { localStorage.setItem('chatspin.legalLanguage', language); } catch { /* Optional preference only. */ }
      const url = new URL(location.href); url.searchParams.set('lang', language);
      if (['#english', '#espanol'].includes(url.hash)) url.hash = '';
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      render();
    }));
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
