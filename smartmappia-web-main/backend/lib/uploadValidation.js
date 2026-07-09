// Shared upload validation for proofs and driver documents (PDF + JPG/PNG only).

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);

const BLOCKED_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.docm',
  '.dot',
  '.dotx',
  '.pub',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.rtf',
  '.odt',
  '.pages',
]);

function fileExtension(name) {
  const i = String(name || '').lastIndexOf('.');
  return i >= 0 ? String(name).slice(i).toLowerCase() : '';
}

function resolveMimeType(fileName, mimeType) {
  const ext = fileExtension(fileName);
  const extMime = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
  }[ext];
  if (mimeType && ALLOWED_MIME_TYPES.includes(mimeType)) return mimeType;
  return extMime || mimeType || null;
}

// Pass { imagesOnly: true } for storefront images (logos / menu photos), which
// must be an actual image — PDFs are rejected there even though they are fine
// for proofs and driver documents.
function validateUploadFile({ fileName, mimeType, imagesOnly = false }) {
  const ext = fileExtension(fileName);
  const allowedMimes = imagesOnly
    ? ALLOWED_MIME_TYPES.filter((m) => m !== 'application/pdf')
    : ALLOWED_MIME_TYPES;
  const allowedExts = imagesOnly
    ? new Set([...ALLOWED_EXTENSIONS].filter((e) => e !== '.pdf'))
    : ALLOWED_EXTENSIONS;
  const rejectMsg = imagesOnly
    ? 'Only JPG and PNG images are accepted.'
    : 'Only PDF, JPG, and PNG files are accepted.';

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: 'Word, Publisher, and other office documents are not accepted. Please upload a PDF, JPG, or PNG.',
    };
  }

  if (ext && !allowedExts.has(ext)) {
    return { ok: false, error: rejectMsg };
  }

  const resolved = resolveMimeType(fileName, mimeType);
  if (!resolved || !allowedMimes.includes(resolved)) {
    return { ok: false, error: rejectMsg };
  }

  return { ok: true, mimeType: resolved };
}

module.exports = {
  ALLOWED_MIME_TYPES,
  validateUploadFile,
};
