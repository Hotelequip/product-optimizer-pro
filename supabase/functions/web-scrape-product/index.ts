const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay + Math.random() * 1000));
      continue;
    }
    if (response.ok || response.status < 500) return response;
    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error('Max retries exceeded');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, product_name, supplier_url, sku, products, base_supplier_url } = await req.json();

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'Firecrawl não configurado.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'LOVABLE_API_KEY não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const firecrawlHeaders = {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    };

    const aiHeaders = {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // ==========================================
    // ACTION: scrape_supplier - Scrape a specific supplier page by URL
    // ==========================================
    if (action === 'scrape_supplier') {
      if (!supplier_url) {
        return new Response(JSON.stringify({ success: false, error: 'URL do fornecedor é obrigatória' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let formattedUrl = supplier_url.trim();
      if (!formattedUrl.startsWith('http')) formattedUrl = `https://${formattedUrl}`;

      // If SKU provided, try to find the product page
      let targetUrl = formattedUrl;
      if (sku) {
        // First try to search within the supplier site for the SKU
        const searchUrl = `${formattedUrl}${formattedUrl.includes('?') ? '&' : '?'}s=${encodeURIComponent(sku)}`;
        
        // Also try mapping the supplier site to find relevant URLs
        try {
          const mapResponse = await fetchWithRetry('https://api.firecrawl.dev/v1/map', {
            method: 'POST',
            headers: firecrawlHeaders,
            body: JSON.stringify({ url: formattedUrl, search: sku, limit: 5 }),
          });
          if (mapResponse.ok) {
            const mapData = await mapResponse.json();
            const links = mapData.links || [];
            if (links.length > 0) {
              // Use the first matching link that contains the SKU
              const skuLink = links.find((l: string) => l.toLowerCase().includes(sku.toLowerCase()));
              targetUrl = skuLink || links[0];
            }
          }
        } catch (e) {
          console.log('Map fallback:', e);
        }
      }

      console.log('Scraping supplier URL:', targetUrl);

      const scrapeResponse = await fetchWithRetry('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: firecrawlHeaders,
        body: JSON.stringify({
          url: targetUrl,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 5000,
        }),
      });

      if (!scrapeResponse.ok) {
        const errText = await scrapeResponse.text();
        console.error('Firecrawl scrape error:', errText);
        if (scrapeResponse.status === 402) {
          return new Response(JSON.stringify({ success: false, error: 'Créditos Firecrawl insuficientes. Use o cupom LOVABLE50 para 50% off.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: false, error: `Erro scraping: ${scrapeResponse.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const scrapeData = await scrapeResponse.json();
      const pageContent = scrapeData.data?.markdown || scrapeData.markdown || '';

      if (!pageContent) {
        return new Response(JSON.stringify({ success: true, enriched: null, message: 'Nenhum conteúdo encontrado na página' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Use AI to extract structured product data
      const aiPrompt = `You are a product data extraction specialist. From this supplier page content, extract product information${sku ? ` for SKU "${sku}"` : ''}.

Page content:
${pageContent.substring(0, 15000)}

Return a JSON object:
{
  "name": "product name",
  "description": "detailed description in Portuguese",
  "brand": "brand name",
  "sku": "SKU/reference code",
  "specifications": [{"name": "spec", "value": "value"}],
  "suggested_price": number or null,
  "images": ["image_url1"],
  "category": "suggested category in Portuguese",
  "tags": ["tag1", "tag2"],
  "seo_title": "SEO title max 60 chars Portuguese",
  "meta_description": "meta desc max 160 chars Portuguese"
}

Return valid JSON only. Only include fields with reliable data.`;

      const aiResponse = await fetchWithRetry('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: 'Extract product data from supplier pages. Return only valid JSON.' },
            { role: 'user', content: aiPrompt },
          ],
        }),
      });

      if (!aiResponse.ok) {
        return handleAiError(aiResponse);
      }

      const aiData = await aiResponse.json();
      const enriched = parseJsonFromAi(aiData.choices?.[0]?.message?.content || '{}');

      return new Response(JSON.stringify({ success: true, enriched, source_url: targetUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // ACTION: search_enrich - Search web + enrich
    // ==========================================
    if (action === 'search_enrich') {
      if (!product_name) {
        return new Response(JSON.stringify({ success: false, error: 'Nome do produto obrigatório' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const query = sku 
        ? `${product_name} ${sku} especificações ficha técnica preço`
        : `${product_name} especificações ficha técnica preço`;

      const searchResponse = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: firecrawlHeaders,
        body: JSON.stringify({
          query,
          limit: 5,
          lang: 'pt',
          country: 'br',
          scrapeOptions: { formats: ['markdown'] },
        }),
      });

      if (!searchResponse.ok) {
        if (searchResponse.status === 402) {
          return new Response(JSON.stringify({ success: false, error: 'Créditos Firecrawl insuficientes. Use o cupom LOVABLE50 para 50% off.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: false, error: `Erro busca: ${searchResponse.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const searchData = await searchResponse.json();
      const results = searchData.data || [];

      if (results.length === 0) {
        return new Response(JSON.stringify({ success: true, enriched: null, message: 'Sem resultados' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const webContent = results.map((r: any, i: number) =>
        `--- Source ${i + 1}: ${r.title || r.url} ---\n${(r.markdown || r.description || '').substring(0, 3000)}`
      ).join('\n\n');

      const aiPrompt = `Product data specialist. Compile info for "${product_name}"${sku ? ` (SKU: ${sku})` : ''}.

Web results:
${webContent.substring(0, 12000)}

Return JSON:
{
  "description": "Rich SEO description in Portuguese, 2-3 paragraphs",
  "short_description": "One sentence Portuguese",
  "brand": "brand if found",
  "specifications": [{"name": "spec", "value": "val"}],
  "suggested_price_range": {"min": number, "max": number},
  "suggested_category": "category in Portuguese",
  "seo_title": "SEO title max 60 chars Portuguese",
  "meta_description": "meta max 160 chars Portuguese",
  "tags": ["tag1"],
  "sources": ["url1"]
}`;

      const aiResponse = await fetchWithRetry('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: 'E-commerce product data specialist. Return only valid JSON.' },
            { role: 'user', content: aiPrompt },
          ],
        }),
      });

      if (!aiResponse.ok) {
        return handleAiError(aiResponse);
      }

      const aiData = await aiResponse.json();
      const enriched = parseJsonFromAi(aiData.choices?.[0]?.message?.content || '{}');
      enriched.raw_sources = results.map((r: any) => ({ title: r.title, url: r.url }));

      return new Response(JSON.stringify({ success: true, enriched }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // ACTION: bulk_enrich - Enrich multiple products
    // ==========================================
    if (action === 'bulk_enrich') {
      if (!products || !Array.isArray(products) || products.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'Lista de produtos vazia' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const results: any[] = [];

      for (const product of products.slice(0, 20)) { // Max 20 per batch
        try {
          let enriched = null;

          // If product has supplier_url, scrape it
          if (product.supplier_url) {
            let targetUrl = product.supplier_url;
            if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;

            // Try to find SKU-specific page via map
            if (product.sku) {
              try {
                const mapResp = await fetchWithRetry('https://api.firecrawl.dev/v1/map', {
                  method: 'POST',
                  headers: firecrawlHeaders,
                  body: JSON.stringify({ url: targetUrl, search: product.sku, limit: 3 }),
                });
                if (mapResp.ok) {
                  const mapData = await mapResp.json();
                  const links = mapData.links || [];
                  const skuLink = links.find((l: string) => l.toLowerCase().includes(product.sku.toLowerCase()));
                  if (skuLink) targetUrl = skuLink;
                  else if (links.length > 0) targetUrl = links[0];
                }
              } catch (e) {
                console.log('Map error for', product.name, e);
              }
            }

            const scrapeResp = await fetchWithRetry('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: firecrawlHeaders,
              body: JSON.stringify({ url: targetUrl, formats: ['markdown'], onlyMainContent: true, waitFor: 5000 }),
            });

            if (scrapeResp.ok) {
              const scrapeData = await scrapeResp.json();
              const content = scrapeData.data?.markdown || scrapeData.markdown || '';

              if (content) {
                const aiResp = await fetchWithRetry('https://ai.gateway.lovable.dev/v1/chat/completions', {
                  method: 'POST',
                  headers: aiHeaders,
                  body: JSON.stringify({
                    model: 'google/gemini-3-flash-preview',
                    messages: [{
                      role: 'user',
                      content: `Extract product data for "${product.name}"${product.sku ? ` (SKU: ${product.sku})` : ''} from:\n${content.substring(0, 8000)}\n\nReturn JSON: {"description":"Portuguese desc","brand":"","specifications":[{"name":"","value":""}],"suggested_price":null,"tags":[],"seo_title":"","meta_description":""}`,
                    }],
                  }),
                });

                if (aiResp.ok) {
                  const aiData = await aiResp.json();
                  enriched = parseJsonFromAi(aiData.choices?.[0]?.message?.content || '{}');
                }
              }
            }
          }

          // Fallback: web search if no supplier URL or scraping failed
          if (!enriched || !enriched.description) {
            const query = product.sku
              ? `${product.name} ${product.sku} especificações`
              : `${product.name} especificações preço`;

            const searchResp = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
              method: 'POST',
              headers: firecrawlHeaders,
              body: JSON.stringify({ query, limit: 3, lang: 'pt', country: 'br', scrapeOptions: { formats: ['markdown'] } }),
            });

            if (searchResp.ok) {
              const searchData = await searchResp.json();
              const webResults = searchData.data || [];
              if (webResults.length > 0) {
                const webContent = webResults.map((r: any) => (r.markdown || r.description || '').substring(0, 2000)).join('\n');
                
                const aiResp = await fetchWithRetry('https://ai.gateway.lovable.dev/v1/chat/completions', {
                  method: 'POST',
                  headers: aiHeaders,
                  body: JSON.stringify({
                    model: 'google/gemini-3-flash-preview',
                    messages: [{
                      role: 'user',
                      content: `Extract product data for "${product.name}"${product.sku ? ` (SKU: ${product.sku})` : ''} from:\n${webContent.substring(0, 8000)}\n\nReturn JSON: {"description":"Portuguese desc","brand":"","specifications":[{"name":"","value":""}],"suggested_price":null,"tags":[],"seo_title":"","meta_description":""}`,
                    }],
                  }),
                });

                if (aiResp.ok) {
                  const aiData = await aiResp.json();
                  enriched = parseJsonFromAi(aiData.choices?.[0]?.message?.content || '{}');
                }
              }
            }
          }

          results.push({ product_id: product.id, success: !!enriched, enriched });

          // Small delay between products to avoid rate limits
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`Error enriching ${product.name}:`, e);
          results.push({ product_id: product.id, success: false, error: (e as Error).message });
        }
      }

      return new Response(JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // ACTION: fetch_images - Find images for products without image_url
    // ==========================================
    if (action === 'fetch_images') {
      if (!products || !Array.isArray(products) || products.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'Lista de produtos vazia' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const results: any[] = [];

      // Helper: extract image URLs from page content (markdown + html patterns)
      function extractImageUrls(content: string): string[] {
        const urls: string[] = [];
        
        // Markdown images: ![alt](url)
        const mdRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/gi;
        for (const m of content.matchAll(mdRegex)) urls.push(m[1]);
        
        // HTML img src, data-src, data-lazy-src, data-original (lazy loading patterns)
        const srcRegex = /(?:src|data-src|data-lazy-src|data-original|data-full|data-large_image)=["'](https?:\/\/[^\s"']+)/gi;
        for (const m of content.matchAll(srcRegex)) urls.push(m[1]);
        
        // srcset patterns (take largest)
        const srcsetRegex = /srcset=["']([^"']+)/gi;
        for (const m of content.matchAll(srcsetRegex)) {
          const parts = m[1].split(',').map(s => s.trim());
          for (const part of parts) {
            const urlMatch = part.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) urls.push(urlMatch[1]);
          }
        }
        
        // CSS background-image: url(...)
        const bgRegex = /background-image:\s*url\(['"]?(https?:\/\/[^\s'")\]]+)/gi;
        for (const m of content.matchAll(bgRegex)) urls.push(m[1]);
        
        // Raw URLs ending in image extensions
        const rawRegex = /(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>]*)?)/gi;
        for (const m of content.matchAll(rawRegex)) urls.push(m[1]);
        
        // Deduplicate and filter
        const seen = new Set<string>();
        return urls.filter(url => {
          const lower = url.toLowerCase();
          if (seen.has(lower)) return false;
          seen.add(lower);
          // Filter out logos, icons, tiny images, placeholders
          return !lower.includes('logo') && !lower.includes('icon') && !lower.includes('favicon') 
            && !lower.includes('avatar') && !lower.includes('placeholder') && !lower.includes('woocommerce')
            && !lower.includes('emoji') && !lower.includes('gravatar') && !lower.includes('wp-includes')
            && !lower.includes('spinner') && !lower.includes('loading') && !lower.includes('blank.gif')
            && !lower.includes('pixel') && !lower.includes('tracking') && !lower.includes('1x1');
        });
      }

      // Helper: scrape a URL and extract the best product image
      // Uses multiple rendering strategies for JS-heavy sites
      async function scrapePageForImage(url: string, productName: string): Promise<string | null> {
        try {
          console.log(`Scraping for image: ${url}`);
          
          // Strategy A: Standard scrape with JS rendering wait
          const scrapeResp = await fetchWithRetry('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: firecrawlHeaders,
            body: JSON.stringify({
              url,
              formats: ['markdown', 'html'],
              onlyMainContent: false, // Get full page for JS-rendered sites
              waitFor: 8000, // Longer wait for JS rendering
            }),
          });

          if (!scrapeResp.ok) return null;

          const scrapeData = await scrapeResp.json();
          const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
          const html = scrapeData.data?.html || scrapeData.html || '';
          const combined = markdown + '\n' + html;
          
          // Also check metadata for og:image, twitter:image
          const metadata = scrapeData.data?.metadata || scrapeData.metadata || {};
          const ogImage = metadata.ogImage || metadata['og:image'] || metadata.twitterImage || metadata['twitter:image'];
          
          const images = extractImageUrls(combined);
          
          // Priority: og:image > product-like images > first image
          if (ogImage && ogImage.startsWith('http') && !ogImage.toLowerCase().includes('logo')) {
            return ogImage;
          }
          
          if (images.length > 0) {
            // Score images by relevance
            const scored = images.map(u => {
              const lower = u.toLowerCase();
              let score = 0;
              if (lower.includes('product')) score += 3;
              if (lower.includes('upload')) score += 2;
              if (lower.includes('media')) score += 2;
              if (lower.includes('image')) score += 1;
              if (lower.includes('wp-content')) score += 2;
              if (lower.includes('cdn')) score += 1;
              // Prefer larger images (often have dimensions in URL)
              if (/\d{3,4}x\d{3,4}/.test(lower)) score += 1;
              if (lower.includes('thumb') || lower.includes('150x') || lower.includes('100x')) score -= 2;
              return { url: u, score };
            });
            scored.sort((a, b) => b.score - a.score);
            return scored[0].url;
          }

          // Strategy B: AI extraction from content
          if (combined.length > 100) {
            const aiResp = await fetchWithRetry('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: aiHeaders,
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash-lite',
                messages: [{
                  role: 'user',
                  content: `From this webpage content, find the main product image URL for "${productName}". Look for image URLs (jpg, png, webp) in markdown ![...](...), HTML <img src="...">, data-src="...", data-lazy-src="...", srcset="...", or raw URLs. Also check for background-image CSS patterns. Return ONLY the full URL starting with http. If none found, return "NONE".\n\n${combined.substring(0, 8000)}`,
                }],
              }),
            });
            if (aiResp.ok) {
              const aiData = await aiResp.json();
              const aiUrl = (aiData.choices?.[0]?.message?.content || '').trim().replace(/[`"']/g, '');
              if (aiUrl && aiUrl !== 'NONE' && aiUrl.startsWith('http')) return aiUrl;
            }
          }

          return null;
        } catch (e) {
          console.log(`Scrape error for ${url}:`, e);
          return null;
        }
      }

      for (const product of products.slice(0, 30)) {
        try {
          let imageUrl: string | null = null;
          const effectiveSupplierUrl = product.supplier_url || base_supplier_url;
          const searchTerm = product.sku || product.name;

          if (effectiveSupplierUrl) {
            let baseUrl = effectiveSupplierUrl;
            if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
            // Remove trailing slash
            baseUrl = baseUrl.replace(/\/+$/, '');

            // ===== APPROACH 1: Site map search =====
            if (!imageUrl) {
              try {
                console.log(`[A1-Map] ${baseUrl} search="${searchTerm}"`);
                const mapResp = await fetchWithRetry('https://api.firecrawl.dev/v1/map', {
                  method: 'POST',
                  headers: firecrawlHeaders,
                  body: JSON.stringify({ url: baseUrl, search: searchTerm, limit: 5 }),
                });
                if (mapResp.ok) {
                  const mapData = await mapResp.json();
                  const links = (mapData.links || []) as string[];
                  console.log(`[A1-Map] Found ${links.length} links`);
                  
                  // Find best match
                  const skuLower = (product.sku || '').toLowerCase();
                  const bestLink = links.find(l => skuLower && l.toLowerCase().includes(skuLower))
                    || links.find(l => {
                      const lLow = l.toLowerCase();
                      // Match any name word (>3 chars) in URL
                      return product.name.toLowerCase().split(/\s+/)
                        .filter((w: string) => w.length > 3)
                        .some((w: string) => lLow.includes(w));
                    })
                    || (links.length > 0 ? links[0] : null);

                  if (bestLink) {
                    imageUrl = await scrapePageForImage(bestLink, product.name);
                  }
                }
              } catch (e) {
                console.log('[A1-Map] error:', e);
              }
            }

            // ===== APPROACH 2: Site internal search (?s=, ?q=, /search/) =====
            if (!imageUrl) {
              const searchUrls = [
                `${baseUrl}/?s=${encodeURIComponent(searchTerm)}`,
                `${baseUrl}/search?q=${encodeURIComponent(searchTerm)}`,
                `${baseUrl}/?post_type=product&s=${encodeURIComponent(searchTerm)}`,
              ];
              
              for (const searchUrl of searchUrls) {
                if (imageUrl) break;
                try {
                  console.log(`[A2-SiteSearch] ${searchUrl}`);
                  const scrapeResp = await fetchWithRetry('https://api.firecrawl.dev/v1/scrape', {
                    method: 'POST',
                    headers: firecrawlHeaders,
                    body: JSON.stringify({
                      url: searchUrl,
                      formats: ['markdown', 'html'],
                      onlyMainContent: true,
                      waitFor: 5000,
                    }),
                  });

                  if (scrapeResp.ok) {
                    const data = await scrapeResp.json();
                    const content = (data.data?.markdown || '') + '\n' + (data.data?.html || '');
                    
                    // Look for product links in search results, then scrape the first one
                    const linkRegex = /href=["'](https?:\/\/[^\s"']+)/gi;
                    const foundLinks: string[] = [];
                    for (const m of content.matchAll(linkRegex)) {
                      const href = m[1].toLowerCase();
                      if (href.includes(baseUrl.replace('https://', '').replace('http://', '')) 
                          && (href.includes('product') || href.includes('produto') || href.includes('shop'))) {
                        foundLinks.push(m[1]);
                      }
                    }
                    
                    // Also extract images directly from search results page
                    const images = extractImageUrls(content);
                    const productImg = images.find(u => {
                      const lower = u.toLowerCase();
                      return (lower.includes('product') || lower.includes('upload')) 
                        && !lower.includes('category') && !lower.includes('banner');
                    });
                    if (productImg) {
                      imageUrl = productImg;
                      break;
                    }
                    
                    // If we found product links, scrape the first one
                    if (foundLinks.length > 0 && !imageUrl) {
                      imageUrl = await scrapePageForImage(foundLinks[0], product.name);
                    }
                  }
                } catch (e) {
                  console.log('[A2-SiteSearch] error:', e);
                }
              }
            }

            // ===== APPROACH 3: Common URL patterns =====
            if (!imageUrl && product.sku) {
              const slug = product.name.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
              
              const candidateUrls = [
                `${baseUrl}/product/${slug}/`,
                `${baseUrl}/produto/${slug}/`,
                `${baseUrl}/shop/${slug}/`,
                `${baseUrl}/${slug}/`,
                `${baseUrl}/product/${product.sku.toLowerCase()}/`,
              ];

              for (const url of candidateUrls) {
                if (imageUrl) break;
                try {
                  console.log(`[A3-DirectURL] ${url}`);
                  imageUrl = await scrapePageForImage(url, product.name);
                } catch (e) {
                  // URL didn't work, try next
                }
              }
            }
          }

          // ===== APPROACH 4: Google site-scoped search =====
          if (!imageUrl && effectiveSupplierUrl) {
            try {
              const domain = effectiveSupplierUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
              const query = `site:${domain} ${product.name} ${product.sku || ''}`.trim();
              console.log(`[A4-GoogleSite] "${query}"`);
              
              const searchResp = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
                method: 'POST',
                headers: firecrawlHeaders,
                body: JSON.stringify({ query, limit: 3, scrapeOptions: { formats: ['markdown', 'html'] } }),
              });

              if (searchResp.ok) {
                const searchData = await searchResp.json();
                const webResults = searchData.data || [];
                
                for (const result of webResults) {
                  if (imageUrl) break;
                  const content = (result.markdown || '') + '\n' + (result.html || '');
                  const images = extractImageUrls(content);
                  if (images.length > 0) {
                    const productImg = images.find((u: string) => u.toLowerCase().includes('product') || u.toLowerCase().includes('upload'));
                    imageUrl = productImg || images[0];
                  }
                }
              }
            } catch (e) {
              console.log('[A4-GoogleSite] error:', e);
            }
          }

          // ===== APPROACH 5: General web search =====
          if (!imageUrl) {
            try {
              const query = product.sku
                ? `"${product.name}" ${product.sku} product image`
                : `"${product.name}" product image`;
              console.log(`[A5-WebSearch] "${query}"`);

              const searchResp = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
                method: 'POST',
                headers: firecrawlHeaders,
                body: JSON.stringify({ query, limit: 3, scrapeOptions: { formats: ['markdown'] } }),
              });

              if (searchResp.ok) {
                const searchData = await searchResp.json();
                const webResults = searchData.data || [];
                
                for (const result of webResults) {
                  if (imageUrl) break;
                  const md = result.markdown || '';
                  const images = extractImageUrls(md);
                  if (images.length > 0) {
                    imageUrl = images[0];
                  }
                }

                // AI fallback with combined content
                if (!imageUrl) {
                  const combined = webResults.map((r: any) => (r.markdown || '').substring(0, 2000)).join('\n');
                  if (combined.length > 50) {
                    const aiResp = await fetchWithRetry('https://ai.gateway.lovable.dev/v1/chat/completions', {
                      method: 'POST',
                      headers: aiHeaders,
                      body: JSON.stringify({
                        model: 'google/gemini-2.5-flash-lite',
                        messages: [{
                          role: 'user',
                          content: `Find the best product image URL for "${product.name}". Return ONLY the URL. If none found, return "NONE".\n\n${combined}`,
                        }],
                      }),
                    });
                    if (aiResp.ok) {
                      const aiData = await aiResp.json();
                      const aiUrl = (aiData.choices?.[0]?.message?.content || '').trim().replace(/[`"']/g, '');
                      if (aiUrl && aiUrl !== 'NONE' && aiUrl.startsWith('http')) imageUrl = aiUrl;
                    }
                  }
                }
              }
            } catch (e) {
              console.log('[A5-WebSearch] error:', e);
            }
          }

          console.log(`Result for "${product.name}": ${imageUrl ? 'FOUND' : 'NOT FOUND'}`);
          results.push({ product_id: product.id, success: !!imageUrl, image_url: imageUrl });

          // Delay between products to avoid rate limits
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`Error fetching image for ${product.name}:`, e);
          results.push({ product_id: product.id, success: false, error: (e as Error).message });
        }
      }

      return new Response(JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: 'Ação inválida. Use: scrape_supplier, search_enrich, bulk_enrich, fetch_images' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Web scrape error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

function handleAiError(response: Response) {
  if (response.status === 429) {
    return new Response(JSON.stringify({ success: false, error: 'Limite IA excedido. Tente novamente.' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  if (response.status === 402) {
    return new Response(JSON.stringify({ success: false, error: 'Créditos IA insuficientes.' }),
      { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ success: false, error: `Erro IA: ${response.status}` }),
    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function parseJsonFromAi(content: string): any {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    console.error('Failed to parse AI JSON:', content);
    return {};
  }
}
