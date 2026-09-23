/* Clerk's browser SDK is loaded only on the staff workspace, never on candidate links. */
window.SlateAuth = (() => {
  let clerk = null;
  let mounted = null;
  let authMounted = null;
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

    /** The workspace this tab's session is currently in, or null. */
    get organizationId() { return clerk?.organization?.id || null; },
    get organizationName() { return clerk?.organization?.name || null; },

    /**
     * A required step Clerk is holding the session on.
     *
     * With organization selection required, a brand-new session arrives
     * `pending` until a workspace is chosen. Slate answers that with its own
     * chooser rather than mounting Clerk's, because the choice has to run the
     * same unsaved-edit guard as every other workspace change and has to be
     * cancellable — which a prebuilt component's selection event is not.
     */
    get pendingTask() { return clerk?.session?.currentTask?.key || null; },

    /**
     * @param onSessionChange  the signed-in identity changed (sign in or out)
     * @param onOrganizationChange  the active workspace changed, including in
     *   another tab: Clerk's session is shared, so this tab can find itself in
     *   a workspace the person selected somewhere else.
     */
    async init(config, onSessionChange, onOrganizationChange) {
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
      let organizationId = clerk.organization?.id || null;
      clerk.addListener(({ session, organization }) => {
        const nextSession = session?.id || null;
        if (nextSession !== sessionId) {
          sessionId = nextSession;
          organizationId = organization?.id || null;
          onSessionChange();
          return;
        }
        const nextOrganization = organization?.id || null;
        if (nextOrganization !== organizationId) {
          const previous = organizationId;
          organizationId = nextOrganization;
          onOrganizationChange?.(nextOrganization, previous);
        }
      });
    },

    async token() { return clerk?.session ? clerk.session.getToken() : null; },
    signIn() { clerk?.openSignIn(); },
    signUp() { if (clerk) location.assign('/sign-up'); },
    async signOut() { if (clerk) await clerk.signOut(); },


    /**
     * Move this session into a workspace.
     *
     * Slate asks for the switch only after its own guard has run, so by the
     * time Clerk is involved the decision is already made. Resolving a pending
     * organization-selection task is the same call with the same result.
     */
    async setActiveOrganization(organizationId) {
      if (!clerk) throw new Error('Sign-in is not ready yet.');
      await clerk.setActive({ organization: organizationId });
    },

    /** Organization invitations waiting for this account, newest first. */
    async invitations() {
      if (!clerk?.user?.getOrganizationInvitations) return [];
      const page = await clerk.user.getOrganizationInvitations({ status: 'pending' });
      return (page?.data || []).map(i => ({
        id: i.id,
        organizationId: i.publicOrganizationData?.id || null,
        organizationName: i.publicOrganizationData?.name || 'A workspace',
        role: i.role,
        accept: () => i.accept()
      }));
    },

    unmount() {
      if (authMounted && clerk) {
        if (authMounted.kind === 'sign-up') clerk.unmountSignUp(authMounted.element);
        else clerk.unmountSignIn(authMounted.element);
      }
      authMounted = null;
      if (mounted && clerk) clerk.unmountUserButton(mounted);
      mounted = null;
    },
    mount(root) {
      const authElement = root.querySelector('[data-clerk-auth]');
      if (authElement && clerk && !clerk.user) {
        const kind = authElement.dataset.clerkAuth;
        const joining = /^\/join(?:\/|$)/.test(location.pathname);
        const context = new URLSearchParams();
        for (const key of ['organization', 'search']) {
          const value = new URLSearchParams(location.search).get(key);
          if (value) context.set(key, value);
        }
        const complete = '/join' + (context.size ? '?' + context : '');
        const props = joining
          ? { routing: 'path', path: /^\/join\/(sign-in|sign-up)/.exec(location.pathname)?.[0] || '/join',
              signInUrl: '/join/sign-in' + location.search, signUpUrl: '/join/sign-up' + location.search,
              forceRedirectUrl: complete, signInForceRedirectUrl: complete, signUpForceRedirectUrl: complete }
          : { routing: 'path', path: '/' + kind, signInUrl: '/sign-in', signUpUrl: '/sign-up', fallbackRedirectUrl: '/' };
        if (kind === 'sign-up') clerk.mountSignUp(authElement, props);
        else clerk.mountSignIn(authElement, props);
        authMounted = { kind, element: authElement };
      }
      const element = root.querySelector('[data-clerk-user]');
      if (element && clerk?.user) {
        clerk.mountUserButton(element);
        mounted = element;
      }
    }
  };
})();
