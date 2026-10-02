import { getCookieConsent } from './cookieConsent';

/**
 * Consent-aware Analytics Bridge for KITS-EOS.
 *
 * IMPORTANT:
 * - KITS-EOS does NOT currently load or bundle third-party tracking scripts (Google Analytics, Mixpanel, etc.).
 * - This architecture serves as an extensible telemetry interface that guarantees strict compliance:
 *   no telemetry or analytics events will be processed unless the user has explicitly consented to the 'analytics' category.
 */

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, any>;
  timestamp?: string;
}

export class AnalyticsService {
  /**
   * Track an event safely, strictly verifying user consent first.
   */
  static trackEvent(name: string, properties?: Record<string, any>): void {
    const consent = getCookieConsent();
    if (!consent.preferences.analytics) {
      // Opted out or not responded: strictly no-op
      return;
    }

    if (typeof window !== 'undefined' && (window as any).__DEV__) {
      console.log(`[KITS-EOS Telemetry] Event: "${name}"`, properties);
    }
  }

  /**
   * Record page views safely under consent rules.
   */
  static trackPageView(path: string): void {
    const consent = getCookieConsent();
    if (!consent.preferences.analytics) {
      return;
    }

    if (typeof window !== 'undefined' && (window as any).__DEV__) {
      console.log(`[KITS-EOS Telemetry] Page View: "${path}"`);
    }
  }
}
