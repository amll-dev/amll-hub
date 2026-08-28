import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutGroup } from 'framer-motion';
import { useSearch } from '@/hooks/useSearch';
import { SearchContext } from '@/hooks/useSearchContext';

export function SearchProvider({ children }: { children: ReactNode }) {
  const search = useSearch();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 标记是否刚从搜索模式退出
  const wasSearching = useRef(false);

  // 让 SearchBar 注册 input 元素，退出搜索后调用 focusInput 恢复焦点
  const registerInput = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
  }, []);

  // 监听 query 变化：在非首页输入搜索词时，导航回首页展示结果
  const prevQuery = useRef('');
  useEffect(() => {
    const trimmed = search.query.trim();
    if (trimmed && trimmed !== prevQuery.current && location.pathname !== '/') {
      navigate('/');
    }
    prevQuery.current = trimmed;
  }, [search.query, location.pathname, navigate]);

  // 监听 hasQuery 变化：退出搜索时恢复焦点
  useEffect(() => {
    if (search.hasQuery) {
      wasSearching.current = true;
    } else if (wasSearching.current) {
      wasSearching.current = false;
      // 用 requestAnimationFrame 轮询等待 input 可用
      let attempts = 0;
      const tryFocus = () => {
        if (inputRef.current) {
          inputRef.current.focus();
          const len = inputRef.current.value.length;
          inputRef.current.setSelectionRange(len, len);
        } else if (attempts < 30) {
          // 最多尝试 30 帧（约 500ms）
          attempts++;
          requestAnimationFrame(tryFocus);
        }
      };
      // 等待 Home exit 完成 + Hero SearchBar 挂载
      setTimeout(tryFocus, 450);
    }
  }, [search.hasQuery]);

  // 提交搜索
  const submit = useCallback(() => {
    if (location.pathname !== '/') navigate('/');
    search.submit();
  }, [location.pathname, navigate, search.submit]);

  // 把 registerInput 和 inputRef 暴露给需要聚焦恢复的组件
  return (
    <SearchContext.Provider value={{ ...search, submit, inputRef, registerInput }}>
      {/* LayoutGroup 让 Header/Hero 中的 layoutId="searchbar" 共享同一布局上下文，
          确保 framer-motion 能稳定捕获位置做共享布局过渡 */}
      <LayoutGroup id="search-layout">{children}</LayoutGroup>
    </SearchContext.Provider>
  );
}
