import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Helper: call AI gateway with retry + exponential backoff
async function callAI(apiKey: string, model: string, messages: any[], modalities?: string[], maxRetries = 4) {
  const body: any = { model, messages };
  if (modalities) body.modalities = modalities;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return await response.json();
    }

    if (response.status === 402) {
      await response.text();
      throw { status: 402, message: 'Créditos insuficientes. Adiciona créditos em Settings → Workspace → Usage.' };
    }

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = response.headers.get('Retry-After');
      let waitMs = 1000 * Math.pow(2, attempt) + Math.random() * 1000;
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) waitMs = parsed * 1000;
      }
      console.log(`Rate limited, retrying in ${Math.round(waitMs)}ms (attempt ${attempt + 1}/${maxRetries})`);
      await response.text(); // consume body
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }

    const errText = await response.text();
    if (response.status === 429) {
      throw { status: 429, message: 'Limite de requisições excedido após várias tentativas. Tenta novamente mais tarde.' };
    }
    throw { status: response.status, message: `AI error: ${response.status} - ${errText}` };
  }

  throw { status: 429, message: 'Limite de requisições excedido após várias tentativas.' };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) return jsonResponse({ success: false, error: 'LOVABLE_API_KEY not configured' }, 500);

    const body = await req.json();
    const { action, product, productIds, phase } = body;

    // ========================
    // ACTION: enrich (single product text enrichment)
    // ========================
    if (action === 'enrich') {
      const prompt = `You are a product data enrichment specialist for e-commerce. 
Given this product information, enrich it with:
1. A compelling SEO-optimized description in Portuguese (Portugal)
2. Key attributes/specifications
3. Suggested category
4. SEO title and meta description

Product: ${JSON.stringify(product)}

Return a JSON object with:
{
  "description": "Enhanced description in Portuguese",
  "seo_title": "SEO optimized title (max 60 chars)",
  "meta_description": "Meta description (max 160 chars)",
  "attributes": [{"name": "attr_name", "value": "attr_value"}],
  "suggested_category": "category name"
}`;

      const data = await callAI(LOVABLE_API_KEY, 'google/gemini-3-flash-preview', [
        { role: 'system', content: 'You are an e-commerce product enrichment AI. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ]);

      const content = data.choices?.[0]?.message?.content || '{}';
      let enriched;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        enriched = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        enriched = {};
      }

      return jsonResponse({ success: true, enriched });
    }

    // ========================
    // ACTION: optimize (multi-phase product optimization - adapted from pixel-perfect-replica)
    // ========================
    if (action === 'optimize') {
      // Authenticate user
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Não autenticado' }, 401);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await userClient.auth.getUser(token);
      if (userError || !user) return jsonResponse({ success: false, error: 'Não autenticado' }, 401);

      const sb = createClient(supabaseUrl, serviceKey);

      if (!Array.isArray(productIds) || productIds.length === 0) {
        return jsonResponse({ success: false, error: 'productIds é obrigatório' }, 400);
      }

      // Phase-based field mapping
      const PHASE_FIELDS: Record<number, string[]> = {
        1: ['title', 'description', 'short_description', 'tags'],
        2: ['seo_title', 'meta_description', 'slug'],
        3: ['price'],
      };

      const currentPhase = phase || 1;
      const fields = PHASE_FIELDS[currentPhase] || PHASE_FIELDS[1];

      // Fetch products
      const { data: products, error: fetchError } = await sb
        .from('products')
        .select('*')
        .in('id', productIds)
        .eq('user_id', user.id);

      if (fetchError || !products?.length) {
        return jsonResponse({ success: false, error: 'Nenhum produto encontrado' }, 404);
      }

      // Fetch existing categories
      let existingCategories: string[] = [];
      const { data: catData } = await sb.from('categories').select('name');
      existingCategories = (catData || []).map((c: any) => c.name).sort();

      const results: any[] = [];

      for (const product of products) {
        try {
          const fieldInstructions = fields.map(f => {
            switch (f) {
              case 'title': return `- "optimized_title": Optimized product title for SEO (max 70 chars, Portuguese PT). Must include brand and key features.`;
              case 'description': return `- "description": Full product description for e-commerce (300-500 words, Portuguese PT). Include features, benefits, technical specifications. Use HTML formatting with <h3>, <ul>, <li>, <p> tags.`;
              case 'short_description': return `- "short_description": Concise summary (2-3 sentences, Portuguese PT).`;
              case 'tags': return `- "tags": Array of 5-10 relevant search tags in Portuguese.`;
              case 'seo_title': return `- "seo_title": SEO meta title (max 60 chars, Portuguese PT).`;
              case 'meta_description': return `- "meta_description": SEO meta description (max 160 chars, Portuguese PT).`;
              case 'slug': return `- "slug": URL-friendly slug (lowercase, hyphens, no accents).`;
              case 'price': return `- "suggested_price": Suggest a competitive retail price based on the cost price and market analysis. Return a number.`;
              default: return '';
            }
          }).filter(Boolean).join('\n');

          const prompt = `You are an expert e-commerce product optimizer for the Portuguese market.

Product data:
- Name: ${product.name}
- SKU: ${product.sku || 'N/A'}
- Brand: ${product.brand || 'N/A'}
- Description: ${product.description || 'N/A'}
- Cost: ${product.cost || 'N/A'}
- Price: ${product.price || 'N/A'}
- Category: ${existingCategories.length > 0 ? `Current categories: ${existingCategories.join(', ')}` : 'No categories defined'}

Generate the following fields:
${fieldInstructions}

Return ONLY a valid JSON object with the requested fields.`;

          const aiData = await callAI(LOVABLE_API_KEY, 'google/gemini-3-flash-preview', [
            { role: 'system', content: 'You are an expert e-commerce optimizer. Return only valid JSON.' },
            { role: 'user', content: prompt },
          ]);

          const content = aiData.choices?.[0]?.message?.content || '{}';
          let optimized;
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            optimized = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
          } catch {
            optimized = {};
          }

          // Apply updates
          const updates: Record<string, unknown> = {};
          if (optimized.optimized_title) updates.optimized_title = optimized.optimized_title;
          if (optimized.description) updates.description = optimized.description;
          if (optimized.short_description) updates.short_description = optimized.short_description;
          if (optimized.tags) updates.tags = optimized.tags;
          if (optimized.seo_title) updates.seo_title = optimized.seo_title;
          if (optimized.meta_description) updates.meta_description = optimized.meta_description;
          if (optimized.slug) updates.slug = optimized.slug;

          if (Object.keys(updates).length > 0) {
            updates.last_enriched_at = new Date().toISOString();
            updates.enrichment_phase = currentPhase;
            await sb.from('products').update(updates as any).eq('id', product.id);
          }

          results.push({ productId: product.id, status: 'done', fields: Object.keys(updates) });
        } catch (prodErr) {
          console.error(`Error optimizing product ${product.id}:`, prodErr);
          results.push({ productId: product.id, status: 'error', error: prodErr instanceof Error ? prodErr.message : 'Erro' });
        }
      }

      return jsonResponse({ success: true, phase: currentPhase, results });
    }

    // ========================
    // ACTION: generate_image (from text only)
    // ========================
    if (action === 'generate_image') {
      const imagePrompt = `Professional e-commerce product photo of: ${product.name}. ${product.description || ''}. Clean white background, studio lighting, high quality product photography, centered composition.`;

      const data = await callAI(LOVABLE_API_KEY, 'google/gemini-3.1-flash-image-preview', [
        { role: 'user', content: imagePrompt },
      ], ['image', 'text']);

      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imageUrl) return jsonResponse({ success: false, error: 'Nenhuma imagem gerada' }, 500);

      return jsonResponse({ success: true, image_url: imageUrl });
    }

    // ========================
    // ACTION: optimize_image (pad to square white background - from pixel-perfect-replica)
    // ========================
    if (action === 'optimize_image') {
      const { image_url, product_name } = product;

      const padPrompt = `Take this product image and place it centered on a pure white square background. Maintain the original proportions without any cropping or distortion. Add equal white padding on all sides so the final image is perfectly square. The product should occupy about 80% of the frame. Clean, professional e-commerce style. Do not add any text, watermarks or extra elements. Product: ${product_name}`;

      const data = await callAI(LOVABLE_API_KEY, 'google/gemini-3.1-flash-image-preview', [
        {
          role: 'user',
          content: [
            { type: 'text', text: padPrompt },
            { type: 'image_url', image_url: { url: image_url } }
          ]
        }
      ], ['image', 'text']);

      const optimizedUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!optimizedUrl) return jsonResponse({ success: false, error: 'Nenhuma imagem otimizada gerada' }, 500);

      // Upload to storage if we have auth
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const sb = createClient(supabaseUrl, serviceKey);

          const base64Data = optimizedUrl.replace(/^data:image\/\w+;base64,/, '');
          const raw = atob(base64Data);
          const chunkSize = 8192;
          const chunks: number[] = [];
          for (let c = 0; c < raw.length; c += chunkSize) {
            const slice = raw.slice(c, c + chunkSize);
            for (let j = 0; j < slice.length; j++) chunks.push(slice.charCodeAt(j));
          }
          const bytes = new Uint8Array(chunks);

          const path = `optimized/${product.id || Date.now()}_${crypto.randomUUID().slice(0, 8)}.webp`;
          await sb.storage.from('product-images').upload(path, bytes, { contentType: 'image/webp', upsert: true });
          const { data: urlData } = sb.storage.from('product-images').getPublicUrl(path);

          return jsonResponse({ success: true, image_url: urlData.publicUrl, stored: true });
        } catch (uploadErr) {
          console.error('Upload failed, returning base64:', uploadErr);
        }
      }

      return jsonResponse({ success: true, image_url: optimizedUrl });
    }

    // ========================
    // ACTION: generate_scene / lifestyle (from pixel-perfect-replica)
    // ========================
    if (action === 'generate_scene') {
      const { image_url, product_name, description } = product;

      const scenePrompt = `Place this product in a realistic, professional commercial environment. The product should be the main focus, centered and prominent. The environment should match the product category - for example: kitchen equipment in a modern professional kitchen, furniture in an elegant room, electronics on a clean modern desk. Professional lighting, high quality commercial photography style. Product: ${product_name}. ${description || ''}`;

      const data = await callAI(LOVABLE_API_KEY, 'google/gemini-3.1-flash-image-preview', [
        {
          role: 'user',
          content: [
            { type: 'text', text: scenePrompt },
            { type: 'image_url', image_url: { url: image_url } }
          ]
        }
      ], ['image', 'text']);

      const sceneUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!sceneUrl) return jsonResponse({ success: false, error: 'Nenhuma imagem de cenário gerada' }, 500);

      // Upload to storage
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const sb = createClient(supabaseUrl, serviceKey);

          const base64Data = sceneUrl.replace(/^data:image\/\w+;base64,/, '');
          const raw = atob(base64Data);
          const chunkSize = 8192;
          const chunks: number[] = [];
          for (let c = 0; c < raw.length; c += chunkSize) {
            const slice = raw.slice(c, c + chunkSize);
            for (let j = 0; j < slice.length; j++) chunks.push(slice.charCodeAt(j));
          }
          const bytes = new Uint8Array(chunks);

          const lifestyleId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
          const path = `lifestyle/${product.id || lifestyleId}_lifestyle.webp`;
          await sb.storage.from('product-images').upload(path, bytes, { contentType: 'image/webp', upsert: true });
          const { data: urlData } = sb.storage.from('product-images').getPublicUrl(path);

          return jsonResponse({ success: true, image_url: urlData.publicUrl, stored: true });
        } catch (uploadErr) {
          console.error('Upload failed, returning base64:', uploadErr);
        }
      }

      return jsonResponse({ success: true, image_url: sceneUrl });
    }

    // ========================
    // ACTION: batch_optimize_images (process multiple products - from pixel-perfect-replica)
    // ========================
    if (action === 'batch_optimize_images') {
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Não autenticado' }, 401);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const sb = createClient(supabaseUrl, serviceKey);

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await userClient.auth.getUser(token);
      if (userError || !user) return jsonResponse({ success: false, error: 'Não autenticado' }, 401);

      const mode = body.mode || 'optimize'; // "optimize" or "lifestyle"

      if (!Array.isArray(productIds) || productIds.length === 0) {
        return jsonResponse({ success: false, error: 'productIds é obrigatório' }, 400);
      }

      const results: any[] = [];

      for (const productId of productIds) {
        try {
          const { data: prod } = await sb.from('products')
            .select('id, name, sku, image_url, description')
            .eq('id', productId)
            .eq('user_id', user.id)
            .single();

          if (!prod?.image_url) {
            results.push({ productId, status: 'skipped', reason: 'Sem imagem' });
            continue;
          }

          const prompt = mode === 'lifestyle'
            ? `Place this product in a realistic, professional commercial environment. The product should be the main focus, centered and prominent. The environment should match the product category. Professional lighting, high quality commercial photography style. Product: ${prod.name}`
            : `Take this product image and place it centered on a pure white square background. Maintain the original proportions without any cropping or distortion. Add equal white padding on all sides so the final image is perfectly square. The product should occupy about 80% of the frame. Clean, professional e-commerce style. Do not add any text, watermarks or extra elements.`;

          const aiData = await callAI(LOVABLE_API_KEY, 'google/gemini-3.1-flash-image-preview', [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: prod.image_url } }
              ]
            }
          ], ['image', 'text']);

          const genImage = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

          if (genImage) {
            const base64Data = genImage.replace(/^data:image\/\w+;base64,/, '');
            const raw = atob(base64Data);
            const chunkSize = 8192;
            const chunks: number[] = [];
            for (let c = 0; c < raw.length; c += chunkSize) {
              const slice = raw.slice(c, c + chunkSize);
              for (let j = 0; j < slice.length; j++) chunks.push(slice.charCodeAt(j));
            }
            const bytes = new Uint8Array(chunks);

            const folder = mode === 'lifestyle' ? 'lifestyle' : 'optimized';
            const path = `${folder}/${productId}_${Date.now()}.webp`;
            await sb.storage.from('product-images').upload(path, bytes, { contentType: 'image/webp', upsert: true });
            const { data: urlData } = sb.storage.from('product-images').getPublicUrl(path);

            // Save to product_images table
            await sb.from('product_images').insert({
              product_id: productId,
              url: urlData.publicUrl,
              type: mode === 'lifestyle' ? 'lifestyle' : 'optimized',
              is_primary: false,
              user_id: user.id,
            } as any);

            results.push({ productId, status: 'done', url: urlData.publicUrl });
          } else {
            results.push({ productId, status: 'error', error: 'IA não gerou imagem' });
          }
        } catch (prodErr) {
          console.error(`Error processing image for ${productId}:`, prodErr);
          results.push({ productId, status: 'error', error: prodErr instanceof Error ? prodErr.message : 'Erro' });
        }
      }

      return jsonResponse({
        success: true,
        mode,
        total: productIds.length,
        processed: results.filter(r => r.status === 'done').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        failed: results.filter(r => r.status === 'error').length,
        results,
      });
    }

    return jsonResponse({ success: false, error: 'Ação inválida' }, 400);

  } catch (error: any) {
    console.error('AI enrichment error:', error);
    const status = error?.status || 500;
    const message = error?.message || (error instanceof Error ? error.message : 'Erro desconhecido');
    return new Response(JSON.stringify({ success: false, error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
