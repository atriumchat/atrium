import { router } from 'expo-router';
import { haptic } from './haptics';

export const openChat = (id: string) => router.push({ pathname: '/chat/[id]', params: { id } });
export const openRoom = (id: string) => router.push({ pathname: '/room/[id]', params: { id } });
export const openFriends = () => router.push('/friends');
export const openInbox = () => { haptic.soft(); router.push('/inbox'); };
export const openProfile = (id: string) => { haptic.soft(); router.push({ pathname: '/user/[id]', params: { id } }); };
export const openGroupInfo = (id: string) => { haptic.soft(); router.push({ pathname: '/members/[id]', params: { id } }); };
export const openGroupPicker = (dmId?: string) => { haptic.soft(); router.push({ pathname: '/group', params: dmId ? { dmId } : {} }); };
