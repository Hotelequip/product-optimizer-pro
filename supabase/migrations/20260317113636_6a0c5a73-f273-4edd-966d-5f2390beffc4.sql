-- Remove all categories that have no woo_id (were not properly synced)
DELETE FROM categories WHERE woo_id IS NULL;

-- Add a unique constraint on woo_id per user to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_woo_id ON categories (user_id, woo_id) WHERE woo_id IS NOT NULL;