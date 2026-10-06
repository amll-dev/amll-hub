import { Delete20Regular, Edit20Regular, LightbulbCheckmark20Regular } from '@fluentui/react-icons';
import { Box, Button, Flex, Text, TextArea, TextField } from '@radix-ui/themes';
import { openDB } from 'idb';
import { useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { uid } from 'uid';
import { pushNotificationAtom } from '$/states/notifications';

const TEMPLATE_DB_NAME = 'review-template-db';
const TEMPLATE_STORE = 'templates';
const TEMPLATE_KEY = 'custom';

type ReviewTemplate = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
};

type TemplateRecord = {
  key: string;
  items: ReviewTemplate[];
  updatedAt: string;
};

const presetTemplates: ReviewTemplate[] = [
  {
    id: 'preset-first-pass',
    title: '✅完美通过（首次投稿）',
    content:
      '恭喜你，人工审核通过，你的贡献将会被更多人看到。感谢你对本项目的支持。欢迎下次投稿！\nCongratulations, you are passed manual review, your contribute will be seen by others. Thanks for your support to our project. You are welcome to post next time!\n\n_推荐使用 [AMLL Player](https://github.com/amll-dev/applemusic-like-lyrics/actions/workflows/build-player.yaml) 以获得更好的体验_\n_To get a better experience, we are recommend to use [AMLL Player](https://github.com/amll-dev/applemusic-like-lyrics/actions/workflows/build-player.yaml)._ \n\n_[Chinese Only] 欢迎加入我们的QQ群 719423243 和开发者一起玩哦！_\n_[Chinese Only] 如果你在群里可以在群名片附上你的 ID 以停止接收这条小广告~_',
    createdAt: 'preset',
  },
  {
    id: 'preset-pass',
    title: '✅完美通过',
    content: '恭喜你，人工审核通过，你的贡献会被更多人看到。感谢你对本项目的支持。欢迎下次投稿！',
    createdAt: 'preset',
  },
  {
    id: 'preset-update',
    title: '⚠️需要修改',
    content:
      '感谢你的慷慨贡献，但是很遗憾，本次人工审核你没有成功通过。建议参考以下内容修改并更新歌词，期待你更高质量的投稿！\n以下为这份歌词存在的问题：',
    createdAt: 'preset',
  },
];

const templateDbPromise = openDB(TEMPLATE_DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(TEMPLATE_STORE)) {
      db.createObjectStore(TEMPLATE_STORE, { keyPath: 'key' });
    }
  },
});

const readCustomTemplates = async () => {
  try {
    const db = await templateDbPromise;
    const record = (await db.get(TEMPLATE_STORE, TEMPLATE_KEY)) as TemplateRecord | undefined;
    return record?.items ?? [];
  } catch {
    return [];
  }
};

const writeCustomTemplates = async (items: ReviewTemplate[]) => {
  const db = await templateDbPromise;
  await db.put(TEMPLATE_STORE, {
    key: TEMPLATE_KEY,
    items,
    updatedAt: new Date().toISOString(),
  } satisfies TemplateRecord);
};

export type ReviewTemplateSectionProps = {
  open: boolean;
  onInsertTemplate: (content: string) => void;
};

