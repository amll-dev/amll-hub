import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { staggerContainer, whileInViewProps } from '@/lib/motion';

export function PetitionList() {
  return (
    <motion.section {...whileInViewProps} variants={staggerContainer}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">歌词请愿</h2>
      </div>
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-card py-16 text-center">
        <Plus className="h-8 w-8 text-ink-3" />
        <p className="mt-4 text-lg font-semibold text-foreground">敬请期待</p>
        <p className="mt-1 text-sm text-ink-3">歌词请愿功能正在筹备中</p>
      </div>
    </motion.section>
  );
}
