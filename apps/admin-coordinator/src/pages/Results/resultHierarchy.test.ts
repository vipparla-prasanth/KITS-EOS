import { describe, it, expect } from 'vitest';
import type { Category } from '@kits-eos/shared/src/types/models';
import {
  resolveEventHierarchy,
  getHierarchyConfig,
  getSubEventSelectPlaceholder,
  isSubEventSelectDisabled,
} from './resultHierarchy';

describe('Result Declaration Dynamic Category Selection Hierarchy', () => {
  const dummyCategories: Category[] = [
    {
      id: 'cat-1',
      event_id: 'ev-1',
      name: 'Technical Competitions',
      description: 'Coding and hardware events',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    },
    {
      id: 'cat-2',
      event_id: 'ev-1',
      name: 'Non-Technical Events',
      description: 'Gaming and creative arts',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    },
  ];

  describe('Case 1: Main Event has categories', () => {
    it('resolves hierarchy to CATEGORIZED mode when categories exist', () => {
      const resolution = resolveEventHierarchy(dummyCategories);
      expect(resolution.hasCategories).toBe(true);
      expect(resolution.mode).toBe('CATEGORIZED');
    });

    it('provides 3-step labels and 3-column grid layout for categorized events', () => {
      const config = getHierarchyConfig(true);
      expect(config.gridColsClass).toBe('sm:grid-cols-3');
      expect(config.eventLabel).toBe('1. Event');
      expect(config.categoryLabel).toBe('2. Category');
      expect(config.subEventLabel).toBe('3. Sub-Event');
    });

    it('prompts admin to select category first before enabling sub-event dropdown', () => {
      const placeholder = getSubEventSelectPlaceholder({
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: '',
        selectedEventId: 'ev-1',
        subEventsCount: 0,
      });
      expect(placeholder).toBe('— Select Category First —');

      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: 'ev-1',
        isLoadingCategories: false,
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: '',
        subEventsCount: 0,
      });
      expect(isDisabled).toBe(true);
    });

    it('enables sub-event selector when category is selected and sub-events exist', () => {
      const placeholder = getSubEventSelectPlaceholder({
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: 'cat-1',
        selectedEventId: 'ev-1',
        subEventsCount: 2,
      });
      expect(placeholder).toBe('— Select Sub-Event —');

      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: 'ev-1',
        isLoadingCategories: false,
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: 'cat-1',
        subEventsCount: 2,
      });
      expect(isDisabled).toBe(false);
    });

    it('displays no-sub-events state cleanly if category has 0 sub-events', () => {
      const placeholder = getSubEventSelectPlaceholder({
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: 'cat-1',
        selectedEventId: 'ev-1',
        subEventsCount: 0,
      });
      expect(placeholder).toBe('— No Sub-Events Available —');

      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: 'ev-1',
        isLoadingCategories: false,
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: 'cat-1',
        subEventsCount: 0,
      });
      expect(isDisabled).toBe(true);
    });
  });

  describe('Case 2: Main Event has no categories (Direct Sub-Events)', () => {
    it('resolves hierarchy to DIRECT mode when categories array is empty or null', () => {
      expect(resolveEventHierarchy([]).hasCategories).toBe(false);
      expect(resolveEventHierarchy([]).mode).toBe('DIRECT');

      expect(resolveEventHierarchy(null).hasCategories).toBe(false);
      expect(resolveEventHierarchy(null).mode).toBe('DIRECT');

      expect(resolveEventHierarchy(undefined).hasCategories).toBe(false);
      expect(resolveEventHierarchy(undefined).mode).toBe('DIRECT');
    });

    it('provides 2-step labels, hides category label, and uses 2-column grid layout', () => {
      const config = getHierarchyConfig(false);
      expect(config.gridColsClass).toBe('sm:grid-cols-2');
      expect(config.eventLabel).toBe('1. Event');
      expect(config.categoryLabel).toBeNull();
      expect(config.subEventLabel).toBe('2. Sub-Event');
    });

    it('enables sub-event selector directly without requiring category selection', () => {
      const placeholder = getSubEventSelectPlaceholder({
        isLoadingSubEvents: false,
        hasCategories: false,
        selectedCategoryId: '',
        selectedEventId: 'ev-hackathon',
        subEventsCount: 3,
      });
      expect(placeholder).toBe('— Select Sub-Event —');

      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: 'ev-hackathon',
        isLoadingCategories: false,
        isLoadingSubEvents: false,
        hasCategories: false,
        selectedCategoryId: '',
        subEventsCount: 3,
      });
      expect(isDisabled).toBe(false);
    });

    it('displays no-sub-events state cleanly if uncategorized event has 0 sub-events', () => {
      const placeholder = getSubEventSelectPlaceholder({
        isLoadingSubEvents: false,
        hasCategories: false,
        selectedCategoryId: '',
        selectedEventId: 'ev-empty',
        subEventsCount: 0,
      });
      expect(placeholder).toBe('— No Sub-Events Available —');

      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: 'ev-empty',
        isLoadingCategories: false,
        isLoadingSubEvents: false,
        hasCategories: false,
        selectedCategoryId: '',
        subEventsCount: 0,
      });
      expect(isDisabled).toBe(true);
    });
  });

  describe('Loading and Error Guard States', () => {
    it('disables sub-event select when sub-events are loading', () => {
      const placeholder = getSubEventSelectPlaceholder({
        isLoadingSubEvents: true,
        hasCategories: false,
        selectedCategoryId: '',
        selectedEventId: 'ev-1',
        subEventsCount: 0,
      });
      expect(placeholder).toBe('Loading sub-events...');

      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: 'ev-1',
        isLoadingCategories: false,
        isLoadingSubEvents: true,
        hasCategories: false,
        selectedCategoryId: '',
        subEventsCount: 2,
      });
      expect(isDisabled).toBe(true);
    });

    it('disables sub-event select when categories are loading', () => {
      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: 'ev-1',
        isLoadingCategories: true,
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: '',
        subEventsCount: 0,
      });
      expect(isDisabled).toBe(true);
    });

    it('disables sub-event select when no event is selected', () => {
      const isDisabled = isSubEventSelectDisabled({
        selectedEventId: '',
        isLoadingCategories: false,
        isLoadingSubEvents: false,
        hasCategories: true,
        selectedCategoryId: '',
        subEventsCount: 0,
      });
      expect(isDisabled).toBe(true);
    });
  });
});
