/* Clerk's browser SDK is loaded only on the staff workspace, never on candidate links. */
window.SlateAuth = (() => {
  let clerk = null;
  let mounted = null;
  function loadScript(src, publishableKey) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      if (publishableKey) script.setAttribute('data-clerk-publishable-key', publishableKey);
      const timer = setTimeout(() => reject(new Error('Sign-in took too long to load. Please refresh and try again.')), 20000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('Sign-in could not load. Check your connection and refresh.')); };
      document.head.appendChild(script);
    });
  }
  return {
    get signedIn() { return Boolean(clerk?.user); },
    async init(config, onSessionChange) {
      if (!config?.configured) throw new Error('Sign-in is temporarily unavailable. Please contact the workspace administrator.');
      const origin = 'https://' + config.domain;
      await loadScript(origin + '/npm/@clerk/ui@1/dist/ui.browser.js');
      await loadScript(origin + '/npm/@clerk/clerk-js@6/dist/clerk.browser.js', config.publishableKey);
      clerk = window.Clerk;
      await clerk.load({
        ui: { ClerkUI: window.__internal_ClerkUICtor },
        signInFallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/',
        appearance: { variables: { colorPrimary: '#1D4E89', borderRadius: '0.5rem' } }
      });
      let sessionId = clerk.session?.id || null;
      clerk.addListener(({ session }) => {
        const next = session?.id || null;
        if (next === sessionId) return;
        sessionId = next;
        onSessionChange();
      });
    },
    async token() { return clerk?.session ? clerk.session.getToken() : null; },
    signIn() { clerk?.openSignIn(); },
    signUp() { clerk?.openSignUp(); },
    async signOut() { if (clerk) await clerk.signOut(); },
    unmount() {
      if (mounted && clerk) clerk.unmountUserButton(mounted);
      mounted = null;
    },
    mount(root) {
      const element = root.querySelector('[data-clerk-user]');
      if (element && clerk?.user) {
        clerk.mountUserButton(element);
        mounted = element;
      }
    }
  };
})();
