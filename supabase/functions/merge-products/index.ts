const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { datasets } = await req.json();

    if (!datasets || !Array.isArray(datasets) || datasets.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nenhum dataset fornecido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If only one dataset, return it directly (no merge needed)
    if (datasets.length === 1) {
      return new Response(
        JSON.stringify({ success: true, products: datasets[0].products || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build a concise representation of each dataset
    const datasetsDescription = datasets.map((ds: any, i: number) => {
      const source = ds.source || `File ${i + 1}`;
      const products = (ds.products || []).slice(0, 500); // limit
      return `--- SOURCE: ${source} (${products.length} products) ---\n${JSON.stringify(products)}`;
    }).join('\n\n');

    const prompt = `You are a product data reconciliation expert. You have multiple product lists extracted from different files (Excel spreadsheets, PDFs, CSVs) for the SAME catalog/supplier.

Your job:
1. Cross-reference products across sources by matching SKU/reference codes and/or product names
2. For matched products, merge data taking the MOST COMPLETE and ACCURATE information from each source:
   - Prefer longer/more descriptive names
   - Take prices/costs from whichever source has them
   - If both sources have a price but they differ, prefer the Excel/CSV source (more structured)
   - Combine any extra fields (brand, description, etc.)
3. For products that appear in only one source, include them as-is
4. Remove exact duplicates
5. Ensure all numeric fields (cost, price, stock) are proper numbers, not strings

Return ONLY a valid JSON array. Each product object should have these fields (all optional except name):
- name (string, required)
- sku (string or null)
- description (string or null)
- cost (number or 0)
- price (number or 0)
- stock (number or 0)
- brand (string or null)

Return ONLY the JSON array. No markdown, no explanation.

${datasetsDescription}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a data merging assistant. Merge product lists and return only valid JSON arrays. Never include markdown formatting.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI API error:', errText);
      return new Response(
        JSON.stringify({ success: false, error: `AI merge failed [${response.status}]` }),
        { status: response.status >= 400 && response.status < 500 ? response.status : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';

    let products;
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      products = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      console.error('Failed to parse AI merge response:', content);
      // Fallback: concatenate all products
      products = datasets.flatMap((ds: any) => ds.products || []);
    }

    return new Response(
      JSON.stringify({ success: true, products, merged: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error merging products:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
