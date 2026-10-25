import type { Category } from '@kits-eos/shared/src/types/models';

export type HierarchyMode = 'CATEGORIZED' | 'DIRECT';

export interface HierarchyResolution {
  hasCategories: boolean;
  mode: HierarchyMode;
}

/**
 * Determines whether the event follows a categorized hierarchy (Event -> Category -> Sub-Event)
 * or a direct sub-event hierarchy (Event -> Sub-Event) based on database categories data.
 */
export function resolveEventHierarchy(categories: Category[] | null | undefined): HierarchyResolution {
  const hasCategories = Boolean(categories && categories.length > 0);
  return {
    hasCategories,
    mode: hasCategories ? 'CATEGORIZED' : 'DIRECT',
  };
}

/**
 * Derives UI labels and grid columns class based on whether categories are applicable.
 */
export function getHierarchyConfig(hasCategories: boolean) {
  return {
    gridColsClass: hasCategories ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
    eventLabel: '1. Event',
    categoryLabel: hasCategories ? '2. Category' : null,
    subEventLabel: hasCategories ? '3. Sub-Event' : '2. Sub-Event',
  };
}

/**
 * Derives the placeholder text for the Sub-Event dropdown based on hierarchy state.
 */
export function getSubEventSelectPlaceholder(options: {
  isLoadingSubEvents: boolean;
  hasCategories: boolean;
  selectedCategoryId: string;
  selectedEventId: string;
  subEventsCount: number;
}): string {
  const { isLoadingSubEvents, hasCategories, selectedCategoryId, selectedEventId, subEventsCount } = options;

  if (isLoadingSubEvents) {
    return 'Loading sub-events...';
  }
  if (hasCategories && !selectedCategoryId) {
    return '— Select Category First —';
  }
  if (selectedEventId && (!hasCategories || selectedCategoryId) && subEventsCount === 0) {
    return '— No Sub-Events Available —';
  }
  return '— Select Sub-Event —';
}

/**
 * Determines whether the Sub-Event select dropdown should be disabled.
 */
export function isSubEventSelectDisabled(options: {
  selectedEventId: string;
  isLoadingCategories: boolean;
  isLoadingSubEvents: boolean;
  hasCategories: boolean;
  selectedCategoryId: string;
  subEventsCount: number;
}): boolean {
  const {
    selectedEventId,
    isLoadingCategories,
    isLoadingSubEvents,
    hasCategories,
    selectedCategoryId,
    subEventsCount,
  } = options;

  if (!selectedEventId) return true;
  if (isLoadingCategories || isLoadingSubEvents) return true;
  if (hasCategories && !selectedCategoryId) return true;
  if (subEventsCount === 0) return true;
  return false;
}
