CREATE TABLE public.woo_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  store_url text NOT NULL,
  consumer_key text NOT NULL,
  consumer_secret text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.woo_stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own woo stores"
  ON public.woo_stores
  FOR ALL
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_woo_stores_updated_at
  BEFORE UPDATE ON public.woo_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();