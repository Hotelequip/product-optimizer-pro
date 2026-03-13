const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, product } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'enrich') {
      const prompt = `You are a product data enrichment specialist for e-commerce. 
Given this product information, enrich it with:
1. A compelling SEO-optimized description in Portuguese (Brazilian)
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

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: 'You are an e-commerce product enrichment AI. Return only valid JSON.' },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(JSON.stringify({ success: false, error: 'Limite de requisições excedido' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ success: false, error: 'Créditos insuficientes' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: false, error: `AI error: ${response.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      
      let enriched;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        enriched = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        enriched = {};
      }

      return new Response(JSON.stringify({ success: true, enriched }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'generate_image') {
      const imagePrompt = `Professional e-commerce product photo of: ${product.name}. ${product.description || ''}. Clean white background, studio lighting, high quality product photography, centered composition.`;

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3.1-flash-image-preview',
          messages: [
            { role: 'user', content: imagePrompt },
          ],
          modalities: ['image', 'text'],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(JSON.stringify({ success: false, error: 'Limite de requisições excedido' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ success: false, error: 'Créditos insuficientes' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: false, error: `Image generation failed: ${response.status}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

      if (!imageUrl) {
        return new Response(JSON.stringify({ success: false, error: 'Nenhuma imagem gerada' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ success: true, image_url: imageUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'optimize_image') {
      const { image_url, product_name } = product;
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3.1-flash-image-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `Enhance this product image for e-commerce: improve lighting, contrast, sharpness, and color balance. Keep the product centered on a clean white background. Product: ${product_name}` },
                { type: 'image_url', image_url: { url: image_url } }
              ]
            }
          ],
          modalities: ['image', 'text'],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) return new Response(JSON.stringify({ success: false, error: 'Limite de requisições excedido' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        if (response.status === 402) return new Response(JSON.stringify({ success: false, error: 'Créditos insuficientes' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ success: false, error: `Image optimization failed: ${response.status}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const data = await response.json();
      const optimizedUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!optimizedUrl) return new Response(JSON.stringify({ success: false, error: 'Nenhuma imagem otimizada gerada' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      return new Response(JSON.stringify({ success: true, image_url: optimizedUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'generate_scene') {
      const { image_url, product_name, description } = product;
      const scenePrompt = `Place this product (${product_name}) in a realistic, professional setting. ${description || ''} Create a lifestyle product photo showing the product being used in its natural environment with realistic lighting and surroundings. High quality commercial photography style.`;

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3.1-flash-image-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: scenePrompt },
                { type: 'image_url', image_url: { url: image_url } }
              ]
            }
          ],
          modalities: ['image', 'text'],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) return new Response(JSON.stringify({ success: false, error: 'Limite de requisições excedido' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        if (response.status === 402) return new Response(JSON.stringify({ success: false, error: 'Créditos insuficientes' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ success: false, error: `Scene generation failed: ${response.status}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const data = await response.json();
      const sceneUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!sceneUrl) return new Response(JSON.stringify({ success: false, error: 'Nenhuma imagem de cenário gerada' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      return new Response(JSON.stringify({ success: true, image_url: sceneUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: 'Ação inválida' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('AI enrichment error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
