// Build metadata for the page to render. No artifact URL is returned here — use
// /api/latest so the download always resolves at click time.
import { latestBuild } from './_eas.js';

export default async function handler(request, response) {
  const profile = new URL(request.url, 'http://localhost').searchParams.get('profile') ?? 'preview';
  try {
    const build = await latestBuild(profile);
    response.setHeader('Cache-Control', 'no-store');
    if (!build) {
      response.status(404).json({ error: `No finished Android build for profile "${profile}".` });
      return;
    }
    response.status(200).json({
      id: build.id,
      profile: build.buildProfile,
      version: `${build.appVersion} (${build.appBuildVersion})`,
      commit: (build.gitCommitHash ?? '').slice(0, 9),
      builtAt: build.createdAt,
    });
  } catch (err) {
    response.status(502).json({ error: err.message });
  }
}
