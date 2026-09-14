// Shared EAS lookup: the newest finished Android build for a given profile.
//
// Why this is resolved live rather than baked into a static page: EAS artifact
// URLs EXPIRE (about two weeks — the build record carries an `expirationDate`).
// A page with a hard-coded link would quietly start 404ing, which is worse than
// no page at all when someone is trying to install a test build.
const APP_ID = '32904d99-92a8-4afd-b199-340c7c8fcfe9';

const QUERY = `
  query ($appId: String!) {
    app {
      byId(appId: $appId) {
        buildsPaginated(first: 25, filter: { platforms: [ANDROID] }) {
          edges {
            node {
              __typename
              ... on Build {
                id
                status
                appVersion
                appBuildVersion
                createdAt
                gitCommitHash
                buildProfile
                artifacts { applicationArchiveUrl }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * @param {string} profile - EAS build profile to look for, e.g. "preview".
 * @returns {Promise<object|undefined>} The newest finished build, or undefined.
 */
export async function latestBuild(profile = 'preview') {
  const token = process.env.EXPO_TOKEN;
  if (!token) {
    throw new Error('EXPO_TOKEN is not configured on this deployment.');
  }

  const response = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { appId: APP_ID } }),
  });

  if (!response.ok) {
    throw new Error(`EAS API returned ${response.status}`);
  }

  const body = await response.json();
  if (body.errors) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }

  const edges = body.data?.app?.byId?.buildsPaginated?.edges ?? [];
  return edges
    .map((e) => e.node)
    .filter(
      (n) =>
        n.__typename === 'Build' &&
        n.status === 'FINISHED' &&
        n.buildProfile === profile &&
        n.artifacts?.applicationArchiveUrl
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}