export const ReviewTemplateSection = ({ open, onInsertTemplate }: ReviewTemplateSectionProps) => {
  const setPushNotification = useSetAtom(pushNotificationAtom);
  const [customTemplates, setCustomTemplates] = useState<ReviewTemplate[]>([]);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateContent, setTemplateContent] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setShowTemplateEditor(false);
      return;
    }
    setShowTemplateEditor(false);
    setTemplateTitle('');
    setTemplateContent('');
    setEditingTemplateId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTemplateLoading(true);
    readCustomTemplates()
      .then((items) => {
        if (!cancelled) {
          setCustomTemplates(items);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTemplateLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const resetEditor = () => {
    setTemplateTitle('');
    setTemplateContent('');
    setEditingTemplateId(null);
    setShowTemplateEditor(false);
  };

  const handleSaveTemplate = async () => {
    if (templateSaving) return;
    const trimmedTitle = templateTitle.trim();
    const trimmedContent = templateContent.trim();
    if (!trimmedTitle || !trimmedContent) {
      setPushNotification({
        title: '请填写模板标题与内容',
        level: 'warning',
        source: 'Review',
      });
      return;
    }
    setTemplateSaving(true);
    try {
      const nextTemplates = [
        ...customTemplates,
        {
          id: uid(),
          title: trimmedTitle,
          content: trimmedContent,
          createdAt: new Date().toISOString(),
        },
      ];
      setCustomTemplates(nextTemplates);
      await writeCustomTemplates(nextTemplates);
      setTemplateTitle('');
      setTemplateContent('');
      setPushNotification({
        title: '已保存自定义模板',
        level: 'success',
        source: 'Review',
      });
    } catch {
      setPushNotification({
        title: '保存模板失败',
        level: 'error',
        source: 'Review',
      });
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    const nextTemplates = customTemplates.filter((t) => t.id !== templateId);
    setCustomTemplates(nextTemplates);
    await writeCustomTemplates(nextTemplates);
    setPushNotification({
      title: '已删除模板',
      level: 'success',
      source: 'Review',
    });
  };

  const handleStartEdit = (template: ReviewTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateContent(template.content);
    setShowTemplateEditor(true);
  };

  const handleUpdateTemplate = async () => {
    if (templateSaving || !editingTemplateId) return;
    const trimmedTitle = templateTitle.trim();
    const trimmedContent = templateContent.trim();
    if (!trimmedTitle || !trimmedContent) {
      setPushNotification({
        title: '请填写模板标题与内容',
        level: 'warning',
        source: 'Review',
      });
      return;
    }
    setTemplateSaving(true);
    try {
      const nextTemplates = customTemplates.map((t) =>
        t.id === editingTemplateId ? { ...t, title: trimmedTitle, content: trimmedContent } : t
      );
      setCustomTemplates(nextTemplates);
      await writeCustomTemplates(nextTemplates);
      resetEditor();
      setPushNotification({
        title: '已更新模板',
        level: 'success',
        source: 'Review',
      });
    } catch {
      setPushNotification({
        title: '更新模板失败',
        level: 'error',
        source: 'Review',
      });
    } finally {
      setTemplateSaving(false);
    }
  };

  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">
        模板
      </Text>
      <Flex wrap="wrap" gap="2">
        {[...presetTemplates, ...customTemplates].map((template) => {
          const isCustom = !template.id.startsWith('preset-');
          return (
            <Button
              key={template.id}
              size="1"
              variant="soft"
              onClick={() => onInsertTemplate(template.content)}
            >
              <Flex align="center" gap="2">
                <LightbulbCheckmark20Regular />
                <Text size="1">{template.title}</Text>
                {isCustom && (
                  <>
                    <Box
                      as="span"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleStartEdit(template);
                      }}
                      style={{ cursor: 'pointer', marginLeft: '4px' }}
                      title="编辑模板"
                    >
                      <Edit20Regular style={{ width: '14px', height: '14px' }} />
                    </Box>
                    <Box
                      as="span"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteTemplate(template.id);
                      }}
                      style={{ cursor: 'pointer', marginLeft: '4px' }}
                      title="删除模板"
                    >
                      <Delete20Regular style={{ width: '14px', height: '14px' }} />
                    </Box>
                  </>
                )}
              </Flex>
            </Button>
          );
        })}
        {templateLoading && (
          <Text size="1" color="gray">
            正在加载模板...
          </Text>
        )}
      </Flex>
      {showTemplateEditor ? (
        <Flex direction="column" gap="2">
          <TextField.Root
            value={templateTitle}
            onChange={(event) => setTemplateTitle(event.currentTarget.value)}
            placeholder="模板标题"
          />
          <TextArea
            value={templateContent}
            onChange={(event) => setTemplateContent(event.currentTarget.value)}
            placeholder="模板内容"
            style={{ minHeight: '120px' }}
          />
          <Flex justify="end" gap="2">
            <Button
              size="2"
              variant="soft"
              color="gray"
              onClick={resetEditor}
              disabled={templateSaving}
            >
              取消
            </Button>
            <Button
              size="2"
              variant="soft"
              onClick={editingTemplateId ? handleUpdateTemplate : handleSaveTemplate}
              disabled={templateSaving}
            >
              {editingTemplateId ? '更新模板' : '保存模板'}
            </Button>
          </Flex>
        </Flex>
      ) : (
        <Flex justify="end">
          <Button size="1" variant="soft" onClick={() => setShowTemplateEditor(true)}>
            新增自定义模板
          </Button>
        </Flex>
      )}
    </Flex>
  );
};
