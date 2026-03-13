import { useState, useMemo } from "react";
import { Product, useUpdateProduct, useDeleteProduct } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { useCatalogs } from "@/hooks/useCatalogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Wand2, Image as ImageIcon, Loader2, Globe, Zap, Pencil, Settings, Check, ExternalLink, Filter, X, FolderInput, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface EditableCell {
  productId: string;
  field: string;
}

function slugify(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function calcSeoScore(p: Product): number {
  let score = 0;
  if (p.optimized_title || p.seo_title) score += 25;
  if (p.meta_description || p.short_description) score += 25;
  if (p.slug) score += 15;
  if (p.description && p.description.length > 50) score += 15;
  if (p.tags && p.tags.length > 0) score += 10;
  if (p.image_url) score += 10;
  return score;
}

export function SpreadsheetEditor({ products }: { products: Product[] }) {
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const { data: catalogs = [] } = useCatalogs();
  const { data: categories = [] } = useCategories();
  const { toast } = useToast();
  const [editingCell, setEditingCell] = useState<EditableCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [generatingImageId, setGeneratingImageId] = useState<string | null>(null);
  const [scrapingId, setScrapingId] = useState<string | null>(null);
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const setFilter = (col: string, value: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (value) next[col] = value; else delete next[col];
      return next;
    });
  };
  const clearFilters = () => setColumnFilters({});
  const hasFilters = Object.keys(columnFilters).length > 0;

  const filteredProducts = useMemo(() => {
    if (!hasFilters) return products;
    return products.filter(p => {
      for (const [col, val] of Object.entries(columnFilters)) {
        const v = val.toLowerCase();
        if (col === "sku" && !(p.sku || "").toLowerCase().includes(v)) return false;
        if (col === "name" && !p.name.toLowerCase().includes(v)) return false;
        if (col === "optimized_title" && !(p.optimized_title || "").toLowerCase().includes(v)) return false;
        if (col === "category") {
          const catName = categories.find(c => c.id === p.category_id)?.name || "";
          if (!catName.toLowerCase().includes(v)) return false;
        }
        if (col === "short_description" && !(p.short_description || "").toLowerCase().includes(v)) return false;
        if (col === "slug" && !(p.slug || "").toLowerCase().includes(v)) return false;
        if (col === "status" && v !== "all" && p.status !== v) return false;
        if (col === "enrichment_phase" && v !== "all") {
          const phase = p.enrichment_phase || 0;
          if (String(phase) !== v) return false;
        }
      }
      return true;
    });
  }, [products, columnFilters, categories]);

  const startEdit = (productId: string, field: string, currentValue: any) => {
    setEditingCell({ productId, field });
    setEditValue(String(currentValue ?? ""));
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { productId, field } = editingCell;
    let value: any = editValue;
    if (field === "cost" || field === "price") value = parseFloat(editValue) || 0;
    if (field === "stock" || field === "seo_score" || field === "enrichment_phase") value = parseInt(editValue) || 0;
    try {
      await updateProduct.mutateAsync({ id: productId, [field]: value });
    } catch {}
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") cancelEdit();
  };

  const isEditing = (productId: string, field: string) =>
    editingCell?.productId === productId && editingCell?.field === field;

  // AI Enrich
  const enrichProduct = async (product: Product) => {
    setEnrichingId(product.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "enrich", product: { name: product.name, description: product.description, cost: product.cost, price: product.price, sku: product.sku, brand: product.brand } },
      });
      if (error) throw error;
      if (data.success && data.enriched?.description) {
        const slug = slugify(data.enriched.seo_title || product.name);
        await updateProduct.mutateAsync({
          id: product.id,
          description: data.enriched.description,
          optimized_title: data.enriched.seo_title || null,
          meta_description: data.enriched.meta_description || null,
          short_description: data.enriched.short_description || null,
          slug,
          enrichment_phase: Math.min((product.enrichment_phase || 0) + 1, 3),
          last_enriched_at: new Date().toISOString(),
        });
        toast({ title: "Produto enriquecido com IA!" });
      } else {
        toast({ title: "Erro ao enriquecer", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setEnrichingId(null);
  };

  // Generate Image
  const generateImage = async (product: Product) => {
    setGeneratingImageId(product.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-enrich", {
        body: { action: "generate_image", product: { name: product.name, description: product.description } },
      });
      if (error) throw error;
      if (data.success && data.image_url) {
        const base64Data = data.image_url.split(",")[1];
        const byteArray = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const fileName = `${product.id}-${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(fileName, byteArray, { contentType: "image/png", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);
        await updateProduct.mutateAsync({ id: product.id, image_url: urlData.publicUrl });
        toast({ title: "Imagem gerada com IA!" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setGeneratingImageId(null);
  };

  // Web Scrape
  const scrapeProduct = async (product: Product) => {
    setScrapingId(product.id);
    try {
      const hasSupplier = product.supplier_url && product.supplier_url.trim().length > 0;
      const { data, error } = await supabase.functions.invoke("web-scrape-product", {
        body: hasSupplier
          ? { action: "scrape_supplier", supplier_url: product.supplier_url, sku: product.sku, product_name: product.name }
          : { action: "search_enrich", product_name: product.name, sku: product.sku },
      });
      if (error) throw error;
      if (data.success && data.enriched) {
        const updates: any = { id: product.id, last_enriched_at: new Date().toISOString() };
        if (data.enriched.description) updates.description = data.enriched.description;
        if (data.enriched.brand) updates.brand = data.enriched.brand;
        if (data.enriched.seo_title) { updates.optimized_title = data.enriched.seo_title; updates.slug = slugify(data.enriched.seo_title); }
        if (data.enriched.meta_description) updates.meta_description = data.enriched.meta_description;
        if (data.enriched.short_description) updates.short_description = data.enriched.short_description;
        if (data.enriched.specifications) updates.specifications = data.enriched.specifications;
        if (data.enriched.tags) updates.tags = data.enriched.tags;
        updates.enrichment_phase = Math.min((product.enrichment_phase || 0) + 1, 3);
        await updateProduct.mutateAsync(updates);
        toast({ title: hasSupplier ? "Dados do fornecedor extraídos!" : "Dados encontrados na web!" });
      } else {
        toast({ title: data.message || "Nenhum dado encontrado", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro no web scraping", description: e.message, variant: "destructive" });
    }
    setScrapingId(null);
  };

  // Bulk enrich
  const bulkEnrich = async () => {
    const selected = products.filter(p => selectedProducts.has(p.id));
    if (selected.length === 0) { toast({ title: "Selecione produtos", variant: "destructive" }); return; }
    setBulkEnriching(true);
    toast({ title: `Enriquecendo ${selected.length} produtos...` });
    try {
      const { data, error } = await supabase.functions.invoke("web-scrape-product", {
        body: { action: "bulk_enrich", products: selected.map(p => ({ id: p.id, name: p.name, sku: p.sku, supplier_url: p.supplier_url })) },
      });
      if (error) throw error;
      if (data.success && data.results) {
        let enriched = 0;
        for (const result of data.results) {
          if (result.success && result.enriched) {
            const updates: any = { id: result.product_id, last_enriched_at: new Date().toISOString(), enrichment_phase: 1 };
            if (result.enriched.description) updates.description = result.enriched.description;
            if (result.enriched.brand) updates.brand = result.enriched.brand;
            if (result.enriched.seo_title) { updates.optimized_title = result.enriched.seo_title; updates.slug = slugify(result.enriched.seo_title); }
            if (result.enriched.meta_description) updates.meta_description = result.enriched.meta_description;
            if (result.enriched.specifications) updates.specifications = result.enriched.specifications;
            if (result.enriched.tags) updates.tags = result.enriched.tags;
            try { await updateProduct.mutateAsync(updates); enriched++; } catch {}
          }
        }
        toast({ title: `${enriched} de ${selected.length} produtos enriquecidos!` });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setBulkEnriching(false);
    setSelectedProducts(new Set());
  };

  const toggleAll = () => {
    if (selectedProducts.size === products.length) setSelectedProducts(new Set());
    else setSelectedProducts(new Set(products.map(p => p.id)));
  };
  const toggleProduct = (id: string) => {
    const next = new Set(selectedProducts);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedProducts(next);
  };

  const renderCell = (product: Product, field: keyof Product, maxW?: string) => {
    if (isEditing(product.id, field)) {
      return (
        <Input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown} onBlur={saveEdit} className="h-7 text-xs px-2 w-full" />
      );
    }
    const value = product[field];
    return (
      <div className={`cursor-pointer hover:bg-accent/50 px-1 py-0.5 rounded text-xs truncate ${maxW || ""}`}
        onDoubleClick={() => startEdit(product.id, field, value)} title={String(value ?? "")}>
        {String(value ?? "") || <span className="text-muted-foreground">—</span>}
      </div>
    );
  };

  const getCategoryName = (catId: string | null) => {
    if (!catId) return "—";
    return categories.find(c => c.id === catId)?.name || "—";
  };

  const getStatusBadge = (product: Product) => {
    const labels: Record<string, string> = { active: "Publicado", inactive: "Inativo", draft: "Pendente" };
    const colors: Record<string, string> = {
      active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      inactive: "bg-muted text-muted-foreground",
      draft: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    };
    return (
      <div className="flex flex-wrap items-center gap-1" onDoubleClick={() => startEdit(product.id, "status", product.status)}>
        <Badge className={`text-[10px] px-1.5 py-0 border ${colors[product.status]} cursor-pointer`}>
          {labels[product.status]}
        </Badge>
        {product.supplier_url && <Badge variant="outline" className="text-[9px] px-1 py-0 border-sky-500/40 text-sky-400">Web</Badge>}
        {product.last_enriched_at && <Badge variant="outline" className="text-[9px] px-1 py-0 border-violet-500/40 text-violet-400">IA</Badge>}
        {product.tags && product.tags.length > 0 && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-500/40 text-orange-400">⚠{product.tags.length}</Badge>
        )}
      </div>
    );
  };

  const getPhaseButtons = (product: Product) => {
    const phase = product.enrichment_phase || 0;
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3].map(n => (
          <span key={n} className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-medium border
            ${phase >= n ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 text-muted-foreground border-border"}`}>
            {n}
          </span>
        ))}
      </div>
    );
  };

  const getSeoScore = (product: Product) => {
    const score = product.seo_score || calcSeoScore(product);
    const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
    return <span className={`text-xs font-bold ${color}`}>{score}</span>;
  };

  return (
    <div className="space-y-3">
      {selectedProducts.size > 0 && (
        <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg border">
          <span className="text-sm font-medium">{selectedProducts.size} selecionados</span>
          <Button size="sm" onClick={bulkEnrich} disabled={bulkEnriching}>
            {bulkEnriching ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Zap className="mr-2 h-3 w-3" />}
            Enriquecer em Massa
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedProducts(new Set())}>Limpar</Button>
        </div>
      )}

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="p-2 w-8"><Checkbox checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0} onCheckedChange={toggleAll} /></th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-24">SKU</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground min-w-[160px]">Título Original</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground min-w-[160px]">Título Otimizado</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-32">Categoria</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground min-w-[120px]">Desc. Curta</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-28">Slug</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-36">Estado</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-20">Fases</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-12">SEO</th>
              <th className="text-left p-2 text-[10px] font-medium text-muted-foreground w-28">
                {hasFilters && (
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={clearFilters} title="Limpar filtros">
                    <X className="h-3 w-3 mr-0.5" />Limpar
                  </Button>
                )}
              </th>
            </tr>
            {/* Filter row */}
            <tr className="border-b bg-muted/20">
              <td className="p-1"><Filter className="h-3 w-3 text-muted-foreground mx-auto" /></td>
              <td className="p-1"><Input placeholder="SKU..." value={columnFilters.sku || ""} onChange={e => setFilter("sku", e.target.value)} className="h-6 text-[10px] px-1" /></td>
              <td className="p-1"><Input placeholder="Título..." value={columnFilters.name || ""} onChange={e => setFilter("name", e.target.value)} className="h-6 text-[10px] px-1" /></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1">
                <Select value={columnFilters.status || "all"} onValueChange={v => setFilter("status", v === "all" ? "" : v)}>
                  <SelectTrigger className="h-6 text-[10px] px-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Publicado</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                    <SelectItem value="draft">Pendente</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="p-1"></td>
              <td className="p-1"></td>
              <td className="p-1"></td>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="p-2 text-center">
                  <Checkbox checked={selectedProducts.has(product.id)} onCheckedChange={() => toggleProduct(product.id)} />
                </td>
                <td className="p-2">{renderCell(product, "sku")}</td>
                <td className="p-2">{renderCell(product, "name", "max-w-[200px]")}</td>
                <td className="p-2">{renderCell(product, "optimized_title", "max-w-[200px]")}</td>
                <td className="p-2">
                  <div className="text-xs truncate max-w-[130px]">{getCategoryName(product.category_id)}</div>
                </td>
                <td className="p-2">{renderCell(product, "short_description", "max-w-[150px]")}</td>
                <td className="p-2">{renderCell(product, "slug", "max-w-[120px]")}</td>
                <td className="p-2">{getStatusBadge(product)}</td>
                <td className="p-2">{getPhaseButtons(product)}</td>
                <td className="p-2">{getSeoScore(product)}</td>
                <td className="p-2">
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDetailProduct(product)} title="Editar">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => scrapeProduct(product)} disabled={scrapingId === product.id} title="Web scrape">
                      {scrapingId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => enrichProduct(product)} disabled={enrichingId === product.id} title="Enriquecer IA">
                      {enrichingId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => {
                        const slug = slugify(product.optimized_title || product.seo_title || product.name);
                        const score = calcSeoScore(product);
                        updateProduct.mutateAsync({ id: product.id, slug, seo_score: score, status: "active" });
                        toast({ title: "Produto aprovado!" });
                      }} title="Aprovar">
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Product Detail Dialog */}
      <Dialog open={!!detailProduct} onOpenChange={() => setDetailProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{detailProduct?.name}</DialogTitle>
          </DialogHeader>
          {detailProduct && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">SKU:</span> {detailProduct.sku || "—"}</div>
                  <div><span className="text-muted-foreground">Marca:</span> {detailProduct.brand || "—"}</div>
                  <div><span className="text-muted-foreground">Custo:</span> R$ {Number(detailProduct.cost).toFixed(2)}</div>
                  <div><span className="text-muted-foreground">Preço:</span> R$ {Number(detailProduct.price).toFixed(2)}</div>
                  <div><span className="text-muted-foreground">Estoque:</span> {detailProduct.stock}</div>
                  <div><span className="text-muted-foreground">Slug:</span> {detailProduct.slug || "—"}</div>
                </div>

                {detailProduct.image_url && (
                  <img src={detailProduct.image_url} alt={detailProduct.name} className="w-full max-h-48 object-contain rounded-lg border" />
                )}

                {(detailProduct.optimized_title || detailProduct.seo_title) && (
                  <div className="p-3 border rounded-lg bg-muted/30">
                    <h4 className="text-sm font-medium mb-1">SEO Preview</h4>
                    <p className="text-sm text-primary font-medium">{detailProduct.optimized_title || detailProduct.seo_title}</p>
                    <p className="text-xs text-muted-foreground">{detailProduct.meta_description || detailProduct.short_description}</p>
                    {detailProduct.slug && <p className="text-[10px] text-emerald-500 mt-1">/{detailProduct.slug}</p>}
                  </div>
                )}

                {detailProduct.description && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Descrição</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detailProduct.description}</p>
                  </div>
                )}

                {detailProduct.specifications && (detailProduct.specifications as any[]).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Especificações</h4>
                    <div className="grid grid-cols-2 gap-1">
                      {(detailProduct.specifications as any[]).map((spec: any, i: number) => (
                        <div key={i} className="text-xs bg-muted/50 rounded px-2 py-1">
                          <span className="text-muted-foreground">{spec.name}:</span> {spec.value}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detailProduct.tags && detailProduct.tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Tags</h4>
                    <div className="flex flex-wrap gap-1">
                      {detailProduct.tags.map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {detailProduct.last_enriched_at && (
                  <p className="text-[10px] text-muted-foreground">Último enriquecimento: {new Date(detailProduct.last_enriched_at).toLocaleString('pt-BR')}</p>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
