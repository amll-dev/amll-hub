import { atom } from 'jotai';
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

export const pushNotificationAtom = atom(
  null,
  (
    _get,
    set,
    input: Omit<AppNotification, 'id' | 'createdAt'> & {
      id?: string;
      createdAt?: string;
    }
  ) => {
    const nextNotification: AppNotification = {
      ...input,
      id: input.id ?? uid(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    set(notificationsAtom, (prev) => [nextNotification, ...prev]);
  }
);

export const upsertNotificationAtom = atom(
  null,
  (get, set, input: Omit<AppNotification, 'createdAt'> & { createdAt?: string }) => {
    const notifications = get(notificationsAtom);
    const existingIndex = notifications.findIndex((notification) => notification.id === input.id);
    const existing = existingIndex >= 0 ? notifications[existingIndex] : null;
    const nextNotification: AppNotification = {
      ...existing,
      ...input,
      createdAt: input.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      set(notificationsAtom, (prev) => {
        const next = [...prev];
        next[existingIndex] = nextNotification;
        return next;
      });
    } else {
      set(notificationsAtom, (prev) => [nextNotification, ...prev]);
    }
  }
);

export const removeNotificationAtom = atom(null, (get, set, id: string) => {
  const notifications = get(notificationsAtom);
  const next = notifications.filter(
    (notification) => notification.id !== id || notification.dismissible === false
  );
  if (next.length !== notifications.length) {
    set(notificationsAtom, next);
  }
});

export const clearNotificationsAtom = atom(null, (_get, set) => {
  set(notificationsAtom, (prev) =>
    prev.filter((notification) => notification.dismissible === false)
  );
});
