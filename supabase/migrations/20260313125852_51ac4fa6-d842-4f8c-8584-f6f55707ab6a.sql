ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS supplier_url text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS specifications jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;