// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MantineColorsTuple } from '@mantine/core';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { App } from './App';

const medplum = new MedplumClient({
  onUnauthenticated: () => (window.location.href = '/'),
  baseUrl: sessionStorage.getItem('medplum_base_url') || import.meta.env.VITE_MEDPLUM_BASE_URL || undefined,
  cacheTime: 60000,
  autoBatchTime: 100,
});

// Premier Health brand palette (from the logo): warm orange / red / gold.
// Mantine needs a 10-shade tuple per color; the brand hex sits at index 6
// (the default primaryShade), lighter tints below it, darker shades above.
const brand: MantineColorsTuple = [
  '#fff5ea',
  '#ffe6cf',
  '#fdcfa3',
  '#fbb673',
  '#f9a04b',
  '#f68a30',
  '#f47b20', // primary — brand orange
  '#d96712',
  '#ad5210',
  '#813d0c',
];

const brandRed: MantineColorsTuple = [
  '#ffe9ec',
  '#ffccd2',
  '#f59aa4',
  '#ee6675',
  '#e73b4e',
  '#e22138',
  '#c8102e', // brand red
  '#a50b26',
  '#82081e',
  '#5f0516',
];

const brandGold: MantineColorsTuple = [
  '#fff9e6',
  '#fff0bf',
  '#ffe08a',
  '#ffd152',
  '#fec42a',
  '#fdbc1a',
  '#fdb913', // brand gold
  '#d99a0a',
  '#a8760a',
  '#7d5807',
];

// Dark surface palette (near-black page background, lighter charcoal cards),
// tuned for the rounded, high-contrast dashboard visual style.
const dark: MantineColorsTuple = [
  '#d6d8dc', // 0 - lightest text
  '#adb0b6', // 1
  '#888c93', // 2
  '#65686f', // 3
  '#46484f', // 4 - borders
  '#313338', // 5 - hover surfaces
  '#232529', // 6 - card surface (elevated)
  '#18191c', // 7 - card surface (base)
  '#101113', // 8
  '#0a0a0b', // 9 - page background
];

const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: 6,
  black: '#0a0a0b',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI Rounded", "Nunito Sans", "Segoe UI", system-ui, sans-serif',
  defaultRadius: 'lg',
  radius: {
    xs: '0.5rem',
    sm: '0.75rem',
    md: '1rem',
    lg: '1.25rem',
    xl: '2rem',
  },
  colors: {
    brand,
    brandRed,
    brandGold,
    dark,
  },
  headings: {
    fontWeight: '700',
    sizes: {
      h1: {
        fontSize: '1.125rem',
        fontWeight: '500',
        lineHeight: '2.0',
      },
    },
  },
  fontSizes: {
    xs: '0.6875rem',
    sm: '0.875rem',
    md: '0.875rem',
    lg: '1.0rem',
    xl: '1.125rem',
  },
  components: {
    Card: {
      defaultProps: {
        radius: 'lg',
      },
    },
    Paper: {
      defaultProps: {
        radius: 'lg',
      },
    },
    Table: {
      defaultProps: {
        // Align dates, dose counts and serial numbers into columns.
        tabularNums: true,
      },
    },
  },
});

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

const navigate = (path: string): Promise<void> => router.navigate(path);

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);
root.render(
  <StrictMode>
    <MedplumProvider medplum={medplum} navigate={navigate}>
      {/* Dark by default; the AppShell user menu offers light/dark/auto. */}
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <Notifications position="bottom-right" />
        <RouterProvider router={router} />
      </MantineProvider>
    </MedplumProvider>
  </StrictMode>
);
