import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PushDriver } from './push';

// The real phone. Only used on a device; a browser has no reminder.
export const expoPushDriver: PushDriver = {
  platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null,
  async permission() {
    return (await Notifications.getPermissionsAsync()).status;
  },
  async ask() {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Axiom', importance: Notifications.AndroidImportance.DEFAULT });
    }
    return (await Notifications.requestPermissionsAsync()).status === 'granted' ? 'granted' : 'denied';
  },
  async token() {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  },
};
