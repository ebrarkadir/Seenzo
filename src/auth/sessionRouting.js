/**
 * Pure post-auth routing decisions.
 * Signed-out users always go to AuthGateway unless they are in explicit demoMode.
 */

export function isAuthFlowRoute(route) {
  return route === 'welcome'
    || route === 'sign-in'
    || route === 'sign-up'
    || route === 'auth';
}

/**
 * @returns {'gateway' | 'onboarding' | 'tabs' | 'stay'}
 */
export function resolveSessionDestination({
  signedIn = false,
  onboardingComplete = false,
  demoMode = false,
} = {}) {
  // Explicit Try Demo may use tabs while signed out.
  if (demoMode) {
    return 'tabs';
  }
  // Signed-out (including after logout with stale onboardingComplete) → gateway.
  if (!signedIn) {
    return 'gateway';
  }
  if (!onboardingComplete) {
    return 'onboarding';
  }
  return 'tabs';
}

/**
 * Decide whether RootStack should replace the current route.
 * @returns {{ action: 'replace' | 'none', to: string | null, reason: string }}
 */
export function resolveRootRedirect({
  signedIn = false,
  onboardingComplete = false,
  demoMode = false,
  route = null,
} = {}) {
  const destination = resolveSessionDestination({
    signedIn,
    onboardingComplete,
    demoMode,
  });

  if (destination === 'gateway') {
    if (!route || route === 'index' || isAuthFlowRoute(route)) {
      return { action: 'none', to: null, reason: 'signed_out_on_auth_surface' };
    }
    return { action: 'replace', to: '/', reason: 'signed_out_to_gateway' };
  }

  if (destination === 'onboarding') {
    if (route === 'onboarding' || route === 'auth') {
      return { action: 'none', to: null, reason: 'signed_in_incomplete_ok' };
    }
    return { action: 'replace', to: '/onboarding', reason: 'signed_in_incomplete' };
  }

  // tabs (signed-in complete or explicit demo)
  if (route === 'welcome' || route === 'onboarding' || route === 'index') {
    return { action: 'replace', to: '/(tabs)', reason: demoMode ? 'demo_tabs' : 'onboarding_complete' };
  }
  return { action: 'none', to: null, reason: 'tabs_ok' };
}
