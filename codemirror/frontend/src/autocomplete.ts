/**
 * Simple autocomplete for Home Assistant entities
 * Module-scoped state for entity management
 */

import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Entity } from './api';

// Module-scoped state (private to this module)
let entityIds: string[] = [];
let entityMetadata: Map<string, Entity> = new Map();

/**
 * Initialize entities for autocomplete
 * @param entityList List of entities from Home Assistant API
 */
export function setEntities(entityList: Entity[]): void {
   entityIds = entityList.map(e => e.entity_id);
   entityMetadata = new Map(entityList.map(e => [e.entity_id, e]));
}

/**
 * CodeMirror autocomplete function
 * Provides entity suggestions based on substring matching
 */
export function entityCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\p{L}\p{N}_.]+/u);
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  if (before.trimStart().startsWith('#')) return null;
  let entityValue = /\b(entity_id|entity|entities)\s*:\s*[^#]*$/.test(before);
  // Support block lists beneath entity_id/entities, including an empty list item.
  if (!entityValue && /^\s*-\s*['"]?[\p{L}\p{N}_.]*$/u.test(before)) {
    const indent = before.search(/\S/);
    for (let number = line.number - 1; number > 0; number--) {
      const previous = context.state.doc.line(number).text;
      if (!previous.trim() || previous.trimStart().startsWith('#')) continue;
      if (previous.search(/\S/) < indent || /^\s*(entity_id|entities)\s*:/.test(previous)) {
        entityValue = /^\s*(entity_id|entities)\s*:\s*$/.test(previous);
        break;
      }
    }
  }
  if (!context.explicit && !entityValue && !word?.text.includes('.')) return null;
  const query = word?.text.toLocaleLowerCase() || '';
  const matches = entityIds.filter(id => id.toLowerCase().includes(query) ||
    entityMetadata.get(id)?.friendly_name.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(b.startsWith(query)) - Number(a.startsWith(query)) || a.localeCompare(b))
    .slice(0, 100);
  if (!matches.length) return null;
  return {
    from: word?.from ?? context.pos,
    // We filter friendly names and substrings ourselves; label-only filtering loses matches.
    filter: false,
    options: matches.map(id => {
      const entity = entityMetadata.get(id)!;
      return { label: id, type: 'variable', detail: `${entity.friendly_name} · ${entity.state_translated ?? entity.state}`,
        info: `Domain: ${entity.domain}\nState: ${entity.state_translated ?? entity.state}` };
    }),
  };
}

/**
 * Get the number of loaded entities
 * @returns Number of entities available for autocomplete
 */
export function getEntityCount(): number {
   return entityIds.length;
}

/**
 * Check if an entity ID exists in the cached entities
 * @param entityId The entity ID to check
 * @returns true if the entity exists, false otherwise
 */
export function isValidEntity(entityId: string): boolean {
   return entityMetadata.has(entityId);
}
