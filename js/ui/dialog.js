// Fenêtre de confirmation intégrée à la page (confirm() est bloqué dans certains cadres).
import { escapeHtml } from '../util.js';

export function confirmDialog({ title, message = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'dialog-overlay';
    ov.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-msg">
        <h2 id="dialog-title">${escapeHtml(title)}</h2>
        ${message ? `<p id="dialog-msg" class="muted">${escapeHtml(message)}</p>` : ''}
        <div class="dialog-actions">
          <button class="btn btn-ghost" type="button" data-choice="no">${escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-choice="yes">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice]');
      if (b) close(b.dataset.choice === 'yes');
      else if (e.target === ov) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    ov.querySelector('[data-choice="no"]').focus();
  });
}
