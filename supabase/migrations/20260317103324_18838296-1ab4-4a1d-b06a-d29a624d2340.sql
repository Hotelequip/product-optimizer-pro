ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS parent_id uuid DEFAULT NULL REFERENCES public.categories(id) ON DELETE SET NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS slug text DEFAULT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS woo_id integer DEFAULT NULL;