// Monorepo-aware Metro config for the PHC patient portal.
// npm workspaces hoist deps to the repo root; @medplum/* are workspace symlinks.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 0. Treat .wasm as a bundled asset so expo-sqlite's web build can import
//    wa-sqlite.wasm (Metro doesn't resolve .wasm imports by default).
config.resolver.assetExts.push('wasm');

// 1. Watch the whole monorepo so changes in packages/* trigger reloads.
config.watchFolders = [monorepoRoot];

// 2. Resolve modules from the app first, then the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Follow workspace symlinks and honour the `exports` map so @medplum/core
//    resolves to its built dist, and keep a single copy of React / React Native.
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
config.resolver.disableHierarchicalLookup = false;

// 4. NativeWind's JSX runtime (react-native-css-interop) is nested under the app's
//    nativewind and can't be resolved by react-native (which lives at the repo root).
//    Alias both to their real locations so `react-native-css-interop/jsx-runtime`
//    resolves from anywhere in the graph.
try {
  const nativewindDir = path.dirname(require.resolve('nativewind/package.json', { paths: [projectRoot] }));
  const cssInteropDir = path.dirname(
    require.resolve('react-native-css-interop/package.json', { paths: [nativewindDir, projectRoot] })
  );
  config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    nativewind: nativewindDir,
    'react-native-css-interop': cssInteropDir,
  };
} catch {
  // NativeWind not installed yet — `npx expo install` first.
}

// 5. Force a SINGLE copy of React across the whole graph. @medplum/react-hooks
//    is a workspace symlink (packages/react-hooks) that carries its own nested
//    node_modules/react + react-dom (19.2.5, from its devDependencies). Metro's
//    hierarchical lookup resolves react from there when bundling react-hooks,
//    so the app's root react (19.1.0, the version react-native 0.81 requires)
//    and react-hooks' 19.2.5 both end up in the bundle → "Invalid hook call"
//    / "Cannot read property 'useState' of null". Redirect every react /
//    react-dom request (incl. subpaths like react/jsx-runtime, react-dom/client)
//    to the one hoisted copy so there is exactly one React instance.
const REACT_SINGLETONS = ['react', 'react-dom'];
const singletonDir = Object.fromEntries(
  REACT_SINGLETONS.map((name) => [
    name,
    path.dirname(require.resolve(`${name}/package.json`, { paths: [projectRoot, monorepoRoot] })),
  ])
);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const name of REACT_SINGLETONS) {
    if (moduleName === name || moduleName.startsWith(`${name}/`)) {
      const subpath = moduleName.slice(name.length); // '' | '/jsx-runtime' | '/client' ...
      // Absolute path won't re-match the guards above, so no recursion.
      return context.resolveRequest(context, singletonDir[name] + subpath, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
