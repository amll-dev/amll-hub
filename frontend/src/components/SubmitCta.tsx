import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Upload } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { buttonTap, whileInViewProps } from '@/lib/motion';

const steps = [
  {
    title: '上传 TTML',
    desc: '提交逐词歌词文件',
    active: true,
  },
  {
    title: '人工审核',
    desc: '人工审核歌词质量',
    active: false,
  },
  {
    title: '入库收录',
    desc: '审核通过后正式收录到词库',
    active: false,
  },
];

export function SubmitCta() {
  const navigate = useNavigate();
  const { user, openLogin } = useAuth();

  // 未登录时先弹登录窗
  const startSubmit = () => {
    if (!user) {
      openLogin('/creator?tab=lyrics');
      return;
    }
    navigate('/creator?tab=lyrics');
  };

  return (
    <motion.section {...whileInViewProps} variants={{ hidden: {}, show: {} }}>
      <div className="overflow-hidden rounded-lg bg-primary-tint">
        <div className="grid gap-8 p-8 md:grid-cols-2 md:p-12">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              社区共建
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">投稿歌词</h2>
            <p className="mt-3 max-w-md text-ink-2">
              贡献你制作的 TTML 逐词歌词，经人工审核后收录到词库。
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <motion.button
                {...buttonTap}
                onClick={startSubmit}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Upload className="h-4 w-4" /> 开始投稿
              </motion.button>
              <Link
                to="/docs"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                查看投稿指南 <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <ol className="relative space-y-6">
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-4">
                {i < steps.length - 1 && (
                  <span className="absolute left-[14px] top-9 h-[calc(100%-12px)] w-px bg-line" />
                )}
                <span
                  className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    s.active
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-line bg-card text-ink-3'
                  }`}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="font-semibold">{s.title}</div>
                  <div className="text-sm text-ink-2">{s.desc}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </motion.section>
  );
}
