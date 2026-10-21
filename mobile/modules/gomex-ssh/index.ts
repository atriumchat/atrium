import { requireOptionalNativeModule } from 'expo-modules-core';

/** SSH for "Your own server" (ios/GomexSshModule.swift, on Citadel). Errors carry a reason code in `message`. */
type GomexSsh = {
  generateKey(): { publicKey: string; privateKey: string };
  randomToken(bytes: number): string;
  connect(host: string, port: number, user: string, password: string | null, privateKey: string | null): Promise<string>;
  exec(id: string, command: string): Promise<{ code: number; output: string }>;
  close(id: string): Promise<void>;
};

// Not there on the web, where "Your own server" only runs on mocks (src/own/mock.ts).
export const ssh = requireOptionalNativeModule<GomexSsh>('GomexSsh')!;
