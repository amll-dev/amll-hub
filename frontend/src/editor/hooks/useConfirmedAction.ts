import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { confirmDialogAtom } from '$/states/dialogs';
import { pushNotificationAtom } from '$/states/notifications';

export type ConfirmedActionOptions = {
  title: string;
  description: string;
  /** 通知来源标签。 */
  source: string;
  /** 成功后的提示；省略则不提示。 */
  successTitle?: string;
  /** 失败提示前缀；省略则沿用抛出的错误信息。 */
  failureTitle?: string;
  run: () => void | Promise<void>;
};

/**
 * 「弹确认框 → 执行 → 成功/失败提示」这套流程在历史记录、删除、恢复等处重复出现，
 * 统一收在这里，调用方只描述文案和要做的事。
 */
export const useConfirmedAction = () => {
  const setConfirmDialog = useSetAtom(confirmDialogAtom);
  const setPushNotification = useSetAtom(pushNotificationAtom);

  return useCallback(
    (options: ConfirmedActionOptions) => {
      setConfirmDialog({
        open: true,
        title: options.title,
        description: options.description,
        onConfirm: async () => {
          try {
            await options.run();
            if (options.successTitle) {
              setPushNotification({
                title: options.successTitle,
                level: 'success',
                source: options.source,
              });
            }
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : '未知错误';
            setPushNotification({
              title: options.failureTitle ? `${options.failureTitle}：${detail}` : detail,
              level: 'error',
              source: options.source,
            });
          }
        },
      });
    },
    [setConfirmDialog, setPushNotification]
  );
};
