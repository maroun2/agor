/**
 * Hooks for persisting canvas preferences per user:
 * - Favorited worktrees
 * - Expanded/collapsed sessions section per worktree
 * - Collapsed zones (cascades to all worktrees inside)
 */

import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';

// ---- Favorites ----

type FavoritesRecord = Record<string, true>;

export function useFavorites(userId: string | undefined) {
  const key = userId ? `agor:favorites:${userId}` : 'agor:favorites:anon';
  const [favorites, setFavorites] = useLocalStorage<FavoritesRecord>(key, {});

  const toggleFavorite = useCallback(
    (worktreeId: string) => {
      setFavorites((prev) => {
        const next = { ...prev };
        if (next[worktreeId]) {
          delete next[worktreeId];
        } else {
          next[worktreeId] = true;
        }
        return next;
      });
    },
    [setFavorites]
  );

  const isFavorite = useCallback((worktreeId: string) => !!favorites[worktreeId], [favorites]);

  return { isFavorite, toggleFavorite };
}

// ---- Worktree expanded state ----

// undefined = use default; true = expanded; false = collapsed
type ExpandedRecord = Record<string, boolean>;

export function useWorktreeExpanded(userId: string | undefined) {
  const key = userId ? `agor:expanded:${userId}` : 'agor:expanded:anon';
  const [expanded, setExpanded] = useLocalStorage<ExpandedRecord>(key, {});

  const setWorktreeExpanded = useCallback(
    (worktreeId: string, isExpanded: boolean) => {
      setExpanded((prev) => ({ ...prev, [worktreeId]: isExpanded }));
    },
    [setExpanded]
  );

  const getWorktreeExpanded = useCallback(
    (worktreeId: string, defaultValue = true) =>
      expanded[worktreeId] !== undefined ? expanded[worktreeId] : defaultValue,
    [expanded]
  );

  return { getWorktreeExpanded, setWorktreeExpanded };
}

// ---- Collapsed zones ----

type CollapsedZonesRecord = Record<string, true>;

export function useCollapsedZones(userId: string | undefined) {
  const key = userId ? `agor:zones-collapsed:${userId}` : 'agor:zones-collapsed:anon';
  const [collapsedZones, setCollapsedZones] = useLocalStorage<CollapsedZonesRecord>(key, {});

  const toggleZoneCollapsed = useCallback(
    (zoneId: string) => {
      setCollapsedZones((prev) => {
        const next = { ...prev };
        if (next[zoneId]) {
          delete next[zoneId];
        } else {
          next[zoneId] = true;
        }
        return next;
      });
    },
    [setCollapsedZones]
  );

  const isZoneCollapsed = useCallback(
    (zoneId: string) => !!collapsedZones[zoneId],
    [collapsedZones]
  );

  return { isZoneCollapsed, toggleZoneCollapsed };
}
