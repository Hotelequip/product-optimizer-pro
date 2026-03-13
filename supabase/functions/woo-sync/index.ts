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

      for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);
        const wooProducts = batch.map((p: any) => ({
          name: p.name,
          description: p.description || '',
          regular_price: String(p.price || 0),
          stock_quantity: p.stock || 0,
          manage_stock: true,
          status: p.status === 'active' ? 'publish' : 'draft',
          images: p.image_url ? [{ src: p.image_url }] : [],
        }));

        // Use batch endpoint
        const response = await fetch(`${baseUrl}/wp-json/wc/v3/products/batch`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${encodedCredentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ create: wooProducts }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('WooCommerce batch error:', errText);
          results.push({ batch: i / BATCH_SIZE + 1, error: `Status ${response.status}` });
        } else {
          const data = await response.json();
          results.push({ batch: i / BATCH_SIZE + 1, created: data.create?.length || 0 });
        }
      }

      return new Response(JSON.stringify({ success: true, results }),
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
