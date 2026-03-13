INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true);

CREATE POLICY "Users can upload product images"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view product images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'product-images');

CREATE POLICY "Users can delete own product images"
ON storage.objects FOR DELETE TO public
USING (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);