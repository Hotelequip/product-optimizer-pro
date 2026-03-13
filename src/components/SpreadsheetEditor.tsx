import { useState } from "react";
import { Product, useUpdateProduct } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wand2, Image as ImageIcon, Loader2, Check, X, Globe, Zap, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";

interface EditableCell {
  productId: string;
  field: string;
}

export function SpreadsheetEditor({ products }: { products: Product[] }) {
  const updateProduct = useUpdateProduct();
  const { toast } = useToast();
  const [editingCell, setEditingCell] = useState<EditableCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [generatingImageId, setGeneratingImageId] = useState<string | null>(null);
  const [scrapingId, setScrapingId] = useState<string | null>(null);
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  const startEdit = (productId: string, field: string, currentValue: any) => {
    setEditingCell({ productId, field });
    setEditValue(String(currentValue ?? ""));
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { productId, field } = editingCell;
    let value: any = editValue;
    if (field === "cost" || field === "price") value = parseFloat(editValue) || 0;
    if (field === "stock") value = parseInt(editValue) || 0;
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
        await updateProduct.mutateAsync({ id: product.id, description: data.enriched.description, last_enriched_at: new Date().toISOString() });
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
      } else {
        toast({ title: "Erro ao gerar imagem", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setGeneratingImageId(null);
  };

  // Web Scrape - search or supplier
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
        if (data.enriched.seo_title) updates.seo_title = data.enriched.seo_title;
        if (data.enriched.meta_description) updates.meta_description = data.enriched.meta_description;
        if (data.enriched.specifications) updates.specifications = data.enriched.specifications;
        if (data.enriched.tags) updates.tags = data.enriched.tags;
        await updateProduct.mutateAsync(updates);
        toast({
          title: hasSupplier ? "Dados do fornecedor extraídos!" : "Dados encontrados na web!",
          description: data.enriched.specifications?.length
            ? `${data.enriched.specifications.length} especificações encontradas`
            : "Produto enriquecido",
        });
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
    if (selected.length === 0) {
      toast({ title: "Selecione produtos para enriquecer", variant: "destructive" });
      return;
    }
    setBulkEnriching(true);
    toast({ title: `Enriquecendo ${selected.length} produtos...`, description: "Isso pode levar alguns minutos" });

    try {
      const { data, error } = await supabase.functions.invoke("web-scrape-product", {
        body: {
          action: "bulk_enrich",
          products: selected.map(p => ({
            id: p.id, name: p.name, sku: p.sku, supplier_url: p.supplier_url,
          })),
        },
      });
      if (error) throw error;

      if (data.success && data.results) {
        let enriched = 0;
        for (const result of data.results) {
          if (result.success && result.enriched) {
            const updates: any = { id: result.product_id, last_enriched_at: new Date().toISOString() };
            if (result.enriched.description) updates.description = result.enriched.description;
            if (result.enriched.brand) updates.brand = result.enriched.brand;
            if (result.enriched.seo_title) updates.seo_title = result.enriched.seo_title;
            if (result.enriched.meta_description) updates.meta_description = result.enriched.meta_description;
            if (result.enriched.specifications) updates.specifications = result.enriched.specifications;
            if (result.enriched.tags) updates.tags = result.enriched.tags;
            try {
              await updateProduct.mutateAsync(updates);
              enriched++;
            } catch {}
          }
        }
        toast({ title: `${enriched} de ${selected.length} produtos enriquecidos!` });
      }
    } catch (e: any) {
      toast({ title: "Erro no enriquecimento em massa", description: e.message, variant: "destructive" });
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

  const renderEditableCell = (product: Product, field: keyof Product) => {
    if (isEditing(product.id, field)) {
      return (
        <div className="flex items-center gap-0.5">
          <Input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown} onBlur={saveEdit} className="h-6 text-[11px] px-1" />
        </div>
      );
    }

    const value = product[field];
    let displayValue: string;
    if (field === "cost" || field === "price") displayValue = `R$ ${Number(value).toFixed(2)}`;
    else displayValue = String(value ?? "");

    return (
      <div className="cursor-pointer hover:bg-accent/50 px-1 py-0.5 rounded text-[11px] truncate"
        onDoubleClick={() => startEdit(product.id, field, value)} title="Duplo clique para editar">
        {displayValue || <span className="text-muted-foreground italic">—</span>}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Bulk actions */}
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
              <th className="p-1 w-8"><Checkbox checked={selectedProducts.size === products.length && products.length > 0} onCheckedChange={toggleAll} /></th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-9">Img</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-20">SKU</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground min-w-[140px]">Nome</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-16">Marca</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground min-w-[150px]">Descrição</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-20">Custo</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-20">Preço</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-14">Estq</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-20">Status</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-24">Fornecedor</th>
              <th className="text-left p-1 text-[10px] font-medium text-muted-foreground w-32">IA</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="p-1 text-center">
                  <Checkbox checked={selectedProducts.has(product.id)} onCheckedChange={() => toggleProduct(product.id)} />
                </td>
                <td className="p-1">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="h-7 w-7 rounded object-cover" />
                  ) : (
                    <div className="h-7 w-7 rounded bg-muted flex items-center justify-center">
                      <ImageIcon className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                </td>
                <td className="p-1">{renderEditableCell(product, "sku")}</td>
                <td className="p-1">
                  <div className="flex items-center gap-1">
                    <div className="flex-1">{renderEditableCell(product, "name")}</div>
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setDetailProduct(product)} title="Ver detalhes">
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
                <td className="p-1">{renderEditableCell(product, "brand")}</td>
                <td className="p-1">
                  <div className="cursor-pointer hover:bg-accent/50 px-1 py-0.5 rounded text-[11px] truncate max-w-[180px]"
                    onDoubleClick={() => startEdit(product.id, "description", product.description)}>
                    {product.description || <span className="text-muted-foreground italic">Sem descrição</span>}
                  </div>
                  {isEditing(product.id, "description") && (
                    <Input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={handleKeyDown} onBlur={saveEdit} className="h-6 text-[11px] px-1" />
                  )}
                </td>
                <td className="p-1">{renderEditableCell(product, "cost")}</td>
                <td className="p-1">{renderEditableCell(product, "price")}</td>
                <td className="p-1">{renderEditableCell(product, "stock")}</td>
                <td className="p-1">
                  {isEditing(product.id, "status") ? (
                    <Select value={editValue} onValueChange={(v) => { updateProduct.mutateAsync({ id: product.id, status: v as any }); setEditingCell(null); }}>
                      <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="inactive">Inativo</SelectItem>
                        <SelectItem value="draft">Rascunho</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div onDoubleClick={() => startEdit(product.id, "status", product.status)} className="cursor-pointer">
                      <Badge variant={product.status === "active" ? "default" : product.status === "inactive" ? "secondary" : "outline"} className="text-[9px] px-1">
                        {product.status === "active" ? "Ativo" : product.status === "inactive" ? "Inativo" : "Rasc"}
                      </Badge>
                    </div>
                  )}
                </td>
                <td className="p-1">{renderEditableCell(product, "supplier_url")}</td>
                <td className="p-1">
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => scrapeProduct(product)} disabled={scrapingId === product.id}
                      title={product.supplier_url ? "Scrape fornecedor" : "Buscar na web"}>
                      {scrapingId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => enrichProduct(product)} disabled={enrichingId === product.id} title="Enriquecer IA">
                      {enrichingId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => generateImage(product)} disabled={generatingImageId === product.id} title="Gerar imagem">
                      {generatingImageId === product.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
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
                  <div><span className="text-muted-foreground">Margem:</span> {detailProduct.cost > 0 ? ((detailProduct.price - detailProduct.cost) / detailProduct.cost * 100).toFixed(1) : 0}%</div>
                </div>

                {detailProduct.image_url && (
                  <img src={detailProduct.image_url} alt={detailProduct.name} className="w-full max-h-48 object-contain rounded-lg border" />
                )}

                {detailProduct.description && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Descrição</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detailProduct.description}</p>
                  </div>
                )}

                {detailProduct.seo_title && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">SEO</h4>
                    <p className="text-xs text-primary font-medium">{detailProduct.seo_title}</p>
                    <p className="text-xs text-muted-foreground">{detailProduct.meta_description}</p>
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

                {detailProduct.supplier_url && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Fornecedor</h4>
                    <a href={detailProduct.supplier_url} target="_blank" rel="noopener" className="text-xs text-primary underline">{detailProduct.supplier_url}</a>
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
