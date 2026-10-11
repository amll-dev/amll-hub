/**
 * @description 拖拽文件到应用上方时显示的遮罩层
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useAtomValue } from 'jotai';
import { Upload } from 'lucide-react';
import { isGlobalFileDraggingAtom } from '$/states/main';

export const GlobalDragOverlay = () => {
  const isDragging = useAtomValue(isGlobalFileDraggingAtom);

  return (
    <AnimatePresence>
      {isDragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
          }}
        >
          <div
            className="flex h-full w-full flex-col items-center justify-center"
            style={{ background: 'rgba(0, 0, 0, 0.6)' }}
          >
            <Upload size={64} color="white" />
            <span className="mt-5 text-4xl font-bold text-white">拖放到此处以加载</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
