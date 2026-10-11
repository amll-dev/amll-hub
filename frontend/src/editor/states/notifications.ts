import { atom } from 'jotai';
import { toast } from 'sonner';
import { uid } from 'uid';

export type NotificationLevel = 'info' | 'warning' | 'error' | 'success';

export type AppNotification = {
  id: string;
  title: string;
  description?: string;
  level: NotificationLevel;
  createdAt: string;
  source?: string;
  pinned?: boolean;
  dismissible?: boolean;
  progress?: {
    value: number | null;
  };
  action?:
    | {
        type: 'open-review-report';
        payload: {
          draftId: string;
        };
      }
    | {
        type: 'open-review-update';
        payload: {
          prNumber: number;
          prTitle: string;
        };
      }
    | {
        type: 'open-url';
        payload: {
          url: string;
        };
      };
};

export const notificationsAtom = atom<AppNotification[]>([]);

/** sonner 的 toast 级别 */
const toSonner = (level: NotificationLevel) => {
  switch (level) {
    case 'success':
      return toast.success;
    case 'error':
      return toast.error;
    case 'warning':
      return toast.warning;
    default:
      return toast.info;
  }
};

const emit = (notification: AppNotification) => {
  const notify = toSonner(notification.level);
  notify(notification.title, {
    id: notification.id,
    description: notification.description,
    duration: notification.pinned ? Number.POSITIVE_INFINITY : undefined,
  });
};

export const pushNotificationAtom = atom(
  null,
  (
    _get,
    _set,
    input: Omit<AppNotification, 'id' | 'createdAt'> & {
      id?: string;
      createdAt?: string;
    }
  ) => {
    emit({
      ...input,
      id: input.id ?? uid(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }
);

export const upsertNotificationAtom = atom(
  null,
  (_get, _set, input: Omit<AppNotification, 'createdAt'> & { createdAt?: string }) => {
    emit({
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }
);

export const removeNotificationAtom = atom(null, (_get, _set, id: string) => {
  toast.dismiss(id);
});

export const clearNotificationsAtom = atom(null, (_get, _set) => {
  toast.dismiss();
});
