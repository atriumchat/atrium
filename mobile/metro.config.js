const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

// In the workspaces (docs/adr/001-client-architecture.md) Expo watches the repo root and resolves hoisted packages
// itself, so the shared packages and the web's dictionaries need nothing here.
const config = getDefaultConfig(__dirname);
// The web build (design work on mocks, e.g. /own?mock=1) has no calls: LiveKit's native module and the Keychain are stubs there.
const stubs = {
  '@livekit/react-native': path.resolve(__dirname, 'web-stubs/livekit-react-native.js'),
  'expo-secure-store': path.resolve(__dirname, 'web-stubs/expo-secure-store.js'),
};
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) =>
  platform === 'web' && stubs[name] ? { type: 'sourceFile', filePath: stubs[name] } : (resolveRequest ?? context.resolveRequest)(context, name, platform);
module.exports = config;
