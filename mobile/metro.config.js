const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The dictionaries and types are shared with the web app.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../web/src')];
// The web build (design work on mocks, e.g. /own?mock=1) has no calls: LiveKit's native module and the Keychain are stubs there.
const stubs = {
  '@livekit/react-native': path.resolve(__dirname, 'web-stubs/livekit-react-native.js'),
  'expo-secure-store': path.resolve(__dirname, 'web-stubs/expo-secure-store.js'),
};
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) =>
  platform === 'web' && stubs[name] ? { type: 'sourceFile', filePath: stubs[name] } : (resolveRequest ?? context.resolveRequest)(context, name, platform);
module.exports = config;
