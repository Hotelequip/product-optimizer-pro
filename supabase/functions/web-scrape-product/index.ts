const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { product_name, action } = await req.json();

    if (!product_name) {
      return new Response(JSON.stringify({ success: false, error: 'Nome do produto é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'Firecrawl não configurado. Conecte o Firecrawl nas configurações.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'LOVABLE_API_KEY não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 1: Search the web for product info
    console.log('Searching for product:', product_name);
    const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `${product_name} especificações preço ficha técnica`,
        limit: 5,
        lang: 'pt',
        country: 'br',
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    if (!searchResponse.ok) {
      const errText = await searchResponse.text();
      console.error('Firecrawl search error:', errText);
      if (searchResponse.status === 402) {
        return new Response(JSON.stringify({ success: false, error: 'Créditos Firecrawl insuficientes. Atualize seu plano com o cupom LOVABLE50 para 50% de desconto.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: false, error: `Erro na busca: ${searchResponse.status}` }),
        { status: searchResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const searchData = await searchResponse.json();
    const results = searchData.data || [];

    if (results.length === 0) {
      return new Response(JSON.stringify({ success: true, enriched: null, message: 'Nenhum resultado encontrado na web' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 2: Compile web data and send to AI for structured extraction
    const webContent = results.map((r: any, i: number) => 
      `--- Source ${i + 1}: ${r.title || r.url} ---\n${(r.markdown || r.description || '').substring(0, 3000)}`
    ).join('\n\n');

    const prompt = `You are a product data specialist. Based on the web search results below, extract and compile comprehensive product information for "${product_name}".

Web search results:
${webContent.substring(0, 12000)}

Return a JSON object with:
{
  "description": "Rich, SEO-optimized product description in Portuguese (Brazilian), 2-3 paragraphs",
  "short_description": "One sentence summary in Portuguese",
  "specifications": [{"name": "spec name", "value": "spec value"}],
  "suggested_price_range": {"min": number, "max": number, "currency": "BRL"},
  "suggested_category": "category name in Portuguese",
  "seo_title": "SEO title max 60 chars in Portuguese",
  "meta_description": "Meta description max 160 chars in Portuguese",
  "tags": ["tag1", "tag2"],
  "brand": "brand name if found",
  "sources": ["url1", "url2"]
}

Only include fields where you found reliable data. Return valid JSON only.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You are an e-commerce product data specialist. Extract and structure product information from web sources. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ success: false, error: 'Limite de requisições IA excedido. Tente novamente.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ success: false, error: 'Créditos IA insuficientes.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: false, error: `Erro IA: ${aiResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '{}';

    let enriched;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      enriched = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      console.error('Failed to parse AI response:', content);
      enriched = {};
    }

    // Add raw search results for transparency
    enriched.raw_sources = results.map((r: any) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));

    return new Response(JSON.stringify({ success: true, enriched }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Web scrape error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
