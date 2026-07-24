import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xbar.ranch',
  appName: 'XBAR',
  webDir: 'dist',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'automatic',
    // Match the app's dark theme so a cold launch never flashes white before
    // the web layer paints. Keep in sync with theme_color in site.webmanifest.
    backgroundColor: '#05070A',
  },
  android: {
    backgroundColor: '#f4f1ec',
  },
  server: process.env.CAP_SERVER_URL
    ? {
        url: process.env.CAP_SERVER_URL,
        cleartext: true,
      }
    : undefined,
};

export default config;
