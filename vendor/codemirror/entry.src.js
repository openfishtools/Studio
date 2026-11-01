import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';

// Theme uses OpenFishTools CSS variables, so it follows [data-theme] automatically.
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text-primary, #eee)', backgroundColor: 'var(--bg-panel-inner, #192014)', fontSize: '13px' },
  '.cm-content': { caretColor: 'var(--color-primary, #aef380)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '.cm-gutters': { backgroundColor: 'var(--bg-dashboard, #192014)', color: 'var(--text-secondary, #8a9a7a)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-panel-hover, #2b3723)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-panel-hover, #2b3723)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--color-primary, #aef380)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--bg-panel-active, #3a4a2d) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-panel, #222b1b)', border: '1px solid var(--border-color, #3a4a2d)', color: 'var(--text-primary, #eee)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--color-primary, #aef380)', color: 'var(--bg-canvas, #12170e)' },
  '.cm-completionDetail': { opacity: '0.7', marginLeft: '8px' },
  '.cm-scroller': { overflow: 'auto' }
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--color-primary, #aef380)' },
  { tag: [t.string, t.special(t.string)], color: '#f6c177' },
  { tag: [t.number, t.bool, t.null], color: '#c4a7e7' },
  { tag: t.comment, color: 'var(--text-secondary, #8a9a7a)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.propertyName], color: '#9ccfd8' },
  { tag: t.definition(t.variableName), color: '#ebbcba' }
]);

function syntaxLint(view) {
  const code = view.state.doc.toString();
  try { new Function(code); return []; }
  catch (e) {
    // Only syntax errors are reported; position is unknown so mark line 1 of the doc.
    return [{ from: 0, to: Math.min(code.length, 1), severity: 'error', message: e.message }];
  }
}

function createEditor(parent, opts = {}) {
  const completions = opts.completions || [];
  const complete = (ctx) => {
    const word = ctx.matchBefore(/[\w.$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return { from: word.from, options: completions, validFor: /^[\w.$]*$/ };
  };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc || '',
      extensions: [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
        javascript(), theme, syntaxHighlighting(highlight),
        autocompletion({ override: [complete] }),
        linter(syntaxLint, { delay: 400 }), lintGutter(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of(u => { if (u.docChanged && opts.onChange) opts.onChange(u.state.doc.toString()); })
      ]
    })
  });
  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(v) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } }); },
    insert(text) { const s = view.state.selection.main; view.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length } }); view.focus(); },
    focus: () => view.focus(),
    destroy: () => view.destroy()
  };
}

window.OFTCodeMirror = { createEditor };
