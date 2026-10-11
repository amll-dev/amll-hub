import { useAtomValue } from 'jotai';
import { ArrowUpFromLine, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { draggedCountAtom, isCopyModeAtom } from '$/states/main';
import styles from './DragGhost.module.css';

export const DragGhostRenderer = () => {
  const draggedCount = useAtomValue(draggedCountAtom);
  const isCopyMode = useAtomValue(isCopyModeAtom);

  const [portalContainer, setPortalContainer] = useState<Element | null>(null);

  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  const actionText = isCopyMode ? '复制到' : '移动到';

  if (!portalContainer) return null;

  return createPortal(
    <div className={styles.dragGhost}>
      {isCopyMode ? <Copy size={18} /> : <ArrowUpFromLine size={18} />}

      <span className={styles.actionText}>{actionText}</span>

      {draggedCount > 1 && <span className={styles.countBadge}>{draggedCount}</span>}
    </div>,
    portalContainer
  );
};
