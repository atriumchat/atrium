import { requireOptionalNativeModule } from 'expo-modules-core';

/** SSH for "Your own server" (ios/GomexSshModule.swift, on Citadel). Errors carry a reason code in `message`. */
type GomexSsh = {
  generateKey(): { publicKey: string; privateKey: string };
  randomToken(bytes: number): string;
  /** `hostKey`: the server's key seen before (an OpenSSH line); a different one fails with the code "hostKey". */
  connect(host: string, port: number, user: string, password: string | null, privateKey: string | null, hostKey: string | null): Promise<{ id: string; hostKey: string }>;
  exec(id: string, command: string): Promise<{ code: number; output: string }>;
  close(id: string): Promise<void>;
};

// Not there on the web, where "Your own server" only runs on mocks (src/own/mock.ts).
export const ssh = requireOptionalNativeModule<GomexSsh>('GomexSsh')!;
