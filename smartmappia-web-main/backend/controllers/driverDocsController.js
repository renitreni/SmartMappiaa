// ---------------------------------------------------------------------
// Driver verification documents controller (driver-facing).
//   - createDocUploadUrl : POST /api/driver/documents/signed-url
//   - recordDriverDocument: POST /api/driver/documents
//   - listMyDocuments    : GET  /api/driver/documents
//
// Mirrors the payment-proof flow: the browser uploads straight to a PRIVATE
// Supabase Storage bucket (`driver-docs`) via a short-lived signed URL, then
// POSTs the path here. Files never pass through this server.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { config } = require('../lib/config');
const { buildDriverDocPath, createDriverDocUploadUrl } = require('../lib/storage');

// --- POST /api/driver/documents/signed-url ---------------------------
async function createDocUploadUrl(req, res) {
  try {
    const { doc_type, file_name, mime_type } = req.body || {};
    if (!config.driverDocs.allTypes.includes(doc_type)) {
      return res.status(400).json({
        error: `doc_type is required and must be one of: ${config.driverDocs.allTypes.join(', ')}`,
      });
    }
    if (!mime_type || !config.driverDocs.allowedMimeTypes.includes(mime_type)) {
      return res.status(400).json({
        error: `mime_type is required and must be one of: ${config.driverDocs.allowedMimeTypes.join(', ')}`,
      });
    }

    const path = buildDriverDocPath(req.driverId, doc_type, file_name);
    const { token, signedUrl } = await createDriverDocUploadUrl(path);

    return res.status(201).json({
      bucket: config.driverDocs.bucket,
      path,
      token,
      signedUrl,
      maxBytes: config.driverDocs.maxBytes,
      next: '/api/driver/documents',
    });
  } catch (err) {
    console.error('createDocUploadUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

// --- POST /api/driver/documents --------------------------------------
async function recordDriverDocument(req, res) {
  try {
    const b = req.body || {};
    const errors = [];
    if (!config.driverDocs.allTypes.includes(b.doc_type)) {
      errors.push(`doc_type must be one of: ${config.driverDocs.allTypes.join(', ')}`);
    }
    if (!b.path) errors.push('path is required (returned by the signed-url step)');
    if (b.path && !String(b.path).startsWith(`${req.driverId}/`)) {
      errors.push('path does not belong to you');
    }
    if (b.size_bytes != null && Number(b.size_bytes) > config.driverDocs.maxBytes) {
      errors.push(`file exceeds max size of ${config.driverDocs.maxBytes} bytes`);
    }
    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // Re-uploads replace: supersede any prior doc of the same type for this driver.
    await supabase
      .from('driver_documents')
      .delete()
      .eq('driver_id', req.driverId)
      .eq('doc_type', b.doc_type);

    const { data: doc, error: insErr } = await supabase
      .from('driver_documents')
      .insert({
        driver_id: req.driverId,
        doc_type: b.doc_type,
        storage_path: b.path,
        file_name: b.file_name ?? null,
        mime_type: b.mime_type ?? null,
        file_size_bytes: b.size_bytes ?? null,
        file_hash: b.file_hash ?? null,
        expiry_date: b.expiry_date ?? null,
        status: 'pending',
      })
      .select('id, doc_type, status, created_at')
      .single();
    if (insErr) {
      console.error('recordDriverDocument insert error:', insErr);
      return res.status(500).json({ error: 'Could not record document' });
    }

    // Uploading (re)opens review: move the driver to "submitted".
    await supabase
      .from('profiles')
      .update({ driver_verification_status: 'submitted' })
      .eq('id', req.driverId);

    return res.status(201).json({ id: doc.id, docType: doc.doc_type, status: doc.status });
  } catch (err) {
    console.error('recordDriverDocument error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- GET /api/driver/documents ---------------------------------------
async function listMyDocuments(req, res) {
  try {
    const { data: docs, error } = await supabase
      .from('driver_documents')
      .select('id, doc_type, status, rejection_reason, file_name, expiry_date, reviewed_at, created_at')
      .eq('driver_id', req.driverId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('listMyDocuments error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('driver_approved, driver_verification_status')
      .eq('id', req.driverId)
      .maybeSingle();

    const verifiedTypes = new Set(docs.filter((d) => d.status === 'verified').map((d) => d.doc_type));
    const missing = config.driverDocs.requiredTypes.filter((t) => !verifiedTypes.has(t));

    return res.json({
      verificationStatus: (profile && profile.driver_verification_status) || 'none',
      driverApproved: !!(profile && profile.driver_approved),
      requiredTypes: config.driverDocs.requiredTypes,
      allTypes: config.driverDocs.allTypes,
      documents: docs,
      missingRequired: missing,
      allRequiredVerified: missing.length === 0,
    });
  } catch (err) {
    console.error('listMyDocuments error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { createDocUploadUrl, recordDriverDocument, listMyDocuments };
