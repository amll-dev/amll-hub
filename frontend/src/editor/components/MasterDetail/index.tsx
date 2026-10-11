import { FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import styles from './index.module.css';

/**
 * 「左侧列表 + 右侧详情」历史浏览骨架。
 * 项目自动保存历史与审阅历史共用，避免两套同形状的内联样式各自漂移。
 */
export const MasterDetailLayout = ({
  master,
  detail,
}: {
  master: ReactNode;
  detail: ReactNode;
}) => (
  <div className={`flex flex-1 ${styles.layout}`}>
    {master}
    <div className={`flex-1 ${styles.detail}`}>{detail}</div>
  </div>
);

export const MasterColumn = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <div className={`flex flex-col ${styles.master}`}>
    <div className={`flex items-center justify-between p-4 ${styles.masterHeader}`}>
      <div className="text-base font-medium">{title}</div>
    </div>
    <div className={`flex-1 ${styles.masterBody}`}>
      <ScrollArea className="h-full">
        <div className="flex flex-col">{children}</div>
      </ScrollArea>
    </div>
  </div>
);

export const MasterListItem = ({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) => (
  <div
    className={styles.masterItem}
    data-selected={selected}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect();
      }
    }}
    role="button"
    tabIndex={0}
  >
    {children}
  </div>
);

export const MasterListEmpty = ({ children }: { children: ReactNode }) => (
  <div className="p-4">
    <p className="text-center text-sm text-ink-3">{children}</p>
  </div>
);

export const DetailPlaceholder = ({ children }: { children: ReactNode }) => (
  <div className={`flex flex-col items-center justify-center ${styles.placeholder}`}>
    <FileText size={48} strokeWidth={1.5} />
    <p className="mt-2">{children}</p>
  </div>
);
