export type PinnedBriefSection =
  | 'goal'
  | 'constraints'
  | 'decisions'
  | 'openQuestions'
  | 'doNotTouch';

export interface PinnedBriefItem {
  id: string;
  roomId: string;
  section: PinnedBriefSection;
  content: string;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
