import { useParams } from 'react-router-dom';
import { LyricViewer } from '@/components/LyricViewer';
import { ViewLyricShell } from '@/components/ViewLyricShell';

export function ViewLyricPage() {
  const { filename } = useParams<{ filename: string }>();

  return (
    <ViewLyricShell
      error={
        filename ? undefined : { title: '缺少文件参数', description: '请提供要查看的歌词文件' }
      }
      backTo="/"
      backLabel="返回搜索"
    >
      {filename && (
        <LyricViewer filename={filename} showHeader showActions rawLyricFile={filename} />
      )}
    </ViewLyricShell>
  );
}
