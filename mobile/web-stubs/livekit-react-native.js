// The web build is only for design work on screens without calls ("Your own server" on mocks): LiveKit's native
// module has no web side, so it is stubbed out there (metro.config.js).
export const registerGlobals = () => undefined;
export const AudioSession = { configureAudio: async () => undefined, startAudioSession: async () => undefined, stopAudioSession: async () => undefined, setAppleAudioConfiguration: async () => undefined, selectAudioOutput: async () => undefined };
export const AndroidAudioTypePresets = {};
export const VideoTrack = () => null;
