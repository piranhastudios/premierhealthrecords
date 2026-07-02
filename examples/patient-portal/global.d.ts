// React 19's types moved `JSX` under the `React` namespace and no longer publish a
// global `JSX` namespace. Our components annotate returns as `JSX.Element`, so we
// re-expose that single alias globally. (Scoped to just `Element` to avoid clashing
// with react-native / nativewind JSX augmentations.)
import type * as React from 'react';

declare global {
  namespace JSX {
    type Element = React.JSX.Element;
  }
}
