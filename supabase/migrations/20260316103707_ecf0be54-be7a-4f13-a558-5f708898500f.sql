
-- Add EAN and data_origin to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ean text,
  ADD COLUMN IF NOT EXISTS data_origin jsonb DEFAULT '{}'::jsonb;

-- Product variations table
CREATE TABLE public.product_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  parent_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku text,
  ean text,
  name text,
  price numeric DEFAULT 0,
  regular_price numeric DEFAULT 0,
  sale_price numeric,
  stock integer DEFAULT 0,
  image_url text,
  attributes jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_variations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own variations"
  ON public.product_variations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Import sessions table
CREATE TABLE public.import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'new',
  status text NOT NULL DEFAULT 'pending',
  files_used jsonb DEFAULT '[]'::jsonb,
  products_processed integer DEFAULT 0,
  products_created integer DEFAULT 0,
  products_updated integer DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  log jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own import sessions"
  ON public.import_sessions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at on variations
CREATE TRIGGER update_product_variations_updated_at
  BEFORE UPDATE ON public.product_variations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
