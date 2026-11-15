import type { Gender } from '@/lib/types';

/** 性别展示文案（用户主页头部与资料卡共用） */
export const GENDER_LABEL: Record<Gender, string> = {
  male: '男',
  female: '女',
  other: '其他',
  unknown: '保密',
};
