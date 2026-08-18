/**
 * Workspace = multiple NetMapDoc "projects" living side-by-side in the same install.
 * Each project has an id, a name, a doc, and an updatedAt timestamp.
 *
 * Stored under a single localStorage key (or in SQLite via the persistence layer).
 * The "active" project id is tracked separately.
 *
 * Vault, filters and templates are SHARED across projects (they are per-user, not per-site).
 */

import type { NetMapDoc } from './types';

export interface Project {
  id: string;
  name: string;
  doc: NetMapDoc;
  updatedAt: number;
  createdAt: number;
}

export interface Workspace {
  version: 1;
  activeId: string | null;
  projects: Project[];
}

const LS_WORKSPACE = 'netmap:workspace:v1';
const LS_LEGACY_DOC = 'netmap:doc:v2';   // pre-workspace single doc

export function emptyWorkspace(): Workspace {
  return { version: 1, activeId: null, projects: [] };
}

export function loadWorkspace(fallbackSeed: NetMapDoc): Workspace {
  try {
    const raw = localStorage.getItem(LS_WORKSPACE);
    if (raw) {
      const parsed = JSON.parse(raw) as Workspace;
      if (parsed.version === 1 && Array.isArray(parsed.projects) && parsed.projects.length > 0) {
        return parsed;
      }
    }
    // Migrate from legacy single-doc storage: promote it to a project named after the doc
    const legacyRaw = localStorage.getItem(LS_LEGACY_DOC);
    if (legacyRaw) {
      const legacyDoc = JSON.parse(legacyRaw) as NetMapDoc;
      const id = 'p-' + Math.random().toString(36).slice(2, 8);
      const p: Project = {
        id, name: legacyDoc.name || 'Мой проект',
        doc: legacyDoc,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      return { version: 1, activeId: id, projects: [p] };
    }
  } catch {}
  // Fresh install → seed
  const id = 'p-' + Math.random().toString(36).slice(2, 8);
  const p: Project = {
    id, name: fallbackSeed.name || 'Новая схема',
    doc: fallbackSeed,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  return { version: 1, activeId: id, projects: [p] };
}

export function saveWorkspace(ws: Workspace) {
  try { localStorage.setItem(LS_WORKSPACE, JSON.stringify(ws)); } catch {}
}

export function makeProject(name: string, doc: NetMapDoc): Project {
  return {
    id: 'p-' + Math.random().toString(36).slice(2, 8),
    name, doc,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}
