// The web build is for design work only: the Keychain is the tab's memory there, gone on reload (metro.config.js).
const memory = new Map();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 0;
export const getItemAsync = async (key) => memory.get(key) ?? null;
export const setItemAsync = async (key, value) => void memory.set(key, value);
export const deleteItemAsync = async (key) => void memory.delete(key);
