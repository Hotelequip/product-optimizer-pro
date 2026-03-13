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
    const { action, product_name, supplier_url, sku, products } = await req.json();

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

      for (const product of products.slice(0, 30)) {
        try {
          let imageUrl: string | null = null;

          // Strategy 1: If supplier_url exists, scrape it for images
          if (product.supplier_url) {
            let targetUrl = product.supplier_url;
            if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;

            // Try to find SKU-specific page
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
                console.log('Map error for image fetch:', e);
              }
            }

            const scrapeResp = await fetchWithRetry('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: firecrawlHeaders,
              body: JSON.stringify({
                url: targetUrl,
                formats: ['markdown', 'links'],
                onlyMainContent: true,
                waitFor: 5000,
              }),
            });

            if (scrapeResp.ok) {
              const scrapeData = await scrapeResp.json();
              const content = scrapeData.data?.markdown || scrapeData.markdown || '';
              
              // Extract image URLs from markdown content
              const imgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp|gif)[^\s)]*)\)/gi;
              const matches = [...content.matchAll(imgRegex)];
              if (matches.length > 0) {
                imageUrl = matches[0][1];
              }

              // Also check for HTML-style img tags in content
              if (!imageUrl) {
                const imgTagRegex = /src=["'](https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp|gif)[^\s"']*)/gi;
                const tagMatches = [...content.matchAll(imgTagRegex)];
                if (tagMatches.length > 0) {
                  imageUrl = tagMatches[0][1];
                }
              }
            }
          }

          // Strategy 2: Web search for product image
          if (!imageUrl) {
            const searchQuery = product.sku
              ? `${product.name} ${product.sku} produto imagem`
              : `${product.name} produto imagem`;

            const searchResp = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
              method: 'POST',
              headers: firecrawlHeaders,
              body: JSON.stringify({
                query: searchQuery,
                limit: 3,
                lang: 'pt',
                country: 'br',
                scrapeOptions: { formats: ['markdown'] },
              }),
            });

            if (searchResp.ok) {
              const searchData = await searchResp.json();
              const webResults = searchData.data || [];
              
              for (const result of webResults) {
                const md = result.markdown || '';
                const imgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp|gif)[^\s)]*)\)/gi;
                const matches = [...md.matchAll(imgRegex)];
                if (matches.length > 0) {
                  // Filter out tiny icons/logos by checking URL patterns
                  const goodImg = matches.find((m: RegExpMatchArray) => {
                    const url = m[1].toLowerCase();
                    return !url.includes('logo') && !url.includes('icon') && !url.includes('favicon') && !url.includes('avatar');
                  });
                  imageUrl = goodImg ? goodImg[1] : matches[0][1];
                  break;
                }

                // Also try img src pattern
                const imgTagRegex = /src=["'](https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp|gif)[^\s"']*)/gi;
                const tagMatches = [...md.matchAll(imgTagRegex)];
                if (tagMatches.length > 0) {
                  imageUrl = tagMatches[0][1];
                  break;
                }
              }
            }
          }

          // Strategy 3: Use AI to find the best image from search results
          if (!imageUrl) {
            const googleQuery = `${product.name} ${product.sku || ''} product photo`;
            const searchResp = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
              method: 'POST',
              headers: firecrawlHeaders,
              body: JSON.stringify({ query: googleQuery, limit: 2, scrapeOptions: { formats: ['markdown'] } }),
            });

            if (searchResp.ok) {
              const searchData = await searchResp.json();
              const webContent = (searchData.data || []).map((r: any) => (r.markdown || '').substring(0, 3000)).join('\n');
              
              if (webContent.length > 50) {
                const aiResp = await fetchWithRetry('https://ai.gateway.lovable.dev/v1/chat/completions', {
                  method: 'POST',
                  headers: aiHeaders,
                  body: JSON.stringify({
                    model: 'google/gemini-2.5-flash-lite',
                    messages: [{
                      role: 'user',
                      content: `From this web content, extract the best product image URL for "${product.name}". Return ONLY the URL, nothing else. If no valid product image URL found, return "NONE".\n\n${webContent}`,
                    }],
                  }),
                });

                if (aiResp.ok) {
                  const aiData = await aiResp.json();
                  const aiUrl = (aiData.choices?.[0]?.message?.content || '').trim();
                  if (aiUrl && aiUrl !== 'NONE' && aiUrl.startsWith('http')) {
                    imageUrl = aiUrl;
                  }
                }
              }
            }
          }

          results.push({ product_id: product.id, success: !!imageUrl, image_url: imageUrl });

          // Delay between products
          await new Promise(r => setTimeout(r, 300));
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
