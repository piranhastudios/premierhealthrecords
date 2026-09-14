// Redirects to the newest finished APK. This is the URL to put on a QR code or
// send to a tester — it keeps working as new builds land.
import { latestBuild } from './_eas.js';

export default async function handler(request, response) {
  const profile = new URL(request.url, 'http://localhost').searchParams.get('profile') ?? 'preview';
  try {
    const build = await latestBuild(profile);
    if (!build) {
      response.status(404).send(`No finished Android build for profile "${profile}".`);
      return;
    }
    // Never cache the redirect itself: the whole point is to follow the latest build.
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(302, build.artifacts.applicationArchiveUrl);
  } catch (err) {
    response.status(502).send(`Could not reach EAS: ${err.message}`);
  }
}
