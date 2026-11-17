import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { langText } from '@/components/submission/status';

import { conditionFields, type RecruitmentDraft } from './types';

const languageOptions = ['zh', 'en', 'ja', 'ko', 'others'] as const;

export function RecruitmentForm({
  onCancel,
  onComplete,
  pending = false,
  error,
}: {
  onCancel: () => void;
  onComplete: (draft: RecruitmentDraft) => void;
  pending?: boolean;
  error?: string;
}) {
  const [announcement, setAnnouncement] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [languageError, setLanguageError] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [endsOn, setEndsOn] = useState('');
  const [targetMembers, setTargetMembers] = useState('');
  const [endError, setEndError] = useState('');
  const [counts, setCounts] = useState<Partial<RecruitmentDraft['conditions']>>({});
  const languageWarning = counts.validSubmissions !== undefined && counts.submissionsPerLanguage !== undefined && counts.submissionsPerLanguage <= counts.validSubmissions;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!endsOn && !targetMembers) {
      setEndError('请填写结束日期或招募人数，至少一项');
      return;
    }
    if (languages.length === 0) {
      setLanguageError(true);
      setLanguageOpen(true);
      return;
    }
    const data = new FormData(event.currentTarget);
    const conditions = Object.fromEntries(
      conditionFields.map(({ key }) => [key, Number(data.get(key))])
    ) as unknown as RecruitmentDraft['conditions'];
    if (conditions.submissionsPerLanguage <= conditions.validSubmissions) {
      toast.warning('单一语种投稿数未大于有效投稿数，将按有效投稿数作为完成标准');
    }
    onComplete({ announcement: announcement.trim(), languages, conditions, endsOn: endsOn || undefined, targetMembers: targetMembers ? Number(targetMembers) : undefined });
  };

  const numericField = (field: (typeof conditionFields)[number]) => (
    <div key={field.key} className="space-y-2">
      <label htmlFor={`recruitment-${field.key}`} className="text-sm font-medium text-foreground">
        {field.label}
      </label>
      <Input
        id={`recruitment-${field.key}`}
        name={field.key}
        type="number"
        min={field.min}
        max={1000000}
        step={1}
        required
        onChange={(event) => setCounts((current) => ({ ...current, [field.key]: event.target.value === '' ? undefined : Number(event.target.value) }))}
      />
    </div>
  );

  return (
    <motion.form
      onSubmit={submit}
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="返回审核招募"
            onClick={onCancel}
          >
            <ArrowLeft />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-foreground">发布招募</h2>
        </div>
        <Button type="submit" disabled={pending}>
          <Check />
          {pending ? '发布中…' : '完成'}
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <motion.section
        variants={fadeUp}
        className="space-y-4 overflow-hidden rounded-lg border border-line bg-card p-5 sm:p-6"
      >
        <label
          htmlFor="recruitment-announcement"
          className="block text-base font-semibold text-foreground"
        >
          公告内容
        </label>
        <Textarea
          id="recruitment-announcement"
          value={announcement}
          onChange={(event) => {
            setAnnouncement(event.target.value);
            event.target.setCustomValidity(event.target.value.trim() ? '' : '请填写公告内容');
          }}
          required
          maxLength={10000}
          className="min-h-64 resize-y leading-relaxed"
        />
      </motion.section>

      <motion.section
        variants={fadeUp}
        className="overflow-hidden rounded-lg border border-line bg-card p-5 sm:p-6"
        aria-labelledby="recruitment-conditions-title"
      >
        <h3
          id="recruitment-conditions-title"
          className="mb-5 text-base font-semibold text-foreground"
        >
          通过条件
        </h3>
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
          {numericField(conditionFields[0])}
          <div className="space-y-2">
            <label htmlFor="recruitment-languages" className="text-sm font-medium text-foreground">
              投稿语言
            </label>
            <Popover open={languageOpen} onOpenChange={setLanguageOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="recruitment-languages"
                  type="button"
                  variant="outline"
                  aria-invalid={languageError || undefined}
                  aria-describedby={languageError ? 'recruitment-language-error' : undefined}
                  className="h-10 w-full justify-between px-3 font-normal text-foreground aria-invalid:border-error"
                >
                  <span className="truncate">
                    {languages.length ? languages.map(langText).join('、') : '选择语言'}
                  </span>
                  <ChevronDown className="text-ink-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <div role="group" aria-label="投稿语言">
                  {languageOptions.map((language) => (
                    <label
                      key={language}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-surface-2"
                    >
                      <Checkbox
                        checked={languages.includes(language)}
                        onCheckedChange={(checked) => {
                          setLanguages((current) =>
                            checked
                              ? [...current, language]
                              : current.filter((item) => item !== language)
                          );
                          setLanguageError(false);
                        }}
                      />
                      {langText(language)}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {languageError && (
              <p id="recruitment-language-error" role="alert" className="text-xs text-error">
                请选择至少一种语言
              </p>
            )}
          </div>
          {conditionFields.slice(1).map(numericField)}
        </div>
      </motion.section>
      {languageWarning && <p role="status" className="text-sm text-amber-600">单一语种投稿数应大于有效投稿数；当前填写仍可发布，将按有效投稿数作为完成标准。</p>}
      <motion.section variants={fadeUp} className="space-y-4 overflow-hidden rounded-lg border border-line bg-card p-5 sm:p-6">
        <h3 className="text-base font-semibold text-foreground">结束条件</h3>
        <p className="text-sm text-ink-3">达到结束日期零时（北京时间）或完成招募的人数目标时，本期招募自动结束。至少填写一项。</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="recruitment-ends-on" className="text-sm font-medium">结束日期</label>
            <Input id="recruitment-ends-on" type="date" value={endsOn} onChange={(event) => { setEndsOn(event.target.value); setEndError(''); }} />
          </div>
          <div className="space-y-2">
            <label htmlFor="recruitment-target-members" className="text-sm font-medium">招募人数</label>
            <Input id="recruitment-target-members" type="number" min={1} max={1000000} step={1} value={targetMembers} onChange={(event) => { setTargetMembers(event.target.value); setEndError(''); }} />
          </div>
        </div>
        {endError && <p role="alert" className="text-sm text-error">{endError}</p>}
      </motion.section>
    </motion.form>
  );
}
