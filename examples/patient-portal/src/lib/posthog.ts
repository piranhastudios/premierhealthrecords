import PostHog from 'posthog-react-native';
import { config } from './config';

function missingPostHogConfig(variable: 'POSTHOG_PROJECT_TOKEN' | 'POSTHOG_HOST'): undefined {
  if (__DEV__) {
    throw new Error(
      `${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
    );
  }
  return undefined;
}

const projectToken = config.posthogProjectToken.trim();
const host = config.posthogHost.trim();

/**
 * Shared PostHog client for the Expo app. Configuration is read from Expo's
 * build-time `extra` config, which receives POSTHOG_* values in app.config.js.
 */
export const posthog = !projectToken
  ? missingPostHogConfig('POSTHOG_PROJECT_TOKEN')
  : !host
    ? missingPostHogConfig('POSTHOG_HOST')
    : new PostHog(projectToken, {
        host,
        errorTracking: {
          autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
            // Console logs are not an intentional error-monitoring signal.
            console: [],
          },
        },
      });
