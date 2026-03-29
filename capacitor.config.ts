import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xbar.ranch',
  appName: 'XBAR',
  webDir: 'dist',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'automatic',
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
