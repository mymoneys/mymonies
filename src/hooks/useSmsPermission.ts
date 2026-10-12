import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

// Deliberately using React Native's built-in PermissionsAndroid instead of
// expo-permissions (deprecated/removed from the Expo SDK years ago) or
// react-native-permissions (an extra native dependency we don't need — RN core
// already ships everything required for a single runtime permission request).

export type SmsPermissionStatus = 'unknown' | 'granted' | 'denied' | 'blocked' | 'unsupported';

export function useSmsPermission() {
  const [status, setStatus] = useState<SmsPermissionStatus>(
    Platform.OS === 'android' ? 'unknown' : 'unsupported'
  );

  const check = useCallback(async (): Promise<SmsPermissionStatus> => {
    if (Platform.OS !== 'android') {
      setStatus('unsupported');
      return 'unsupported';
    }

    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    const next: SmsPermissionStatus = granted ? 'granted' : 'unknown';
    setStatus(next);
    return next;
  }, []);

  const request = useCallback(async (): Promise<SmsPermissionStatus> => {
    if (Platform.OS !== 'android') {
      setStatus('unsupported');
      return 'unsupported';
    }

    // RECEIVE_SMS is requested alongside READ_SMS so it's available for a future
    // real-time SmsReceiver; this phase only wires up READ_SMS for backfill.
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);

    const readResult = results[PermissionsAndroid.PERMISSIONS.READ_SMS];
    let next: SmsPermissionStatus;
    if (readResult === PermissionsAndroid.RESULTS.GRANTED) {
      next = 'granted';
    } else if (readResult === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      next = 'blocked';
    } else {
      next = 'denied';
    }

    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { status, request, check };
}
