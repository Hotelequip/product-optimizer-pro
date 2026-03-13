import { useState, useCallback, useMemo } from "react";
import { useProducts, useCreateProduct, useUpdateProduct, Product } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { useCatalogs, useCreateCatalog, useDeleteCatalog } from "@/hooks/useCatalogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Upload, Sheet, FileUp, Loader2, FolderPlus, Folder, FolderOpen, Trash2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SpreadsheetEditor } from "@/components/SpreadsheetEditor";
import { WooCommerceSync } from "@/components/WooCommerceSync";
import { supabase } from "@/integrations/supabase/client";

export default function Catalog() {
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const { data: catalogs = [] } = useCatalogs();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const createCatalog = useCreateCatalog();
  const deleteCatalog = useDeleteCatalog();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>("all");
  const [newCatalogName, setNewCatalogName] = useState("");
  const [showNewCatalogInput, setShowNewCatalogInput] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");

  // Filter products by selected catalog
  const filteredProducts = useMemo(() => {
    if (selectedCatalogId === "all") return products;
    if (selectedCatalogId === "uncategorized") return products.filter(p => !p.catalog_id);
    return products.filter(p => p.catalog_id === selectedCatalogId);
  }, [products, selectedCatalogId]);

  // Count products per catalog
  const catalogCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length, uncategorized: 0 };
    for (const p of products) {
      if (!p.catalog_id) { counts.uncategorized++; continue; }
      counts[p.catalog_id] = (counts[p.catalog_id] || 0) + 1;
    }
    return counts;
  }, [products]);

  const handleCreateCatalog = async () => {
    if (!newCatalogName.trim()) return;
    await createCatalog.mutateAsync(newCatalogName.trim());
    setNewCatalogName("");
    setShowNewCatalogInput(false);
  };

  const handleDeleteCatalog = async (id: string) => {
    await deleteCatalog.mutateAsync(id);
    if (selectedCatalogId === id) setSelectedCatalogId("all");
  };

  // Excel/CSV import — assigns to selected catalog
  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();

    setImporting(true);
    try {
      let rows: Record<string, string>[] = [];

      if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
        rows = jsonData.map(r => {
          const out: Record<string, string> = {};
          Object.keys(r).forEach(k => { out[k.trim().toLowerCase()] = String(r[k]).trim(); });
          return out;
        });
      } else if (ext === "csv") {
        const text = await file.text();
        const lines = text.split("\n").filter(Boolean);
        const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(",").map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => (row[h] = vals[idx] || ""));
          rows.push(row);
        }
      } else {
        toast({ title: "Formato não suportado", description: "Use .xlsx, .xls ou .csv", variant: "destructive" });
        setImporting(false);
        return;
      }

      const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;

      let imported = 0;
      for (const row of rows) {
        const name = row.name || row.nome || row["título"] || row.titulo || row.title || row["product name"] || row.produto || "";
        if (!name) continue;
        try {
          await createProduct.mutateAsync({
            name,
            description: row.description || row.descricao || row["descrição"] || null,
            sku: row.sku || row.ref || row["referência"] || row.referencia || row.codigo || row["código"] || null,
            cost: parseFloat(row.cost || row.custo || "0") || 0,
            price: parseFloat(row.price || row.preco || row["preço"] || row.pvp || "0") || 0,
            stock: parseInt(row.stock || row.estoque || row.qty || row.quantidade || "0") || 0,
            brand: row.brand || row.marca || null,
            supplier_url: row.supplier_url || row.url || row.fornecedor_url || null,
            status: "draft",
            catalog_id: catalogId,
          } as any);
          imported++;
        } catch {}
      }
      toast({ title: `${imported} produtos importados de ${file.name}!` });
    } catch (err: any) {
      toast({ title: "Erro na importação", description: err.message, variant: "destructive" });
    }
    setImporting(false);
    e.target.value = "";
  }, [createProduct, toast, selectedCatalogId]);

  // PDF import
  const handlePdfImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith(".pdf")) return;

    setImporting(true);
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
      }

      if (!fullText.trim()) {
        toast({ title: "PDF vazio", variant: "destructive" });
        setImporting(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("extract-products", { body: { text: fullText } });
      if (error) throw error;

      const catalogId = selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : null;

      if (data.success && data.products?.length > 0) {
        let imported = 0;
        for (const p of data.products) {
          try {
            await createProduct.mutateAsync({
              name: p.name,
              description: p.description || null,
              sku: p.sku || null,
              cost: p.cost || 0,
              price: p.price || 0,
              stock: p.stock || 0,
              brand: p.brand || null,
              status: "draft",
              catalog_id: catalogId,
            } as any);
            imported++;
          } catch {}
        }
        toast({ title: `${imported} produtos importados do PDF!` });
      } else {
        toast({ title: "Nenhum produto encontrado no PDF", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro ao processar PDF", description: err.message, variant: "destructive" });
    }
    setImporting(false);
    e.target.value = "";
  }, [createProduct, toast, selectedCatalogId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Catálogo</h1>
        <div className="flex gap-2">
          <label>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileImport} disabled={importing} />
            <Button variant="outline" asChild disabled={importing}>
              <span>{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Excel/CSV</span>
            </Button>
          </label>
          <label>
            <input type="file" accept=".pdf" className="hidden" onChange={handlePdfImport} disabled={importing} />
            <Button variant="outline" asChild disabled={importing}>
              <span><FileUp className="mr-2 h-4 w-4" />PDF</span>
            </Button>
          </label>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingProduct(null); }}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Novo Produto</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingProduct ? "Editar Produto" : "Novo Produto"}</DialogTitle>
              </DialogHeader>
              <ProductForm
                product={editingProduct}
                categories={categories}
                catalogs={catalogs}
                selectedCatalogId={selectedCatalogId}
                onSubmit={async (data) => {
                  if (editingProduct) {
                    await updateProduct.mutateAsync({ id: editingProduct.id, ...data });
                  } else {
                    await createProduct.mutateAsync(data);
                  }
                  setDialogOpen(false);
                  setEditingProduct(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Catalog/Folder selector - compact dropdown */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Folder className="h-4 w-4" />
              {selectedCatalogId === "all"
                ? "Todas as pastas"
                : selectedCatalogId === "uncategorized"
                ? "Sem pasta"
                : catalogs.find(c => c.id === selectedCatalogId)?.name || "Pasta"}
              <span className="text-xs opacity-70">
                ({selectedCatalogId === "all"
                  ? catalogCounts.all
                  : selectedCatalogId === "uncategorized"
                  ? catalogCounts.uncategorized || 0
                  : catalogCounts[selectedCatalogId] || 0})
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto" onCloseAutoFocus={() => setCatalogSearch("")}>
            <div className="px-2 py-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar pasta..."
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  className="h-7 text-xs pl-7"
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                />
              </div>
            </div>
            <DropdownMenuSeparator />
            {!catalogSearch && (
              <>
                <DropdownMenuItem onClick={() => setSelectedCatalogId("all")} className="gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Todas as pastas
                  <span className="ml-auto text-xs text-muted-foreground">{catalogCounts.all}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCatalogId("uncategorized")} className="gap-2">
                  <Folder className="h-4 w-4" />
                  Sem pasta
                  <span className="ml-auto text-xs text-muted-foreground">{catalogCounts.uncategorized || 0}</span>
                </DropdownMenuItem>
                {catalogs.length > 0 && <DropdownMenuSeparator />}
              </>
            )}
            {catalogs
              .filter(cat => !catalogSearch || cat.name.toLowerCase().includes(catalogSearch.toLowerCase()))
              .map(cat => (
              <DropdownMenuItem key={cat.id} className="gap-2 group" onClick={() => setSelectedCatalogId(cat.id)}>
                <Folder className="h-4 w-4" />
                <span className="flex-1 truncate">{cat.name}</span>
                <span className="text-xs text-muted-foreground">{catalogCounts[cat.id] || 0}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); handleDeleteCatalog(cat.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </DropdownMenuItem>
            ))}
            {catalogSearch && catalogs.filter(cat => cat.name.toLowerCase().includes(catalogSearch.toLowerCase())).length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">Nenhuma pasta encontrada</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {showNewCatalogInput ? (
          <div className="flex items-center gap-1">
            <Input
              placeholder="Nome da pasta..."
              value={newCatalogName}
              onChange={e => setNewCatalogName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateCatalog(); if (e.key === "Escape") setShowNewCatalogInput(false); }}
              className="h-8 w-40 text-sm"
              autoFocus
            />
            <Button size="sm" onClick={handleCreateCatalog} disabled={!newCatalogName.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowNewCatalogInput(true)} className="gap-1.5 border-dashed">
            <FolderPlus className="h-3.5 w-3.5" />
            Nova Pasta
          </Button>
        )}
      </div>

      <Tabs defaultValue="spreadsheet" className="space-y-4">
        <TabsList>
          <TabsTrigger value="spreadsheet" className="gap-2"><Sheet className="h-4 w-4" />Planilha</TabsTrigger>
          <TabsTrigger value="sync">🔄 WooCommerce</TabsTrigger>
        </TabsList>

        <TabsContent value="spreadsheet">
          <Card>
            <CardHeader>
              <p className="text-xs text-muted-foreground">
                💡 Importe Excel/PDF e os produtos aparecem aqui. Selecione uma pasta antes de importar para organizar.
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Carregando...</p>
              ) : filteredProducts.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {products.length === 0
                    ? "Nenhum produto encontrado. Importe um ficheiro Excel ou PDF."
                    : "Nenhum produto nesta pasta."}
                </p>
              ) : (
                <SpreadsheetEditor products={filteredProducts} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync">
          <WooCommerceSync />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProductForm({
  product,
  categories,
  catalogs,
  selectedCatalogId,
  onSubmit,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
  catalogs: { id: string; name: string }[];
  selectedCatalogId: string;
  onSubmit: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name || "");
  const [description, setDescription] = useState(product?.description || "");
  const [sku, setSku] = useState(product?.sku || "");
  const [categoryId, setCategoryId] = useState(product?.category_id || "none");
  const [catalogId, setCatalogId] = useState(
    (product as any)?.catalog_id || (selectedCatalogId !== "all" && selectedCatalogId !== "uncategorized" ? selectedCatalogId : "none")
  );
  const [cost, setCost] = useState(product?.cost?.toString() || "0");
  const [price, setPrice] = useState(product?.price?.toString() || "0");
  const [stock, setStock] = useState(product?.stock?.toString() || "0");
  const [status, setStatus] = useState(product?.status || "draft");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onSubmit({
      name,
      description: description || null,
      sku: sku || null,
      category_id: categoryId === "none" ? null : categoryId,
      catalog_id: catalogId === "none" ? null : catalogId,
      cost: parseFloat(cost),
      price: parseFloat(price),
      stock: parseInt(stock),
      status,
      image_url: product?.image_url || null,
    });
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>SKU</Label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Referência" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Descrição</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Custo (R$)</Label>
          <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Preço (R$)</Label>
          <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Estoque</Label>
          <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Pendente</SelectItem>
              <SelectItem value="active">Publicado</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Categoria</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem categoria</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Pasta</Label>
          <Select value={catalogId} onValueChange={setCatalogId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem pasta</SelectItem>
              {catalogs.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Salvando..." : product ? "Atualizar" : "Criar Produto"}
      </Button>
    </form>
  );
}
