import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

/** 生成分页页码 */
function buildPageItems(current: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const start = Math.max(2, Math.min(current - 1, totalPages - 3));
  const end = Math.min(totalPages - 1, Math.max(current + 1, 4));
  const items: (number | 'ellipsis')[] = [1];
  if (start > 2) items.push('ellipsis');
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < totalPages - 1) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

/** 列表通用分页条 */
export function ListPagination({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const go = (p: number) => {
    if (p >= 1 && p <= totalPages && p !== page) onPageChange(p);
  };

  return (
    <Pagination className={cn('pt-4', className)}>
      <PaginationContent>
        <PaginationItem>
          <PaginationLink
            href="#"
            aria-label="上一页"
            onClick={(e) => {
              e.preventDefault();
              go(page - 1);
            }}
            className={page <= 1 ? 'pointer-events-none opacity-40' : ''}
          >
            <ChevronLeft className="h-4 w-4" />
          </PaginationLink>
        </PaginationItem>
        {buildPageItems(page, totalPages).map((p, i) =>
          p === 'ellipsis' ? (
            <PaginationItem key={`ellipsis-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                href="#"
                isActive={p === page}
                onClick={(e) => {
                  e.preventDefault();
                  go(p);
                }}
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationLink
            href="#"
            aria-label="下一页"
            onClick={(e) => {
              e.preventDefault();
              go(page + 1);
            }}
            className={page >= totalPages ? 'pointer-events-none opacity-40' : ''}
          >
            <ChevronRight className="h-4 w-4" />
          </PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
