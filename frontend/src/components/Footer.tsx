import { Github } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { usePlayer } from '@/hooks/usePlayer';
import { fadeUp, whileInViewProps } from '@/lib/motion';

const resourceLinks = [
  { label: '音乐解析', to: '/ncm' },
  { label: '排行榜', to: '/ranking' },
  { label: '投稿', to: '/submit' },
];

const ecosystemLinks = [{ label: 'GitHub 仓库', href: 'https://github.com/amll-dev/amll-hub' }];

const techStack = ['React', 'Go', 'Rust'];

export function Footer() {
  const { track } = usePlayer();
  const location = useLocation();
  const bottomPad = track ? 'pb-20' : 'pb-12';
  return (
    <motion.footer
      layout="position"
      layoutDependency={location.pathname}
      transition={{ layout: { duration: 0.4, ease: [0.2, 0.8, 0.2, 1] } }}
      className="mt-20 border-t border-line bg-card"
    >
      <div
        className={`mx-auto max-w-[1200px] px-6 pt-12 transition-[padding-bottom] duration-300 ${bottomPad}`}
      >
        <motion.div
          variants={fadeUp}
          {...whileInViewProps}
          className="grid gap-10 md:grid-cols-[2fr_1fr_1fr_1.5fr]"
        >
          <div>
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="AMLL-Hub" className="h-8 w-8 rounded-md object-contain" />
              <span className="text-lg font-bold">AMLL Hub</span>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                测试版
              </span>
            </div>
            <p className="mt-3 text-sm text-ink-2">与 AMLL 歌词生态协作</p>
            <p className="mt-1 text-xs text-ink-3">测试版本，不代表最终品质</p>
            <p className="mt-4 text-xs text-ink-3">© 2026 AMLL Hub</p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-ink-3">资源</h4>
            <ul className="mt-3 space-y-2">
              {resourceLinks.map((l) => (
                <li key={l.to}>
                  <a
                    href={l.to}
                    className="text-sm text-ink-2 transition-colors hover:text-primary"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-ink-3">生态</h4>
            <ul className="mt-3 space-y-2">
              {ecosystemLinks.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-ink-2 transition-colors hover:text-primary"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-ink-3">技术栈</h4>
            <p className="mt-3 text-sm text-ink-2">{techStack.join(' · ')}</p>
          </div>
        </motion.div>

        <div className="mt-10 flex items-center justify-between border-t border-line pt-6">
          <span className="text-xs text-ink-3">Built with AMLL ecosystem</span>
          <a
            href="https://github.com/amll-dev/amll-hub"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="text-ink-2 transition-colors hover:text-primary"
          >
            <Github className="h-5 w-5" />
          </a>
        </div>
      </div>
    </motion.footer>
  );
}
