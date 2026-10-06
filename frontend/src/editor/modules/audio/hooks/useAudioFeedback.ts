import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { uid } from 'uid';
import { audioEngineStateAtom, audioErrorAtom } from '$/modules/audio/states/index.ts';
import {
  pushNotificationAtom,
  removeNotificationAtom,
  upsertNotificationAtom,
} from '$/states/notifications';

export const useAudioFeedback = () => {
  const engineState = useAtomValue(audioEngineStateAtom);
  const [errorMsg, setErrorMsg] = useAtom(audioErrorAtom);
  const notificationId = useRef<string | null>(null);
  const { t } = useTranslation();
  const setPushNotification = useSetAtom(pushNotificationAtom);
  const upsertNotification = useSetAtom(upsertNotificationAtom);
  const removeNotification = useSetAtom(removeNotificationAtom);

  useEffect(() => {
    if (engineState === 'loading') {
      if (notificationId.current === null) {
        notificationId.current = uid();
      }
      upsertNotification({
        id: notificationId.current,
        title: t('audio.status.loading', '正在加载音频...'),
        level: 'info',
        source: 'Audio',
      });
      return;
    }

    if (notificationId.current !== null) {
      removeNotification(notificationId.current);
      notificationId.current = null;
    }
  }, [engineState, t, upsertNotification, removeNotification]);

  useEffect(() => {
    if (errorMsg) {
      setPushNotification({
        title: `${t('audio.error.workerError', '处理音频时出错')}: ${errorMsg}`,
        level: 'error',
        source: 'Audio',
      });
      if (notificationId.current !== null) {
        removeNotification(notificationId.current);
        notificationId.current = null;
      }

      setErrorMsg(null);
    }
  }, [errorMsg, setErrorMsg, t, setPushNotification, removeNotification]);
};
