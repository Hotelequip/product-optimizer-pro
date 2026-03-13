
INSERT INTO storage.buckets (id, name, public)
VALUES ('catalog-files', 'catalog-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Auth users can upload catalog files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catalog-files');

CREATE POLICY "Anyone can view catalog files"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'catalog-files');

CREATE POLICY "Auth users can delete catalog files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'catalog-files');
