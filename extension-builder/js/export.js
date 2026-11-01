/**
 * Extension Builder - Export / import.
 * Output is a plain Studio/Extension/*.js file. A base64 model comment is embedded so the file can be re-imported.
 */
(function (global) {
  'use strict';

  const Model = global.OFTBuilderModel;
  const Codegen = global.OFTBuilderCodegen;

  function fileName() { return (Model.data.meta.id || 'extension') + '.js'; }

  /** Validate with the same rules the editor uses for imported extensions. */
  function validate(code) {
    if (global.CardBuilder && typeof global.CardBuilder.validateExtensionJS === 'function') {
      const r = global.CardBuilder.validateExtensionJS(code);
      if (r.valid) return { valid: true };
      // CardBuilder messages are Indonesian; the builder UI is English.
      const error = /interaktif/.test(r.error) ? 'Add at least one interactive component (button, slider, switch…) before exporting.'
        : /fungsi aksi/.test(r.error) ? 'Add logic: a component needs an onClick / onChange handler.'
        : /sintaks/i.test(r.error) ? r.error.replace(/^.*pada file \.js:\s*/, 'Syntax error: ')
        : r.error;
      return { valid: false, error };
    }
    return { valid: true };
  }

  function download() {
    const code = Codegen.generate(Model.data);
    const blob = new Blob([code], { type: 'text/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return validate(code);
  }

  async function copy() {
    const code = Codegen.generate(Model.data);
    try { await navigator.clipboard.writeText(code); return true; }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      return !!ok;
    }
  }

  function importFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.onload = () => {
        const data = Codegen.extractModel(String(reader.result));
        if (!data) return reject(new Error('This file was not created by Extension Builder (no model data found).'));
        Model.load(data);
        resolve(data);
      };
      reader.readAsText(file);
    });
  }

  global.OFTBuilderExport = { download, copy, importFile, validate, fileName };
})(window);
