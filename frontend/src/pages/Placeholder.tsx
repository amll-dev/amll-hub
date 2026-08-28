import { Link } from 'react-router-dom';

/** 占位页面 */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-32 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mt-4 text-ink-2">即将上线</p>
      <Link to="/" className="mt-8 inline-block text-primary hover:underline">
        返回首页
      </Link>
    </div>
  );
}
