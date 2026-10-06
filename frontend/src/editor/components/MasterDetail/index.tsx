import { DocumentRegular } from '@fluentui/react-icons';
import { Box, Flex, Heading, ScrollArea, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import styles from './index.module.css';

/**
 * 「左侧列表 + 右侧详情」历史浏览骨架。
 * 项目自动保存历史与审阅历史共用，避免两套同形状的内联样式各自漂移。
 */
export const MasterDetailLayout = ({
  master,
  detail,
}: {
  master: ReactNode;
  detail: ReactNode;
}) => (
  <Flex flexGrow="1" className={styles.layout}>
    {master}
    <Box flexGrow="1" className={styles.detail}>
      {detail}
    </Box>
  </Flex>
);

export const MasterColumn = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <Flex direction="column" className={styles.master}>
    <Flex p="4" align="center" justify="between" className={styles.masterHeader}>
      <Heading size="3">{title}</Heading>
    </Flex>
    <Box flexGrow="1" className={styles.masterBody}>
      <ScrollArea type="auto" scrollbars="vertical" style={{ height: '100%' }}>
        <Flex direction="column">{children}</Flex>
      </ScrollArea>
    </Box>
  </Flex>
);

export const MasterListItem = ({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) => (
  <Box
    className={styles.masterItem}
    data-selected={selected}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect();
      }
    }}
    role="button"
    tabIndex={0}
  >
    {children}
  </Box>
);

export const MasterListEmpty = ({ children }: { children: ReactNode }) => (
  <Box p="4">
    <Text size="2" color="gray" align="center">
      {children}
    </Text>
  </Box>
);

export const DetailPlaceholder = ({ children }: { children: ReactNode }) => (
  <Flex align="center" justify="center" direction="column" className={styles.placeholder}>
    <DocumentRegular fontSize={48} />
    <Text mt="2">{children}</Text>
  </Flex>
);
