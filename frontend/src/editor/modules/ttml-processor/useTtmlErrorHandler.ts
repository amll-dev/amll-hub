import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import type { JsError } from '$/modules/ttml-processor/types';
import { ttmlErrorDialogAtom } from '$/states/dialogs.ts';
import { Logger } from '$/utils/logger';

export const useTtmlErrorHandler = () => {
  const setTtmlErrorDialog = useSetAtom(ttmlErrorDialogAtom);

  const handleTtmlError = useCallback(
    (error: JsError, contextInfo = 'Failed to process TTML', rawText?: string) => {
      Logger.warn('TTML Error Handler', contextInfo, error);
      setTtmlErrorDialog({ error, rawText });
    },
    [setTtmlErrorDialog]
  );

  return handleTtmlError;
};
