-- Remove duplicate categories, keeping the one with woo_id or the oldest
DELETE FROM categories
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, LOWER(TRIM(name))) id
  FROM categories
  ORDER BY user_id, LOWER(TRIM(name)), woo_id NULLS LAST, created_at ASC
);