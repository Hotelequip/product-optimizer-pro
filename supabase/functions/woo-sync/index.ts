import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, store_id, products } = await req.json();

    // Get user from auth header
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader! } }
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get store credentials
    const { data: store, error: storeError } = await supabase
      .from('woo_stores')
      .select('*')
      .eq('id', store_id)
      .eq('user_id', user.id)
      .single();

    if (storeError || !store) {
      return new Response(JSON.stringify({ success: false, error: 'Loja não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const baseUrl = store.store_url.replace(/\/$/, '');
    const encodedCredentials = btoa(`${store.consumer_key}:${store.consumer_secret}`);

    if (action === 'import') {
      // Import products from WooCommerce
      let allProducts: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=100&page=${page}`, {
          headers: {
            'Authorization': `Basic ${encodedCredentials}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('WooCommerce API error:', errText);
          return new Response(JSON.stringify({ success: false, error: `Erro WooCommerce: ${response.status}` }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const batch = await response.json();
        allProducts = allProducts.concat(batch);
        hasMore = batch.length === 100;
        page++;

        if (page > 10) break; // Safety limit: 1000 products max
      }

      return new Response(JSON.stringify({ success: true, products: allProducts }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'export') {
      // Export products to WooCommerce
      if (!products || !Array.isArray(products) || products.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'Nenhum produto para exportar' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const results: any[] = [];
      const BATCH_SIZE = 50;
      const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();
      const normalizeTaxonomyKey = (value: unknown) => normalizeText(value).replace(/^pa_/, '');
      const normalizeKey = (value: unknown) => normalizeText(value);
      const normalizeCategoryKey = (value: unknown) => normalizeText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const normalizeSlugLike = (value: unknown) => normalizeCategoryKey(value).replace(/\s+/g, '-');

      const splitCategoryCandidates = (value: unknown): string[] => {
        const raw = String(value ?? '').replace(/<[^>]*>/g, ' ').trim();
        if (!raw) return [];

        const direct = raw
          .split(/[;,|]+/)
          .map((s) => s.trim())
          .filter(Boolean);

        const breadcrumbParts = direct.flatMap((item) =>
          item
            .split(/[>\/\\›»]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        );

        const preferred = [...breadcrumbParts].reverse(); // leaf first
        return Array.from(new Set([raw, ...preferred, ...direct]));
      };

      const getResolvedSourceCategoryName = (p: any) =>
        String(
          p?.category_name
          ?? categoryNameById.get(String(p?.category_id ?? ''))
          ?? ''
        ).trim();

      // Resolve product category names from DB when only category_id is available
      const categoryNameById = new Map<string, string>();
      const categoryIds = Array.from(new Set(
        (products || [])
          .map((p: any) => String(p?.category_id ?? '').trim())
          .filter((id) => id.length > 0)
      ));

      if (categoryIds.length > 0) {
        const { data: dbCategories, error: dbCategoriesError } = await supabase
          .from('categories')
          .select('id, name')
          .eq('user_id', user.id)
          .in('id', categoryIds);

        if (!dbCategoriesError && dbCategories) {
          for (const c of dbCategories) {
            categoryNameById.set(String(c.id), String(c.name ?? '').trim());
          }
        }
      }

      // Pre-fetch existing WooCommerce categories to map by name/slug
      let wooCategories: any[] = [];
      const wooCategoryLookup = new Map<string, number>();
      const wooCategoryEntries: Array<{ id: number; nameKey: string; compactKey: string; slugKey: string; slugLike: string }> = [];

      try {
        let catPage = 1;
        let hasMoreCats = true;
        while (hasMoreCats) {
          const catRes = await fetch(`${baseUrl}/wp-json/wc/v3/products/categories?per_page=100&page=${catPage}`, {
            headers: { 'Authorization': `Basic ${encodedCredentials}`, 'Content-Type': 'application/json' },
          });
          if (catRes.ok) {
            const cats = await catRes.json();
            wooCategories = wooCategories.concat(cats);
            for (const c of cats) {
              const id = Number(c?.id);
              if (!Number.isFinite(id)) continue;

              const nameKey = normalizeText(c?.name);
              const compactKey = normalizeCategoryKey(c?.name);
              const slugKey = normalizeText(c?.slug);
              const slugLike = normalizeSlugLike(c?.name);

              if (nameKey) wooCategoryLookup.set(nameKey, id);
              if (compactKey) wooCategoryLookup.set(compactKey, id);
              if (slugKey) wooCategoryLookup.set(slugKey, id);
              if (slugLike) wooCategoryLookup.set(slugLike, id);

              wooCategoryEntries.push({ id, nameKey, compactKey, slugKey, slugLike });
            }
            hasMoreCats = cats.length === 100;
            catPage++;
          } else { hasMoreCats = false; }
          if (catPage > 5) break;
        }
      } catch (e) { console.error('Error fetching WooCommerce categories:', e); }

      // Lookup existing WooCommerce category by name (NEVER create new ones)
      function findWooCategory(rawCategory: unknown): number | null {
        const candidates = splitCategoryCandidates(rawCategory);
        if (candidates.length === 0) return null;

        for (const candidate of candidates) {
          const directMatch =
            wooCategoryLookup.get(normalizeText(candidate))
            ?? wooCategoryLookup.get(normalizeCategoryKey(candidate))
            ?? wooCategoryLookup.get(normalizeSlugLike(candidate));

          if (directMatch) return directMatch;
        }

        for (const candidate of candidates) {
          const candidateKey = normalizeCategoryKey(candidate);
          if (candidateKey.length < 4) continue;

          const fuzzy = wooCategoryEntries.find((entry) =>
            entry.compactKey === candidateKey
            || entry.slugLike === candidateKey
            || entry.compactKey.includes(candidateKey)
            || candidateKey.includes(entry.compactKey)
          );

          if (fuzzy?.id) return fuzzy.id;
        }

        return null;
      }

      const defaultCategoryId =
        findWooCategory('sem categoria') ||
        findWooCategory('uncategorized') ||
        wooCategories[0]?.id ||
        null;

      // Discover global attribute used for brand (if configured in WooCommerce)
      let brandAttributeId: number | null = null;
      try {
        const attrRes = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes?per_page=100`, {
          headers: { 'Authorization': `Basic ${encodedCredentials}`, 'Content-Type': 'application/json' },
        });
        if (attrRes.ok) {
          const attrs = await attrRes.json();
          const brandAttr = attrs.find((a: any) => {
            const name = normalizeText(a?.name);
            const slug = normalizeTaxonomyKey(a?.slug);
            return ['brand', 'marca', 'marca do produto'].includes(name)
              || ['brand', 'marca', 'marca-do-produto'].includes(slug);
          });
          if (brandAttr?.id) brandAttributeId = Number(brandAttr.id);
        }
      } catch (e) { console.error('Error fetching WooCommerce attributes:', e); }

      // Pre-fetch existing WooCommerce products to match by SKU/slug
      const existingWooProductsBySku = new Map<string, number>();
      const existingWooProductsBySlug = new Map<string, number>();

      try {
        let prodPage = 1;
        let hasMoreProds = true;
        while (hasMoreProds) {
          const prodRes = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=100&page=${prodPage}`, {
            headers: { 'Authorization': `Basic ${encodedCredentials}`, 'Content-Type': 'application/json' },
          });
          if (prodRes.ok) {
            const prods = await prodRes.json();
            for (const wp of prods) {
              const skuKey = normalizeKey(wp.sku);
              const slugKey = normalizeKey(wp.slug);
              if (skuKey) existingWooProductsBySku.set(skuKey, wp.id);
              if (slugKey) existingWooProductsBySlug.set(slugKey, wp.id);
            }
            hasMoreProds = prods.length === 100;
            prodPage++;
          } else { hasMoreProds = false; }
          if (prodPage > 10) break;
        }
      } catch (e) { console.error('Error fetching existing WooCommerce products:', e); }

      // AI-based category suggestion for products without category
      const wooCategoryNames = wooCategories
        .filter((c: any) => normalizeText(c?.name) !== 'sem categoria' && normalizeText(c?.slug) !== 'uncategorized')
        .map((c: any) => c.name);

      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      const aiCategoryCache = new Map<string, string>(); // product key → category name

      async function suggestCategoriesForBatch(items: any[]): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        if (!LOVABLE_API_KEY || wooCategoryNames.length === 0 || items.length === 0) return result;

        const productList = items.map((p, i) => {
          const sourceCategory = getResolvedSourceCategoryName(p) || 'N/A';
          return `${i + 1}. "${p.optimized_title || p.seo_title || p.name}" (marca: ${p.brand || 'N/A'}, categoria_origem: ${sourceCategory})`;
        }).join('\n');

        try {
          const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash-lite',
              messages: [{
                role: 'user',
                content: `You are a product categorization expert. Given ONLY these existing WooCommerce store categories:\n${wooCategoryNames.join(', ')}\n\nAssign the BEST matching EXISTING category to each product below. You MUST ONLY use categories from the list above — NEVER invent or create new category names. Reply ONLY with a JSON array of objects: [{"index":1,"category":"exact category name from list"},...]\n\nProducts:\n${productList}`
              }],
              temperature: 0.1,
              max_tokens: 2000,
            }),
          });

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            const content = aiData.choices?.[0]?.message?.content || '';
            const jsonMatch = content.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
              const suggestions = JSON.parse(jsonMatch[0]);
              for (const s of suggestions) {
                if (s.index >= 1 && s.index <= items.length && s.category) {
                  const key = normalizeKey(items[s.index - 1].sku || items[s.index - 1].name);
                  result.set(key, s.category);
                }
              }
            }
          }
        } catch (e) {
          console.error('AI category suggestion error:', e);
        }
        return result;
      }

      for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);

        // Identify products still without a valid mapped Woo category (even if source category exists)
        const needsCategory = batch.filter((p: any) => {
          const sourceCategory = getResolvedSourceCategoryName(p);
          return !findWooCategory(sourceCategory);
        });

        // Use AI to suggest EXISTING Woo categories for unmapped products
        if (needsCategory.length > 0) {
          const suggestions = await suggestCategoriesForBatch(needsCategory);
          for (const [key, catName] of suggestions) {
            aiCategoryCache.set(key, catName);
          }
        }

        const toCreate: any[] = [];
        const toUpdate: any[] = [];

        for (const p of batch) {
          const normalizedStatus = String(p.status ?? '').trim().toLowerCase();
          const nonPublishStatuses = new Set(['inactive', 'disabled', '0', 'false']);
          const wooStatus = nonPublishStatuses.has(normalizedStatus) ? 'draft' : 'publish';

          const product: any = {
            name: p.optimized_title || p.seo_title || p.name,
            description: p.description || '',
            short_description: p.short_description || '',
            regular_price: String(p.price || 0),
            sku: p.sku || '',
            stock_quantity: Number(p.stock ?? 0),
            manage_stock: true,
            status: wooStatus,
            images: p.image_url ? [{ src: p.image_url }] : [],
          };

          const slug = String(p.slug ?? '').trim();
          if (slug) product.slug = slug;

          // Category (source file/DB first, then AI-restricted fallback, then default)
          const sourceCategoryName = getResolvedSourceCategoryName(p);
          const aiSuggestedCategoryName = String(aiCategoryCache.get(normalizeKey(p.sku || p.name)) ?? '').trim();

          const mappedCategoryId =
            findWooCategory(sourceCategoryName)
            ?? findWooCategory(aiSuggestedCategoryName)
            ?? null;

          if (mappedCategoryId) {
            product.categories = [{ id: mappedCategoryId }];
          } else if (defaultCategoryId) {
            product.categories = [{ id: defaultCategoryId }];
          }

          // EAN/GTIN + SEO + brand as meta_data
          const metaData: any[] = [];
          if (p.ean) {
            metaData.push({ key: '_global_unique_id', value: p.ean });
            metaData.push({ key: '_barcode', value: p.ean });
          }
          if (p.meta_description) {
            metaData.push({ key: '_yoast_wpseo_metadesc', value: p.meta_description });
          }

          const brand = String(p.brand ?? '').trim();
          if (brand) {
            product.attributes = brandAttributeId
              ? [{ id: brandAttributeId, visible: true, variation: false, options: [brand] }]
              : [
                  { name: 'Marca', visible: true, variation: false, options: [brand] },
                  { name: 'Marca Do Produto', visible: true, variation: false, options: [brand] },
                ];

            metaData.push({ key: 'marca_do_produto', value: brand });
            metaData.push({ key: '_brand', value: brand });
            metaData.push({ key: 'xstore_brand', value: brand });
            metaData.push({ key: 'brand_id', value: brand });
          }

          if (metaData.length > 0) product.meta_data = metaData;

          // Tags
          if (p.tags && Array.isArray(p.tags) && p.tags.length > 0) {
            product.tags = p.tags.map((t: string) => ({ name: t }));
          }

          // Check if product exists in WooCommerce by SKU/slug
          const skuKey = normalizeKey(p.sku);
          const slugKey = normalizeKey(p.slug);
          const wooId = (skuKey && existingWooProductsBySku.get(skuKey)) || (slugKey && existingWooProductsBySlug.get(slugKey)) || null;
          if (wooId) {
            product.id = wooId;
            toUpdate.push(product);
          } else {
            toCreate.push(product);
          }
        }

        const batchBody: any = {};
        if (toCreate.length > 0) batchBody.create = toCreate;
        if (toUpdate.length > 0) batchBody.update = toUpdate;

        const response = await fetch(`${baseUrl}/wp-json/wc/v3/products/batch`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${encodedCredentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(batchBody),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('WooCommerce batch error:', errText);
          results.push({ batch: i / BATCH_SIZE + 1, error: `Status ${response.status}` });
        } else {
          const data = await response.json();
          results.push({
            batch: i / BATCH_SIZE + 1,
            created: data.create?.length || 0,
            updated: data.update?.length || 0,
          });
        }
      }

      return new Response(JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'sync_categories') {
      // Fetch ALL WooCommerce categories with hierarchy
      let wooAllCategories: any[] = [];
      let catPage = 1;
      let hasMoreCats = true;
      while (hasMoreCats) {
        const catRes = await fetch(`${baseUrl}/wp-json/wc/v3/products/categories?per_page=100&page=${catPage}`, {
          headers: { 'Authorization': `Basic ${encodedCredentials}`, 'Content-Type': 'application/json' },
        });
        if (!catRes.ok) {
          return new Response(JSON.stringify({ success: false, error: `Erro ao buscar categorias: ${catRes.status}` }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const cats = await catRes.json();
        wooAllCategories = wooAllCategories.concat(cats);
        hasMoreCats = cats.length === 100;
        catPage++;
        if (catPage > 20) break;
      }

      console.log(`Fetched ${wooAllCategories.length} WooCommerce categories`);

      // Get existing local categories
      const { data: existingCategories } = await supabase
        .from('categories')
        .select('id, name, woo_id')
        .eq('user_id', user.id);

      const existingByWooId = new Map<number, string>();
      const existingByName = new Map<string, string>();
      for (const c of (existingCategories || [])) {
        if (c.woo_id) existingByWooId.set(Number(c.woo_id), c.id);
        existingByName.set(String(c.name).trim().toLowerCase(), c.id);
      }

      const wooIdToLocalId = new Map<number, string>();
      let created = 0;
      let skipped = 0;

      // Filter out uncategorized
      const validWooCategories = wooAllCategories.filter(c => {
        const name = String(c.name || '').trim().toLowerCase();
        return name && name !== 'uncategorized' && name !== 'sem categoria';
      });

      // Batch upsert: collect new categories to insert in one go
      const toInsert: Array<{ name: string; user_id: string; slug: string | null; woo_id: number }> = [];
      const toUpdate: Array<{ id: string; slug: string | null; woo_id: number }> = [];

      for (const wooCat of validWooCategories) {
        const name = String(wooCat.name || '').trim();
        const wooId = Number(wooCat.id);
        const slug = String(wooCat.slug || '').trim() || null;

        // Already exists by woo_id?
        if (existingByWooId.has(wooId)) {
          wooIdToLocalId.set(wooId, existingByWooId.get(wooId)!);
          toUpdate.push({ id: existingByWooId.get(wooId)!, slug, woo_id: wooId });
          skipped++;
          continue;
        }

        // Already exists by name?
        if (existingByName.has(name.toLowerCase())) {
          const localId = existingByName.get(name.toLowerCase())!;
          wooIdToLocalId.set(wooId, localId);
          toUpdate.push({ id: localId, slug, woo_id: wooId });
          skipped++;
          continue;
        }

        // New category
        toInsert.push({ name, user_id: user.id, slug, woo_id: wooId });
      }

      // Batch insert new categories (50 at a time)
      const BATCH = 50;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH);
        const { data: inserted, error: insertError } = await supabase
          .from('categories')
          .insert(batch)
          .select('id, woo_id, name');

        if (insertError) {
          console.error('Batch insert error:', insertError.message);
          // Fallback: insert one by one
          for (const item of batch) {
            const { data: single, error: singleErr } = await supabase
              .from('categories')
              .insert(item)
              .select('id, woo_id')
              .single();
            if (!singleErr && single) {
              created++;
              wooIdToLocalId.set(Number(single.woo_id), single.id);
              existingByName.set(item.name.toLowerCase(), single.id);
            } else {
              console.error('Single insert error:', singleErr?.message, item.name);
            }
          }
        } else if (inserted) {
          created += inserted.length;
          for (const row of inserted) {
            wooIdToLocalId.set(Number(row.woo_id), row.id);
            existingByName.set(String(row.name).toLowerCase(), row.id);
          }
        }
      }

      // Batch update existing categories (50 at a time)
      for (let i = 0; i < toUpdate.length; i += BATCH) {
        const batch = toUpdate.slice(i, i + BATCH);
        for (const item of batch) {
          await supabase.from('categories').update({ slug: item.slug, woo_id: item.woo_id }).eq('id', item.id);
        }
      }

      // Second pass: set parent_id based on WooCommerce parent hierarchy (batch)
      const parentUpdates: Array<{ id: string; parent_id: string }> = [];
      for (const wooCat of validWooCategories) {
        const wooId = Number(wooCat.id);
        const wooParent = Number(wooCat.parent || 0);
        if (wooParent === 0) continue;

        const localId = wooIdToLocalId.get(wooId);
        const parentLocalId = wooIdToLocalId.get(wooParent);
        if (localId && parentLocalId) {
          parentUpdates.push({ id: localId, parent_id: parentLocalId });
        }
      }

      for (const pu of parentUpdates) {
        await supabase.from('categories').update({ parent_id: pu.parent_id }).eq('id', pu.id);
      }

      console.log(`Sync complete: ${created} created, ${skipped} updated, ${parentUpdates.length} parent links`);

      return new Response(JSON.stringify({
        success: true,
        total_woo: wooAllCategories.length,
        created,
        skipped,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'discover') {
      // Discover product attributes and taxonomies for brand mapping
      const results: any = {};
      try {
        const attrRes = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes`, {
          headers: { 'Authorization': `Basic ${encodedCredentials}`, 'Content-Type': 'application/json' },
        });
        if (attrRes.ok) results.attributes = await attrRes.json();
      } catch (e) { results.attributes_error = String(e); }

      // Check for existing product to see how brand appears
      try {
        const prodRes = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=5`, {
          headers: { 'Authorization': `Basic ${encodedCredentials}`, 'Content-Type': 'application/json' },
        });
        if (prodRes.ok) {
          const prods = await prodRes.json();
          results.sample_products = prods.map((p: any) => ({
            id: p.id, name: p.name, 
            attributes: p.attributes,
            meta_data: p.meta_data?.filter((m: any) => 
              ['_brand', 'marca_do_produto', '_wc_brand', 'pwb-brand', 'brand'].some(k => m.key.toLowerCase().includes(k))
            ),
          }));
        }
      } catch (e) { results.products_error = String(e); }

      return new Response(JSON.stringify({ success: true, ...results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'test') {
      // Test connection
      const response = await fetch(`${baseUrl}/wp-json/wc/v3/system_status`, {
        headers: {
          'Authorization': `Basic ${encodedCredentials}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ success: false, error: `Conexão falhou: ${response.status}` }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const data = await response.json();
      return new Response(JSON.stringify({
        success: true,
        info: {
          version: data.environment?.version || 'unknown',
          store: data.settings?.store_url || baseUrl,
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: 'Ação inválida' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('WooCommerce sync error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
