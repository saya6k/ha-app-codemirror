import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { hoverTooltip } from '@codemirror/view';

let icons: Record<string, string> | undefined;
let loading: Promise<Record<string, string>> | undefined;
function loadIcons(): Promise<Record<string, string>> {
  return loading ??= import('virtual:mdi-icons').then(module => icons = module.default).catch(error => {
    loading = undefined;
    throw error;
  });
}

function isComment(state: EditorState, pos: number): boolean {
  return state.doc.lineAt(pos).text.trimStart().startsWith('#') ||
    /comment/i.test(syntaxTree(state).resolveInner(pos, -1).name);
}

function iconSvg(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'currentColor');
  svg.append(shape);
  return svg;
}

function preview(name: string, path: string): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'mdi-preview';
  const label = document.createElement('span');
  label.textContent = 'mdi:' + name;
  dom.append(iconSvg(path), label);
  return dom;
}

export async function mdiCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const token = context.matchBefore(/mdi:[a-z0-9-]*/);
  if (!token || isComment(context.state, token.from) ||
      /[\w:-]/.test(context.state.sliceDoc(Math.max(0, token.from - 1), token.from))) return null;
  const query = token.text.slice(4);
  const suffix = context.state.sliceDoc(context.pos, context.state.doc.lineAt(context.pos).to).match(/^[a-z0-9-]*/)!;
  let data: Record<string, string>;
  try { data = await loadIcons(); } catch { return null; }
  if (context.aborted) return null;
  const matches = Object.keys(data).filter(name => name.includes(query)).sort((a, b) =>
    Number(b.startsWith(query)) - Number(a.startsWith(query)) || a.localeCompare(b)).slice(0, 80);
  return {
    from: token.from, to: context.pos + suffix[0].length, filter: false,
    options: matches.map(name => ({
      label: 'mdi:' + name, info: () => preview(name, data[name]),
    })),
  };
}

/** Actual glyphs in the suggestion list also work on touch devices. */
export const mdiOptionPreview = {
  position: 10,
  render(completion: Completion): Node | null {
    const path = completion.label.startsWith('mdi:') ? icons?.[completion.label.slice(4)] : undefined;
    if (!path) return null;
    const svg = iconSvg(path);
    svg.classList.add('mdi-option-icon');
    return svg;
  },
};

export const mdiHover = hoverTooltip(async (view, pos, side) => {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  if (isComment(view.state, pos)) return null;
  for (const match of line.text.matchAll(/mdi:[a-z0-9-]+/g)) {
    const from = line.from + match.index!;
    const to = from + match[0].length;
    if (pos < from || pos > to || (pos === from && side < 0) || (pos === to && side > 0)) continue;
    if (/[\w:-]/.test(line.text.slice(Math.max(0, match.index! - 1), match.index))) continue;
    let data: Record<string, string>;
    try { data = await loadIcons(); } catch { return null; }
    if (view.state.doc !== doc) return null;
    const name = match[0].slice(4);
    if (!Object.prototype.hasOwnProperty.call(data, name)) return null;
    return { pos: from, end: to, above: true, create: () => ({ dom: preview(name, data[name]) }) };
  }
  return null;
}, { hoverTime: 400, hideOnChange: true });
