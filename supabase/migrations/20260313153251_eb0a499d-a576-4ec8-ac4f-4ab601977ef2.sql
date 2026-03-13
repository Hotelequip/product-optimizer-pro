
-- Create catalogs table for organizing products into folders
CREATE TABLE public.catalogs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Users can manage own catalogs"
  ON public.catalogs
  FOR ALL
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add catalog_id to products
ALTER TABLE public.products ADD COLUMN catalog_id UUID REFERENCES public.catalogs(id) ON DELETE SET NULL;
