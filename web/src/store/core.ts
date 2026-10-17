import { create } from 'zustand';
import { toast } from '@heroui/react';
import { shellSlice, type ShellSlice } from './shell';
import { accountSlice, type AccountSlice } from './account';
import { peopleSlice, type PeopleSlice } from './people';
import { chatSlice, trimLeftConversation, type ChatSlice } from './chat';
import { voiceSlice, type VoiceSlice } from './voice';

/*
 * One store, one slice per domain. The slices import `set`/`get` from here while this file takes their starting
 * state, so the imports go both ways: a slice file must not touch the store while it loads, only inside functions.
 */
export type State = ShellSlice & AccountSlice & PeopleSlice & ChatSlice & VoiceSlice;

export const useStore = create<State>(() => ({
  ...shellSlice(),
  ...accountSlice(),
  ...peopleSlice(),
  ...chatSlice(),
  ...voiceSlice(),
}));

export function set(partial: Partial<State> | ((state: State) => Partial<State>)) {
  useStore.setState(partial);
}

export function get(): State {
  return useStore.getState();
}

export function showError(message: string) {
  toast.danger(message);
}

useStore.subscribe(trimLeftConversation);

// Local development only: lets the browser console poke the state (e.g. fake who is talking).
if (import.meta.env.DEV) (window as unknown as { __gomex: typeof useStore }).__gomex = useStore;
