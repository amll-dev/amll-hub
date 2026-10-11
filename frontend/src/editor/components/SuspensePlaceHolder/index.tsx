import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { type PropsWithChildren, Suspense } from 'react';

export const SuspensePlaceHolder = (props: PropsWithChildren) => {
  return (
    <Suspense
      fallback={
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex h-full w-full min-w-0 flex-col items-center justify-center gap-2"
        >
          <Loader2 className="size-4 animate-spin text-ink-3" />
          <span className="text-xs text-ink-3">面板载入中...</span>
        </motion.div>
      }
    >
      {props.children}
    </Suspense>
  );
};

export default SuspensePlaceHolder;
