// Rewrites persisted Supabase public object URLs to the API media gateway.
// Dry-run by default. Use --apply only after PUBLIC_API_BASE is configured.
require('dotenv').config();
const { supabase } = require('../lib/supabase');

const targets = [
  ['profiles', 'avatar_url'],
  ['merchants', 'logo_url'],
  ['menu_categories', 'image_url'],
  ['menu_items', 'image_url'],
  ['product_categories', 'image_url'],
  ['products', 'image_url'],
];
const apply = process.argv.includes('--apply');
const apiBase = String(process.env.PUBLIC_API_BASE || '').replace(/\/$/, '');

function migratedUrl(value) {
  if (!value || value.startsWith(`${apiBase}/api/files/public/`)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  const marker = '/storage/v1/object/public/';
  const index = parsed.pathname.indexOf(marker);
  if (index < 0) return null;
  const object = parsed.pathname.slice(index + marker.length);
  return `${apiBase}/api/files/public/${object}`;
}

async function main() {
  if (!apiBase) throw new Error('PUBLIC_API_BASE is required');
  let total = 0;
  for (const [table, column] of targets) {
    const { data, error } = await supabase.from(table).select(`id,${column}`).not(column, 'is', null);
    if (error) throw error;
    const changes = (data || []).map((row) => ({ row, next: migratedUrl(row[column]) })).filter((x) => x.next);
    console.log(`${table}.${column}: ${changes.length} URL(s) ${apply ? 'to update' : 'would update'}`);
    total += changes.length;
    if (apply) {
      for (const { row, next } of changes) {
        const { error: updateError } = await supabase.from(table).update({ [column]: next }).eq('id', row.id);
        if (updateError) throw updateError;
      }
    }
  }
  console.log(`${apply ? 'Updated' : 'Dry run found'} ${total} URL(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
