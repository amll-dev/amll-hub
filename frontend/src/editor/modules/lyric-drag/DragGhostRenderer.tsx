import { ArrowExportRegular, CopyRegular } from '@fluentui/react-icons';
import { useAtomValue } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { draggedCountAtom, isCopyModeAtom } from '$/states/main';
import styles from './DragGhost.module.css';

export const DragGhostRenderer = () => {
  const { t } = useTranslation();

  const draggedCount = useAtomValue(draggedCountAtom);
  const isCopyMode = useAtomValue(isCopyModeAtom);

  const [portalContainer, setPortalContainer] = useState<Element | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (anchorRef.current) {
      const themeContainer = anchorRef.current.closest('.radix-themes');
      setPortalContainer(themeContainer || document.body);
    }
  }, []);

  const actionText = isCopyMode ? t('common.copyTo', '复制到') : t('common.moveTo', '移动到');

  if (!portalContainer) {
    return <span ref={anchorRef} style={{ display: 'none' }} aria-hidden="true" />;
  }

  return (
    <>
      <span ref={anchorRef} style={{ display: 'none' }} aria-hidden="true" />

      {createPortal(
        <div className={styles.dragGhost}>
          {isCopyMode ? <CopyRegular fontSize={18} /> : <ArrowExportRegular fontSize={18} />}

          <span className={styles.actionText}>{actionText}</span>

          {draggedCount > 1 && <span className={styles.countBadge}>{draggedCount}</span>}
        </div>,
        portalContainer
      )}
    </>
  );
};
