import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { rightSidebarPanelAtom, rightSidebarWidthAtom } from '$/states/sidebar.ts';
import { ResizableSidebar } from './ResizableSidebar';

const MIN_WIDTH = 220;
export const RightSidebar = () => {
  const { t } = useTranslation();
  const [activePanel] = useAtom(rightSidebarPanelAtom);

  return (
    <ResizableSidebar
      side="right"
      panelAtom={rightSidebarPanelAtom}
      widthAtom={rightSidebarWidthAtom}
      closedPanel="none"
      minWidth={MIN_WIDTH}
      maxWidthRatio={0.4}
      titles={{ annotations: t('sidebar.annotations.title', '批注') }}
    >
      {activePanel === 'annotations' && null}
    </ResizableSidebar>
  );
};

export default RightSidebar;
