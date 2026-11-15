import { splitValidationText } from '@/lib/validation';

/** 校验错误列表：把后端返回的「[查看文档](...)」渲染为可点击链接 */
export function ValidationErrors({ errors }: { errors: string[] }) {
  return (
    <>
      {errors.map((err, i) => (
        <p key={i} className="text-xs">
          •{' '}
          {splitValidationText(err).map((part, j) =>
            typeof part === 'string' ? (
              <span key={j}>{part}</span>
            ) : (
              <a
                key={j}
                href={part.href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                {part.label}
              </a>
            )
          )}
        </p>
      ))}
    </>
  );
}
