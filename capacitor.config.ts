import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.petkol.notes',
  appName: 'פתקול',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
