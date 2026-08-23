/**
 * Deprecated: The application now uses V3-DOSSIER ENGINE which returns structured JSON.
 * These utilities are kept for legacy compatibility but are no longer active in the core flow.
 */
import type { BookProposal, Chapter, ChapterSummary } from '../types';

export const extractOutput = (text: string): string => text.trim();

export const parseChapter = (text: string, chapterNumber: number): Chapter | null => {
  return {
    id: `chap-${chapterNumber}`,
    chapter_number: chapterNumber,
    title: `Capítulo ${chapterNumber}`,
    text: text
  };
};